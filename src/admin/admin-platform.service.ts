import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { existsSync, promises as fs } from 'node:fs';
import { join } from 'node:path';
import { DataSource, LessThanOrEqual, Repository } from 'typeorm';
import { JobMonitorService } from '../health/job-monitor.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { SettingsService, type SettingsSection } from '../settings/settings.service.js';
import { TransfersService } from '../transfers/transfers.service.js';
import { WalletsService } from '../transfers/wallets.service.js';
import type { Actor, ActionContext } from './admin-users.service.js';
import { AuditService } from './audit.service.js';
import type { AdminOffersQueryDto, AnnouncementsQueryDto, CreateAnnouncementDto, LedgerQueryDto, WalletAdjustDto } from './dto/platform.dto.js';
import { Announcement, type AnnouncementAudience } from './entities/announcement.entity.js';

const TRANSFERS_LINK = '/dashboard/efootball/transfers';

/**
 * Platform-level staff tools: the transfer market and wallets, system settings,
 * announcements and system health.
 */
@Injectable()
export class AdminPlatformService {
  private readonly logger = new Logger(AdminPlatformService.name);
  private sending = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Announcement) private readonly announcements: Repository<Announcement>,
    private readonly transfers: TransfersService,
    private readonly wallets: WalletsService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly monitor: JobMonitorService,
  ) {}

  // ----------------------------------------------------------- transfers

  async offers(query: AdminOffersQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const params: unknown[] = [];
    const p = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    const where: string[] = [];
    if (query.status === 'open') where.push(`o.status IN ('pending', 'scheduled')`);
    else if (query.status) where.push(`o.status = ${p(query.status)}`);
    if (query.kind) where.push(`o.kind = ${p(query.kind)}`);
    if (query.clubId) {
      const c = p(query.clubId);
      where.push(`(o."toClubId" = ${c} OR o."fromClubId" = ${c})`);
    }
    if (query.playerUserId) where.push(`o."playerUserId" = ${p(query.playerUserId)}`);
    if (query.from) where.push(`o."createdAt" >= ${p(query.from)}`);
    if (query.to) where.push(`o."createdAt" <= ${p(query.to)}`);
    if (query.search?.trim()) {
      const q = p(`%${query.search.trim().toLowerCase()}%`);
      where.push(`(LOWER(u.name) LIKE ${q} OR LOWER(tc.name) LIKE ${q} OR LOWER(fc.name) LIKE ${q} OR o."paymentRef" ILIKE ${q})`);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const from = `FROM transfer_offers o
      JOIN users u ON u.id = o."playerUserId"
      JOIN clubs tc ON tc.id = o."toClubId"
      LEFT JOIN clubs fc ON fc.id = o."fromClubId"
      ${clause}`;
    const [{ total }] = await this.dataSource.query(`SELECT count(*)::int AS total ${from}`, params);
    const data = await this.dataSource.query(
      `SELECT o.id, o.kind, o.status, o."amountTk", o."payeeType", o."paymentRef", o."createdAt", o."completedAt", o."expiresAt",
              o."playerUserId", u.name AS "playerName", u."dpUrl" AS "playerDpUrl",
              o."toClubId", tc.name AS "toClubName", o."fromClubId", fc.name AS "fromClubName",
              (o.status = 'completed' AND EXISTS (SELECT 1 FROM player_contracts c WHERE c."offerId" = o.id AND c.status = 'active')) AS reversible
         ${from}
        ORDER BY o."createdAt" DESC
        LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      params,
    );
    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 } };
  }

  async cancelOffer(actor: Actor, offerId: string, reason: string, ctx: ActionContext = {}) {
    const offer = await this.transfers.staffCancel(offerId, reason);
    await this.audit.record(actor, {
      action: 'transfer.cancel',
      targetType: 'transfer',
      targetId: offerId,
      targetName: `${offer.player.name} → ${offer.toClub.name}`,
      after: { amountTk: offer.amountTk, status: offer.status },
      reason,
      ip: ctx.ip,
    });
    return offer;
  }

  async reverseOffer(actor: Actor, offerId: string, reason: string, ctx: ActionContext = {}) {
    const offer = await this.transfers.staffReverse(offerId, reason);
    await this.audit.record(actor, {
      action: 'transfer.reverse',
      targetType: 'transfer',
      targetId: offerId,
      targetName: `${offer.player.name} → ${offer.toClub.name}`,
      after: { amountTk: offer.amountTk, backTo: offer.fromClub?.name ?? 'no club' },
      reason,
      ip: ctx.ip,
    });
    return offer;
  }

  async endLock(actor: Actor, userId: string, reason: string, ctx: ActionContext = {}) {
    const contract = await this.transfers.staffEndLock(userId, reason);
    await this.audit.record(actor, {
      action: 'transfer.end_lock',
      targetType: 'user',
      targetId: userId,
      targetName: contract.contractNo,
      after: { club: contract.clubName },
      reason,
      ip: ctx.ip,
    });
    return contract;
  }

  async ledger(query: LedgerQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 30;
    const params: unknown[] = [];
    const p = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    const where: string[] = [];
    if (query.ownerType) where.push(`w."ownerType" = ${p(query.ownerType)}`);
    if (query.ownerId) where.push(`w."ownerId" = ${p(query.ownerId)}`);
    if (query.kind) where.push(`t.kind = ${p(query.kind)}`);
    if (query.from) where.push(`t."createdAt" >= ${p(query.from)}`);
    if (query.to) where.push(`t."createdAt" <= ${p(query.to)}`);
    if (query.search?.trim()) {
      const q = p(`%${query.search.trim().toLowerCase()}%`);
      where.push(`(LOWER(COALESCE(u.name, c.name)) LIKE ${q} OR LOWER(t.counterparty) LIKE ${q} OR t.reference ILIKE ${q})`);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const from = `FROM wallet_transactions t
      JOIN wallets w ON w.id = t."walletId"
      LEFT JOIN users u ON w."ownerType" = 'user' AND u.id = w."ownerId"
      LEFT JOIN clubs c ON w."ownerType" = 'club' AND c.id = w."ownerId"
      ${clause}`;
    const [{ total }] = await this.dataSource.query(`SELECT count(*)::int AS total ${from}`, params);
    const data = await this.dataSource.query(
      `SELECT t.id, t.kind, t."amountTk", t."offerId", t.counterparty, t.reference, t."createdAt",
              w."ownerType", w."ownerId", COALESCE(u.name, c.name) AS "ownerName", w."balanceTk", w."heldTk"
         ${from}
        ORDER BY t."createdAt" DESC
        LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      params,
    );
    const [totals] = await this.dataSource.query(
      `SELECT COALESCE(sum("balanceTk"), 0)::int AS "balanceTk", COALESCE(sum("heldTk"), 0)::int AS "heldTk", count(*)::int AS wallets FROM wallets`,
    );
    return { data, totals, meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 } };
  }

  async walletOf(ownerType: 'user' | 'club', ownerId: string) {
    const [row] = await this.dataSource.query(`SELECT "balanceTk", "heldTk" FROM wallets WHERE "ownerType" = $1 AND "ownerId" = $2`, [ownerType, ownerId]);
    return row ?? { balanceTk: null, heldTk: null };
  }

  /** A correction to a wallet, recorded in its history as "adjustment" and in the audit log. */
  async adjustWallet(actor: Actor, dto: WalletAdjustDto, ctx: ActionContext = {}) {
    const table = dto.ownerType === 'club' ? 'clubs' : 'users';
    const [owner] = await this.dataSource.query(`SELECT name FROM "${table}" WHERE id = $1`, [dto.ownerId]);
    if (!owner) throw new NotFoundException('Wallet owner not found');
    const wallet = await this.dataSource.transaction((em) =>
      this.wallets.adjust(em, { type: dto.ownerType, id: dto.ownerId }, dto.amountTk, 'adjustment', { counterparty: `ALLYNQ staff: ${dto.reason}`.slice(0, 255) }),
    );
    const message = `ALLYNQ staff ${dto.amountTk > 0 ? 'added' : 'removed'} ${Math.abs(dto.amountTk)} tk ${dto.amountTk > 0 ? 'to' : 'from'} the wallet: ${dto.reason}`;
    const recipients =
      dto.ownerType === 'user'
        ? [dto.ownerId]
        : (await this.dataSource.query(`SELECT "userId" FROM efootball_profiles WHERE "clubId" = $1 AND "clubRole" IN ('President', 'General Secretary')`, [dto.ownerId])).map(
            (r: { userId: string }) => r.userId,
          );
    await this.notifications.createMany(recipients, {
      title: 'Wallet adjusted',
      message,
      type: 'transfer',
      link: dto.ownerType === 'club' ? `/dashboard/efootball/clubs/${dto.ownerId}?tab=transfers` : '/dashboard/efootball/wallet',
      code: 'admin.wallet_adjusted',
      params: { amount: dto.amountTk, owner: owner.name, reason: dto.reason },
    });
    await this.audit.record(actor, {
      action: 'wallet.adjust',
      targetType: dto.ownerType,
      targetId: dto.ownerId,
      targetName: owner.name,
      before: { balanceTk: wallet.balanceTk - dto.amountTk },
      after: { balanceTk: wallet.balanceTk },
      reason: dto.reason,
      ip: ctx.ip,
    });
    return { balanceTk: wallet.balanceTk, heldTk: wallet.heldTk };
  }

  // ------------------------------------------------------------- settings

  async allSettings() {
    const [transfers, admin, features, maintenance] = await Promise.all([
      this.settings.section('transfers'),
      this.settings.section('admin'),
      this.settings.section('features'),
      this.settings.section('maintenance'),
    ]);
    return { transfers, admin, features, maintenance };
  }

  async updateSettings(actor: Actor, section: SettingsSection, patch: Record<string, unknown>, ctx: ActionContext = {}) {
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    if (!Object.keys(clean).length) throw new BadRequestException('Nothing to change');
    const before = await this.settings.section<Record<string, unknown>>(section);
    const after = await this.settings.updateSection<Record<string, unknown>>(section, clean);
    const changed = Object.keys(clean).filter((k) => before[k] !== after[k]);
    if (!changed.length) return this.allSettings();

    // Club leaders hear about new transfer rules; everyone sees maintenance on the site itself.
    if (section === 'transfers') {
      const leaders = (
        await this.dataSource.query(
          `SELECT DISTINCT ep."userId" FROM efootball_profiles ep JOIN users u ON u.id = ep."userId"
            WHERE ep."clubRole" IN ('President', 'General Secretary') AND u."deletedAt" IS NULL`,
        )
      ).map((r: { userId: string }) => r.userId);
      const summary = changed.map((k) => `${k}: ${before[k]} → ${after[k]}`).join(', ');
      await this.notifications.createMany(leaders, {
        title: 'Transfer rules changed',
        message: `ALLYNQ staff changed the transfer market rules (${summary}). New contracts and offers use the new values.`,
        type: 'transfer',
        link: TRANSFERS_LINK,
        code: 'admin.transfer_settings',
        params: { changes: summary },
      });
    }
    await this.audit.record(actor, {
      action: `settings.${section}`,
      targetType: 'settings',
      targetName: section,
      before: Object.fromEntries(changed.map((k) => [k, before[k] as unknown])),
      after: Object.fromEntries(changed.map((k) => [k, after[k] as unknown])),
      ip: ctx.ip,
    });
    return this.allSettings();
  }

  // -------------------------------------------------------- announcements

  async listAnnouncements(query: AnnouncementsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const [rows, total] = await this.announcements.findAndCount({ order: { createdAt: 'DESC' }, skip: (page - 1) * limit, take: limit });
    const authors = rows.length
      ? await this.dataSource.query(`SELECT id, name FROM users WHERE id = ANY($1::uuid[])`, [[...new Set(rows.map((r) => r.createdById).filter(Boolean))]])
      : [];
    const nameOf = new Map(authors.map((a: { id: string; name: string }) => [a.id, a.name]));
    return {
      data: rows.map((r) => ({ ...r, createdByName: r.createdById ? (nameOf.get(r.createdById) ?? null) : null })),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 },
    };
  }

  /** Estimated reach, shown before sending. */
  async audienceSize(dto: Pick<CreateAnnouncementDto, 'audience' | 'country' | 'targetId'>) {
    const audience = this.toAudience(dto);
    return { recipients: (await this.recipients(audience)).length, label: await this.label(audience) };
  }

  async createAnnouncement(actor: Actor, dto: CreateAnnouncementDto, ctx: ActionContext = {}) {
    const audience = this.toAudience(dto);
    const scheduledFor = dto.scheduledFor ? new Date(dto.scheduledFor) : null;
    if (dto.link && !dto.link.startsWith('/')) throw new BadRequestException('Links must be inside ALLYNQ (start with /)');
    const announcement = await this.announcements.save(
      this.announcements.create({
        title: dto.title.trim(),
        message: dto.message.trim(),
        link: dto.link?.trim() || null,
        audience,
        audienceLabel: await this.label(audience),
        status: 'scheduled',
        scheduledFor,
        createdById: actor.id,
      }),
    );
    await this.audit.record(actor, {
      action: scheduledFor && scheduledFor > new Date() ? 'announcement.schedule' : 'announcement.send',
      targetType: 'announcement',
      targetId: announcement.id,
      targetName: announcement.title,
      after: { audience: announcement.audienceLabel, scheduledFor: scheduledFor?.toISOString() ?? null },
      ip: ctx.ip,
    });
    if (!scheduledFor || scheduledFor <= new Date()) return this.deliver(announcement);
    return announcement;
  }

  async cancelAnnouncement(actor: Actor, id: string, ctx: ActionContext = {}) {
    const a = await this.announcements.findOne({ where: { id } });
    if (!a) throw new NotFoundException('Announcement not found');
    if (a.status !== 'scheduled') throw new BadRequestException(`This announcement is already ${a.status}`);
    a.status = 'cancelled';
    await this.announcements.save(a);
    await this.audit.record(actor, { action: 'announcement.cancel', targetType: 'announcement', targetId: id, targetName: a.title, ip: ctx.ip });
    return a;
  }

  /** Every minute: send scheduled announcements that are due. */
  @Cron(CronExpression.EVERY_MINUTE)
  async sendDue(): Promise<number> {
    if (this.sending) return 0;
    this.sending = true;
    try {
      return await this.monitor.run(
        'announcements.send',
        async () => {
          const due = await this.announcements.find({ where: { status: 'scheduled', scheduledFor: LessThanOrEqual(new Date()) }, take: 20 });
          for (const a of due) await this.deliver(a);
          return due.length;
        },
        (n) => `${n} sent`,
      );
    } catch (error) {
      this.logger.error(`Sending announcements failed: ${(error as Error).message}`);
      return 0;
    } finally {
      this.sending = false;
    }
  }

  private async deliver(a: Announcement) {
    const ids = await this.recipients(a.audience);
    const count = await this.notifications.createMany(ids, {
      title: a.title,
      message: a.message,
      type: 'system',
      link: a.link ?? undefined,
      code: 'admin.announcement',
      params: { title: a.title, message: a.message },
    });
    a.status = 'sent';
    a.sentAt = new Date();
    a.recipients = count;
    return this.announcements.save(a);
  }

  private toAudience(dto: Pick<CreateAnnouncementDto, 'audience' | 'country' | 'targetId'>): AnnouncementAudience {
    switch (dto.audience) {
      case 'country':
        return { type: 'country', country: dto.country!.trim() };
      case 'community':
      case 'club':
        return { type: dto.audience, id: dto.targetId! };
      default:
        return { type: dto.audience };
    }
  }

  private async recipients(audience: AnnouncementAudience): Promise<string[]> {
    const active = `u."deletedAt" IS NULL AND u."bannedAt" IS NULL`;
    const sql: Record<AnnouncementAudience['type'], string> = {
      all: `SELECT u.id FROM users u WHERE ${active}`,
      staff: `SELECT u.id FROM users u WHERE ${active} AND u."systemRole" IS NOT NULL`,
      leaders: `SELECT DISTINCT u.id FROM users u JOIN efootball_profiles ep ON ep."userId" = u.id
                 WHERE ${active} AND (ep."clubRole" IN ('President', 'General Secretary')
                   OR EXISTS (SELECT 1 FROM community_members cm WHERE cm."profileId" = ep.id AND cm.role IN ('President', 'Vice President')))`,
      country: `SELECT u.id FROM users u WHERE ${active} AND LOWER(u.country) = LOWER($1)`,
      community: `SELECT DISTINCT u.id FROM users u JOIN efootball_profiles ep ON ep."userId" = u.id
                   WHERE ${active} AND (ep."communityId" = $1 OR EXISTS (SELECT 1 FROM community_members cm WHERE cm."profileId" = ep.id AND cm."communityId" = $1))`,
      club: `SELECT u.id FROM users u JOIN efootball_profiles ep ON ep."userId" = u.id WHERE ${active} AND ep."clubId" = $1`,
    };
    const params = audience.type === 'country' ? [audience.country] : audience.type === 'community' || audience.type === 'club' ? [audience.id] : [];
    return (await this.dataSource.query(sql[audience.type], params)).map((r: { id: string }) => r.id);
  }

  private async label(audience: AnnouncementAudience): Promise<string> {
    if (audience.type === 'country') return `Everyone in ${audience.country}`;
    if (audience.type === 'community' || audience.type === 'club') {
      const table = audience.type === 'club' ? 'clubs' : 'communities';
      const [row] = await this.dataSource.query(`SELECT name FROM "${table}" WHERE id = $1`, [audience.id]);
      if (!row) throw new NotFoundException(`That ${audience.type} doesn't exist`);
      return `Members of ${row.name}`;
    }
    return { all: 'Everyone', staff: 'ALLYNQ staff', leaders: 'Club and community leaders' }[audience.type];
  }

  // ---------------------------------------------------------------- health

  async health() {
    const memory = process.memoryUsage();
    const [db] = await this.dataSource.query(
      `SELECT pg_database_size(current_database())::bigint AS bytes,
              (SELECT count(*)::int FROM pg_stat_activity WHERE datname = current_database()) AS connections`,
    );
    const tables = await this.dataSource.query(
      `SELECT relname AS name, n_live_tup::int AS rows, pg_total_relation_size(relid)::bigint AS bytes
         FROM pg_stat_user_tables WHERE schemaname = 'public' ORDER BY pg_total_relation_size(relid) DESC LIMIT 12`,
    );
    const [activity] = await this.dataSource.query(
      `SELECT (SELECT count(*)::int FROM notifications WHERE "createdAt" > now() - interval '24 hours') AS "notifications24h",
              (SELECT count(*)::int FROM login_events WHERE "createdAt" > now() - interval '24 hours') AS "signIns24h",
              (SELECT count(*)::int FROM login_events WHERE NOT success AND "createdAt" > now() - interval '24 hours') AS "failedSignIns24h",
              (SELECT count(*)::int FROM activity_events WHERE "createdAt" > now() - interval '24 hours') AS "actions24h"`,
    );
    return {
      server: {
        uptimeSeconds: Math.round(process.uptime()),
        node: process.version,
        memoryMb: { rss: Math.round(memory.rss / 1e6), heapUsed: Math.round(memory.heapUsed / 1e6), heapTotal: Math.round(memory.heapTotal / 1e6) },
      },
      database: { bytes: Number(db.bytes), connections: db.connections, tables: tables.map((t: { name: string; rows: number; bytes: string }) => ({ ...t, bytes: Number(t.bytes) })) },
      uploads: await this.uploadSizes(),
      activity,
      maintenance: await this.settings.maintenance(),
      features: await this.settings.features(),
      ...this.monitor.snapshot(),
    };
  }

  /** Size and file count of each uploads/ sub-folder. */
  private async uploadSizes() {
    const root = join(process.cwd(), 'uploads');
    if (!existsSync(root)) return [];
    const walk = async (dir: string): Promise<{ bytes: number; files: number }> => {
      let bytes = 0;
      let files = 0;
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          const sub = await walk(full);
          bytes += sub.bytes;
          files += sub.files;
        } else {
          bytes += (await fs.stat(full)).size;
          files += 1;
        }
      }
      return { bytes, files };
    };
    const folders = (await fs.readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory());
    return Promise.all(folders.map(async (f) => ({ folder: f.name, ...(await walk(join(root, f.name))) })));
  }
}
