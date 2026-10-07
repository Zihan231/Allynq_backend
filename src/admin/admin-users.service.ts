import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import bcrypt from 'bcrypt';
import { DataSource, Repository } from 'typeorm';
import { ActivityService } from '../activity/activity.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { RecycleBinService } from '../recycle-bin/recycle-bin.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { User } from '../users/entities/user.entity.js';
import { DocumentType, SYSTEM_ROLE_RANK, SystemRole } from '../users/enums/user-attributes.enum.js';
import { AuditService } from './audit.service.js';
import type {
  ActivityQueryDto,
  AdminUsersQueryDto,
  BulkUsersDto,
  EditUserDto,
  SetRoleDto,
  VerificationQueryDto,
  VerificationReviewDto,
} from './dto/admin.dto.js';
import { hasSystemRole } from './system-role.guard.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const USER_LINK = '/dashboard/efootball/profile';

/** Level an approved document gives, unless the reviewer picks another. */
const DOCUMENT_LEVEL: Record<DocumentType, number> = {
  [DocumentType.NATIONAL_ID]: 3,
  [DocumentType.PASSPORT]: 3,
  [DocumentType.BIRTH_CERTIFICATE]: 2,
  [DocumentType.DRIVER_LICENSE]: 2,
  [DocumentType.UNIVERSITY_DOCS]: 1,
  [DocumentType.COLLEGE_DOCS]: 1,
};

export type Actor = Pick<User, 'id' | 'name' | 'systemRole'>;
export interface ActionContext {
  ip?: string | null;
}

const rankOf = (user: Pick<User, 'systemRole'>) => (user.systemRole ? SYSTEM_ROLE_RANK[user.systemRole] : 0);

/** Snapshot of the moderation fields, for the audit log's before / after. */
function moderationState(user: User) {
  return {
    suspendedUntil: user.suspendedUntil,
    suspendReason: user.suspendReason,
    bannedAt: user.bannedAt,
    banReason: user.banReason,
    warningsCount: user.warningsCount,
  };
}

