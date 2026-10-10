import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CommunitiesService } from '../communities/communities.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { TournamentsService } from '../tournaments/tournaments.service.js';
import { User } from '../users/entities/user.entity.js';
import type { ActionContext } from './admin-users.service.js';
import { AuditService } from './audit.service.js';
import type {
  ClubCommunityDto,
  EditClubDto,
  EditCommunityDto,
  SetLeaderDto,
  TournamentOfficialsDto,
  TournamentStatusDto,
  TournamentTimesDto,
} from './dto/manage.dto.js';

const clubLink = (id: string) => `/dashboard/efootball/clubs/${id}`;
const communityLink = (id: string) => `/dashboard/efootball/community/${id}`;
const tournamentLink = (id: string) => `/dashboard/efootball/tournaments/${id}`;

/**
 * Staff control over clubs, communities and tournaments: details, edits, leader changes,
 * freezing, moving clubs between communities, and fixing tournaments. Everything is audited
 * and the people affected are notified.
 */
@Injectable()
export class AdminManageService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly communities: CommunitiesService,
    private readonly tournaments: TournamentsService,
  ) {}

  // ------------------------------------------------------------------ clubs

  async clubDetail(id: string) {
    const [club] = await this.dataSource.query(
      `SELECT c.id, c.name, c."dpUrl", c.color, c.motto, c.location, c."minRoster", c."maxRoster", c.points, c."createdAt",
              c."frozenAt", c."frozenReason", fz.name AS "frozenByName"
         FROM clubs c LEFT JOIN users fz ON fz.id = c."frozenById"
        WHERE c.id = $1 AND c."deletedAt" IS NULL`,
      [id],
    );
    if (!club) throw new NotFoundException('Club not found');
    const [members, communities, stats] = await Promise.all([
      this.dataSource.query(
        `SELECT ep.id AS "profileId", u.id AS "userId", u.name, u."dpUrl", ep."clubRole" AS role
           FROM efootball_profiles ep JOIN users u ON u.id = ep."userId"
          WHERE ep."clubId" = $1 AND u."deletedAt" IS NULL
          ORDER BY CASE ep."clubRole" WHEN 'President' THEN 0 WHEN 'General Secretary' THEN 1 WHEN 'Manager' THEN 2 ELSE 3 END, u.name`,
        [id],
      ),
      this.dataSource.query(
        `SELECT co.id, co.name FROM community_clubs cc JOIN communities co ON co.id = cc."communityId"
          WHERE cc."clubId" = $1 AND co."deletedAt" IS NULL ORDER BY co.name`,
        [id],
      ),
      this.dataSource.query(
        `SELECT (SELECT count(*)::int FROM tournaments WHERE "hostClubId" = $1 AND "deletedAt" IS NULL) AS "hostedTournaments",
                (SELECT count(*)::int FROM transfer_offers WHERE status IN ('pending', 'scheduled') AND ("toClubId" = $1 OR "fromClubId" = $1)) AS "openOffers",
                (SELECT count(*)::int FROM reports WHERE status IN ('open', 'in_review') AND "targetType" = 'club' AND "targetId" = $1) AS "openReports"`,
        [id],
      ),
    ]);
    return { ...club, members, communities, stats: stats[0] };
  }

  async editClub(actor: User, id: string, dto: EditClubDto, ctx: ActionContext = {}) {
    const before = await this.clubDetail(id);
    const { reason, ...fields } = dto;
    const patch = this.changed(before, fields);
    if (patch.minRoster != null || patch.maxRoster != null) {
      const min = Number(patch.minRoster ?? before.minRoster);
      const max = Number(patch.maxRoster ?? before.maxRoster);
      if (min > max) throw new BadRequestException('The minimum squad size must not be above the maximum');
    }
    await this.update('clubs', id, patch);
    await this.audit.record(actor, { action: 'club.edit', targetType: 'club', targetId: id, targetName: before.name, before: this.pick(before, patch), after: patch, reason, ip: ctx.ip });
    return this.clubDetail(id);
  }

  /** Makes a member the club's President or General Secretary; whoever held that role becomes a Player. */
  async setClubLeader(actor: User, id: string, dto: SetLeaderDto, ctx: ActionContext = {}) {
    if (dto.role === 'Vice President') throw new BadRequestException('Clubs have a President and a General Secretary');
    const club = await this.clubDetail(id);
    const target = club.members.find((m: { userId: string }) => m.userId === dto.userId);
    if (!target) throw new BadRequestException('Pick a member of this club');
    if (target.role === 'President' && dto.role !== 'President') {
      throw new BadRequestException('That would leave the club without a President. Choose a new President first.');
    }
    const previous = club.members.filter((m: { role: string; userId: string }) => m.role === dto.role && m.userId !== dto.userId);
    await this.dataSource.transaction(async (em) => {
      await em.query(`UPDATE efootball_profiles SET "clubRole" = 'Player' WHERE "clubId" = $1 AND "clubRole" = $2 AND "userId" <> $3`, [id, dto.role, dto.userId]);
      await em.query(`UPDATE efootball_profiles SET "clubRole" = $2 WHERE "clubId" = $1 AND "userId" = $3`, [id, dto.role, dto.userId]);
    });
    await this.notifyUsers([dto.userId, ...previous.map((m: { userId: string }) => m.userId)], {
      title: 'Club leadership changed',
      message: `ALLYNQ staff made ${target.name} the ${dto.role} of ${club.name}: ${dto.reason}`,
      link: clubLink(id),
      code: 'admin.leader_changed',
      params: { name: target.name, role: dto.role, group: club.name, reason: dto.reason },
    });
    await this.audit.record(actor, {
      action: 'club.leader',
      targetType: 'club',
      targetId: id,
      targetName: club.name,
      before: { [dto.role]: previous.map((m: { name: string }) => m.name).join(', ') || null },
      after: { [dto.role]: target.name },
      reason: dto.reason,
      ip: ctx.ip,
    });
    return this.clubDetail(id);
  }

  async setClubCommunity(actor: User, clubId: string, dto: ClubCommunityDto, ctx: ActionContext = {}) {
    const club = await this.clubDetail(clubId);
    if (dto.action === 'add') await this.communities.addClub(dto.communityId, clubId, actor, { staff: true });
    else await this.communities.removeClub(dto.communityId, clubId, actor, { staff: true });
    const [community] = await this.dataSource.query(`SELECT name FROM communities WHERE id = $1`, [dto.communityId]);
    await this.audit.record(actor, {
      action: dto.action === 'add' ? 'club.community_add' : 'club.community_remove',
      targetType: 'club',
      targetId: clubId,
      targetName: club.name,
      after: { community: community?.name ?? dto.communityId },
      reason: dto.reason,
      ip: ctx.ip,
    });
    return this.clubDetail(clubId);
  }

  // ------------------------------------------------------------- communities

  async communityDetail(id: string) {
    const [community] = await this.dataSource.query(
      `SELECT co.id, co.name, co."dpUrl", co.color, co.motto, co.location, co.tier, co."createdAt", co."creatorId",
              cr.name AS "creatorName", co."frozenAt", co."frozenReason", fz.name AS "frozenByName"
         FROM communities co
         LEFT JOIN users cr ON cr.id = co."creatorId"
         LEFT JOIN users fz ON fz.id = co."frozenById"
        WHERE co.id = $1 AND co."deletedAt" IS NULL`,
      [id],
    );
    if (!community) throw new NotFoundException('Community not found');
    const [leaders, clubs, stats] = await Promise.all([
      this.dataSource.query(
        `SELECT ep.id AS "profileId", u.id AS "userId", u.name, u."dpUrl", cm.role
           FROM community_members cm JOIN efootball_profiles ep ON ep.id = cm."profileId" JOIN users u ON u.id = ep."userId"
          WHERE cm."communityId" = $1 AND cm.role <> 'Member' AND u."deletedAt" IS NULL
          ORDER BY CASE cm.role WHEN 'President' THEN 0 WHEN 'Vice President' THEN 1 ELSE 2 END, u.name`,
        [id],
      ),
      this.dataSource.query(
        `SELECT c.id, c.name, c."dpUrl" FROM community_clubs cc JOIN clubs c ON c.id = cc."clubId"
          WHERE cc."communityId" = $1 AND c."deletedAt" IS NULL ORDER BY c.name`,
        [id],
      ),
      this.dataSource.query(
        `SELECT (SELECT count(*)::int FROM community_members WHERE "communityId" = $1) AS members,
                (SELECT count(*)::int FROM tournaments WHERE "communityId" = $1 AND "deletedAt" IS NULL) AS tournaments,
                (SELECT count(*)::int FROM reports WHERE status IN ('open', 'in_review') AND "targetType" = 'community' AND "targetId" = $1) AS "openReports"`,
        [id],
      ),
    ]);
    return { ...community, leaders, clubs, stats: stats[0] };
  }

  /** People who can be made a leader: members of the community, searched by name. */
  async communityMembers(id: string, search = '') {
    return this.dataSource.query(
      `SELECT u.id AS "userId", u.name, u."dpUrl", cm.role
         FROM community_members cm JOIN efootball_profiles ep ON ep.id = cm."profileId" JOIN users u ON u.id = ep."userId"
        WHERE cm."communityId" = $1 AND u."deletedAt" IS NULL AND LOWER(u.name) LIKE $2
        ORDER BY u.name LIMIT 20`,
      [id, `%${search.trim().toLowerCase()}%`],
    );
  }

  async editCommunity(actor: User, id: string, dto: EditCommunityDto, ctx: ActionContext = {}) {
    const before = await this.communityDetail(id);
    const { reason, ...fields } = dto;
    const patch = this.changed(before, fields);
    await this.update('communities', id, patch);
    await this.audit.record(actor, { action: 'community.edit', targetType: 'community', targetId: id, targetName: before.name, before: this.pick(before, patch), after: patch, reason, ip: ctx.ip });
    return this.communityDetail(id);
  }

  /** Makes a member the community's President or Vice President; whoever held it becomes a Member. */
  async setCommunityLeader(actor: User, id: string, dto: SetLeaderDto, ctx: ActionContext = {}) {
    if (dto.role === 'General Secretary') throw new BadRequestException('Communities have a President and a Vice President');
    const community = await this.communityDetail(id);
    const [target] = await this.dataSource.query(
      `SELECT ep.id AS "profileId", u.id AS "userId", u.name, ep."communityId", ep."clubRole"
         FROM community_members cm JOIN efootball_profiles ep ON ep.id = cm."profileId" JOIN users u ON u.id = ep."userId"
        WHERE cm."communityId" = $1 AND u.id = $2`,
      [id, dto.userId],
    );
    if (!target) throw new BadRequestException('Pick a member of this community');
    if (dto.role !== 'President' && community.leaders.some((l: { userId: string; role: string }) => l.userId === dto.userId && l.role === 'President')) {
      throw new BadRequestException('That would leave the community without a President. Choose a new President first.');
    }
    const previous = community.leaders.filter((l: { role: string; userId: string }) => l.role === dto.role && l.userId !== dto.userId);
    await this.dataSource.transaction(async (em) => {
      for (const p of previous) {
        await em.query(`UPDATE community_members SET role = 'Member' WHERE "communityId" = $1 AND "profileId" = $2`, [id, p.profileId]);
        await em.query(`UPDATE efootball_profiles SET "communityRole" = 'Member' WHERE id = $1 AND "communityId" = $2`, [p.profileId, id]);
      }
      await em.query(`UPDATE community_members SET role = $3 WHERE "communityId" = $1 AND "profileId" = $2`, [id, target.profileId, dto.role]);
      await em.query(`UPDATE efootball_profiles SET "communityRole" = $3 WHERE id = $1 AND "communityId" = $2`, [target.profileId, id, dto.role]);
      if (dto.role === 'President') await em.query(`UPDATE communities SET "creatorId" = $2 WHERE id = $1`, [id, dto.userId]);
    });
    await this.notifyUsers([dto.userId, ...previous.map((p: { userId: string }) => p.userId)], {
      title: 'Community leadership changed',
      message: `ALLYNQ staff made ${target.name} the ${dto.role} of ${community.name}: ${dto.reason}`,
      link: communityLink(id),
      code: 'admin.leader_changed',
      params: { name: target.name, role: dto.role, group: community.name, reason: dto.reason },
    });
    await this.audit.record(actor, {
      action: 'community.leader',
      targetType: 'community',
      targetId: id,
      targetName: community.name,
      before: { [dto.role]: previous.map((p: { name: string }) => p.name).join(', ') || null },
      after: { [dto.role]: target.name },
      reason: dto.reason,
      ip: ctx.ip,
    });
    return this.communityDetail(id);
  }

  // ------------------------------------------------------------------ freeze

  async setFrozen(actor: User, kind: 'club' | 'community', id: string, frozen: boolean, reason: string | undefined, ctx: ActionContext = {}) {
    const detail = kind === 'club' ? await this.clubDetail(id) : await this.communityDetail(id);
    if (Boolean(detail.frozenAt) === frozen) throw new BadRequestException(frozen ? 'Already frozen' : 'Not frozen');
    const table = kind === 'club' ? 'clubs' : 'communities';
    await this.dataSource.query(
      `UPDATE "${table}" SET "frozenAt" = $2, "frozenReason" = $3, "frozenById" = $4 WHERE id = $1`,
      [id, frozen ? new Date() : null, frozen ? reason?.trim() || null : null, frozen ? actor.id : null],
    );
    const message = frozen
      ? `ALLYNQ staff froze ${detail.name}: ${reason}. Tournaments, transfers and edits are paused until it is unfrozen.`
      : `ALLYNQ staff unfroze ${detail.name}. Everything works again.`;
    const i18n = { code: frozen ? 'admin.frozen' : 'admin.unfrozen', params: { group: detail.name, reason: reason ?? '' } };
    if (kind === 'club') {
      await this.notifications.notifyClubAuthorities(id, frozen ? 'Club frozen' : 'Club unfrozen', message, clubLink(id), { type: 'system', ...i18n });
    } else {
      await this.notifications.notifyCommunityAuthorities(id, frozen ? 'Community frozen' : 'Community unfrozen', message, communityLink(id), i18n);
    }
    await this.audit.record(actor, {
      action: frozen ? `${kind}.freeze` : `${kind}.unfreeze`,
      targetType: kind,
      targetId: id,
      targetName: detail.name,
      after: { frozen },
      reason,
      ip: ctx.ip,
    });
    return kind === 'club' ? this.clubDetail(id) : this.communityDetail(id);
  }

  // -------------------------------------------------------------- tournaments

  async tournamentDetail(id: string) {
    const [tournament] = await this.dataSource.query(
      `SELECT t.id, t.name, t.type, t.status, t.format, t."startAt", t."endAt", t."registrationDeadline", t."teamSubmissionDeadline",
              t."maxParticipants", t."matchOfficialIds", t."communityId", t."hostClubId", t."createdAt",
              COALESCE(co.name, hc.name) AS "hostName", cr.name AS "creatorName"
         FROM tournaments t
         LEFT JOIN communities co ON co.id = t."communityId"
         LEFT JOIN clubs hc ON hc.id = t."hostClubId"
         LEFT JOIN users cr ON cr.id = t."creatorId"
        WHERE t.id = $1 AND t."deletedAt" IS NULL`,
      [id],
    );
    if (!tournament) throw new NotFoundException('Tournament not found');
    const officialIds: string[] = tournament.matchOfficialIds ?? [];
    const [participants, officials, stats] = await Promise.all([
      this.dataSource.query(
        `SELECT p.id, p."participantType", p.status, p."clubId", p."userId", COALESCE(c.name, u.name) AS name, COALESCE(c."dpUrl", u."dpUrl") AS "dpUrl", p."createdAt"
           FROM tournament_participants p LEFT JOIN clubs c ON c.id = p."clubId" LEFT JOIN users u ON u.id = p."userId"
          WHERE p."tournamentId" = $1 ORDER BY p."createdAt"`,
        [id],
      ),
      officialIds.length ? this.dataSource.query(`SELECT id, name, "dpUrl" FROM users WHERE id = ANY($1::uuid[]) ORDER BY name`, [officialIds]) : [],
      this.dataSource.query(
        `SELECT count(*) FILTER (WHERE m.status = 'completed')::int AS "matchesDone",
                count(*)::int AS matches,
                (SELECT count(*)::int FROM tournament_match_games g JOIN tournament_matches m2 ON m2.id = g."matchId"
                  WHERE m2."tournamentId" = $1 AND g.status IN ('submitted', 'awaiting_opponent')) AS "gamesInReview"
           FROM tournament_matches m WHERE m."tournamentId" = $1`,
        [id],
      ),
    ]);
    return { ...tournament, participants, officials, stats: stats[0] };
  }

  async setTournamentTimes(actor: User, id: string, dto: TournamentTimesDto, ctx: ActionContext = {}) {
    const before = await this.tournamentDetail(id);
    const parse = (value: string | undefined, field: string, nullable: boolean): Date | null | undefined => {
      if (value === undefined) return undefined;
      if (value === '' && nullable) return null;
      const d = new Date(value);
      if (isNaN(d.getTime())) throw new BadRequestException(`Invalid ${field}`);
      return d;
    };
    const patch: Record<string, Date | null> = {};
    const startAt = parse(dto.startAt, 'start time', false);
    const endAt = parse(dto.endAt, 'end time', true);
    const registrationDeadline = parse(dto.registrationDeadline, 'registration deadline', true);
    if (startAt !== undefined) patch.startAt = startAt;
    if (endAt !== undefined) patch.endAt = endAt;
    if (registrationDeadline !== undefined) patch.registrationDeadline = registrationDeadline;
    const start = patch.startAt ?? new Date(before.startAt);
    const end = 'endAt' in patch ? patch.endAt : before.endAt ? new Date(before.endAt) : null;
    if (end && end <= start) throw new BadRequestException('The end must be after the start');
    if (!Object.keys(patch).length) return before;
    await this.update('tournaments', id, patch);
    await this.tournaments.notifyParticipants(await this.tournaments.findOne(id), actor.id, {
      title: 'Tournament schedule changed',
      message: `ALLYNQ staff changed the schedule of "${before.name}"${dto.reason ? `: ${dto.reason}` : '.'}`,
      link: tournamentLink(id),
      code: 'admin.tournament_rescheduled',
      params: { tournament: before.name, reason: dto.reason ?? '' },
    });
    await this.audit.record(actor, {
      action: 'tournament.times',
      targetType: 'tournament',
      targetId: id,
      targetName: before.name,
      before: this.pick(before, patch),
      after: patch,
      reason: dto.reason,
      ip: ctx.ip,
    });
    return this.tournamentDetail(id);
  }

  async setTournamentStatus(actor: User, id: string, dto: TournamentStatusDto, ctx: ActionContext = {}) {
    const before = await this.tournamentDetail(id);
    if (before.status === dto.status) throw new BadRequestException('The tournament already has that status');
    await this.update('tournaments', id, { status: dto.status });
    // A cancelled general tournament refunds entry fees and returns the organizer's prize.
    const settled = dto.status === 'cancelled' ? await this.tournaments.settleCancelled(id) : null;
    const words: Record<string, string> = {
      cancelled: 'cancelled',
      completed: 'marked as finished',
      ongoing: 'marked as live',
      registration_open: 'reopened for registration',
    };
    await this.tournaments.notifyParticipants(await this.tournaments.findOne(id), actor.id, {
      title: 'Tournament updated by ALLYNQ staff',
      message: `"${before.name}" was ${words[dto.status]} by ALLYNQ staff: ${dto.reason}`,
      link: tournamentLink(id),
      code: `admin.tournament_${dto.status}`,
      params: { tournament: before.name, reason: dto.reason },
    });
    await this.audit.record(actor, {
      action: 'tournament.status',
      targetType: 'tournament',
      targetId: id,
      targetName: before.name,
      before: { status: before.status },
      after: { status: dto.status, ...(settled ? { refundedTk: settled.refunded, unrefundedTk: settled.shortfall } : {}) },
      reason: dto.reason,
      ip: ctx.ip,
    });
    return this.tournamentDetail(id);
  }

  /** Replaces the match officials. Any existing user can be appointed; they're told about it. */
  async setTournamentOfficials(actor: User, id: string, dto: TournamentOfficialsDto, ctx: ActionContext = {}) {
    const before = await this.tournamentDetail(id);
    const ids = [...new Set(dto.userIds)];
    const found: Array<{ id: string; name: string }> = ids.length
      ? await this.dataSource.query(`SELECT id, name FROM users WHERE id = ANY($1::uuid[]) AND "deletedAt" IS NULL`, [ids])
      : [];
    if (found.length !== ids.length) throw new BadRequestException('Some of those users no longer exist');
    await this.dataSource.query(`UPDATE tournaments SET "matchOfficialIds" = $2::jsonb WHERE id = $1`, [id, JSON.stringify(ids)]);
    const added = ids.filter((u) => !(before.matchOfficialIds ?? []).includes(u));
    await this.notifyUsers(added, {
      title: 'You are a match official',
      message: `ALLYNQ staff made you a match official for "${before.name}". You can now review its match evidence.`,
      link: tournamentLink(id),
      code: 'admin.official_added',
      params: { tournament: before.name },
    });
    await this.audit.record(actor, {
      action: 'tournament.officials',
      targetType: 'tournament',
      targetId: id,
      targetName: before.name,
      before: { officials: before.officials.map((o: { name: string }) => o.name).join(', ') || null },
      after: { officials: found.map((o) => o.name).join(', ') || null },
      reason: dto.reason,
      ip: ctx.ip,
    });
    return this.tournamentDetail(id);
  }

  /** Removes an entry before the fixtures are made (afterwards the bracket depends on it). */
  async removeParticipant(actor: User, id: string, participantId: string, reason: string, ctx: ActionContext = {}) {
    const before = await this.tournamentDetail(id);
    if (before.format) throw new BadRequestException('The fixtures are already made, so entries can no longer be removed');
    const participant = before.participants.find((p: { id: string }) => p.id === participantId);
    if (!participant) throw new NotFoundException('Entry not found');
    await this.dataSource.query(`DELETE FROM tournament_participants WHERE id = $1 AND "tournamentId" = $2`, [participantId, id]);
    const recipients = participant.userId
      ? [participant.userId]
      : (await this.dataSource.query(
          `SELECT "userId" FROM efootball_profiles WHERE "clubId" = $1 AND "clubRole" IN ('President', 'General Secretary')`,
          [participant.clubId],
        )).map((r: { userId: string }) => r.userId);
    await this.notifyUsers(recipients, {
      title: 'Removed from a tournament',
      message: `ALLYNQ staff removed ${participant.name} from "${before.name}": ${reason}`,
      link: tournamentLink(id),
      code: 'admin.participant_removed',
      params: { name: participant.name, tournament: before.name, reason },
    });
    await this.audit.record(actor, {
      action: 'tournament.remove_entry',
      targetType: 'tournament',
      targetId: id,
      targetName: before.name,
      after: { removed: participant.name },
      reason,
      ip: ctx.ip,
    });
    return this.tournamentDetail(id);
  }

  // ------------------------------------------------------------------ helpers

  /** Only the fields that actually change. */
  private changed(current: Record<string, unknown>, fields: Record<string, unknown>): Record<string, unknown> {
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      const next = typeof value === 'string' ? value.trim() : value;
      if ((current[key] ?? null) !== (next === '' ? null : next)) patch[key] = next === '' ? null : next;
    }
    return patch;
  }

  private pick(source: Record<string, unknown>, patch: Record<string, unknown>) {
    return Object.fromEntries(Object.keys(patch).map((k) => [k, source[k] ?? null]));
  }

  private async update(table: 'clubs' | 'communities' | 'tournaments', id: string, patch: Record<string, unknown>) {
    const keys = Object.keys(patch);
    if (!keys.length) return;
    const sets = keys.map((k, i) => `"${k}" = $${i + 2}`).join(', ');
    await this.dataSource.query(`UPDATE "${table}" SET ${sets}, "updatedAt" = now() WHERE id = $1`, [id, ...keys.map((k) => patch[k])]);
  }

  private async notifyUsers(
    userIds: string[],
    n: { title: string; message: string; link: string; code: string; params: Record<string, string> },
  ) {
    await Promise.allSettled(
      [...new Set(userIds)].map((userId) => this.notifications.createNotification(userId, { ...n, type: 'system' })),
    );
  }
}
