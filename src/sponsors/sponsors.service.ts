import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, In, IsNull, LessThanOrEqual } from 'typeorm';
import { AuditService } from '../admin/audit.service.js';
import { parseLinks } from '../coaching/coaching.service.js';
import { removeCoachingFiles, toPostMedia } from '../coaching/coaching-upload.js';
import { CoachPost } from '../coaching/entities/coach-post.entity.js';
import { Community } from '../communities/entities/community.entity.js';
import { createPaginatedResult } from '../common/interfaces/paginated-result.interface.js';
import type { NotificationParams } from '../notifications/entities/notification.entity.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { Tournament } from '../tournaments/entities/tournament.entity.js';
import { TournamentStatus } from '../tournaments/enums/tournament.enum.js';
import { TournamentsService } from '../tournaments/tournaments.service.js';
import { paymentRef } from '../transfers/contract-fee.js';
import { WalletsService } from '../transfers/wallets.service.js';
import { User } from '../users/entities/user.entity.js';
import { CommunityRole } from '../users/enums/user-attributes.enum.js';
import {
  SponsorCall,
  SponsorProfile,
  Sponsorship,
  TIER_LIMITS,
  type SponsorshipParty,
  type SponsorTargetType,
  type SponsorTier,
} from './entities/sponsor.entities.js';
import { brandUrls, removeBrandFiles, uploadedBrandUrls, type BrandFiles } from './sponsors-upload.js';

export interface SponsorProfileInput {
  brandName?: string;
  tagline?: string;
  about?: string;
  website?: string;
  facebookUrl?: string;
  industry?: string;
}

export interface SponsorshipInput {
  targetType: SponsorTargetType;
  targetId: string;
  /** Set when a tournament organizer or community leader asks a sponsor. */
  sponsorUserId?: string;
  tier: SponsorTier;
  amountTk: number;
  days?: number;
  message?: string;
}

/** A tournament or community that can be sponsored, and who gets the money. */
interface Target {
  type: SponsorTargetType;
  id: string;
  name: string;
  link: string;
  payeeUserId: string;
  tournament?: Tournament;
  community?: Community;
}

const MIN_DAYS = 7;
const MAX_DAYS = 365;
const OPEN = ['pending', 'active'] as const;

/**
 * Sponsor mode: a sponsor's brand profile and posts (feed posts with `authorRole='sponsor'`,
 * reviewed by staff like coach posts), and sponsorships of tournaments (community and general
 * ones) and communities. Either side can start a deal; the sponsor's money is held while it's
 * open and paid to the host (organizer, or the community President) minus the platform's cut
 * once accepted. Tournament deals last until the tournament ends, community deals `days`.
 */