@Injectable()
export class AdminUsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly activity: ActivityService,
    private readonly bin: RecycleBinService,
    private readonly settings: SettingsService,
  ) {}

  // ---------------------------------------------------------------- reads

  async list(query: AdminUsersQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const params: unknown[] = [];
    const p = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };
    const where: string[] = [];

    if (query.search?.trim()) {
      const q = p(`%${query.search.trim().toLowerCase()}%`);
      where.push(`(LOWER(u.name) LIKE ${q} OR LOWER(u.email) LIKE ${q} OR u."phoneNumber" LIKE ${q} OR LOWER(u."inGameId") LIKE ${q} OR u.id::text = ${p(query.search.trim())})`);
    }
    if (query.country) where.push(`LOWER(u.country) = LOWER(${p(query.country)})`);
    if (query.division) where.push(`LOWER(u.division) = LOWER(${p(query.division)})`);
    if (query.verificationStatus) where.push(`u."verificationStatus" = ${p(query.verificationStatus)}`);
    if (query.verificationLevel !== undefined) where.push(`u."verificationLevel"::text = ${p(String(query.verificationLevel))}`);
    if (query.systemRole === 'none') where.push(`u."systemRole" IS NULL`);
    else if (query.systemRole === 'staff') where.push(`u."systemRole" IS NOT NULL`);
    else if (query.systemRole) where.push(`u."systemRole" = ${p(query.systemRole)}`);
    if (query.clubId) where.push(`ep."clubId" = ${p(query.clubId)}`);
    if (query.communityId) {
      const c = p(query.communityId);
      where.push(`(ep."communityId" = ${c} OR ep."clubId" IN (SELECT "clubId" FROM community_clubs WHERE "communityId" = ${c}))`);
    }
    if (query.joinedFrom) where.push(`u."createdAt" >= ${p(query.joinedFrom)}`);
    if (query.joinedTo) where.push(`u."createdAt" <= ${p(query.joinedTo)}`);

    switch (query.status) {
      case 'deleted':
        where.push(`u."deletedAt" IS NOT NULL`);
        break;
      case 'banned':
        where.push(`u."deletedAt" IS NULL AND u."bannedAt" IS NOT NULL`);
        break;
      case 'suspended':
        where.push(`u."deletedAt" IS NULL AND u."bannedAt" IS NULL AND u."suspendedUntil" > now()`);
        break;
      case 'warned':
        where.push(`u."deletedAt" IS NULL AND u."warningsCount" > 0`);
        break;
      case 'active':
        where.push(`u."deletedAt" IS NULL AND u."bannedAt" IS NULL AND (u."suspendedUntil" IS NULL OR u."suspendedUntil" <= now())`);
        break;
      default:
        where.push(`u."deletedAt" IS NULL`);
    }

    const order = {
      newest: 'u."createdAt" DESC',
      oldest: 'u."createdAt" ASC',
      name: 'LOWER(u.name) ASC',
      last_login: 'u."lastLoginAt" DESC NULLS LAST',
      warnings: 'u."warningsCount" DESC, u."createdAt" DESC',
    }[query.sort ?? 'newest'];

    const from = `FROM users u
      LEFT JOIN efootball_profiles ep ON ep."userId" = u.id
      LEFT JOIN clubs c ON c.id = ep."clubId"
      LEFT JOIN communities co ON co.id = ep."communityId"
      WHERE ${where.join(' AND ')}`;
    const [{ total }] = await this.dataSource.query(`SELECT count(*)::int AS total ${from}`, params);
    const data = await this.dataSource.query(
      `SELECT u.id, u.name, u.email, u."phoneNumber", u.country, u.division, u.district, u."dpUrl", u."createdAt",
              u."lastLoginAt", u."verificationLevel", u."verificationStatus", u."systemRole", u."suspendedUntil",
              u."bannedAt", u."warningsCount", u."deletedAt",
              ep."clubId", c.name AS "clubName", ep."clubRole", ep."communityId", co.name AS "communityName", ep."communityRole"
         ${from}
        ORDER BY ${order}
        LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      params,
    );
    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 } };
  }

  async detail(id: string) {
    const [user] = await this.dataSource.query(
      `SELECT u.id, u.name, u.email, u."phoneNumber", u.country, u.division, u.district, u.bio, u."dpUrl", u."coverUrl",
              u."inGameId", u.birthday, u."createdAt", u."updatedAt", u."lastLoginAt", u."documentType",
              (u."documentDataUrl" IS NOT NULL AND u."documentDataUrl" <> '') AS "hasDocument",
              u."verificationLevel", u."verificationStatus", u."verificationNote", u."verificationReviewedAt",
              rv.name AS "verificationReviewedBy", u."systemRole", u."suspendedUntil", u."suspendReason",
              u."bannedAt", u."banReason", u."warningsCount", u."deletedAt",
              ep."clubId", c.name AS "clubName", ep."clubRole", ep."communityId", co.name AS "communityName",
              ep."communityRole", ep.points, ep."konamiUid",
              w."balanceTk" AS "walletTk", w."heldTk" AS "walletHeldTk",
              pc."contractNo", pc."lockEndsAt"
         FROM users u
         LEFT JOIN users rv ON rv.id = u."verificationReviewedById"
         LEFT JOIN efootball_profiles ep ON ep."userId" = u.id
         LEFT JOIN clubs c ON c.id = ep."clubId"
         LEFT JOIN communities co ON co.id = ep."communityId"
         LEFT JOIN wallets w ON w."ownerType" = 'user' AND w."ownerId" = u.id
         LEFT JOIN player_contracts pc ON pc."userId" = u.id AND pc.status = 'active'
        WHERE u.id = $1`,
      [id],
    );
    if (!user) throw new NotFoundException('User not found');

    const [logins, activity, audit, counts, sharedIp] = await Promise.all([
      this.dataSource.query(
        `SELECT id, success, "failureReason", ip, "userAgent", "createdAt" FROM login_events
          WHERE "userId" = $1 ORDER BY "createdAt" DESC LIMIT 15`,
        [id],
      ),
      this.dataSource.query(
        `SELECT id, type, summary, "targetType", "targetId", "createdAt" FROM activity_events
          WHERE "userId" = $1 ORDER BY "createdAt" DESC LIMIT 20`,
        [id],
      ),
      this.dataSource.query(
        `SELECT id, "actorName", "actorRole", action, reason, before, after, "createdAt" FROM admin_audit_logs
          WHERE "targetType" = 'user' AND "targetId" = $1 ORDER BY "createdAt" DESC LIMIT 20`,
        [id],
      ),
      this.dataSource.query(
        `SELECT
           (SELECT count(*)::int FROM transfer_offers o WHERE o."playerUserId" = $1 AND o.status = 'completed') AS transfers,
           (SELECT count(*)::int FROM login_events l WHERE l."userId" = $1 AND l.success) AS logins,
           (SELECT count(*)::int FROM login_events l WHERE l."userId" = $1 AND NOT l.success AND l."createdAt" > now() - interval '7 days') AS "failedLogins7d"`,
        [id],
      ),
      // Other accounts that signed in from the same IP addresses (possible multi-accounting).
      this.dataSource.query(
        `SELECT DISTINCT u.id, u.name, l2.ip
           FROM login_events l1
           JOIN login_events l2 ON l2.ip = l1.ip AND l2."userId" <> l1."userId" AND l2.success
           JOIN users u ON u.id = l2."userId"
          WHERE l1."userId" = $1 AND l1.success AND l1.ip IS NOT NULL
          LIMIT 10`,
        [id],
      ),
    ]);
    return { ...user, stats: counts[0], logins, activity, audit, sharedIp };
  }

  async document(id: string) {
    const user = await this.users.findOne({ where: { id }, select: { id: true, documentType: true, documentDataUrl: true } });
    if (!user) throw new NotFoundException('User not found');
    return { documentType: user.documentType, documentDataUrl: user.documentDataUrl };
  }

  async activityOf(id: string, query: ActivityQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 30;
    const params: unknown[] = [id];
    const where = [`"userId" = $1`];
    if (query.type) {
      params.push(`${query.type}%`);
      where.push(`type LIKE $${params.length}`);
    }
    if (query.from) {
      params.push(query.from);
      where.push(`"createdAt" >= $${params.length}`);
    }
    if (query.to) {
      params.push(query.to);
      where.push(`"createdAt" <= $${params.length}`);
    }
    const clause = where.join(' AND ');
    const [{ total }] = await this.dataSource.query(`SELECT count(*)::int AS total FROM activity_events WHERE ${clause}`, params);
    const data = await this.dataSource.query(
      `SELECT id, type, summary, "targetType", "targetId", meta, ip, "createdAt" FROM activity_events
        WHERE ${clause} ORDER BY "createdAt" DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      params,
    );
    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 } };
  }

  async verificationQueue(query: VerificationQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const params: unknown[] = [query.status ?? 'pending'];
    let search = '';
    if (query.search?.trim()) {
      params.push(`%${query.search.trim().toLowerCase()}%`);
      search = `AND (LOWER(u.name) LIKE $2 OR LOWER(u.email) LIKE $2)`;
    }
    const where = `WHERE u."verificationStatus" = $1 AND u."deletedAt" IS NULL ${search}`;
    const [{ total }] = await this.dataSource.query(`SELECT count(*)::int AS total FROM users u ${where}`, params);
    const data = await this.dataSource.query(
      `SELECT u.id, u.name, u.email, u."dpUrl", u.country, u."documentType", u."verificationLevel", u."verificationStatus",
              u."verificationNote", u."verificationReviewedAt", rv.name AS "reviewedBy", u."updatedAt", u."createdAt"
         FROM users u LEFT JOIN users rv ON rv.id = u."verificationReviewedById"
         ${where}
        ORDER BY u."updatedAt" ${query.status && query.status !== 'pending' ? 'DESC' : 'ASC'}
        LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      params,
    );
    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 } };
  }

  // -------------------------------------------------------------- actions

  async warn(actor: Actor, id: string, reason: string, ctx: ActionContext = {}) {
    const user = await this.target(actor, id);
    const before = moderationState(user);
    user.warningsCount += 1;
    await this.users.update(id, { warningsCount: user.warningsCount });
    await this.notifyUser(id, 'admin.warning', 'Warning from ALLYNQ', `You received a warning: ${reason}`, { reason });
    await this.done(actor, 'user.warn', user, before, moderationState(user), reason, ctx);
    return this.summary(id);
  }

  async suspend(actor: Actor, id: string, until: string, reason: string, ctx: ActionContext = {}) {
    const user = await this.target(actor, id);
    const untilDate = new Date(until);
    if (!(untilDate.getTime() > Date.now())) throw new BadRequestException('The suspension must end in the future');
    if (!hasSystemRole(actor, SystemRole.ADMIN)) {
      const { moderatorMaxSuspendDays } = await this.settings.admin();
      if (untilDate.getTime() - Date.now() > moderatorMaxSuspendDays * DAY_MS + 60_000) {
        throw new ForbiddenException(`Moderators can suspend for at most ${moderatorMaxSuspendDays} days`);
      }
    }
    const before = moderationState(user);
    await this.users.update(id, { suspendedUntil: untilDate, suspendReason: reason.trim() });
    await this.bumpToken(id);
    await this.notifyUser(id, 'admin.suspended', 'Account suspended', `Your account is suspended until ${untilDate.toISOString()}: ${reason}`, {
      reason,
      until: untilDate.toISOString(),
    });
    await this.done(actor, 'user.suspend', user, before, { ...before, suspendedUntil: untilDate, suspendReason: reason }, reason, ctx);
    return this.summary(id);
  }

  async unsuspend(actor: Actor, id: string, reason: string | undefined, ctx: ActionContext = {}) {
    const user = await this.target(actor, id);
    const before = moderationState(user);
    await this.users.update(id, { suspendedUntil: null, suspendReason: null });
    await this.notifyUser(id, 'admin.unsuspended', 'Suspension lifted', 'Your account suspension has been lifted.', {});
    await this.done(actor, 'user.unsuspend', user, before, { ...before, suspendedUntil: null, suspendReason: null }, reason, ctx);
    return this.summary(id);
  }

  async ban(actor: Actor, id: string, reason: string, ctx: ActionContext = {}) {
    const user = await this.target(actor, id);
    if (user.bannedAt) throw new BadRequestException('This user is already banned');
    const before = moderationState(user);
    const bannedAt = new Date();
    await this.users.update(id, { bannedAt, banReason: reason.trim() });
    await this.bumpToken(id);
    await this.done(actor, 'user.ban', user, before, { ...before, bannedAt, banReason: reason }, reason, ctx);
    return this.summary(id);
  }

  async unban(actor: Actor, id: string, reason: string | undefined, ctx: ActionContext = {}) {
    const user = await this.target(actor, id);
    const before = moderationState(user);
    await this.users.update(id, { bannedAt: null, banReason: null });
    await this.notifyUser(id, 'admin.unbanned', 'Ban lifted', 'Your account ban has been lifted. Welcome back.', {});
    await this.done(actor, 'user.unban', user, before, { ...before, bannedAt: null, banReason: null }, reason, ctx);
    return this.summary(id);
  }

  async forceLogout(actor: Actor, id: string, reason: string | undefined, ctx: ActionContext = {}) {
    const user = await this.target(actor, id);
    await this.bumpToken(id);
    await this.done(actor, 'user.force_logout', user, null, null, reason, ctx);
    return this.summary(id);
  }

  async resetPassword(actor: Actor, id: string, password: string, ctx: ActionContext = {}) {
    const user = await this.target(actor, id);
    await this.users.update(id, { password: await bcrypt.hash(password, 10) });
    await this.bumpToken(id);
    await this.notifyUser(id, 'admin.password_reset', 'Password reset', 'An administrator reset your password. Sign in with the new one.', {});
    await this.done(actor, 'user.reset_password', user, null, null, 'Password reset by staff', ctx);
    return this.summary(id);
  }

  async edit(actor: Actor, id: string, dto: EditUserDto, ctx: ActionContext = {}) {
    const user = await this.target(actor, id);
    const { reason, ...fields } = dto;
    const patch: Partial<User> = {};
    const before: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields) as Array<[keyof typeof fields, string | undefined]>) {
      if (value === undefined) continue;
      const next = key === 'email' ? value.toLowerCase().trim() : value.trim();
      if ((user as unknown as Record<string, unknown>)[key] === next) continue;
      before[key] = (user as unknown as Record<string, unknown>)[key];
      (patch as Record<string, unknown>)[key] = next || (key === 'name' ? user.name : null);
    }
    if (!Object.keys(patch).length) return this.summary(id);
    if (patch.email) {
      const taken = await this.users.findOne({ where: { email: patch.email } });
      if (taken && taken.id !== id) throw new ConflictException('Another account already uses this email');
    }
    await this.users.update(id, patch);
    await this.done(actor, 'user.edit', user, before, patch as Record<string, unknown>, reason, ctx);
    return this.summary(id);
  }

  async setRole(actor: Actor, id: string, dto: SetRoleDto, ctx: ActionContext = {}) {
    if (actor.id === id) throw new BadRequestException("You can't change your own role");
    const user = await this.users.findOne({ where: { id } });
    if (!user || user.deletedAt) throw new NotFoundException('User not found');
    const role = dto.role === 'none' ? null : dto.role;
    if (user.systemRole === role) return this.summary(id);
    await this.users.update(id, { systemRole: role });
    // A new or removed role takes effect on the next sign-in.
    await this.bumpToken(id);
    await this.notifyUser(
      id,
      'admin.role_changed',
      'Staff role changed',
      role ? `You are now an ALLYNQ ${role.replace('_', ' ')}.` : 'Your ALLYNQ staff role was removed.',
      { role: role ?? 'none' },
    );
    await this.done(actor, 'user.role', user, { systemRole: user.systemRole }, { systemRole: role }, dto.reason, ctx);
    return this.summary(id);
  }

  async moveToBin(actor: Actor, id: string, reason: string, ctx: ActionContext = {}) {
    const user = await this.target(actor, id);
    await this.bin.moveToBin('user', id, actor.id, reason);
    await this.done(actor, 'bin.delete', user, null, { deletedAt: new Date() }, reason, ctx);
    return { id, binned: true };
  }

  async reviewVerification(actor: Actor, id: string, dto: VerificationReviewDto, ctx: ActionContext = {}) {
    const user = await this.users.findOne({ where: { id } });
    if (!user || user.deletedAt) throw new NotFoundException('User not found');
    if (dto.approve && !user.documentType) throw new BadRequestException('This user has not uploaded a document');
    const level = dto.approve ? (dto.level ?? (user.documentType ? DOCUMENT_LEVEL[user.documentType] : 1)) : 0;
    const before = { verificationStatus: user.verificationStatus, verificationLevel: user.verificationLevel };
    const after = { verificationStatus: dto.approve ? 'approved' : 'rejected', verificationLevel: level };
    await this.users.update(id, {
      verificationStatus: after.verificationStatus as User['verificationStatus'],
      verificationLevel: level,
      verificationNote: dto.note?.trim() || null,
      verificationReviewedAt: new Date(),
      verificationReviewedById: actor.id,
    });
    if (dto.approve) {
      await this.notifyUser(id, 'verification.approved', 'Verification approved', `Your ID was approved. Verification level ${level}.`, { level });
    } else {
      await this.notifyUser(
        id,
        'verification.rejected',
        'Verification rejected',
        `Your ID document was rejected${dto.note ? `: ${dto.note}` : ''}. Please upload a clearer document.`,
        { note: dto.note ?? '' },
      );
    }
    await this.done(actor, dto.approve ? 'verification.approve' : 'verification.reject', user, before, after, dto.note, ctx);
    return this.summary(id);
  }

  /** Runs one action on many users. Each user is handled separately; failures are reported, not thrown. */
  async bulk(actor: Actor, dto: BulkUsersDto, ctx: ActionContext = {}) {
    const needsReason = ['warn', 'suspend', 'ban', 'bin'].includes(dto.action);
    if (needsReason && (dto.reason?.trim().length ?? 0) < 3) throw new BadRequestException('A reason is required');
    if (dto.action === 'suspend' && !dto.until) throw new BadRequestException('Pick when the suspension ends');
    if (dto.action === 'notify' && !dto.message?.trim()) throw new BadRequestException('Write the message to send');
    if (dto.action !== 'warn' && dto.action !== 'suspend' && !hasSystemRole(actor, SystemRole.ADMIN)) {
      throw new ForbiddenException('This needs the admin role');
    }

    const failed: Array<{ id: string; error: string }> = [];
    let done = 0;
    for (const id of new Set(dto.userIds)) {
      try {
        switch (dto.action) {
          case 'warn':
            await this.warn(actor, id, dto.reason!, ctx);
            break;
          case 'suspend':
            await this.suspend(actor, id, dto.until!, dto.reason!, ctx);
            break;
          case 'unsuspend':
            await this.unsuspend(actor, id, dto.reason, ctx);
            break;
          case 'ban':
            await this.ban(actor, id, dto.reason!, ctx);
            break;
          case 'unban':
            await this.unban(actor, id, dto.reason, ctx);
            break;
          case 'force_logout':
            await this.forceLogout(actor, id, dto.reason, ctx);
            break;
          case 'bin':
            await this.moveToBin(actor, id, dto.reason!, ctx);
            break;
          case 'notify':
            await this.target(actor, id);
            await this.notifyUser(id, 'admin.message', 'Message from ALLYNQ', dto.message!.trim(), { message: dto.message!.trim() });
            break;
        }
        done++;
      } catch (error) {
        failed.push({ id, error: (error as Error).message });
      }
    }
    if (dto.action === 'notify' && done) {
      await this.audit.record(actor, {
        action: 'user.notify',
        targetType: 'user',
        after: { recipients: done, message: dto.message },
        ip: ctx.ip,
      });
    }
    return { done, failed };
  }

  // -------------------------------------------------------------- helpers

  /**
   * Loads the user an action targets. Staff can't act on themselves, and only on users
   * ranked below them (a moderator can't touch an admin).
   */
  private async target(actor: Actor, id: string): Promise<User> {
    if (actor.id === id) throw new BadRequestException("You can't do this to your own account");
    const user = await this.users.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    if (user.deletedAt) throw new BadRequestException('This account is in the recycle bin. Restore it first.');
    if (rankOf(user) >= rankOf(actor)) {
      throw new ForbiddenException('You can only act on users below your own staff role');
    }
    return user;
  }

  private async bumpToken(id: string) {
    await this.users.increment({ id }, 'tokenVersion', 1);
  }

  private async notifyUser(userId: string, code: string, title: string, message: string, params: Record<string, string | number>) {
    await this.notifications.createNotification(userId, {
      title,
      message,
      type: 'system',
      link: USER_LINK,
      code,
      params,
    });
  }

  private async done(
    actor: Actor,
    action: string,
    user: User,
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null,
    reason: string | null | undefined,
    ctx: ActionContext,
  ) {
    await this.audit.record(actor, { action, targetType: 'user', targetId: user.id, targetName: user.name, before, after, reason, ip: ctx.ip });
    await this.activity.log(user.id, {
      type: `moderation.${action.split('.').pop()}`,
      summary: `${action.replace('.', ': ')} by ${actor.name}${reason ? ` (${reason})` : ''}`,
      targetType: 'user',
      targetId: user.id,
    });
  }

  private async summary(id: string) {
    const [row] = (await this.list({ search: id, limit: 1, status: undefined })).data;
    return row ?? (await this.users.findOne({ where: { id } }));
  }
}
