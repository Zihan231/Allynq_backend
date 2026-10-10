import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { NotificationTemplate } from '../notifications/entities/notification-template.entity.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { SecurityService } from '../security/security.service.js';
import { User } from '../users/entities/user.entity.js';
import { serializeUser } from '../users/serializers/user.serializer.js';
import { AuditService } from './audit.service.js';
import type {
  AccountLabelDto,
  CreateSeasonDto,
  CreateSecurityBanDto,
  CreateStoreItemDto,
  NotificationTemplateDto,
  StaffNoteDto,
  UpdateSeasonDto,
  UpdateStoreItemDto,
  ViewAsUserDto,
} from './dto/phase-six.dto.js';
import { AccountLabel } from './entities/account-label.entity.js';
import { AccountStaffNote } from './entities/account-staff-note.entity.js';
import { Season } from './entities/season.entity.js';
import { StoreItem } from './entities/store-item.entity.js';
import { SeasonStanding } from './entities/season-standing.entity.js';
import { StatsService } from '../stats/stats.service.js';

type Actor = Pick<User, 'id' | 'name' | 'systemRole'>;
type ActionContext = { ip?: string | null; deviceId?: string | null };

@Injectable()
export class AdminPhaseSixService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(AccountStaffNote)
    private readonly notes: Repository<AccountStaffNote>,
    @InjectRepository(AccountLabel)
    private readonly labels: Repository<AccountLabel>,
    @InjectRepository(NotificationTemplate)
    private readonly templates: Repository<NotificationTemplate>,
    @InjectRepository(Season) private readonly seasons: Repository<Season>,
    @InjectRepository(StoreItem)
    private readonly storeItems: Repository<StoreItem>,
    @InjectRepository(SeasonStanding)
    private readonly standings: Repository<SeasonStanding>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly notifications: NotificationsService,
    private readonly security: SecurityService,
    private readonly audit: AuditService,
    private readonly jwt: JwtService,
    private readonly stats: StatsService,
  ) {}

  // ----------------------------------------------------- network and devices

  securityBans(page?: number, limit?: number) {
    return this.security.list(page, limit);
  }

  async createSecurityBan(
    actor: Actor,
    dto: CreateSecurityBanDto,
    context: ActionContext,
  ) {
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    if (expiresAt && expiresAt.getTime() <= Date.now())
      throw new BadRequestException('Expiry must be in the future');
    this.assertNotOwnClient(dto.kind, this.security.hash(dto.kind, dto.value), context);
    const ban = await this.security.create({
      ...dto,
      expiresAt,
      actorId: actor.id,
    });
    await this.audit.record(actor, {
      action: `security.${dto.kind}_ban`,
      targetType: 'security_ban',
      targetId: ban.id,
      targetName: ban.valueHint,
      after: { kind: ban.kind, expiresAt: ban.expiresAt },
      reason: dto.reason,
      ip: context.ip,
    });
    return ban;
  }

  async createSecurityBanFromLogin(
    actor: Actor,
    loginId: string,
    dto: { kind: 'ip' | 'device'; reason: string; expiresAt?: string },
    context: ActionContext,
  ) {
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    if (expiresAt && expiresAt.getTime() <= Date.now())
      throw new BadRequestException('Expiry must be in the future');
    const login = await this.dataSource.query(`SELECT ip, "deviceHash" FROM login_events WHERE id = $1`, [loginId]);
    const own = login[0];
    if (own) {
      const hash = dto.kind === 'ip' ? (own.ip ? this.security.hash('ip', own.ip) : null) : own.deviceHash;
      if (hash) this.assertNotOwnClient(dto.kind, hash, context);
    }
    const ban = await this.security.createFromLogin(
      loginId,
      dto.kind,
      dto.reason,
      expiresAt,
      actor.id,
    );
    await this.audit.record(actor, {
      action: `security.${dto.kind}_ban`,
      targetType: 'security_ban',
      targetId: ban.id,
      targetName: ban.valueHint,
      after: { loginId, kind: ban.kind, expiresAt },
      reason: dto.reason,
      ip: context.ip,
    });
    return ban;
  }

  async revokeSecurityBan(actor: Actor, id: string, context: ActionContext) {
    const ban = await this.security.revoke(id, actor.id);
    await this.audit.record(actor, {
      action: 'security.ban_revoke',
      targetType: 'security_ban',
      targetId: ban.id,
      targetName: ban.valueHint,
      before: { kind: ban.kind },
      ip: context.ip,
    });
    return ban;
  }

  // ------------------------------------------------------- notes and labels

  async accountNotes(userId: string) {
    await this.requireUser(userId);
    return this.notes.find({ where: { userId }, order: { createdAt: 'DESC' } });
  }

  async addAccountNote(
    actor: Actor,
    userId: string,
    dto: StaffNoteDto,
    context: ActionContext,
  ) {
    const user = await this.requireUser(userId);
    const note = await this.notes.save(
      this.notes.create({
        userId,
        authorId: actor.id,
        authorName: actor.name,
        body: dto.body.trim(),
      }),
    );
    await this.audit.record(actor, {
      action: 'user.note_add',
      targetType: 'user',
      targetId: user.id,
      targetName: user.name,
      after: { noteId: note.id },
      ip: context.ip,
    });
    return note;
  }

  async updateAccountNote(
    actor: Actor,
    userId: string,
    noteId: string,
    dto: StaffNoteDto,
    context: ActionContext,
  ) {
    const note = await this.notes.findOne({ where: { id: noteId, userId } });
    if (!note) throw new NotFoundException('Staff note not found');
    const before = note.body;
    note.body = dto.body.trim();
    await this.notes.save(note);
    await this.audit.record(actor, {
      action: 'user.note_edit',
      targetType: 'user',
      targetId: userId,
      before: { noteId, body: before },
      after: { noteId, body: note.body },
      ip: context.ip,
    });
    return note;
  }

  async deleteAccountNote(
    actor: Actor,
    userId: string,
    noteId: string,
    context: ActionContext,
  ) {
    const note = await this.notes.findOne({ where: { id: noteId, userId } });
    if (!note) throw new NotFoundException('Staff note not found');
    await this.notes.remove(note);
    await this.audit.record(actor, {
      action: 'user.note_delete',
      targetType: 'user',
      targetId: userId,
      before: { noteId, body: note.body },
      ip: context.ip,
    });
    return { success: true };
  }

  async accountLabels(userId: string) {
    await this.requireUser(userId);
    return this.labels.find({ where: { userId }, order: { label: 'ASC' } });
  }

  async addAccountLabel(
    actor: Actor,
    userId: string,
    dto: AccountLabelDto,
    context: ActionContext,
  ) {
    const user = await this.requireUser(userId);
    const label = dto.label.trim();
    const existing = await this.labels.findOne({ where: { userId, label } });
    const row = await this.labels.save(
      existing
        ? Object.assign(existing, { color: dto.color ?? existing.color })
        : this.labels.create({
            userId,
            label,
            color: dto.color ?? '#64748b',
            createdById: actor.id,
          }),
    );
    await this.audit.record(actor, {
      action: existing ? 'user.label_edit' : 'user.label_add',
      targetType: 'user',
      targetId: userId,
      targetName: user.name,
      after: { label: row.label, color: row.color },
      ip: context.ip,
    });
    return row;
  }

  async removeAccountLabel(
    actor: Actor,
    userId: string,
    labelId: string,
    context: ActionContext,
  ) {
    const row = await this.labels.findOne({ where: { id: labelId, userId } });
    if (!row) throw new NotFoundException('Account label not found');
    await this.labels.remove(row);
    await this.audit.record(actor, {
      action: 'user.label_delete',
      targetType: 'user',
      targetId: userId,
      before: { label: row.label, color: row.color },
      ip: context.ip,
    });
    return { success: true };
  }

  // ----------------------------------------------- notification text editor

  async notificationTemplates() {
    const [overrides, used] = await Promise.all([
      this.templates.find({ order: { code: 'ASC' } }),
      this.dataSource.query(
        `SELECT DISTINCT code FROM notifications WHERE code IS NOT NULL ORDER BY code`,
      ),
    ]);
    const byCode = new Map(overrides.map((row) => [row.code, row]));
    return [
      ...new Set<string>([
        ...used.map((row: { code: string }) => row.code),
        ...byCode.keys(),
      ]),
    ]
      .sort()
      .map((code) => ({ code, override: byCode.get(code) ?? null }));
  }

  async updateNotificationTemplate(
    actor: Actor,
    code: string,
    dto: NotificationTemplateDto,
    context: ActionContext,
  ) {
    if (!/^[a-z0-9_.-]{2,64}$/iu.test(code))
      throw new BadRequestException('Invalid notification code');
    const before = await this.templates.findOne({ where: { code } });
    const row = await this.templates.save({
      code,
      titleTemplate: dto.titleTemplate.trim(),
      messageTemplate: dto.messageTemplate.trim(),
      titleTemplateBn: dto.titleTemplateBn?.trim() || null,
      messageTemplateBn: dto.messageTemplateBn?.trim() || null,
      enabled: dto.enabled ?? true,
      updatedById: actor.id,
    });
    this.notifications.clearTemplateCache(code);
    await this.audit.record(actor, {
      action: 'notification_template.update',
      targetType: 'notification_template',
      targetName: code,
      before: before
        ? {
            titleTemplate: before.titleTemplate,
            messageTemplate: before.messageTemplate,
            enabled: before.enabled,
          }
        : null,
      after: {
        titleTemplate: row.titleTemplate,
        messageTemplate: row.messageTemplate,
        enabled: row.enabled,
      },
      ip: context.ip,
    });
    return row;
  }

  async resetNotificationTemplate(
    actor: Actor,
    code: string,
    context: ActionContext,
  ) {
    const row = await this.templates.findOne({ where: { code } });
    if (!row)
      throw new NotFoundException('Notification template override not found');
    await this.templates.remove(row);
    this.notifications.clearTemplateCache(code);
    await this.audit.record(actor, {
      action: 'notification_template.reset',
      targetType: 'notification_template',
      targetName: code,
      before: {
        titleTemplate: row.titleTemplate,
        messageTemplate: row.messageTemplate,
      },
      ip: context.ip,
    });
    return { success: true };
  }

  // -------------------------------------------------------------- seasons

  listSeasons() {
    return this.seasons.find({ order: { startsAt: 'DESC' } });
  }

  currentSeason() {
    return this.seasons.findOne({ where: { status: 'active' } });
  }

  async createSeason(
    actor: Actor,
    dto: CreateSeasonDto,
    context: ActionContext,
  ) {
    this.validateSeason(dto.startsAt, dto.endsAt);
    const row = await this.seasons.save(
      this.seasons.create({
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        startsAt: new Date(dto.startsAt),
        endsAt: new Date(dto.endsAt),
        status: 'draft',
        rules: dto.rules ?? {},
        createdById: actor.id,
      }),
    );
    await this.audit.record(actor, {
      action: 'season.create',
      targetType: 'season',
      targetId: row.id,
      targetName: row.name,
      after: { startsAt: row.startsAt, endsAt: row.endsAt },
      ip: context.ip,
    });
    return row;
  }

  async updateSeason(
    actor: Actor,
    id: string,
    dto: UpdateSeasonDto,
    context: ActionContext,
  ) {
    const row = await this.requireSeason(id);
    if (row.status === 'closed')
      throw new ConflictException('Closed seasons cannot be edited');
    const startsAt = dto.startsAt ?? row.startsAt.toISOString();
    const endsAt = dto.endsAt ?? row.endsAt.toISOString();
    this.validateSeason(startsAt, endsAt);
    const before = {
      name: row.name,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      rules: row.rules,
    };
    if (dto.name !== undefined) row.name = dto.name.trim();
    if (dto.description !== undefined)
      row.description = dto.description.trim() || null;
    if (dto.startsAt !== undefined) row.startsAt = new Date(dto.startsAt);
    if (dto.endsAt !== undefined) row.endsAt = new Date(dto.endsAt);
    if (dto.rules !== undefined) row.rules = dto.rules;
    await this.seasons.save(row);
    await this.audit.record(actor, {
      action: 'season.update',
      targetType: 'season',
      targetId: row.id,
      targetName: row.name,
      before,
      after: {
        name: row.name,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        rules: row.rules,
      },
      ip: context.ip,
    });
    return row;
  }

  async activateSeason(actor: Actor, id: string, context: ActionContext) {
    // The season being replaced keeps its final standings.
    const current = await this.seasons.findOne({ where: { status: 'active' } });
    if (current && current.id !== id) await this.archiveStandings(current);
    const row = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(Season);
      const target = await repo.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!target) throw new NotFoundException('Season not found');
      if (target.status === 'closed')
        throw new ConflictException('A closed season cannot be reactivated');
      await repo
        .createQueryBuilder()
        .update()
        .set({ status: 'closed' })
        .where(`status = 'active' AND id <> :id`, { id })
        .execute();
      target.status = 'active';
      return repo.save(target);
    });
    await this.audit.record(actor, {
      action: 'season.activate',
      targetType: 'season',
      targetId: row.id,
      targetName: row.name,
      after: { status: row.status },
      ip: context.ip,
    });
    return row;
  }

  async closeSeason(
    actor: Actor,
    id: string,
    reason: string | undefined,
    context: ActionContext,
  ) {
    const row = await this.requireSeason(id);
    const before = row.status;
    if (before === 'closed') throw new ConflictException('This season is already closed');
    // Final standings are taken while it is still active (the "this season" rankings).
    const archived = before === 'active' ? await this.archiveStandings(row) : { players: 0, clubs: 0 };
    row.status = 'closed';
    await this.seasons.save(row);
    await this.audit.record(actor, {
      action: 'season.close',
      targetType: 'season',
      targetId: row.id,
      targetName: row.name,
      before: { status: before },
      after: { status: row.status, archivedPlayers: archived.players, archivedClubs: archived.clubs },
      reason,
      ip: context.ip,
    });
    return row;
  }

  // -------------------------------------------------------- store catalogue

  /** Staff view of the catalogue: every item with how many users own it and what it has earned. */
  async adminStoreCatalog() {
    const items = await this.storeCatalog(true);
    if (!items.length) return [];
    const stats: Array<{ sku: string; owners: number; revenueTk: number; sales: number }> = await this.dataSource.query(
      `SELECT i.sku,
              (SELECT count(*)::int FROM users u WHERE u."ownedCosmeticIds" ? i.sku) AS owners,
              COALESCE((SELECT -sum(w."amountTk") FROM wallet_transactions w WHERE w."storeItemId" = i.id AND w.kind = 'purchase'), 0)::int AS "revenueTk",
              (SELECT count(*)::int FROM wallet_transactions w WHERE w."storeItemId" = i.id AND w.kind = 'purchase') AS sales
         FROM store_items i`,
    );
    const bySku = new Map(stats.map((s) => [s.sku, s]));
    return items.map((item) => ({
      ...item,
      owners: bySku.get(item.sku)?.owners ?? 0,
      sales: bySku.get(item.sku)?.sales ?? 0,
      revenueTk: bySku.get(item.sku)?.revenueTk ?? 0,
    }));
  }

  storeCatalog(includeInactive = true) {
    return this.storeItems.find({
      where: includeInactive ? {} : { active: true },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
  }

  async createStoreItem(
    actor: Actor,
    dto: CreateStoreItemDto,
    context: ActionContext,
  ) {
    const existing = await this.storeItems.findOne({ where: { sku: dto.sku } });
    if (existing) throw new ConflictException('That store SKU already exists');
    const row = await this.storeItems.save(
      this.storeItems.create({
        ...dto,
        description: dto.description?.trim() || null,
        assetUrl: dto.assetUrl?.trim() || null,
        active: dto.active ?? true,
        sortOrder: dto.sortOrder ?? 0,
        metadata: dto.metadata ?? {},
      }),
    );
    await this.audit.record(actor, {
      action: 'store_item.create',
      targetType: 'store_item',
      targetId: row.id,
      targetName: row.name,
      after: { sku: row.sku, category: row.category, priceTk: row.priceTk },
      ip: context.ip,
    });
    return row;
  }

  async updateStoreItem(
    actor: Actor,
    id: string,
    dto: UpdateStoreItemDto,
    context: ActionContext,
  ) {
    const row = await this.storeItems.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Store item not found');
    const before = { ...row };
    Object.assign(row, dto);
    if (dto.description !== undefined)
      row.description = dto.description.trim() || null;
    if (dto.assetUrl !== undefined) row.assetUrl = dto.assetUrl.trim() || null;
    try {
      await this.storeItems.save(row);
    } catch (error) {
      if ((error as { code?: string }).code === '23505')
        throw new ConflictException('That store SKU already exists');
      throw error;
    }
    await this.audit.record(actor, {
      action: 'store_item.update',
      targetType: 'store_item',
      targetId: row.id,
      targetName: row.name,
      before: {
        sku: before.sku,
        category: before.category,
        priceTk: before.priceTk,
        active: before.active,
      },
      after: {
        sku: row.sku,
        category: row.category,
        priceTk: row.priceTk,
        active: row.active,
      },
      ip: context.ip,
    });
    return row;
  }

  async grantStoreItem(
    actor: Actor,
    userId: string,
    itemId: string,
    remove: boolean,
    reason: string | undefined,
    context: ActionContext,
  ) {
    const item = await this.storeItems.findOne({ where: { id: itemId } });
    if (!item) throw new NotFoundException('Store item not found');
    const user = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(User);
      const target = await repo.findOne({
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!target) throw new NotFoundException('User not found');
      // Owned items are stored by their code (the same ids the store and profiles use).
      const owned = new Set(target.ownedCosmeticIds ?? []);
      if (remove) {
        owned.delete(item.sku);
        owned.delete(item.id);
        // A revoked item can't stay equipped.
        for (const field of ['equippedBadgeId', 'equippedTitleId', 'equippedFrameId', 'equippedThemeId'] as const) {
          if (target[field] === item.sku || target[field] === item.id) target[field] = null;
        }
      } else owned.add(item.sku);
      target.ownedCosmeticIds = [...owned];
      return repo.save(target);
    });
    await this.audit.record(actor, {
      action: remove ? 'store_item.revoke' : 'store_item.grant',
      targetType: 'user',
      targetId: user.id,
      targetName: user.name,
      after: { itemId: item.id, sku: item.sku },
      reason,
      ip: context.ip,
    });
    return { userId: user.id, item, owned: !remove };
  }

  // --------------------------------------------------------- export / view as

  async exportUser(actor: Actor, userId: string, context: ActionContext) {
    const user = await this.users.findOne({
      where: { id: userId },
      relations: { efootballProfile: true },
    });
    if (!user) throw new NotFoundException('User not found');
    const queries = await Promise.all([
      this.dataSource.query(
        `SELECT * FROM notifications WHERE "userId" = $1 ORDER BY "createdAt"`,
        [userId],
      ),
      this.dataSource.query(
        `SELECT * FROM activity_events WHERE "userId" = $1 ORDER BY "createdAt"`,
        [userId],
      ),
      this.dataSource.query(
        `SELECT id, email, success, "failureReason", ip, "userAgent", "deviceHint", "createdAt" FROM login_events WHERE "userId" = $1 ORDER BY "createdAt"`,
        [userId],
      ),
      this.dataSource.query(
        `SELECT * FROM tournament_participants WHERE "userId" = $1 ORDER BY "createdAt"`,
        [userId],
      ),
      this.dataSource.query(
        `SELECT * FROM reports WHERE "reporterId" = $1 ORDER BY "createdAt"`,
        [userId],
      ),
      this.dataSource.query(
        `SELECT * FROM player_contracts WHERE "userId" = $1 ORDER BY "createdAt"`,
        [userId],
      ),
      this.dataSource.query(
        `SELECT * FROM transfer_offers WHERE "playerUserId" = $1 ORDER BY "createdAt"`,
        [userId],
      ),
      this.labels.find({ where: { userId }, order: { createdAt: 'ASC' } }),
    ]);
    const [
      notifications,
      activity,
      signIns,
      tournamentEntries,
      reports,
      contracts,
      transferOffers,
      labels,
    ] = queries;
    const result = {
      exportedAt: new Date().toISOString(),
      user: serializeUser(user, true),
      efootballProfile: user.efootballProfile ?? null,
      notifications,
      activity,
      signIns,
      tournamentEntries,
      reports,
      contracts,
      transferOffers,
      labels,
    };
    await this.audit.record(actor, {
      action: 'user.export',
      targetType: 'user',
      targetId: user.id,
      targetName: user.name,
      ip: context.ip,
    });
    return result;
  }

  async viewAsUser(
    actor: Actor,
    userId: string,
    dto: ViewAsUserDto,
    context: ActionContext,
  ) {
    const user = await this.requireUser(userId);
    if (user.systemRole)
      throw new ConflictException(
        'Staff accounts cannot be opened with view-as-user',
      );
    const minutes = dto.minutes ?? 15;
    const accessToken = this.jwt.sign(
      {
        sub: user.id,
        email: user.email,
        tv: user.tokenVersion ?? 0,
        act: actor.id,
        viewOnly: true,
        purpose: 'access',
      },
      { expiresIn: `${minutes}m` },
    );
    await this.audit.record(actor, {
      action: 'user.view_as',
      targetType: 'user',
      targetId: user.id,
      targetName: user.name,
      after: { viewOnly: true, minutes },
      ip: context.ip,
    });
    return {
      accessToken,
      expiresAt: new Date(Date.now() + minutes * 60_000).toISOString(),
      viewOnly: true,
      user: serializeUser(user, false),
    };
  }

  /** A season's archived final standings (top 100 players and clubs). */
  seasonStandings(seasonId: string, kind: 'player' | 'club') {
    return this.standings.find({ where: { seasonId, kind }, order: { rank: 'ASC' } });
  }

  /** Saves the top 100 players and clubs of the active season's rankings. */
  private async archiveStandings(season: Season): Promise<{ players: number; clubs: number }> {
    const [players, clubs] = await Promise.all([
      this.stats.playerRankings({ period: 'this-season', page: 1, limit: 100 }),
      this.stats.clubRankings({ period: 'this-season', page: 1, limit: 100 }),
    ]);
    const rows = [
      ...players.data.filter((r) => r.rank != null).map((r) => ({ kind: 'player' as const, r })),
      ...clubs.data.filter((r) => r.rank != null).map((r) => ({ kind: 'club' as const, r })),
    ].map(({ kind, r }) =>
      this.standings.create({
        seasonId: season.id,
        kind,
        rank: Number(r.rank),
        entityId: r.id,
        name: String((r as { name?: string }).name ?? ''),
        line: r as unknown as Record<string, unknown>,
      }),
    );
    await this.standings.delete({ seasonId: season.id });
    if (rows.length) await this.standings.save(rows, { chunk: 100 });
    return { players: rows.filter((r) => r.kind === 'player').length, clubs: rows.filter((r) => r.kind === 'club').length };
  }

  private assertNotOwnClient(kind: 'ip' | 'device', hash: string, context: ActionContext) {
    if (this.security.matchesClient(kind, hash, { ip: context.ip, deviceId: context.deviceId })) {
      throw new BadRequestException(
        kind === 'ip'
          ? "That's the network you're using right now. Banning it could lock out you and other staff on it."
          : "That's the device you're using right now.",
      );
    }
  }

  private async requireUser(id: string): Promise<User> {
    const user = await this.users.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  private async requireSeason(id: string): Promise<Season> {
    const season = await this.seasons.findOne({ where: { id } });
    if (!season) throw new NotFoundException('Season not found');
    return season;
  }

  private validateSeason(startsAt: string, endsAt: string): void {
    if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
      throw new BadRequestException('Season end must be after its start');
    }
  }
}
