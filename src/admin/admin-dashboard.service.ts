import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { DashboardQueryDto } from './dto/admin.dto.js';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Buckets follow Bangladesh time, so a "day" matches what players see. */
const TZ = 'Asia/Dhaka';
const MAX_BUCKETS = 400;

interface Range {
  from: Date;
  to: Date;
}

/** Builds positional SQL parameters. */
class Params {
  readonly values: unknown[] = [];
  add(value: unknown): string {
    // ISO strings (UTC) compare correctly with both timestamp and timestamptz columns.
    this.values.push(value instanceof Date ? value.toISOString() : value);
    return `$${this.values.length}`;
  }
}

/**
 * Admin dashboard numbers. Every figure follows the same filters: a date range, and a
 * scope (country / division for people, community / club for everything, tournament type).
 */
@Injectable()
export class AdminDashboardService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async overview(query: DashboardQueryDto) {
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from ? new Date(query.from) : new Date(to.getTime() - 30 * DAY_MS);
    if (!(from < to)) throw new BadRequestException('"from" must be before "to"');
    const groupBy = query.groupBy ?? this.defaultGroupBy(from, to);
    const span = to.getTime() - from.getTime();
    if (groupBy === 'day' && span / DAY_MS > MAX_BUCKETS) throw new BadRequestException('Too many days: group by week or month');
    const range = { from, to };
    const previous = { from: new Date(from.getTime() - span), to: from };