@Injectable()
export class SponsorsService {
  private readonly logger = new Logger(SponsorsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly settings: SettingsService,
    private readonly wallets: WalletsService,
    private readonly tournaments: TournamentsService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- helpers

  private assertSponsorRole(user: User) {
    if (!(user.roles ?? []).includes('sponsor')) {
      throw new ForbiddenException('Add the Sponsor role in your profile first');
    }
  }

  private async requireProfile(em: EntityManager, userId: string): Promise<SponsorProfile> {
    const profile = await em.getRepository(SponsorProfile).findOne({ where: { userId } });
    if (!profile?.brandName) throw new BadRequestException('Set up your sponsor profile (brand name) first');
    return profile;
  }

  private commissionOf(amountTk: number, pct: number) {
    return Math.round((amountTk * pct) / 100);
  }

  private async notify(userIds: string[], code: string, title: string, message: string, link: string, params: NotificationParams = {}) {
    await Promise.all(
      [...new Set(userIds.filter(Boolean))].map((userId) =>
        this.notifications
          .createNotification(userId, { title, message, type: 'sponsorship', link, code, params })
          .catch((err) => this.logger.error(`Sponsorship notification to ${userId} failed: ${(err as Error).message}`)),
      ),
    );
  }

  /** The community's President (its creator if it has none): receives community sponsorships. */
  private async communityPayee(em: EntityManager, community: Community): Promise<string> {
    const [row]: Array<{ userId: string }> = await em.query(
      `SELECT p."userId" FROM community_members m JOIN efootball_profiles p ON p.id = m."profileId"
        WHERE m."communityId" = $1 AND m.role = $2 LIMIT 1`,
      [community.id, CommunityRole.PRESIDENT],
    );
    return row?.userId ?? community.creatorId;
  }

  /** Loads what's being sponsored. Club tournaments and finished tournaments can't be. */
  private async target(em: EntityManager, type: SponsorTargetType, id: string): Promise<Target> {
    if (type === 'tournament') {
      const tournament = await em.getRepository(Tournament).findOne({ where: { id }, relations: { community: true } });
      if (!tournament || tournament.deletedAt) throw new NotFoundException('Tournament not found');
      if (tournament.hostClubId) throw new BadRequestException('Club tournaments can’t be sponsored');
      const payeeUserId = tournament.community ? await this.communityPayee(em, tournament.community) : (tournament.creatorId ?? '');
      if (!payeeUserId) throw new BadRequestException('This tournament has no organizer to receive a sponsorship');
      const link = tournament.communityId
        ? `/dashboard/efootball/community/${tournament.communityId}/tournaments/${tournament.id}`
        : `/dashboard/efootball/tournaments/${tournament.id}`;
      return { type, id, name: tournament.name, link, payeeUserId, tournament };
    }
    const community = await em.getRepository(Community).findOne({ where: { id } });
    if (!community || community.deletedAt) throw new NotFoundException('Community not found');
    return { type, id, name: community.name, link: `/dashboard/efootball/community/${community.id}`, payeeUserId: await this.communityPayee(em, community), community };
  }

  private assertOpenTarget(target: Target) {
    const status = target.tournament?.status;
    if (status === TournamentStatus.COMPLETED || status === TournamentStatus.CANCELLED) {
      throw new BadRequestException('This tournament has ended; it can’t be sponsored');
    }
  }

  /** Whether the user runs the tournament (its organizers) or community (creator, President, Vice President). */
  private async isHost(em: EntityManager, target: Target, userId: string): Promise<boolean> {
    if (target.tournament) {
      try {
        await this.tournaments.assertCanManage(userId, target.tournament, 'manage sponsors');
        return true;
      } catch {
        return false;
      }
    }
    if (target.community?.creatorId === userId) return true;
    const [row]: Array<{ ok: boolean }> = await em.query(
      `SELECT EXISTS (SELECT 1 FROM community_members m JOIN efootball_profiles p ON p.id = m."profileId"
        WHERE m."communityId" = $1 AND p."userId" = $2 AND m.role IN ($3, $4)) AS ok`,
      [target.id, userId, CommunityRole.PRESIDENT, CommunityRole.VICE_PRESIDENT],
    );
    return Boolean(row?.ok);
  }

  private async assertHost(em: EntityManager, target: Target, userId: string) {
    if (!(await this.isHost(em, target, userId))) {
      throw new ForbiddenException(
        target.type === 'tournament'
          ? 'Only the tournament’s organizers can manage its sponsors'
          : 'Only the community’s President, Vice President or creator can manage its sponsors',
      );
    }
  }

  private targetOf(deal: Sponsorship): { type: SponsorTargetType; id: string } {
    return { type: deal.targetType, id: (deal.tournamentId ?? deal.communityId)! };
  }

  /** A target can have one active Title sponsor, 3 Gold and 8 Partners; a sponsor one open deal per target. */
  private async assertRoom(em: EntityManager, deal: Pick<Sponsorship, 'targetType' | 'tournamentId' | 'communityId' | 'tier' | 'sponsorUserId'> & { id?: string }) {
    const where = deal.targetType === 'tournament' ? { tournamentId: deal.tournamentId! } : { communityId: deal.communityId! };
    const active = await em.getRepository(Sponsorship).count({ where: { ...where, tier: deal.tier, status: 'active' } });
    if (active >= TIER_LIMITS[deal.tier]) {
      throw new BadRequestException(
        deal.tier === 'title' ? 'This already has a Title sponsor' : `This already has ${TIER_LIMITS[deal.tier]} ${deal.tier} sponsors`,
      );
    }
    const open = await em.getRepository(Sponsorship).find({ where: { ...where, sponsorUserId: deal.sponsorUserId, status: In([...OPEN]) } });
    if (open.some((d) => d.id !== deal.id)) throw new BadRequestException('This sponsor already has an open or active deal here');
  }

  private assertTerms(type: SponsorTargetType, amountTk: number, days: number | undefined | null) {
    if (!Number.isInteger(amountTk) || amountTk < 0) throw new BadRequestException('Set an amount (0 or more)');
    if (type === 'community' && (days == null || days < MIN_DAYS || days > MAX_DAYS)) {
      throw new BadRequestException(`A community sponsorship lasts ${MIN_DAYS} to ${MAX_DAYS} days`);
    }
  }

  private async lockDeal(em: EntityManager, id: string): Promise<Sponsorship> {
    const deal = await em.getRepository(Sponsorship).createQueryBuilder('s').setLock('pessimistic_write').where('s.id = :id', { id }).getOne();
    if (!deal) throw new NotFoundException('Sponsorship not found');
    return deal;
  }

  /** Which side of a deal the caller is on (sponsor, host leader), or an error. */
  private async partyOf(em: EntityManager, deal: Sponsorship, target: Target, userId: string): Promise<SponsorshipParty> {
    if (deal.sponsorUserId === userId) return 'sponsor';
    if (await this.isHost(em, target, userId)) return 'host';
    throw new ForbiddenException('This isn’t your sponsorship');
  }

  private async sponsorName(em: EntityManager, userId: string): Promise<string> {
    const profile = await em.getRepository(SponsorProfile).findOne({ where: { userId } });
    if (profile?.brandName) return profile.brandName;
    const user = await em.getRepository(User).findOne({ where: { id: userId } });
    return user?.name ?? 'Sponsor';
  }

  private ref(deal: Sponsorship, counterparty: string) {
    return { sponsorshipId: deal.id, tournamentId: deal.tournamentId, counterparty, reference: deal.paymentRef };
  }

  /** The people answering for the host side (to notify). */
  private async hostLeaders(em: EntityManager, target: Target): Promise<string[]> {
    if (target.tournament?.communityId || target.community) {
      const communityId = target.community?.id ?? target.tournament!.communityId!;
      const rows: Array<{ userId: string }> = await em.query(
        `SELECT p."userId" FROM community_members m JOIN efootball_profiles p ON p.id = m."profileId"
          WHERE m."communityId" = $1 AND m.role IN ($2, $3)`,
        [communityId, CommunityRole.PRESIDENT, CommunityRole.VICE_PRESIDENT],
      );
      return [...rows.map((r) => r.userId), target.payeeUserId, target.tournament?.creatorId ?? ''];
    }
    return [target.payeeUserId];
  }

  // ---------------------------------------------------------------- profile + posts

  async me(user: User) {
    this.assertSponsorRole(user);
    const em = this.dataSource.manager;
    const profile = await em.getRepository(SponsorProfile).findOne({ where: { userId: user.id } });
    const posts = await em.getRepository(CoachPost).find({
      where: { coachUserId: user.id, authorRole: 'sponsor', deletedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
    const deals = await em.getRepository(Sponsorship).find({ where: { sponsorUserId: user.id }, order: { createdAt: 'DESC' } });
    const views = await this.views(deals, user.id);
    const s = await this.settings.transfers();
    return {
      profile,
      posts,
      deals: views,
      spentTk: views.filter((d) => d.paidAt).reduce((n, d) => n + d.amountTk, 0),
      stats: await this.stats(user.id),
      settings: { commissionPct: s.sponsorCommissionPct, offerExpiryDays: s.offerExpiryDays, minDays: MIN_DAYS, maxDays: MAX_DAYS },
    };
  }

  async upsertProfile(user: User, input: SponsorProfileInput, files: BrandFiles): Promise<SponsorProfile> {
    try {
      this.assertSponsorRole(user);
      const urls = brandUrls(files);
      const repo = this.dataSource.getRepository(SponsorProfile);
      const profile = (await repo.findOne({ where: { userId: user.id } })) ?? repo.create({ userId: user.id, brandName: '', tagline: '' });
      const clean = (v: string | undefined, max: number) => (v === undefined ? undefined : v.trim().slice(0, max));
      if (input.brandName !== undefined) {
        const name = input.brandName.trim();
        if (name.length < 2 || name.length > 80) throw new BadRequestException('Brand name: 2–80 characters');
        profile.brandName = name;
      }
      if (!profile.brandName) throw new BadRequestException('Give your brand a name');
      if (input.tagline !== undefined) profile.tagline = clean(input.tagline, 140)!;
      if (input.about !== undefined) profile.about = clean(input.about, 2000) || null;
      if (input.industry !== undefined) profile.industry = clean(input.industry, 60) || null;
      for (const key of ['website', 'facebookUrl'] as const) {
        const value = input[key]?.trim();
        if (value === undefined) continue;
        if (value && !/^https?:\/\//i.test(value)) throw new BadRequestException('Links must start with http:// or https://');
        profile[key] = value || null;
      }
      const old = [urls.logoUrl ? profile.logoUrl : null, urls.bannerUrl ? profile.bannerUrl : null];
      Object.assign(profile, urls);
      const saved = await repo.save(profile);
      await removeBrandFiles(old);
      return saved;
    } catch (err) {
      await removeBrandFiles(uploadedBrandUrls(files));
      throw err;
    }
  }

  /** A sponsor post: like a coach post, reviewed by staff before it shows in the feed. */
  async createPost(user: User, input: { body?: string; links?: string }, files: Express.Multer.File[]): Promise<CoachPost> {
    try {
      this.assertSponsorRole(user);
      await this.requireProfile(this.dataSource.manager, user.id);
      const media = toPostMedia(files);
      const links = parseLinks(input.links);
      const body = (input.body ?? '').trim();
      if (!body && !links.length && !media.length) throw new BadRequestException('Write something, add a link or upload a photo or video');
      const repo = this.dataSource.getRepository(CoachPost);
      return await repo.save(repo.create({ coachUserId: user.id, authorRole: 'sponsor', body, links, media, status: 'pending' }));
    } catch (err) {
      await removeCoachingFiles(files.map((f) => `/uploads/coaching/${f.filename}`));
      throw err;
    }
  }

  async deletePost(user: User, id: string) {
    const repo = this.dataSource.getRepository(CoachPost);
    const post = await repo.findOne({ where: { id, authorRole: 'sponsor' } });
    if (!post || post.deletedAt) throw new NotFoundException('Post not found');
    if (post.coachUserId !== user.id) throw new ForbiddenException('You can only delete your own posts');
    post.deletedAt = new Date();
    await repo.save(post);
    await removeCoachingFiles(post.media.map((m) => m.url));
    return { deleted: true };
  }

  /** The sponsor directory: verified first, then the most active. */
  async list(query: { search?: string; verified?: string; page?: number; limit?: number }) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const qb = this.dataSource
      .getRepository(SponsorProfile)
      .createQueryBuilder('sp')
      .innerJoinAndSelect('sp.user', 'u')
      .where(`u."deletedAt" IS NULL AND u."bannedAt" IS NULL AND sp."brandName" <> ''`)
      .andWhere(`u.roles @> '["sponsor"]'::jsonb`);
    if (query.verified === 'true') qb.andWhere('sp."verifiedAt" IS NOT NULL');
    if (query.search?.trim()) qb.andWhere('(sp."brandName" ILIKE :q OR sp.tagline ILIKE :q OR sp.industry ILIKE :q)', { q: `%${query.search.trim()}%` });
    const [rows, total] = await qb
      .orderBy('sp."verifiedAt" IS NULL', 'ASC')
      .addOrderBy('sp."updatedAt"', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    const ids = rows.map((r) => r.userId);
    const counts: Array<{ sponsorUserId: string; n: number }> = ids.length
      ? await this.dataSource.query(
          `SELECT "sponsorUserId", count(*)::int AS n FROM sponsorships WHERE status IN ('active', 'completed') AND "sponsorUserId" = ANY($1) GROUP BY 1`,
          [ids],
        )
      : [];
    return createPaginatedResult(
      rows.map((r) => ({
        userId: r.userId,
        name: r.user?.name ?? 'Sponsor',
        brandName: r.brandName,
        tagline: r.tagline,
        industry: r.industry,
        logoUrl: r.logoUrl,
        bannerUrl: r.bannerUrl,
        verified: Boolean(r.verifiedAt),
        sponsorships: counts.find((c) => c.sponsorUserId === r.userId)?.n ?? 0,
      })),
      total,
      page,
      limit,
    );
  }

  /** A sponsor's public page: brand, posts, and what they sponsor now and before. */
  async publicSponsor(userId: string, viewerId: string | null) {
    const user = await this.dataSource.getRepository(User).findOne({ where: { id: userId } });
    if (!user || user.deletedAt) throw new NotFoundException('Sponsor not found');
    const profile = await this.dataSource.getRepository(SponsorProfile).findOne({ where: { userId } });
    if (!profile?.brandName) throw new NotFoundException('Sponsor not found');
    const own = viewerId === userId;
    const posts = await this.dataSource.getRepository(CoachPost).find({
      where: own
        ? { coachUserId: userId, authorRole: 'sponsor', deletedAt: IsNull() }
        : { coachUserId: userId, authorRole: 'sponsor', status: 'approved', deletedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
    const deals = await this.dataSource.getRepository(Sponsorship).find({
      where: { sponsorUserId: userId, status: In(['active', 'completed', 'ended']) },
      order: { startedAt: 'DESC' },
    });
    const views = await this.views(deals, null);
    return {
      user: { id: user.id, name: user.name, dpUrl: user.dpUrl, coverUrl: user.coverUrl, joinedAt: user.createdAt?.toISOString?.() ?? null },
      profile: { ...profile, verified: Boolean(profile.verifiedAt) },
      posts,
      // Amounts stay private on the public page.
      sponsorships: views.map(({ amountTk: _a, heldTk: _h, commissionTk: _c, commissionPct: _p, bids: _b, ...d }) => d),
    };
  }

  // ---------------------------------------------------------------- deals

  /**
   * A sponsor offers to sponsor a target (the amount is held from their wallet), or a
   * tournament organizer / community leader asks a sponsor (nothing is held until they accept).
   */
  async create(caller: User, input: SponsorshipInput) {
    const s = await this.settings.transfers();
    const deal = await this.dataSource.transaction(async (em) => {
      const target = await this.target(em, input.targetType, input.targetId);
      this.assertOpenTarget(target);
      this.assertTerms(target.type, input.amountTk, input.days);
      const fromSponsor = !input.sponsorUserId || input.sponsorUserId === caller.id;
      let sponsorUserId: string;
      if (fromSponsor) {
        this.assertSponsorRole(caller);
        await this.requireProfile(em, caller.id);
        if (await this.isHost(em, target, caller.id)) throw new BadRequestException('You can’t sponsor something you run');
        sponsorUserId = caller.id;
      } else {
        await this.assertHost(em, target, caller.id);
        const sponsor = await em.getRepository(User).findOne({ where: { id: input.sponsorUserId } });
        if (!sponsor || sponsor.deletedAt || !(sponsor.roles ?? []).includes('sponsor')) throw new NotFoundException('Sponsor not found');
        await this.requireProfile(em, sponsor.id).catch(() => {
          throw new BadRequestException('This sponsor hasn’t set up a profile yet');
        });
        sponsorUserId = sponsor.id;
      }
      const repo = em.getRepository(Sponsorship);
      const days = target.type === 'community' ? input.days! : null;
      const draft = repo.create({
        sponsorUserId,
        targetType: target.type,
        tournamentId: target.type === 'tournament' ? target.id : null,
        communityId: target.type === 'community' ? target.id : null,
        tier: input.tier,
        amountTk: input.amountTk,
        heldTk: 0,
        commissionPct: s.sponsorCommissionPct,
        commissionTk: this.commissionOf(input.amountTk, s.sponsorCommissionPct),
        days,
        origin: fromSponsor ? 'sponsor' : 'host',
        turn: fromSponsor ? 'host' : 'sponsor',
        bids: [
          {
            party: fromSponsor ? 'sponsor' : 'host',
            byUserId: caller.id,
            amountTk: input.amountTk,
            tier: input.tier,
            days,
            message: input.message?.trim() || null,
            at: new Date().toISOString(),
          },
        ],
        message: input.message?.trim() || null,
        status: 'pending',
        expiresAt: new Date(Date.now() + s.offerExpiryDays * 24 * 3600_000),
        createdByUserId: caller.id,
        paymentRef: input.amountTk > 0 ? paymentRef() : null,
      });
      await this.assertRoom(em, draft);
      const saved = await repo.save(draft);
      if (fromSponsor && input.amountTk > 0) {
        await this.wallets.hold(em, { type: 'user', id: sponsorUserId }, input.amountTk, this.ref(saved, `Sponsorship: ${target.name}`));
        saved.heldTk = input.amountTk;
        await repo.save(saved);
      }
      const brand = await this.sponsorName(em, sponsorUserId);
      const to = fromSponsor ? await this.hostLeaders(em, target) : [sponsorUserId];
      await this.notify(
        to.filter((id) => id !== caller.id),
        'sponsorship.requested',
        'Sponsorship request',
        fromSponsor ? `${brand} wants to sponsor ${target.name} (${input.tier}).` : `${target.name} asks ${brand} to sponsor it (${input.tier}).`,
        fromSponsor ? target.link : '/dashboard/sponsor/deals',
        { name: target.name, brand },
      );
      return saved;
    });
    return (await this.views([deal], caller.id))[0];
  }

  /** The side whose turn it is accepts (money moves) or declines (the hold is refunded). */
  async respond(caller: User, id: string, accept: boolean) {
    const deal = await this.dataSource.transaction(async (em) => {
      const deal = await this.lockDeal(em, id);
      if (deal.status !== 'pending') throw new BadRequestException('This sponsorship is no longer open');
      const t = this.targetOf(deal);
      const target = await this.target(em, t.type, t.id);
      const party = await this.partyOf(em, deal, target, caller.id);
      if (party !== deal.turn) throw new ForbiddenException('Waiting for the other side to answer');
      const brand = await this.sponsorName(em, deal.sponsorUserId);
      const sponsorWallet = { type: 'user' as const, id: deal.sponsorUserId };

      if (!accept) {
        await this.wallets.refund(em, sponsorWallet, deal.heldTk, this.ref(deal, `Sponsorship: ${target.name}`));
        deal.heldTk = 0;
        deal.status = 'declined';
        deal.endedAt = new Date();
      } else {
        this.assertOpenTarget(target);
        await this.assertRoom(em, deal);
        // The sponsor's money: held now if it wasn't (a host's request), or topped up to the agreed amount.
        await this.wallets.rehold(em, sponsorWallet, deal.heldTk, deal.amountTk, this.ref(deal, `Sponsorship: ${target.name}`));
        deal.heldTk = deal.amountTk;
        const s = await this.settings.transfers();
        deal.commissionPct = s.sponsorCommissionPct;
        deal.commissionTk = this.commissionOf(deal.amountTk, s.sponsorCommissionPct);
        const payee = await em.getRepository(User).findOne({ where: { id: target.payeeUserId } });
        if (deal.amountTk > 0) {
          await this.wallets.payOutWithCommission(em, sponsorWallet, { type: 'user', id: target.payeeUserId }, deal.amountTk, deal.commissionTk, {
            sponsorshipId: deal.id,
            tournamentId: deal.tournamentId,
            fromName: brand,
            toName: `${payee?.name ?? 'Host'} (${target.name})`,
            reference: deal.paymentRef,
          });
          deal.paidAt = new Date();
        }
        deal.heldTk = 0;
        deal.paidToUserId = target.payeeUserId;
        deal.status = 'active';
        deal.startedAt = new Date();
        deal.endsAt = deal.days ? new Date(Date.now() + deal.days * 24 * 3600_000) : null;
      }
      await em.getRepository(Sponsorship).save(deal);
      const to = party === 'host' ? [deal.sponsorUserId] : await this.hostLeaders(em, target);
      await this.notify(
        to.filter((uid) => uid !== caller.id),
        accept ? 'sponsorship.accepted' : 'sponsorship.declined',
        accept ? 'Sponsorship accepted' : 'Sponsorship declined',
        accept ? `${brand} now sponsors ${target.name} (${deal.tier}).` : `The sponsorship of ${target.name} by ${brand} was declined.`,
        party === 'host' ? '/dashboard/sponsor/deals' : target.link,
        { name: target.name, brand },
      );
      return deal;
    });
    return (await this.views([deal], caller.id))[0];
  }

  /** A counter-offer (amount, tier, days): the sponsor's hold follows their own counters. */
  async counter(caller: User, id: string, input: { amountTk: number; tier?: SponsorTier; days?: number; message?: string }) {
    const deal = await this.dataSource.transaction(async (em) => {
      const deal = await this.lockDeal(em, id);
      if (deal.status !== 'pending') throw new BadRequestException('This sponsorship is no longer open');
      const t = this.targetOf(deal);
      const target = await this.target(em, t.type, t.id);
      const party = await this.partyOf(em, deal, target, caller.id);
      if (party !== deal.turn) throw new ForbiddenException('Waiting for the other side to answer');
      const days = deal.targetType === 'community' ? (input.days ?? deal.days) : null;
      this.assertTerms(deal.targetType, input.amountTk, days);
      const tier = input.tier ?? deal.tier;
      if (tier !== deal.tier) await this.assertRoom(em, { ...deal, tier });
      if (party === 'sponsor') {
        await this.wallets.rehold(em, { type: 'user', id: deal.sponsorUserId }, deal.heldTk, input.amountTk, this.ref(deal, `Sponsorship: ${target.name}`));
        deal.heldTk = input.amountTk;
      }
      const s = await this.settings.transfers();
      deal.amountTk = input.amountTk;
      deal.tier = tier;
      deal.days = days;
      deal.commissionTk = this.commissionOf(input.amountTk, s.sponsorCommissionPct);
      if (input.amountTk > 0 && !deal.paymentRef) deal.paymentRef = paymentRef();
      deal.bids = [...deal.bids, { party, byUserId: caller.id, amountTk: input.amountTk, tier, days, message: input.message?.trim() || null, at: new Date().toISOString() }];
      deal.turn = party === 'sponsor' ? 'host' : 'sponsor';
      deal.expiresAt = new Date(Date.now() + s.offerExpiryDays * 24 * 3600_000);
      await em.getRepository(Sponsorship).save(deal);
      const brand = await this.sponsorName(em, deal.sponsorUserId);
      await this.notify(
        (party === 'host' ? [deal.sponsorUserId] : await this.hostLeaders(em, target)).filter((uid) => uid !== caller.id),
        'sponsorship.countered',
        'Sponsorship counter-offer',
        `New terms for ${brand} sponsoring ${target.name}: ${input.amountTk} tk, ${tier}.`,
        party === 'host' ? '/dashboard/sponsor/deals' : target.link,
        { name: target.name, brand },
      );
      return deal;
    });
    return (await this.views([deal], caller.id))[0];
  }

  /** Either side withdraws an open request; the sponsor's hold is refunded. */
  async cancel(caller: User, id: string) {
    const deal = await this.dataSource.transaction(async (em) => {
      const deal = await this.lockDeal(em, id);
      if (deal.status !== 'pending') throw new BadRequestException('This sponsorship is no longer open');
      const t = this.targetOf(deal);
      const target = await this.target(em, t.type, t.id);
      await this.partyOf(em, deal, target, caller.id);
      await this.wallets.refund(em, { type: 'user', id: deal.sponsorUserId }, deal.heldTk, this.ref(deal, `Sponsorship: ${target.name}`));
      deal.heldTk = 0;
      deal.status = 'cancelled';
      deal.endedAt = new Date();
      return em.getRepository(Sponsorship).save(deal);
    });
    return (await this.views([deal], caller.id))[0];
  }

  /** Either side ends an active sponsorship early (the money already paid stays paid). */
  async end(caller: User, id: string) {
    const deal = await this.dataSource.transaction(async (em) => {
      const deal = await this.lockDeal(em, id);
      if (deal.status !== 'active') throw new BadRequestException('Only an active sponsorship can be ended');
      const t = this.targetOf(deal);
      const target = await this.target(em, t.type, t.id);
      const party = await this.partyOf(em, deal, target, caller.id);
      deal.status = 'ended';
      deal.endedAt = new Date();
      deal.endReason = party;
      await em.getRepository(Sponsorship).save(deal);
      const brand = await this.sponsorName(em, deal.sponsorUserId);
      await this.notify(
        (party === 'host' ? [deal.sponsorUserId] : await this.hostLeaders(em, target)).filter((uid) => uid !== caller.id),
        'sponsorship.ended',
        'Sponsorship ended',
        `${brand}'s sponsorship of ${target.name} has ended.`,
        party === 'host' ? '/dashboard/sponsor/deals' : target.link,
        { name: target.name, brand },
      );
      return deal;
    });
    return (await this.views([deal], caller.id))[0];
  }

  /** Expires unanswered requests, ends community deals at their end date and tournament deals when it's over. */
  async tick(now = new Date()) {
    const repo = this.dataSource.getRepository(Sponsorship);
    const stale = await repo.find({ where: { status: 'pending', expiresAt: LessThanOrEqual(now) } });
    for (const d of stale) {
      await this.dataSource.transaction(async (em) => {
        const deal = await this.lockDeal(em, d.id);
        if (deal.status !== 'pending') return;
        await this.wallets.refund(em, { type: 'user', id: deal.sponsorUserId }, deal.heldTk, { sponsorshipId: deal.id, counterparty: 'Sponsorship expired' });
        deal.heldTk = 0;
        deal.status = 'expired';
        deal.endedAt = now;
        await em.getRepository(Sponsorship).save(deal);
      });
    }
    const due = await repo.find({ where: { status: 'active', endsAt: LessThanOrEqual(now) } });
    for (const deal of due) await repo.update({ id: deal.id }, { status: 'completed', endedAt: now, endReason: 'time' });
    const finished: Array<{ id: string }> = await this.dataSource.query(
      `SELECT s.id FROM sponsorships s JOIN tournaments t ON t.id = s."tournamentId"
        WHERE s.status = 'active' AND t.status IN ('completed', 'cancelled')`,
    );
    for (const { id } of finished) await repo.update({ id }, { status: 'completed', endedAt: now, endReason: 'tournament' });
    return { expired: stale.length, completed: due.length + finished.length };
  }

  /** Deals with their sponsor's brand and target's name; the viewer's side and whether it's their turn. */
  async views(deals: Sponsorship[], viewerId: string | null) {
    if (!deals.length) return [];
    const em = this.dataSource.manager;
    const sponsorIds = [...new Set(deals.map((d) => d.sponsorUserId))];
    const profiles = await em.getRepository(SponsorProfile).find({ where: { userId: In(sponsorIds) } });
    const users = await em.getRepository(User).find({ where: { id: In(sponsorIds) } });
    const tournamentIds = deals.map((d) => d.tournamentId).filter((x): x is string => Boolean(x));
    const communityIds = deals.map((d) => d.communityId).filter((x): x is string => Boolean(x));
    const tournaments = tournamentIds.length ? await em.getRepository(Tournament).find({ where: { id: In(tournamentIds) } }) : [];
    const communities = communityIds.length ? await em.getRepository(Community).find({ where: { id: In(communityIds) } }) : [];
    return deals.map((d) => {
      const profile = profiles.find((p) => p.userId === d.sponsorUserId);
      const user = users.find((u) => u.id === d.sponsorUserId);
      const tournament = tournaments.find((x) => x.id === d.tournamentId);
      const community = communities.find((x) => x.id === d.communityId);
      const target = tournament
        ? {
            type: 'tournament' as const,
            id: tournament.id,
            name: tournament.name,
            status: tournament.status,
            startAt: tournament.startAt,
            link: tournament.communityId
              ? `/dashboard/efootball/community/${tournament.communityId}/tournaments/${tournament.id}`
              : `/dashboard/efootball/tournaments/${tournament.id}`,
            dpUrl: null,
          }
        : {
            type: 'community' as const,
            id: community?.id ?? d.communityId,
            name: community?.name ?? 'Community',
            status: null,
            startAt: null,
            link: `/dashboard/efootball/community/${d.communityId}`,
            dpUrl: community?.dpUrl ?? null,
          };
      return {
        ...d,
        sponsor: {
          id: d.sponsorUserId,
          name: user?.name ?? 'Sponsor',
          brandName: profile?.brandName ?? user?.name ?? 'Sponsor',
          logoUrl: profile?.logoUrl ?? null,
          bannerUrl: profile?.bannerUrl ?? null,
          website: profile?.website ?? null,
          verified: Boolean(profile?.verifiedAt),
        },
        target,
        mySide: viewerId === d.sponsorUserId ? ('sponsor' as const) : null,
        netTk: d.amountTk - d.commissionTk,
      };
    });
  }

  /** A tournament's or community's sponsors (active, by tier); its leaders also get pending deals and the open call. */
  async forTarget(type: SponsorTargetType, id: string, viewerId: string | null) {
    const em = this.dataSource.manager;
    const target = await this.target(em, type, id);
    const where = type === 'tournament' ? { tournamentId: id } : { communityId: id };
    const active = await em.getRepository(Sponsorship).find({ where: { ...where, status: 'active' }, order: { startedAt: 'ASC' } });
    const canManage = viewerId ? await this.isHost(em, target, viewerId) : false;
    const pending = canManage ? await em.getRepository(Sponsorship).find({ where: { ...where, status: 'pending' }, order: { createdAt: 'DESC' } }) : [];
    const call = await em.getRepository(SponsorCall).findOne({ where: { ...where, open: true } });
    const order: Record<SponsorTier, number> = { title: 0, gold: 1, partner: 2 };
    const sponsors = (await this.views(active, viewerId))
      .sort((a, b) => order[a.tier] - order[b.tier])
      .map(({ amountTk: _a, heldTk: _h, commissionTk: _c, commissionPct: _p, bids: _b, netTk: _n, ...d }) => d);
    return {
      target: { type, id, name: target.name },
      sponsors,
      title: sponsors.find((s) => s.tier === 'title') ?? null,
      canManage,
      pending: canManage ? (await this.views(pending, viewerId)).map((d) => ({ ...d, mySide: 'host' as const })) : [],
      call,
      limits: TIER_LIMITS,
      commissionPct: (await this.settings.transfers()).sponsorCommissionPct,
    };
  }

  // ---------------------------------------------------------------- open calls

  async openCall(caller: User, input: { targetType: SponsorTargetType; targetId: string; tiers: SponsorTier[]; note?: string; askTk?: number }) {
    return this.dataSource.transaction(async (em) => {
      const target = await this.target(em, input.targetType, input.targetId);
      this.assertOpenTarget(target);
      await this.assertHost(em, target, caller.id);
      if (!input.tiers?.length) throw new BadRequestException('Pick at least one tier you’re looking for');
      const repo = em.getRepository(SponsorCall);
      const where = input.targetType === 'tournament' ? { tournamentId: target.id } : { communityId: target.id };
      const call = (await repo.findOne({ where })) ?? repo.create({ ...where, targetType: input.targetType, createdByUserId: caller.id });
      call.tiers = [...new Set(input.tiers)];
      call.note = input.note?.trim().slice(0, 1000) || null;
      call.askTk = input.askTk ?? null;
      call.open = true;
      return repo.save(call);
    });
  }

  async closeCall(caller: User, id: string) {
    const em = this.dataSource.manager;
    const call = await em.getRepository(SponsorCall).findOne({ where: { id } });
    if (!call) throw new NotFoundException('Call not found');
    const target = await this.target(em, call.targetType, (call.tournamentId ?? call.communityId)!);
    await this.assertHost(em, target, caller.id);
    call.open = false;
    return em.getRepository(SponsorCall).save(call);
  }

  /** Open calls for sponsors to browse: tournaments not yet over, and communities. */
  async calls() {
    const rows: Array<SponsorCall & { name: string; startAt: Date | null; status: string | null; hostName: string | null }> = await this.dataSource.query(
      `SELECT c.*, COALESCE(t.name, cm.name) AS name, t."startAt" AS "startAt", t.status::text AS status,
              COALESCE(tc.name, cm.name, u.name) AS "hostName"
         FROM sponsor_calls c
         LEFT JOIN tournaments t ON t.id = c."tournamentId"
         LEFT JOIN communities tc ON tc.id = t."communityId"
         LEFT JOIN users u ON u.id = t."creatorId"
         LEFT JOIN communities cm ON cm.id = c."communityId"
        WHERE c.open = true
          AND (c."tournamentId" IS NULL OR (t."deletedAt" IS NULL AND t.status NOT IN ('completed', 'cancelled')))
          AND (c."communityId" IS NULL OR cm."deletedAt" IS NULL)
        ORDER BY c."updatedAt" DESC LIMIT 100`,
    );
    return rows.map((r) => ({
      ...r,
      link: r.tournamentId
        ? r.communityId
          ? `/dashboard/efootball/community/${r.communityId}`
          : `/dashboard/efootball/tournaments/${r.tournamentId}`
        : `/dashboard/efootball/community/${r.communityId}`,
    }));
  }

  // ---------------------------------------------------------------- stats

  /** Views and clicks of sponsor logos and banners, sent in batches by the app. */
  async recordImpressions(items: Array<{ sponsorshipId: string; views?: number; clicks?: number }>) {
    const clean = items
      .slice(0, 50)
      .map((i) => ({ id: i.sponsorshipId, views: Math.min(20, Math.max(0, Math.floor(i.views ?? 0))), clicks: Math.min(5, Math.max(0, Math.floor(i.clicks ?? 0))) }))
      .filter((i) => i.views || i.clicks);
    if (!clean.length) return { recorded: 0 };
    const ids = [...new Set(clean.map((i) => i.id))];
    const active: Array<{ id: string }> = await this.dataSource.query(`SELECT id FROM sponsorships WHERE id = ANY($1) AND status = 'active'`, [ids]);
    const ok = new Set(active.map((a) => a.id));
    let recorded = 0;
    for (const i of clean.filter((x) => ok.has(x.id))) {
      await this.dataSource.query(
        `INSERT INTO sponsor_impressions ("sponsorshipId", day, views, clicks) VALUES ($1, CURRENT_DATE, $2, $3)
         ON CONFLICT ("sponsorshipId", day) DO UPDATE SET views = sponsor_impressions.views + $2, clicks = sponsor_impressions.clicks + $3`,
        [i.id, i.views, i.clicks],
      );
      recorded += 1;
    }
    return { recorded };
  }

  /** A sponsor's numbers: views / clicks per sponsorship (and the last 14 days), and post reach. */
  async stats(sponsorUserId: string) {
    const perDeal: Array<{ sponsorshipId: string; views: number; clicks: number }> = await this.dataSource.query(
      `SELECT i."sponsorshipId", sum(i.views)::int AS views, sum(i.clicks)::int AS clicks
         FROM sponsor_impressions i JOIN sponsorships s ON s.id = i."sponsorshipId"
        WHERE s."sponsorUserId" = $1 GROUP BY 1`,
      [sponsorUserId],
    );
    const daily: Array<{ day: string; views: number; clicks: number }> = await this.dataSource.query(
      `SELECT to_char(i.day, 'YYYY-MM-DD') AS day, sum(i.views)::int AS views, sum(i.clicks)::int AS clicks
         FROM sponsor_impressions i JOIN sponsorships s ON s.id = i."sponsorshipId"
        WHERE s."sponsorUserId" = $1 AND i.day > CURRENT_DATE - 14 GROUP BY 1 ORDER BY 1`,
      [sponsorUserId],
    );
    const [posts]: Array<{ reach: number; likes: number; comments: number; saves: number }> = await this.dataSource.query(
      `SELECT (SELECT count(*) FROM coach_post_views v JOIN coach_posts p ON p.id = v."postId"
                WHERE p."coachUserId" = $1 AND p."authorRole" = 'sponsor')::int AS reach,
              COALESCE(sum("likeCount"), 0)::int AS likes, COALESCE(sum("commentCount"), 0)::int AS comments, COALESCE(sum("saveCount"), 0)::int AS saves
         FROM coach_posts WHERE "coachUserId" = $1 AND "authorRole" = 'sponsor' AND "deletedAt" IS NULL`,
      [sponsorUserId],
    );
    return {
      views: perDeal.reduce((n, r) => n + r.views, 0),
      clicks: perDeal.reduce((n, r) => n + r.clicks, 0),
      perDeal,
      daily,
      posts: posts ?? { reach: 0, likes: 0, comments: 0, saves: 0 },
    };
  }

  // ---------------------------------------------------------------- staff

  async adminList(query: { search?: string; page?: number; limit?: number }) {
    const list = await this.list({ ...query, limit: query.limit ?? 30 });
    const ids = list.data.map((s) => s.userId);
    const deals = ids.length ? await this.dataSource.getRepository(Sponsorship).find({ where: { sponsorUserId: In(ids) }, order: { createdAt: 'DESC' } }) : [];
    const views = await this.views(deals, null);
    return { ...list, data: list.data.map((s) => ({ ...s, deals: views.filter((d) => d.sponsorUserId === s.userId).slice(0, 5) })) };
  }

  /** Staff verify (or un-verify) a sponsor's brand: a badge, and listed first. */
  async verify(actor: User, userId: string, verified: boolean, ip: string | null) {
    const repo = this.dataSource.getRepository(SponsorProfile);
    const profile = await repo.findOne({ where: { userId } });
    if (!profile) throw new NotFoundException('Sponsor not found');
    const before = Boolean(profile.verifiedAt);
    profile.verifiedAt = verified ? (profile.verifiedAt ?? new Date()) : null;
    profile.verifiedById = verified ? actor.id : null;
    await repo.save(profile);
    await this.audit.record(actor, {
      action: verified ? 'sponsor.verify' : 'sponsor.unverify',
      targetType: 'user',
      targetId: userId,
      targetName: profile.brandName,
      before: { verified: before },
      after: { verified },
      reason: null,
      ip,
    });
    if (verified && !before) {
      await this.notify([userId], 'sponsor.verified', 'Sponsor verified', `${profile.brandName} is now a verified sponsor.`, '/dashboard/sponsor/profile', {
        brand: profile.brandName,
      });
    }
    return { ...profile, verified };
  }
}
