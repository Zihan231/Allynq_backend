import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, In, IsNull, LessThanOrEqual } from 'typeorm';
import { AuditService } from '../admin/audit.service.js';
import { Club } from '../clubs/entities/club.entity.js';
import { assertNotFrozen } from '../common/frozen.js';
import { createPaginatedResult } from '../common/interfaces/paginated-result.interface.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import type { NotificationParams } from '../notifications/entities/notification.entity.js';
import { SettingsService } from '../settings/settings.service.js';
import { paymentRef } from '../transfers/contract-fee.js';
import type { PaymentMethod } from '../transfers/entities/transfer-offer.entity.js';
import { PLATFORM_WALLET_ID } from '../transfers/entities/wallet.entity.js';
import { TransfersService } from '../transfers/transfers.service.js';
import { WalletsService, type WalletOwner } from '../transfers/wallets.service.js';
import { EfootballProfile } from '../users/entities/efootball-profile.entity.js';
import { User } from '../users/entities/user.entity.js';
import { removeCoachingFiles, toPostMedia } from './coaching-upload.js';
import type {
  AdminCoachPostsQueryDto,
  CoachesQueryDto,
  CounterCoachingDealDto,
  CreateCoachingDealDto,
  CreateCoachPostDto,
  RespondCoachingDealDto,
  ReviewCoachPostDto,
  UpdateCoachProfileDto,
} from './dto/coaching.dto.js';
import { CoachPost } from './entities/coach-post.entity.js';
import { CoachProfile } from './entities/coach-profile.entity.js';
import {
  CoachingDeal,
  OPEN_COACHING_STATUSES,
  type CoachingParty,
  type CoachingStatus,
} from './entities/coaching-deal.entity.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const COACH_LINK = '/dashboard/coach';
const clubLink = (clubId: string) => `/dashboard/efootball/clubs/${clubId}?tab=transfers`;
const MAX_LINKS = 5;

export interface PartyRef {
  id: string;
  name: string;
  dpUrl: string | null;
}

export interface CoachingDealView {
  id: string;
  status: CoachingStatus;
  origin: CoachingParty;
  turn: CoachingParty;
  feeTk: number;
  heldTk: number;
  days: number;
  /** The cut (fixed once agreed; the current setting before that) and what the coach gets. */
  commissionPct: number;
  commissionTk: number;
  netTk: number;
  message: string | null;
  bids: CoachingDeal['bids'];
  coach: PartyRef;
  club: PartyRef & { color: string | null };
  expiresAt: string;
  createdAt: string;
  startedAt: string | null;
  endsAt: string | null;
  endedAt: string | null;
  endReason: CoachingDeal['endReason'];
  paymentRef: string | null;
  paidAt: string | null;
}

type Ctx = { ip: string | null };

/**
 * Coaches: a public profile, tutorial posts (shown once staff approve them) and coaching
 * deals with clubs. A deal is for a number of days and a fee the club pays: held while
 * the deal is open, paid to the coach minus the platform's cut when it's agreed. A coach
 * works with one club at a time; a deal agreed meanwhile starts when the current one ends.
 */