    const [totals, period, prior, series, breakdowns, attention] = await Promise.all([
      this.totals(query),
      this.periodFigures(query, range),
      query.compare ? this.periodFigures(query, previous) : Promise.resolve(null),
      this.series(query, range, groupBy),
      this.breakdowns(query, range),
      this.attention(),
    ]);
    return {
      range: { from: from.toISOString(), to: to.toISOString(), groupBy },
      previousRange: query.compare ? { from: previous.from.toISOString(), to: previous.to.toISOString() } : null,
      totals,
      period,
      previous: prior,
      series,
      breakdowns,
      attention,
    };
  }

  private defaultGroupBy(from: Date, to: Date): 'day' | 'week' | 'month' {
    const days = (to.getTime() - from.getTime()) / DAY_MS;
    return days <= 62 ? 'day' : days <= 370 ? 'week' : 'month';
  }

  // ---------------------------------------------------------------- scopes

  /** Which users count (country, division, community, club). Uses aliases u + ep. */
  private userScope(query: DashboardQueryDto, p: Params): string {
    const where = [`u."deletedAt" IS NULL`];
    if (query.country) where.push(`LOWER(u.country) = LOWER(${p.add(query.country)})`);
    if (query.division) where.push(`LOWER(u.division) = LOWER(${p.add(query.division)})`);
    if (query.clubId) where.push(`ep."clubId" = ${p.add(query.clubId)}`);
    if (query.communityId) {
      const c = p.add(query.communityId);
      where.push(`(ep."communityId" = ${c} OR ep."clubId" IN (SELECT "clubId" FROM community_clubs WHERE "communityId" = ${c}))`);
    }
    return where.join(' AND ');
  }

  /** Which tournaments count (community, club host or participant, type). Uses alias t. */
  private tournamentScope(query: DashboardQueryDto, p: Params): string {
    const where = [`t."deletedAt" IS NULL`];
    if (query.communityId) where.push(`t."communityId" = ${p.add(query.communityId)}`);
    if (query.clubId) {
      const c = p.add(query.clubId);
      where.push(
        `(t."hostClubId" = ${c} OR EXISTS (SELECT 1 FROM tournament_participants tp WHERE tp."tournamentId" = t.id AND tp."clubId" = ${c}))`,
      );
    }
    if (query.tournamentType === 'club') where.push(`t."hostClubId" IS NOT NULL`);
    else if (query.tournamentType) where.push(`t.type = ${p.add(query.tournamentType)} AND t."hostClubId" IS NULL`);
    return where.join(' AND ');
  }

  /** Which completed transfers count (club on either side, community of either club). Uses alias o. */
  private transferScope(query: DashboardQueryDto, p: Params): string {
    const where = [`o.status = 'completed'`];
    if (query.clubId) {
      const c = p.add(query.clubId);
      where.push(`(o."toClubId" = ${c} OR o."fromClubId" = ${c})`);
    }
    if (query.communityId) {
      const c = p.add(query.communityId);
      where.push(
        `(o."toClubId" IN (SELECT "clubId" FROM community_clubs WHERE "communityId" = ${c}) OR o."fromClubId" IN (SELECT "clubId" FROM community_clubs WHERE "communityId" = ${c}))`,
      );
    }
    if (query.country) where.push(`EXISTS (SELECT 1 FROM users pu WHERE pu.id = o."playerUserId" AND LOWER(pu.country) = LOWER(${p.add(query.country)}))`);
    return where.join(' AND ');
  }

  private clubScope(query: DashboardQueryDto, p: Params): string {
    const where = [`c."deletedAt" IS NULL`];
    if (query.clubId) where.push(`c.id = ${p.add(query.clubId)}`);
    if (query.communityId) where.push(`c.id IN (SELECT "clubId" FROM community_clubs WHERE "communityId" = ${p.add(query.communityId)})`);
    return where.join(' AND ');
  }

  // ---------------------------------------------------------------- figures

  /** Figures "right now" (not tied to the date range). */
  private async totals(query: DashboardQueryDto) {
    const p = new Params();
    const users = this.userScope(query, p);
    const tournaments = this.tournamentScope(query, p);
    const clubs = this.clubScope(query, p);
    const communityFilter = query.communityId ? `AND co.id = ${p.add(query.communityId)}` : '';
    const [row] = await this.dataSource.query(
      `SELECT
         (SELECT count(*)::int FROM users u LEFT JOIN efootball_profiles ep ON ep."userId" = u.id WHERE ${users}) AS users,
         (SELECT count(*)::int FROM users u LEFT JOIN efootball_profiles ep ON ep."userId" = u.id WHERE ${users} AND u."verificationLevel"::text <> '0') AS "verifiedUsers",
         (SELECT count(*)::int FROM users u LEFT JOIN efootball_profiles ep ON ep."userId" = u.id WHERE ${users} AND u."bannedAt" IS NULL AND u."suspendedUntil" > now()) AS "suspendedUsers",
         (SELECT count(*)::int FROM users u LEFT JOIN efootball_profiles ep ON ep."userId" = u.id WHERE ${users} AND u."bannedAt" IS NOT NULL) AS "bannedUsers",
         (SELECT count(*)::int FROM users u LEFT JOIN efootball_profiles ep ON ep."userId" = u.id WHERE ${users} AND u."systemRole" IS NOT NULL) AS staff,
         (SELECT count(*)::int FROM clubs c WHERE ${clubs}) AS clubs,
         (SELECT count(*)::int FROM communities co WHERE co."deletedAt" IS NULL ${communityFilter}) AS communities,
         (SELECT count(*)::int FROM tournaments t WHERE ${tournaments} AND t.status = 'ongoing') AS "liveTournaments",
         (SELECT count(*)::int FROM tournaments t WHERE ${tournaments} AND t.status IN ('registration_open', 'submission_phase')) AS "upcomingTournaments",
         (SELECT count(*)::int FROM tournament_matches m JOIN tournaments t ON t.id = m."tournamentId" WHERE ${tournaments} AND m.status = 'in_review') AS "openDisputes",
         (SELECT COALESCE(sum(w."balanceTk"), 0)::int FROM wallets w) AS "walletBalanceTk",
         (SELECT COALESCE(sum(w."heldTk"), 0)::int FROM wallets w) AS "walletHeldTk",
         (SELECT count(*)::int FROM transfer_offers o WHERE o.status IN ('pending', 'scheduled')) AS "openOffers"`,
      p.values,
    );
    return row;
  }

  /** Figures for one date range; run twice for the "compare with previous period" view. */
  private async periodFigures(query: DashboardQueryDto, range: Range) {
    const p = new Params();
    const from = p.add(range.from);
    const to = p.add(range.to);
    const users = this.userScope(query, p);
    const tournaments = this.tournamentScope(query, p);
    const transfers = this.transferScope(query, p);
    const clubs = this.clubScope(query, p);
    const [row] = await this.dataSource.query(
      `SELECT
         (SELECT count(*)::int FROM users u LEFT JOIN efootball_profiles ep ON ep."userId" = u.id
           WHERE ${users} AND u."createdAt" >= ${from} AND u."createdAt" < ${to}) AS "newUsers",
         (SELECT count(DISTINCT l."userId")::int FROM login_events l JOIN users u ON u.id = l."userId"
            LEFT JOIN efootball_profiles ep ON ep."userId" = u.id
           WHERE ${users} AND l.success AND l."createdAt" >= ${from} AND l."createdAt" < ${to}) AS "activeUsers",
         (SELECT count(*)::int FROM clubs c WHERE ${clubs} AND c."createdAt" >= ${from} AND c."createdAt" < ${to}) AS "newClubs",
         (SELECT count(*)::int FROM tournaments t WHERE ${tournaments} AND t."createdAt" >= ${from} AND t."createdAt" < ${to}) AS "tournamentsCreated",
         (SELECT count(*)::int FROM tournaments t WHERE ${tournaments} AND t.status = 'completed'
            AND COALESCE(t."endAt", t."updatedAt") >= ${from} AND COALESCE(t."endAt", t."updatedAt") < ${to}) AS "tournamentsCompleted",
         (SELECT count(*)::int FROM tournament_matches m JOIN tournaments t ON t.id = m."tournamentId"
           WHERE ${tournaments} AND m.status = 'completed' AND m."completedAt" >= ${from} AND m."completedAt" < ${to}) AS "matchesPlayed",
         (SELECT count(*)::int FROM transfer_offers o WHERE ${transfers} AND o."completedAt" >= ${from} AND o."completedAt" < ${to}) AS transfers,
         (SELECT COALESCE(sum(o."amountTk"), 0)::int FROM transfer_offers o WHERE ${transfers} AND o."completedAt" >= ${from} AND o."completedAt" < ${to}) AS "transferVolumeTk",
         (SELECT count(*)::int FROM users u WHERE u."verificationReviewedAt" >= ${from} AND u."verificationReviewedAt" < ${to}) AS "verificationsReviewed",
         (SELECT count(*)::int FROM admin_audit_logs a WHERE a."createdAt" >= ${from} AND a."createdAt" < ${to}) AS "staffActions"`,
      p.values,
    );
    return row;
  }

  /** One row per bucket (day / week / month), zero-filled. */
  private async series(query: DashboardQueryDto, range: Range, groupBy: 'day' | 'week' | 'month') {
    const p = new Params();
    const from = p.add(range.from);
    const to = p.add(range.to);
    const unit = p.add(groupBy);
    const step = p.add(`1 ${groupBy}`);
    const tz = p.add(TZ);
    const users = this.userScope(query, p);
    const tournaments = this.tournamentScope(query, p);
    const transfers = this.transferScope(query, p);
    const bucket = (column: string) => `date_trunc(${unit}, (${column})::timestamptz AT TIME ZONE ${tz})`;
    return this.dataSource.query(
      `WITH buckets AS (
         SELECT generate_series(
           date_trunc(${unit}, ${from}::timestamptz AT TIME ZONE ${tz}),
           date_trunc(${unit}, ${to}::timestamptz AT TIME ZONE ${tz}),
           ${step}::interval) AS b
       ),
       signups AS (
         SELECT ${bucket('u."createdAt"')} AS b, count(*)::int AS n
           FROM users u LEFT JOIN efootball_profiles ep ON ep."userId" = u.id
          WHERE ${users} AND u."createdAt" >= ${from} AND u."createdAt" < ${to} GROUP BY 1
       ),
       logins AS (
         SELECT ${bucket('l."createdAt"')} AS b, count(DISTINCT l."userId")::int AS n
           FROM login_events l JOIN users u ON u.id = l."userId" LEFT JOIN efootball_profiles ep ON ep."userId" = u.id
          WHERE ${users} AND l.success AND l."createdAt" >= ${from} AND l."createdAt" < ${to} GROUP BY 1
       ),
       matches AS (
         SELECT ${bucket('m."completedAt"')} AS b, count(*)::int AS n
           FROM tournament_matches m JOIN tournaments t ON t.id = m."tournamentId"
          WHERE ${tournaments} AND m.status = 'completed' AND m."completedAt" >= ${from} AND m."completedAt" < ${to} GROUP BY 1
       ),
       created AS (
         SELECT ${bucket('t."createdAt"')} AS b, count(*)::int AS n
           FROM tournaments t WHERE ${tournaments} AND t."createdAt" >= ${from} AND t."createdAt" < ${to} GROUP BY 1
       ),
       moves AS (
         SELECT ${bucket('o."completedAt"')} AS b, count(*)::int AS n, COALESCE(sum(o."amountTk"), 0)::int AS tk
           FROM transfer_offers o WHERE ${transfers} AND o."completedAt" >= ${from} AND o."completedAt" < ${to} GROUP BY 1
       )
       SELECT to_char(buckets.b, 'YYYY-MM-DD') AS date,
              COALESCE(signups.n, 0) AS signups,
              COALESCE(logins.n, 0) AS "activeUsers",
              COALESCE(matches.n, 0) AS matches,
              COALESCE(created.n, 0) AS tournaments,
              COALESCE(moves.n, 0) AS transfers,
              COALESCE(moves.tk, 0) AS "transferTk"
         FROM buckets
         LEFT JOIN signups ON signups.b = buckets.b
         LEFT JOIN logins ON logins.b = buckets.b
         LEFT JOIN matches ON matches.b = buckets.b
         LEFT JOIN created ON created.b = buckets.b
         LEFT JOIN moves ON moves.b = buckets.b
        ORDER BY buckets.b`,
      p.values,
    );
  }

  private async breakdowns(query: DashboardQueryDto, range: Range) {
    // Each query gets its own parameter list: Postgres rejects parameters a statement doesn't use.
    const byUsers = (column: 'country' | 'division') => {
      const p = new Params();
      const users = this.userScope(query, p);
      return this.dataSource.query(
        `SELECT COALESCE(NULLIF(u.${column}, ''), 'Unknown') AS label, count(*)::int AS value
           FROM users u LEFT JOIN efootball_profiles ep ON ep."userId" = u.id WHERE ${users}
          GROUP BY 1 ORDER BY 2 DESC LIMIT 8`,
        p.values,
      );
    };
    const statusParams = new Params();
    const statusScope = this.tournamentScope(query, statusParams);
    const clubParams = new Params();
    const clubTournaments = this.tournamentScope(query, clubParams);
    const from = clubParams.add(range.from);
    const to = clubParams.add(range.to);

    const [usersByCountry, usersByDivision, tournamentsByStatus, topClubsByMatches] = await Promise.all([
      byUsers('country'),
      byUsers('division'),
      this.dataSource.query(
        `SELECT t.status AS label, count(*)::int AS value FROM tournaments t WHERE ${statusScope} GROUP BY 1 ORDER BY 2 DESC`,
        statusParams.values,
      ),
      // Clubs with the most completed matches in the range.
      this.dataSource.query(
        `SELECT c.id, c.name AS label, count(*)::int AS value
           FROM tournament_matches m
           JOIN tournaments t ON t.id = m."tournamentId"
           JOIN tournament_participants tp ON tp.id IN (m."participantAId", m."participantBId") AND tp."clubId" IS NOT NULL
           JOIN clubs c ON c.id = tp."clubId" AND c."deletedAt" IS NULL
          WHERE ${clubTournaments} AND m.status = 'completed' AND m."completedAt" >= ${from} AND m."completedAt" < ${to}
          GROUP BY c.id, c.name ORDER BY 3 DESC LIMIT 8`,
        clubParams.values,
      ),
    ]);
    return { usersByCountry, usersByDivision, tournamentsByStatus, topClubsByMatches };
  }

  /** Queues that need a staff member. */
  private async attention() {
    const [counts] = await this.dataSource.query(
      `SELECT
         (SELECT count(*)::int FROM users WHERE "verificationStatus" = 'pending' AND "deletedAt" IS NULL) AS "pendingVerifications",
         (SELECT count(*)::int FROM tournament_matches m JOIN tournaments t ON t.id = m."tournamentId"
           WHERE t."deletedAt" IS NULL AND m.status = 'in_review') AS "openDisputes",
         (SELECT count(*)::int FROM tournament_matches m JOIN tournaments t ON t.id = m."tournamentId"
           WHERE t."deletedAt" IS NULL AND m.status = 'in_review' AND m."updatedAt" < now() - interval '48 hours') AS "staleDisputes",
         (SELECT count(*)::int FROM recycle_bin WHERE "purgeAfter" < now() + interval '3 days') AS "binExpiringSoon",
         (SELECT count(*)::int FROM reports WHERE status IN ('open', 'in_review')) AS "openReports",
         (SELECT count(*)::int FROM reports WHERE status = 'open' AND "assigneeId" IS NULL) AS "unassignedReports",
         (SELECT count(*)::int FROM reports WHERE status IN ('open', 'in_review') AND "reportedAs" <> 'self') AS "leaderReports",
         (SELECT count(*)::int FROM users WHERE "suspendedUntil" BETWEEN now() AND now() + interval '24 hours') AS "suspensionsEndingToday",
         (SELECT count(*)::int FROM (
            SELECT l.ip FROM login_events l WHERE NOT l.success AND l."createdAt" > now() - interval '24 hours' AND l.ip IS NOT NULL
             GROUP BY l.ip HAVING count(*) >= 10) x) AS "suspiciousIps",
         (SELECT count(*)::int FROM (
            SELECT l.ip FROM login_events l WHERE l.success AND l."createdAt" > now() - interval '30 days' AND l.ip IS NOT NULL
             GROUP BY l.ip HAVING count(DISTINCT l."userId") >= 3) x) AS "sharedIps"`,
    );
    const oldestDisputes = await this.dataSource.query(
      `SELECT m.id, m."roundName", m."updatedAt", t.id AS "tournamentId", t.name AS "tournamentName", t."communityId", t."hostClubId"
         FROM tournament_matches m JOIN tournaments t ON t.id = m."tournamentId"
        WHERE t."deletedAt" IS NULL AND m.status = 'in_review'
        ORDER BY m."updatedAt" ASC LIMIT 5`,
    );
    return { ...counts, oldestDisputes };
  }
}
