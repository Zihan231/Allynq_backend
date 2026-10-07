import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import type { Actor, ActionContext } from '../admin/admin-users.service.js';
import { AdminContentService } from '../admin/admin-content.service.js';
import { AdminUsersService } from '../admin/admin-users.service.js';
import { AuditService } from '../admin/audit.service.js';
import { hasSystemRole } from '../admin/system-role.guard.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { User } from '../users/entities/user.entity.js';
import { ClubRole, CommunityRole, SystemRole } from '../users/enums/user-attributes.enum.js';
import type {
  AdminReportsQueryDto,
  AssignReportDto,
  CreateReportDto,
  MyReportsQueryDto,
  ResolveReportDto,
} from './dto/report.dto.js';
import { ReportMessage } from './entities/report-message.entity.js';
import { ACTIVE_REPORT_STATUSES, Report, type ReportTarget } from './entities/report.entity.js';
import { removeReportFiles } from './report-upload.js';

const REPORTER_LINK = (id: string) => `/dashboard/efootball/reports?id=${id}`;
const CLUB_LEADERS: string[] = [ClubRole.PRESIDENT, ClubRole.GENERAL_SECRETARY];
const COMMUNITY_LEADERS: string[] = [CommunityRole.PRESIDENT, CommunityRole.VICE_PRESIDENT];

interface TargetInfo {
  name: string;
  clubId: string | null;
  communityId: string | null;
  /** For a user target: their account, so the report can't be about yourself. */
  userId?: string;
}

/**
 * Reports from players and club / community leaders, and the staff side of handling them.
 * Leaders' reports (filed on behalf of their club or community) rank higher in the queue.
 */