@Injectable()
export class CoachingService {
  private readonly logger = new Logger(CoachingService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly settingsService: SettingsService,
    private readonly walletsService: WalletsService,
    private readonly transfers: TransfersService,
    private readonly notificationsService: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------ helpers

  private clubWallet(clubId: string): WalletOwner {
    return { type: 'club', id: clubId };
  }

  /** The user, who must have taken on the coach role (and be in good standing). */
  private async coachUser(em: EntityManager, userId: string): Promise<User> {
    const user = await em.getRepository(User).findOne({ where: { id: userId } });
    if (!user || user.deletedAt || user.bannedAt) throw new NotFoundException('Coach not found');
    if (!(user.roles ?? []).includes('coach')) {
      throw new BadRequestException(`${user.name} isn't a coach. Add the Coach role in your profile first.`);
    }
    return user;
  }

  private async requireCoachProfile(em: EntityManager, userId: string): Promise<CoachProfile> {
    const profile = await em.getRepository(CoachProfile).findOne({ where: { userId } });
    if (!profile) throw new BadRequestException('Set up your coach profile first');
    return profile;
  }

  private async lockDeal(em: EntityManager, id: string): Promise<CoachingDeal> {
    const deal = await em
      .getRepository(CoachingDeal)
      .createQueryBuilder('d')
      .setLock('pessimistic_write')
      .where('d.id = :id', { id })
      .getOne();
    if (!deal) throw new NotFoundException('Coaching deal not found');
    return deal;
  }

  /** Only the side whose turn it is may answer: the coach himself, or the club's President / GS. */
  private async assertParty(em: EntityManager, deal: CoachingDeal, party: CoachingParty, callerId: string): Promise<void> {
    if (party === 'coach') {
      if (deal.coachUserId !== callerId) throw new ForbiddenException('Only the coach can answer this');
      return;
    }
    await this.transfers.assertClubLeader(em, deal.clubId, callerId);
  }

  private assertDays(days: number, min: number, max: number): void {
    if (days < min || days > max) throw new BadRequestException(`A coaching deal can last ${min} to ${max} days`);
  }

  private commissionOf(feeTk: number, pct: number): number {
    return Math.round((feeTk * pct) / 100);
  }

  /** Club money for the deal brought up (or down) to the fee on the table. */
  private async holdFee(em: EntityManager, deal: CoachingDeal, method: PaymentMethod | undefined, clubName: string, coachName: string) {
    if (deal.feeTk > deal.heldTk && !method && !deal.paymentMethod) throw new BadRequestException('Choose a payment method');
    if (deal.feeTk === deal.heldTk) return;
    deal.paymentMethod = deal.feeTk > 0 ? (method ?? deal.paymentMethod) : null;
    deal.paymentRef = deal.feeTk > 0 ? (deal.paymentRef ?? paymentRef()) : null;
    await this.walletsService.rehold(em, this.clubWallet(deal.clubId), deal.heldTk, deal.feeTk, {
      coachingDealId: deal.id,
      counterparty: `Coach: ${coachName}`,
      reference: deal.paymentRef,
    });
    deal.heldTk = deal.feeTk;
    void clubName;
  }

  private async refundHold(em: EntityManager, deal: CoachingDeal, coachName: string) {
    if (deal.heldTk <= 0) return;
    await this.walletsService.refund(em, this.clubWallet(deal.clubId), deal.heldTk, {
      coachingDealId: deal.id,
      counterparty: `Coach: ${coachName}`,
    });
    deal.heldTk = 0;
  }

  private async names(em: EntityManager, deal: CoachingDeal) {
    const coach = await em.getRepository(User).findOne({ where: { id: deal.coachUserId } });
    const club = await em.getRepository(Club).findOne({ where: { id: deal.clubId } });
    return { coachName: coach?.name ?? 'Coach', clubName: club?.name ?? 'Club' };
  }

  private async notify(userIds: string[], code: string, title: string, message: string, link: string, params: NotificationParams) {
    await Promise.all(
      [...new Set(userIds)].map((userId) =>
        this.notificationsService
          .createNotification(userId, { title, message, type: 'coaching', link, code, params })
          .catch((err) => this.logger.error(`Coaching notification to ${userId} failed: ${(err as Error).message}`)),
      ),
    );
  }

  private async notifyParty(deal: CoachingDeal, party: CoachingParty, code: string, title: string, message: string) {
    const { coachName, clubName } = await this.names(this.dataSource.manager, deal);
    const params = { coach: coachName, club: clubName, fee: deal.feeTk, days: deal.days };
    if (party === 'coach') await this.notify([deal.coachUserId], code, title, message, COACH_LINK, params);
    else await this.notify(await this.transfers.clubLeaderIds(deal.clubId), code, title, message, clubLink(deal.clubId), params);
  }

  async dealView(id: string): Promise<CoachingDealView> {
    const deal = await this.dataSource.getRepository(CoachingDeal).findOne({ where: { id }, relations: { coach: true, club: true } });
    if (!deal) throw new NotFoundException('Coaching deal not found');
    return this.toView(deal, (await this.settingsService.transfers()).coachingCommissionPct);
  }

  private toView(deal: CoachingDeal, currentPct: number): CoachingDealView {
    const pct = deal.commissionPct ?? currentPct;
    const commissionTk = deal.commissionTk ?? this.commissionOf(deal.feeTk, pct);
    return {
      id: deal.id,
      status: deal.status,
      origin: deal.origin,
      turn: deal.turn,
      feeTk: deal.feeTk,
      heldTk: deal.heldTk,
      days: deal.days,
      commissionPct: pct,
      commissionTk,
      netTk: deal.feeTk - commissionTk,
      message: deal.message,
      bids: deal.bids ?? [],
      coach: { id: deal.coachUserId, name: deal.coach?.name ?? 'Coach', dpUrl: deal.coach?.dpUrl ?? null },
      club: { id: deal.clubId, name: deal.club?.name ?? 'Club', dpUrl: deal.club?.dpUrl ?? null, color: deal.club?.color ?? null },
      expiresAt: deal.expiresAt.toISOString(),
      createdAt: deal.createdAt.toISOString(),
      startedAt: deal.startedAt?.toISOString() ?? null,
      endsAt: deal.endsAt?.toISOString() ?? null,
      endedAt: deal.endedAt?.toISOString() ?? null,
      endReason: deal.endReason,
      paymentRef: deal.paymentRef,
      paidAt: deal.paidAt?.toISOString() ?? null,
    };
  }

  private async views(deals: CoachingDeal[]): Promise<CoachingDealView[]> {
    const pct = (await this.settingsService.transfers()).coachingCommissionPct;
    return deals.map((d) => this.toView(d, pct));
  }

  // ------------------------------------------------------------------ profile

  /** The coach's own area: profile, every post (with its review status), deals and earnings. */
  async me(userId: string) {
    const em = this.dataSource.manager;
    const profile = await em.getRepository(CoachProfile).findOne({ where: { userId } });
    const posts = await em.getRepository(CoachPost).find({
      where: { coachUserId: userId, deletedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
    const deals = await em.getRepository(CoachingDeal).find({
      where: { coachUserId: userId },
      relations: { coach: true, club: true },
      order: { createdAt: 'DESC' },
    });
    const views = await this.views(deals);
    const earnedTk = views.filter((d) => d.paidAt && ['scheduled', 'active', 'completed', 'ended'].includes(d.status)).reduce((s, d) => s + d.netTk, 0);
    return {
      profile,
      posts: posts.filter((p) => !p.deletedAt),
      deals: views,
      current: views.find((d) => d.status === 'active') ?? null,
      earnedTk,
      settings: await this.settingsView(),
    };
  }

  async settingsView() {
    const s = await this.settingsService.transfers();
    return { commissionPct: s.coachingCommissionPct, minDays: s.minCoachingDays, maxDays: s.maxCoachingDays, offerExpiryDays: s.offerExpiryDays };
  }

  async upsertProfile(caller: User, dto: UpdateCoachProfileDto): Promise<CoachProfile> {
    await this.coachUser(this.dataSource.manager, caller.id);
    const repo = this.dataSource.getRepository(CoachProfile);
    const profile = (await repo.findOne({ where: { userId: caller.id } })) ?? repo.create({ userId: caller.id, headline: '', specialities: [] });
    if (dto.headline !== undefined) profile.headline = dto.headline.trim();
    if (dto.bio !== undefined) profile.bio = dto.bio?.trim() || null;
    if (dto.youtubeChannelUrl !== undefined) profile.youtubeChannelUrl = dto.youtubeChannelUrl?.trim() || null;
    if (dto.specialities !== undefined) profile.specialities = [...new Set(dto.specialities.map((s) => s.trim()).filter(Boolean))];
    if (dto.askingFeeTk !== undefined) profile.askingFeeTk = dto.askingFeeTk;
    if (dto.available !== undefined) profile.available = dto.available;
    return repo.save(profile);
  }

  /** Coaches clubs can browse: with a profile, the coach role, in good standing. */
  async listCoaches(query: CoachesQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const qb = this.dataSource
      .getRepository(CoachProfile)
      .createQueryBuilder('cp')
      .innerJoinAndSelect('cp.user', 'u')
      .where('u."deletedAt" IS NULL AND u."bannedAt" IS NULL')
      .andWhere(`u.roles @> '["coach"]'::jsonb`);
    if (query.available === 'true') qb.andWhere('cp.available = true');
    if (query.search?.trim()) {
      qb.andWhere('(u.name ILIKE :q OR cp.headline ILIKE :q)', { q: `%${query.search.trim()}%` });
    }
    const [rows, total] = await qb.orderBy('cp.available', 'DESC').addOrderBy('cp.updatedAt', 'DESC').skip((page - 1) * limit).take(limit).getManyAndCount();
    const ids = rows.map((r) => r.userId);
    const current = ids.length
      ? await this.dataSource.getRepository(CoachingDeal).find({ where: { coachUserId: In(ids), status: 'active' }, relations: { club: true } })
      : [];
    const postCounts: Array<{ coachUserId: string; n: number }> = ids.length
      ? await this.dataSource.query(
          `SELECT "coachUserId", count(*)::int AS n FROM coach_posts WHERE status = 'approved' AND "deletedAt" IS NULL AND "coachUserId" = ANY($1) GROUP BY 1`,
          [ids],
        )
      : [];
    return createPaginatedResult(
      rows.map((r) => ({
        userId: r.userId,
        name: r.user?.name ?? 'Coach',
        dpUrl: r.user?.dpUrl ?? null,
        headline: r.headline,
        specialities: r.specialities,
        askingFeeTk: r.askingFeeTk,
        available: r.available,
        youtubeChannelUrl: r.youtubeChannelUrl,
        posts: postCounts.find((p) => p.coachUserId === r.userId)?.n ?? 0,
        currentClub: (() => {
          const d = current.find((c) => c.coachUserId === r.userId);
          return d ? { id: d.clubId, name: d.club?.name ?? 'Club', endsAt: d.endsAt?.toISOString() ?? null } : null;
        })(),
      })),
      total,
      page,
      limit,
    );
  }

  /** A coach's public page: approved posts only (the coach himself also sees his others). */
  async coachDetail(userId: string, viewerId: string | null) {
    const user = await this.dataSource.getRepository(User).findOne({ where: { id: userId } });
    if (!user || user.deletedAt) throw new NotFoundException('Coach not found');
    const profile = await this.dataSource.getRepository(CoachProfile).findOne({ where: { userId } });
    if (!profile) throw new NotFoundException('Coach not found');
    const own = viewerId === userId;
    const posts = await this.dataSource.getRepository(CoachPost).find({
      where: own ? { coachUserId: userId, deletedAt: IsNull() } : { coachUserId: userId, status: 'approved', deletedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
    const active = await this.dataSource.getRepository(CoachingDeal).findOne({
      where: { coachUserId: userId, status: 'active' },
      relations: { club: true },
    });
    // Clubs he has coached (or is coaching), newest first; deal terms stay private.
    const past = await this.dataSource.getRepository(CoachingDeal).find({
      where: { coachUserId: userId, status: In(['active', 'completed', 'ended']) },
      relations: { club: true },
      order: { startedAt: 'DESC' },
    });
    return {
      user: {
        id: user.id,
        name: user.name,
        dpUrl: user.dpUrl,
        coverUrl: user.coverUrl,
        roles: user.roles ?? [],
        country: user.country,
        joinedAt: user.createdAt ? new Date(user.createdAt).toISOString() : null,
      },
      history: past.map((d) => ({
        clubId: d.clubId,
        name: d.club?.name ?? 'Club',
        dpUrl: d.club?.dpUrl ?? null,
        status: d.status,
        days: d.days,
        startedAt: d.startedAt?.toISOString() ?? null,
        endedAt: (d.endedAt ?? d.endsAt)?.toISOString() ?? null,
      })),
      profile,
      posts: posts.filter((p) => !p.deletedAt),
      currentClub: active
        ? { id: active.clubId, name: active.club?.name ?? 'Club', dpUrl: active.club?.dpUrl ?? null, endsAt: active.endsAt?.toISOString() ?? null }
        : null,
    };
  }

  // -------------------------------------------------------------------- posts

  async createPost(caller: User, dto: CreateCoachPostDto, files: Express.Multer.File[]): Promise<CoachPost> {
    let media: CoachPost['media'] = [];
    try {
      await this.coachUser(this.dataSource.manager, caller.id);
      await this.requireCoachProfile(this.dataSource.manager, caller.id);
      media = toPostMedia(files);
      const links = parseLinks(dto.links);
      const body = (dto.body ?? '').trim();
      if (!body && !links.length && !media.length) throw new BadRequestException('Write something, add a link or upload a photo or video');
      const post = this.dataSource.getRepository(CoachPost).create({ coachUserId: caller.id, body, links, media, status: 'pending' });
      return await this.dataSource.getRepository(CoachPost).save(post);
    } catch (err) {
      await removeCoachingFiles(files.map((f) => `/uploads/coaching/${f.filename}`));
      throw err;
    }
  }

  async deletePost(caller: User, id: string): Promise<{ deleted: true }> {
    const repo = this.dataSource.getRepository(CoachPost);
    const post = await repo.findOne({ where: { id } });
    if (!post || post.deletedAt) throw new NotFoundException('Post not found');
    if (post.coachUserId !== caller.id) throw new ForbiddenException('You can only delete your own posts');
    post.deletedAt = new Date();
    await repo.save(post);
    await removeCoachingFiles(post.media.map((m) => m.url));
    return { deleted: true };
  }

  /** Staff review queue. */
  async adminPosts(query: AdminCoachPostsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const [rows, total] = await this.dataSource.getRepository(CoachPost).findAndCount({
      where: { status: query.status ?? 'pending', deletedAt: IsNull() },
      relations: { coach: true },
      order: { createdAt: query.status === 'pending' || !query.status ? 'ASC' : 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    const counts: Array<{ status: string; n: number }> = await this.dataSource.query(
      `SELECT status, count(*)::int AS n FROM coach_posts WHERE "deletedAt" IS NULL GROUP BY 1`,
    );
    return {
      ...createPaginatedResult(
        rows
          .filter((p) => !p.deletedAt)
          .map((p) => ({ ...p, coach: { id: p.coachUserId, name: p.coach?.name ?? 'Coach', dpUrl: p.coach?.dpUrl ?? null } })),
        total,
        page,
        limit,
      ),
      counts: Object.fromEntries(counts.map((c) => [c.status, c.n])),
    };
  }

  async reviewPost(actor: User, id: string, dto: ReviewCoachPostDto, ctx: Ctx) {
    const repo = this.dataSource.getRepository(CoachPost);
    const post = await repo.findOne({ where: { id }, relations: { coach: true } });
    if (!post || post.deletedAt) throw new NotFoundException('Post not found');
    if (!dto.approve && !dto.reason?.trim()) throw new BadRequestException('Give a reason when rejecting a post');
    const before = post.status;
    post.status = dto.approve ? 'approved' : 'rejected';
    post.rejectReason = dto.approve ? null : dto.reason!.trim();
    post.reviewedById = actor.id;
    post.reviewedAt = new Date();
    await repo.save(post);
    await this.audit.record(actor, {
      action: dto.approve ? 'coaching.post.approve' : 'coaching.post.reject',
      targetType: 'coach_post',
      targetId: post.id,
      targetName: post.coach?.name ?? null,
      before: { status: before },
      after: { status: post.status },
      reason: post.rejectReason,
      ip: ctx.ip,
    });
    await this.notify(
      [post.coachUserId],
      dto.approve ? 'coaching.postApproved' : 'coaching.postRejected',
      dto.approve ? 'Post approved' : 'Post not approved',
      dto.approve ? 'Your coaching post is now public.' : `Your coaching post wasn't approved: ${post.rejectReason}`,
      COACH_LINK,
      { reason: post.rejectReason },
    );
    return post;
  }

  // -------------------------------------------------------------------- deals

  /** Open deals and the active coach of a club; leaders also see open ones. */
  async clubCoaching(clubId: string, viewerId: string | null) {
    const em = this.dataSource.manager;
    const active = await em.getRepository(CoachingDeal).findOne({ where: { clubId, status: 'active' }, relations: { coach: true, club: true } });
    const isLeader = viewerId ? await this.transfers.isClubLeader(em, clubId, viewerId) : false;
    const open = isLeader
      ? await em.getRepository(CoachingDeal).find({
          where: { clubId, status: In(['pending', 'scheduled']) },
          relations: { coach: true, club: true },
          order: { createdAt: 'DESC' },
        })
      : [];
    const [activeView] = active ? await this.views([active]) : [null];
    return { clubId, isLeader, coach: activeView, open: await this.views(open), settings: await this.settingsView() };
  }

  async create(caller: User, dto: CreateCoachingDealDto): Promise<CoachingDealView> {
    const settings = await this.settingsService.transfers();
    this.assertDays(dto.days, settings.minCoachingDays, settings.maxCoachingDays);
    await this.transfers.assertMarketOpen();
    const byClub = Boolean(dto.coachUserId);
    const coachUserId = dto.coachUserId ?? caller.id;

    const id = await this.dataSource.transaction(async (em) => {
      const club = await this.transfers.clubOf(em, dto.clubId);
      await assertNotFrozen(em, 'club', club.id);
      if (byClub) await this.transfers.assertClubLeader(em, club.id, caller.id);
      const coach = await this.coachUser(em, coachUserId);
      const profile = await this.requireCoachProfile(em, coachUserId);
      if (byClub && !profile.available) throw new BadRequestException(`${coach.name} isn't taking new clubs right now`);

      const membership = await em.getRepository(EfootballProfile).findOne({ where: { userId: coachUserId } });
      if (membership?.clubId === club.id) throw new BadRequestException(`${coach.name} plays for ${club.name}, so he can't be its coach as well`);
      const open = await em.getRepository(CoachingDeal).findOne({ where: { coachUserId, clubId: club.id, status: In(OPEN_COACHING_STATUSES) } });
      if (open) throw new BadRequestException(`There's already an open coaching deal between ${coach.name} and ${club.name}`);
      if (byClub && dto.feeTk > 0 && !dto.paymentMethod) throw new BadRequestException('Choose a payment method');

      const message = dto.message?.trim() || null;
      const deal = await em.getRepository(CoachingDeal).save(
        em.getRepository(CoachingDeal).create({
          coachUserId,
          clubId: club.id,
          origin: byClub ? 'club' : 'coach',
          turn: byClub ? 'coach' : 'club',
          status: 'pending',
          heldTk: 0,
          feeTk: dto.feeTk,
          days: dto.days,
          message,
          bids: [{ party: byClub ? 'club' : 'coach', byUserId: caller.id, feeTk: dto.feeTk, days: dto.days, message, at: new Date().toISOString() }],
          createdByUserId: caller.id,
          expiresAt: new Date(Date.now() + settings.offerExpiryDays * DAY_MS),
        }),
      );
      // A club offer is paid into the hold right away.
      if (byClub) {
        await this.holdFee(em, deal, dto.paymentMethod, club.name, coach.name);
        await em.save(deal);
      }
      return deal.id;
    });

    const deal = await this.dataSource.getRepository(CoachingDeal).findOneOrFail({ where: { id } });
    const { coachName, clubName } = await this.names(this.dataSource.manager, deal);
    if (byClub) {
      await this.notifyParty(deal, 'coach', 'coaching.offer', 'Coaching offer', `${clubName} wants you as their coach: ${deal.feeTk} tk for ${deal.days} days.`);
    } else {
      await this.notifyParty(deal, 'club', 'coaching.request', 'Coach request', `${coachName} wants to coach ${clubName}: ${deal.feeTk} tk for ${deal.days} days.`);
    }
    return this.dealView(id);
  }

  async respond(caller: User, id: string, dto: RespondCoachingDealDto): Promise<CoachingDealView> {
    let outcome: 'declined' | 'agreed' = 'declined';
    await this.dataSource.transaction(async (em) => {
      const deal = await this.lockDeal(em, id);
      if (deal.status !== 'pending') throw new BadRequestException(`This deal is already ${deal.status}`);
      if (deal.expiresAt <= new Date()) throw new BadRequestException('This deal has expired');
      await this.assertParty(em, deal, deal.turn, caller.id);
      const { coachName, clubName } = await this.names(em, deal);

      if (!dto.accept) {
        await this.refundHold(em, deal, coachName);
        deal.status = 'declined';
        await em.save(deal);
        return;
      }
      await this.transfers.assertMarketOpen();
      await assertNotFrozen(em, 'club', deal.clubId);
      await this.coachUser(em, deal.coachUserId);
      // The club pays now if it hasn't yet (the coach's request, or his counter-offer).
      if (deal.turn === 'club') await this.holdFee(em, deal, dto.paymentMethod, clubName, coachName);
      await this.agree(em, deal, coachName, clubName);
      outcome = 'agreed';
    });

    const deal = await this.dataSource.getRepository(CoachingDeal).findOneOrFail({ where: { id } });
    const other: CoachingParty = deal.turn === 'coach' ? 'club' : 'coach';
    if (outcome === 'declined') {
      await this.notifyParty(deal, other, 'coaching.declined', 'Coaching deal declined', `The coaching deal (${deal.feeTk} tk, ${deal.days} days) was declined.`);
    } else {
      const { coachName, clubName } = await this.names(this.dataSource.manager, deal);
      const when = deal.status === 'scheduled' ? `It starts on ${deal.startedAt?.toISOString().slice(0, 10)}.` : 'It starts now.';
      await this.notifyParty(deal, 'coach', 'coaching.agreed', 'Coaching deal agreed', `You'll coach ${clubName} for ${deal.days} days; ${deal.feeTk - (deal.commissionTk ?? 0)} tk paid to you. ${when}`);
      await this.notifyParty(deal, 'club', 'coaching.agreed', 'Coaching deal agreed', `${coachName} will coach ${clubName} for ${deal.days} days. ${when}`);
    }
    return this.dealView(id);
  }

  /** Pays the coach (minus the cut) and starts the deal, or lines it up after his current one. */
  private async agree(em: EntityManager, deal: CoachingDeal, coachName: string, clubName: string): Promise<void> {
    const settings = await this.settingsService.transfers();
    const current = await em.getRepository(CoachingDeal).find({
      where: { coachUserId: deal.coachUserId, status: In(['active', 'scheduled']) },
      order: { endsAt: 'DESC' },
    });
    if (current.some((d) => d.status === 'scheduled')) {
      throw new BadRequestException(`${coachName} already has his next club lined up. Try again when that deal starts.`);
    }
    const now = new Date();
    deal.commissionPct = settings.coachingCommissionPct;
    deal.commissionTk = this.commissionOf(deal.feeTk, settings.coachingCommissionPct);
    if (deal.feeTk > 0) {
      await this.walletsService.payOutWithCommission(
        em,
        this.clubWallet(deal.clubId),
        { type: 'user', id: deal.coachUserId },
        deal.feeTk,
        deal.commissionTk,
        { coachingDealId: deal.id, fromName: clubName, toName: coachName, reference: deal.paymentRef },
      );
      deal.paidAt = now;
    }
    deal.heldTk = 0;
    const active = current.find((d) => d.status === 'active');
    deal.startedAt = active?.endsAt && active.endsAt > now ? active.endsAt : now;
    deal.endsAt = new Date(deal.startedAt.getTime() + deal.days * DAY_MS);
    deal.status = deal.startedAt > now ? 'scheduled' : 'active';
    await em.save(deal);
  }

  async counter(caller: User, id: string, dto: CounterCoachingDealDto): Promise<CoachingDealView> {
    const settings = await this.settingsService.transfers();
    await this.transfers.assertMarketOpen();
    let party: CoachingParty = 'coach';
    await this.dataSource.transaction(async (em) => {
      const deal = await this.lockDeal(em, id);
      if (deal.status !== 'pending') throw new BadRequestException(`This deal is already ${deal.status}`);
      if (deal.expiresAt <= new Date()) throw new BadRequestException('This deal has expired');
      await this.assertParty(em, deal, deal.turn, caller.id);
      const days = dto.days ?? deal.days;
      this.assertDays(days, settings.minCoachingDays, settings.maxCoachingDays);
      if (dto.feeTk === deal.feeTk && days === deal.days) {
        throw new BadRequestException('Those terms are already on the table. Accept them instead of countering.');
      }
      party = deal.turn;
      const { coachName, clubName } = await this.names(em, deal);
      deal.feeTk = dto.feeTk;
      deal.days = days;
      const message = dto.message?.trim() || null;
      deal.bids = [...(deal.bids ?? []), { party, byUserId: caller.id, feeTk: dto.feeTk, days, message, at: new Date().toISOString() }];
      // A club counter is paid into the hold at once; the coach's counter waits for the club.
      if (party === 'club') await this.holdFee(em, deal, dto.paymentMethod, clubName, coachName);
      deal.turn = party === 'club' ? 'coach' : 'club';
      deal.expiresAt = new Date(Date.now() + settings.offerExpiryDays * DAY_MS);
      await em.save(deal);
    });
    const deal = await this.dataSource.getRepository(CoachingDeal).findOneOrFail({ where: { id } });
    await this.notifyParty(deal, deal.turn, 'coaching.counter', 'Coaching counter-offer', `New terms on the table: ${deal.feeTk} tk for ${deal.days} days.`);
    void party;
    return this.dealView(id);
  }

  /** The side that proposed it withdraws a pending deal; any held money goes back. */
  async cancel(caller: User, id: string): Promise<CoachingDealView> {
    await this.dataSource.transaction(async (em) => {
      const deal = await this.lockDeal(em, id);
      if (deal.status !== 'pending') throw new BadRequestException(`This deal is already ${deal.status}`);
      const isCoach = deal.coachUserId === caller.id;
      const isLeader = await this.transfers.isClubLeader(em, deal.clubId, caller.id);
      if (!isCoach && !isLeader) throw new ForbiddenException('Only the coach or the club leaders can withdraw this');
      const { coachName } = await this.names(em, deal);
      await this.refundHold(em, deal, coachName);
      deal.status = 'cancelled';
      await em.save(deal);
    });
    const deal = await this.dataSource.getRepository(CoachingDeal).findOneOrFail({ where: { id } });
    const isCoach = deal.coachUserId === caller.id;
    await this.notifyParty(deal, isCoach ? 'club' : 'coach', 'coaching.cancelled', 'Coaching deal withdrawn', 'A coaching deal was withdrawn.');
    return this.dealView(id);
  }

  /** Either side ends a running (or lined-up) deal early. The fee isn't refunded. */
  async end(caller: User, id: string): Promise<CoachingDealView> {
    let byCoach = false;
    await this.dataSource.transaction(async (em) => {
      const deal = await this.lockDeal(em, id);
      if (!['active', 'scheduled'].includes(deal.status)) throw new BadRequestException(`This deal is ${deal.status}`);
      byCoach = deal.coachUserId === caller.id;
      if (!byCoach) await this.transfers.assertClubLeader(em, deal.clubId, caller.id);
      deal.status = 'ended';
      deal.endedAt = new Date();
      deal.endReason = byCoach ? 'coach' : 'club';
      await em.save(deal);
    });
    const deal = await this.dataSource.getRepository(CoachingDeal).findOneOrFail({ where: { id } });
    await this.notifyParty(deal, byCoach ? 'club' : 'coach', 'coaching.ended', 'Coaching deal ended', 'A coaching deal was ended early.');
    await this.startDue();
    return this.dealView(id);
  }

  // --------------------------------------------------------------------- jobs

  /** Every minute: expire old proposals, finish deals that ran their days, start lined-up ones. */
  async tick(now = new Date()): Promise<{ expired: number; completed: number; started: number }> {
    let expired = 0;
    const stale = await this.dataSource.getRepository(CoachingDeal).find({ where: { status: 'pending', expiresAt: LessThanOrEqual(now) } });
    for (const { id } of stale) {
      const done = await this.dataSource.transaction(async (em) => {
        const deal = await this.lockDeal(em, id);
        if (deal.status !== 'pending' || deal.expiresAt > now) return false;
        const { coachName } = await this.names(em, deal);
        await this.refundHold(em, deal, coachName);
        deal.status = 'expired';
        await em.save(deal);
        return true;
      });
      if (done) {
        expired++;
        const deal = await this.dataSource.getRepository(CoachingDeal).findOneOrFail({ where: { id } });
        for (const party of ['coach', 'club'] as const) {
          await this.notifyParty(deal, party, 'coaching.expired', 'Coaching deal expired', 'A coaching deal expired without an answer; any money held was returned.');
        }
      }
    }

    const finished = await this.dataSource.getRepository(CoachingDeal).find({ where: { status: 'active', endsAt: LessThanOrEqual(now) } });
    for (const deal of finished) {
      deal.status = 'completed';
      deal.endedAt = now;
      deal.endReason = 'time';
      await this.dataSource.getRepository(CoachingDeal).save(deal);
      for (const party of ['coach', 'club'] as const) {
        await this.notifyParty(deal, party, 'coaching.completed', 'Coaching deal finished', `The coaching deal ran its ${deal.days} days.`);
      }
    }
    const started = await this.startDue(now);
    return { expired, completed: finished.length, started };
  }

  /** Lined-up deals whose start has come (or whose coach is free now) become active. */
  private async startDue(now = new Date()): Promise<number> {
    const waiting = await this.dataSource.getRepository(CoachingDeal).find({ where: { status: 'scheduled' } });
    let count = 0;
    for (const deal of waiting) {
      const busy = await this.dataSource.getRepository(CoachingDeal).findOne({ where: { coachUserId: deal.coachUserId, status: 'active' } });
      if (busy && busy.endsAt && busy.endsAt > now) continue;
      const days = deal.days;
      deal.startedAt = now;
      deal.endsAt = new Date(now.getTime() + days * DAY_MS);
      deal.status = 'active';
      await this.dataSource.getRepository(CoachingDeal).save(deal);
      count++;
      for (const party of ['coach', 'club'] as const) {
        await this.notifyParty(deal, party, 'coaching.started', 'Coaching deal started', `The coaching deal has started and runs for ${days} days.`);
      }
    }
    return count;
  }

  // -------------------------------------------------------------------- staff

  async adminDeals(query: { page?: number; limit?: number }) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const [rows, total] = await this.dataSource.getRepository(CoachingDeal).findAndCount({
      relations: { coach: true, club: true },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    const platform = await this.dataSource.transaction((em) => this.walletsService.lock(em, { type: 'platform', id: PLATFORM_WALLET_ID }));
    return { ...createPaginatedResult(await this.views(rows), total, page, limit), platformCommissionTk: platform.balanceTk };
  }
}

/** Links from a newline list or a JSON array; http(s) only, at most 5. */
export function parseLinks(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  let items: unknown;
  try {
    items = JSON.parse(raw);
  } catch {
    items = raw.split(/\r?\n/u);
  }
  const list = (Array.isArray(items) ? items : [items]).map((s) => String(s).trim()).filter(Boolean);
  if (list.length > MAX_LINKS) throw new BadRequestException(`Add at most ${MAX_LINKS} links`);
  for (const link of list) {
    try {
      const url = new URL(link);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('protocol');
    } catch {
      throw new BadRequestException(`Not a valid link: ${link.slice(0, 80)}`);
    }
  }
  return [...new Set(list)];
}