@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(Report) private readonly reports: Repository<Report>,
    @InjectRepository(ReportMessage) private readonly messages: Repository<ReportMessage>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly adminUsers: AdminUsersService,
    private readonly adminContent: AdminContentService,
  ) {}

  // ------------------------------------------------------------ reporter side

  async create(user: User, dto: CreateReportDto, attachments: string[]): Promise<Report> {
    try {
      const { reportDailyLimit, reportStrikeLimit } = await this.settings.admin();
      if ((user.reportStrikes ?? 0) >= reportStrikeLimit) {
        throw new ForbiddenException('You can no longer send reports because several of your reports were found to be false.');
      }
      const [{ n }] = await this.dataSource.query(
        `SELECT count(*)::int AS n FROM reports WHERE "reporterId" = $1 AND "createdAt" > now() - interval '24 hours'`,
        [user.id],
      );
      if (n >= reportDailyLimit) {
        throw new BadRequestException(`You can send up to ${reportDailyLimit} reports a day. Please try again tomorrow.`);
      }

      const target = await this.resolveTarget(dto.targetType, dto.targetId);
      if (dto.targetType === 'user' && target.userId === user.id) {
        throw new BadRequestException("You can't report yourself");
      }
      const open = await this.reports.findOne({
        where: { reporterId: user.id, targetType: dto.targetType, targetId: dto.targetId, status: In(ACTIVE_REPORT_STATUSES) },
      });
      if (open) throw new ConflictException('You already have an open report about this. Add to it from My reports.');

      const reportedAs = dto.reportedAs ?? 'self';
      const profile = user.efootballProfile;
      let reporterClubId: string | null = null;
      let reporterCommunityId: string | null = null;
      if (reportedAs === 'club') {
        if (!profile?.clubId || !CLUB_LEADERS.includes(profile.clubRole ?? '')) {
          throw new ForbiddenException('Only a club President or General Secretary can report on behalf of the club');
        }
        reporterClubId = profile.clubId;
      } else if (reportedAs === 'community') {
        if (!profile?.communityId || !(await this.leadsCommunity(user, profile.communityId))) {
          throw new ForbiddenException('Only a community President or Vice President can report on behalf of the community');
        }
        reporterCommunityId = profile.communityId;
      }

      return await this.reports.save(
        this.reports.create({
          reporterId: user.id,
          reportedAs,
          reporterClubId,
          reporterCommunityId,
          targetType: dto.targetType,
          targetId: dto.targetId,
          targetName: target.name.slice(0, 255),
          contextClubId: target.clubId,
          contextCommunityId: target.communityId,
          reason: dto.reason,
          details: dto.details.trim(),
          attachments,
          status: 'open',
        }),
      );
    } catch (error) {
      // The images were already written to disk; don't keep them for a refused report.
      await removeReportFiles(attachments);
      throw error;
    }
  }

  async mine(user: User, query: MyReportsQueryDto) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 50);
    const [data, total] = await this.reports.findAndCount({
      where: { reporterId: user.id },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data: data.map((r) => this.reporterView(r)), meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 } };
  }

  /** The reporter's view of one report: no internal notes, no staff identities beyond names. */
  async reporterDetail(user: User, id: string) {
    const report = await this.reports.findOne({ where: { id } });
    if (!report || report.reporterId !== user.id) throw new NotFoundException('Report not found');
    const thread = await this.messages.find({ where: { reportId: id, internal: false }, order: { createdAt: 'ASC' } });
    return { ...this.reporterView(report), messages: thread.map((m) => ({ id: m.id, fromStaff: m.fromStaff, authorName: m.fromStaff ? 'ALLYNQ staff' : m.authorName, body: m.body, createdAt: m.createdAt })) };
  }

  async reply(user: User, id: string, body: string) {
    const report = await this.reports.findOne({ where: { id } });
    if (!report || report.reporterId !== user.id) throw new NotFoundException('Report not found');
    if (!ACTIVE_REPORT_STATUSES.includes(report.status)) throw new BadRequestException('This report is closed');
    await this.messages.save(this.messages.create({ reportId: id, authorId: user.id, authorName: user.name, fromStaff: false, internal: false, body: body.trim() }));
    await this.reports.update(id, { updatedAt: new Date() });
    return this.reporterDetail(user, id);
  }

  async withdraw(user: User, id: string) {
    const report = await this.reports.findOne({ where: { id } });
    if (!report || report.reporterId !== user.id) throw new NotFoundException('Report not found');
    if (!ACTIVE_REPORT_STATUSES.includes(report.status)) throw new BadRequestException('This report is already closed');
    await this.reports.update(id, { status: 'withdrawn', resolvedAt: new Date() });
    return this.reporterDetail(user, id);
  }

  // --------------------------------------------------------------- staff side

  async list(actor: Actor, query: AdminReportsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const params: unknown[] = [];
    const p = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };
    const where: string[] = [];
    const status = query.status ?? 'active';
    if (status === 'active') where.push(`r.status IN ('open', 'in_review')`);
    else if (status !== 'all') where.push(`r.status = ${p(status)}`);
    if (query.targetType) where.push(`r."targetType" = ${p(query.targetType)}`);
    if (query.targetId) where.push(`r."targetId" = ${p(query.targetId)}`);
    if (query.reason) where.push(`r.reason = ${p(query.reason)}`);
    if (query.reportedAs === 'leaders') where.push(`r."reportedAs" <> 'self'`);
    else if (query.reportedAs) where.push(`r."reportedAs" = ${p(query.reportedAs)}`);
    if (query.assignee === 'me') where.push(`r."assigneeId" = ${p(actor.id)}`);
    else if (query.assignee === 'unassigned') where.push(`r."assigneeId" IS NULL`);
    else if (query.assignee) where.push(`r."assigneeId"::text = ${p(query.assignee)}`);
    if (query.clubId) {
      const c = p(query.clubId);
      where.push(`(r."contextClubId" = ${c} OR (r."targetType" = 'club' AND r."targetId" = ${c}) OR r."reporterClubId" = ${c})`);
    }
    if (query.communityId) {
      const c = p(query.communityId);
      where.push(`(r."contextCommunityId" = ${c} OR (r."targetType" = 'community' AND r."targetId" = ${c}) OR r."reporterCommunityId" = ${c})`);
    }
    if (query.from) where.push(`r."createdAt" >= ${p(query.from)}`);
    if (query.to) where.push(`r."createdAt" <= ${p(query.to)}`);
    if (query.search?.trim()) {
      const q = p(`%${query.search.trim().toLowerCase()}%`);
      where.push(`(LOWER(r."targetName") LIKE ${q} OR LOWER(r.details) LIKE ${q} OR LOWER(rep.name) LIKE ${q})`);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    // Priority: how many people currently report the same target, plus a bonus for leaders' reports.
    const openOnTarget = `(SELECT count(*)::int FROM reports o WHERE o."targetType" = r."targetType" AND o."targetId" = r."targetId" AND o.status IN ('open', 'in_review'))`;
    const priority = `(${openOnTarget} + CASE WHEN r."reportedAs" <> 'self' THEN 2 ELSE 0 END)`;
    const order = {
      priority: `${priority} DESC, r."createdAt" ASC`,
      newest: `r."createdAt" DESC`,
      oldest: `r."createdAt" ASC`,
    }[query.sort ?? 'priority'];

    const from = `FROM reports r JOIN users rep ON rep.id = r."reporterId" LEFT JOIN users a ON a.id = r."assigneeId" ${clause}`;
    const [{ total }] = await this.dataSource.query(`SELECT count(*)::int AS total ${from}`, params);
    const data = await this.dataSource.query(
      `SELECT r.id, r."targetType", r."targetId", r."targetName", r.reason, r.details, r.status, r."reportedAs",
              r."createdAt", r."updatedAt", r."resolvedAt", jsonb_array_length(r.attachments)::int AS "attachmentCount",
              r."reporterId", rep.name AS "reporterName", rep."dpUrl" AS "reporterDpUrl",
              r."assigneeId", a.name AS "assigneeName",
              (SELECT name FROM clubs WHERE id = r."reporterClubId") AS "reporterClubName",
              (SELECT name FROM communities WHERE id = r."reporterCommunityId") AS "reporterCommunityName",
              ${openOnTarget} AS "openOnTarget", ${priority} AS priority
         ${from}
        ORDER BY ${order}
        LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      params,
    );
    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 } };
  }

  async staffDetail(id: string) {
    const [report] = await this.dataSource.query(
      `SELECT r.*, rep.name AS "reporterName", rep."dpUrl" AS "reporterDpUrl", rep."reportStrikes" AS "reporterStrikes",
              (SELECT count(*)::int FROM reports x WHERE x."reporterId" = r."reporterId") AS "reporterTotal",
              (SELECT count(*)::int FROM reports x WHERE x."reporterId" = r."reporterId" AND x."falseReport") AS "reporterFalse",
              a.name AS "assigneeName", rs.name AS "resolvedByName",
              (SELECT name FROM clubs WHERE id = r."reporterClubId") AS "reporterClubName",
              (SELECT name FROM communities WHERE id = r."reporterCommunityId") AS "reporterCommunityName"
         FROM reports r
         JOIN users rep ON rep.id = r."reporterId"
         LEFT JOIN users a ON a.id = r."assigneeId"
         LEFT JOIN users rs ON rs.id = r."resolvedById"
        WHERE r.id = $1`,
      [id],
    );
    if (!report) throw new NotFoundException('Report not found');
    const [thread, related, target] = await Promise.all([
      this.messages.find({ where: { reportId: id }, order: { createdAt: 'ASC' } }),
      this.dataSource.query(
        `SELECT r.id, r.reason, r.status, r."createdAt", r."reportedAs", u.name AS "reporterName"
           FROM reports r JOIN users u ON u.id = r."reporterId"
          WHERE r."targetType" = $1 AND r."targetId" = $2 AND r.id <> $3
          ORDER BY r."createdAt" DESC LIMIT 20`,
        [report.targetType, report.targetId, id],
      ),
      this.targetSummary(report.targetType, report.targetId),
    ]);
    return { ...report, messages: thread, related, target };
  }

  async assign(actor: Actor, id: string, dto: AssignReportDto, ctx: ActionContext = {}) {
    const report = await this.mustFind(id);
    const assigneeId = dto.assigneeId ?? null;
    if (assigneeId && assigneeId !== actor.id) {
      const staff = await this.users.findOne({ where: { id: assigneeId } });
      if (!staff?.systemRole) throw new BadRequestException('Reports can only be assigned to staff');
    }
    await this.reports.update(id, {
      assigneeId,
      status: report.status === 'open' && assigneeId ? 'in_review' : report.status,
    });
    await this.audit.record(actor, {
      action: 'report.assign',
      targetType: 'report',
      targetId: id,
      targetName: report.targetName,
      before: { assigneeId: report.assigneeId },
      after: { assigneeId },
      ip: ctx.ip,
    });
    return this.staffDetail(id);
  }

  /** A staff message to the reporter, or an internal note (internal = true). */
  async staffNote(actor: Actor, id: string, body: string, internal: boolean) {
    const report = await this.mustFind(id);
    await this.messages.save(
      this.messages.create({ reportId: id, authorId: actor.id, authorName: actor.name, fromStaff: true, internal, body: body.trim() }),
    );
    await this.reports.update(id, { status: report.status === 'open' ? 'in_review' : report.status, updatedAt: new Date() });
    if (!internal) {
      await this.notify(report, 'report.message', 'New reply on your report', `ALLYNQ staff replied about "${report.targetName}".`, {
        target: report.targetName,
      });
    }
    return this.staffDetail(id);
  }

  async resolve(actor: Actor, id: string, dto: ResolveReportDto, ctx: ActionContext = {}) {
    const report = await this.mustFind(id);
    if (!ACTIVE_REPORT_STATUSES.includes(report.status)) throw new BadRequestException('This report is already closed');
    const action = dto.outcome === 'action_taken' ? (dto.action ?? 'none') : 'none';

    // Act on the target first: if that is refused (e.g. a moderator trying to ban), nothing is closed.
    if (action !== 'none') await this.applyAction(actor, report, action, dto, ctx);

    const targets = dto.closeSimilar
      ? await this.reports.find({ where: { targetType: report.targetType, targetId: report.targetId, status: In(ACTIVE_REPORT_STATUSES) } })
      : [report];
    const now = new Date();
    for (const r of targets) {
      const isFalse = dto.outcome === 'rejected' && Boolean(dto.falseReport) && r.id === report.id;
      await this.reports.update(r.id, {
        status: dto.outcome,
        resolution: dto.resolution.trim(),
        resolutionAction: action === 'none' ? null : action,
        falseReport: isFalse,
        resolvedById: actor.id,
        resolvedAt: now,
      });
      if (isFalse) await this.users.increment({ id: r.reporterId }, 'reportStrikes', 1);
      if (dto.outcome === 'action_taken') {
        await this.notify(r, 'report.resolved', 'Report resolved', `Action was taken on your report about "${r.targetName}": ${dto.resolution}`, {
          target: r.targetName,
          resolution: dto.resolution,
        });
      } else {
        await this.notify(r, 'report.rejected', 'Report closed', `Your report about "${r.targetName}" was closed without action: ${dto.resolution}`, {
          target: r.targetName,
          resolution: dto.resolution,
        });
      }
    }
    await this.audit.record(actor, {
      action: dto.outcome === 'action_taken' ? 'report.resolve' : 'report.reject',
      targetType: 'report',
      targetId: id,
      targetName: report.targetName,
      after: { outcome: dto.outcome, action, closed: targets.length, falseReport: Boolean(dto.falseReport) },
      reason: dto.resolution,
      ip: ctx.ip,
    });
    return this.staffDetail(id);
  }

  /** Queue counts for the dashboard and the sidebar badge. */
  async counts(actor: Actor) {
    const [row] = await this.dataSource.query(
      `SELECT count(*) FILTER (WHERE status IN ('open', 'in_review'))::int AS active,
              count(*) FILTER (WHERE status = 'open' AND "assigneeId" IS NULL)::int AS unassigned,
              count(*) FILTER (WHERE status IN ('open', 'in_review') AND "assigneeId" = $1)::int AS mine
         FROM reports`,
      [actor.id],
    );
    return row;
  }

  // ------------------------------------------------------------------ helpers

  private async applyAction(actor: Actor, report: Report, action: string, dto: ResolveReportDto, ctx: ActionContext) {
    const reason = (dto.actionReason?.trim() || dto.resolution).slice(0, 500);
    if (report.targetType === 'user') {
      if (action === 'warn') return this.adminUsers.warn(actor, report.targetId, reason, ctx);
      if (action === 'suspend') {
        if (!dto.until) throw new BadRequestException('Pick when the suspension ends');
        return this.adminUsers.suspend(actor, report.targetId, dto.until, reason, ctx);
      }
      if (action === 'ban' || action === 'bin') {
        if (!hasSystemRole(actor, SystemRole.ADMIN)) throw new ForbiddenException('This needs the admin role');
        return action === 'ban'
          ? this.adminUsers.ban(actor, report.targetId, reason, ctx)
          : this.adminUsers.moveToBin(actor, report.targetId, reason, ctx);
      }
    } else if (report.targetType !== 'match' && action === 'bin') {
      if (!hasSystemRole(actor, SystemRole.ADMIN)) throw new ForbiddenException('This needs the admin role');
      return this.adminContent.moveToBin(actor, report.targetType, report.targetId, reason, ctx);
    }
    throw new BadRequestException(`"${action}" can't be applied to a ${report.targetType}`);
  }

  private async resolveTarget(type: ReportTarget, id: string): Promise<TargetInfo> {
    const queries: Record<ReportTarget, string> = {
      user: `SELECT u.id AS "userId", u.name, ep."clubId", ep."communityId"
               FROM users u LEFT JOIN efootball_profiles ep ON ep."userId" = u.id
              WHERE u.id = $1 AND u."deletedAt" IS NULL`,
      club: `SELECT c.name, c.id AS "clubId", (SELECT cc."communityId" FROM community_clubs cc WHERE cc."clubId" = c.id LIMIT 1) AS "communityId"
               FROM clubs c WHERE c.id = $1 AND c."deletedAt" IS NULL`,
      community: `SELECT co.name, NULL::uuid AS "clubId", co.id AS "communityId" FROM communities co WHERE co.id = $1 AND co."deletedAt" IS NULL`,
      tournament: `SELECT t.name, t."hostClubId" AS "clubId", t."communityId" FROM tournaments t WHERE t.id = $1 AND t."deletedAt" IS NULL`,
      match: `SELECT t.name || ' · ' || m."roundName" || ' #' || m."matchNumber" AS name, t."hostClubId" AS "clubId", t."communityId"
                FROM tournament_matches m JOIN tournaments t ON t.id = m."tournamentId"
               WHERE m.id = $1 AND t."deletedAt" IS NULL`,
    };
    const [row] = await this.dataSource.query(queries[type], [id]);
    if (!row) throw new NotFoundException(`That ${type} doesn't exist`);
    return row as TargetInfo;
  }

  /** What staff see about the target next to the report. */
  private async targetSummary(type: ReportTarget, id: string) {
    const queries: Record<ReportTarget, string> = {
      user: `SELECT u.id, u.name, u."dpUrl", u."systemRole", u."warningsCount", u."suspendedUntil", u."bannedAt", u."deletedAt",
                    c.name AS "clubName", co.name AS "communityName"
               FROM users u LEFT JOIN efootball_profiles ep ON ep."userId" = u.id
               LEFT JOIN clubs c ON c.id = ep."clubId" LEFT JOIN communities co ON co.id = ep."communityId"
              WHERE u.id = $1`,
      club: `SELECT c.id, c.name, c."dpUrl", c."deletedAt", (SELECT count(*)::int FROM efootball_profiles WHERE "clubId" = c.id) AS members FROM clubs c WHERE c.id = $1`,
      community: `SELECT co.id, co.name, co."dpUrl", co."deletedAt" FROM communities co WHERE co.id = $1`,
      tournament: `SELECT t.id, t.name, t.status, t.type, t."deletedAt", t."startAt" FROM tournaments t WHERE t.id = $1`,
      match: `SELECT m.id, m.status, m."roundName", m."scoreA", m."scoreB", t.id AS "tournamentId", t.name AS "tournamentName",
                     COALESCE(ca.name, ua.name) AS "sideA", COALESCE(cb.name, ub.name) AS "sideB"
                FROM tournament_matches m JOIN tournaments t ON t.id = m."tournamentId"
                LEFT JOIN tournament_participants pa ON pa.id = m."participantAId"
                LEFT JOIN tournament_participants pb ON pb.id = m."participantBId"
                LEFT JOIN clubs ca ON ca.id = pa."clubId" LEFT JOIN users ua ON ua.id = pa."userId"
                LEFT JOIN clubs cb ON cb.id = pb."clubId" LEFT JOIN users ub ON ub.id = pb."userId"
               WHERE m.id = $1`,
    };
    const [row] = await this.dataSource.query(queries[type], [id]);
    return row ?? null;
  }

  private async leadsCommunity(user: User, communityId: string): Promise<boolean> {
    if (COMMUNITY_LEADERS.includes(user.efootballProfile?.communityRole ?? '')) return true;
    const [row] = await this.dataSource.query(
      `SELECT 1 FROM communities WHERE id = $1 AND "creatorId" = $2
       UNION SELECT 1 FROM community_members cm WHERE cm."communityId" = $1 AND cm."profileId" = $3 AND cm.role IN ('President', 'Vice President')
       LIMIT 1`,
      [communityId, user.id, user.efootballProfile?.id ?? null],
    );
    return Boolean(row);
  }

  private async mustFind(id: string): Promise<Report> {
    const report = await this.reports.findOne({ where: { id } });
    if (!report) throw new NotFoundException('Report not found');
    return report;
  }

  private reporterView(r: Report) {
    return {
      id: r.id,
      targetType: r.targetType,
      targetId: r.targetId,
      targetName: r.targetName,
      reason: r.reason,
      details: r.details,
      attachments: r.attachments,
      reportedAs: r.reportedAs,
      status: r.status,
      resolution: r.resolution,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      resolvedAt: r.resolvedAt,
    };
  }

  private async notify(report: Report, code: string, title: string, message: string, params: Record<string, string>) {
    await this.notifications.createNotification(report.reporterId, {
      title,
      message,
      type: 'system',
      link: REPORTER_LINK(report.id),
      code,
      params,
    });
  }
}

