import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createPaginatedResult, type PaginatedResult } from '../common/interfaces/paginated-result.interface.js';
import type { ClubRankingsQueryDto, PlayerRankingsQueryDto } from './dto/stats-query.dto.js';
import {
  type LoadPoint,
  matchLoad,
  type PlayerGame,
  type Snapshot,
  snapshot,
  type StatLine,
  statLine,
  type TopOpponents,
  topOpponents,
  inPeriod,
} from './stats.calc.js';
import {
  CLUB_FIXTURES_SQL,
  CLUB_RANK_ORDER,
  clubTotalsSql,
  PLAYER_GAMES_SQL,
  PLAYER_RANK_ORDER,
  periodCondition,
  playerTotalsSql,
  STATS_PERIODS,
  type StatsPeriod,
} from './stats.sql.js';

type Param = (value: unknown) => string;

export interface PlayerRankingRow extends StatLine {
  id: string;
  name: string;
  dpUrl: string | null;
  clubName: string | null;
  /** Null when the player has no confirmed games in the period. */
  rank: number | null;
}

export interface ClubRankingRow {
  id: string;
  name: string;
  color: string | null;
  initials: string | null;
  dpUrl: string | null;
  stage: string | null;
  rank: number | null;
  M: number;
  W: number;
  D: number;
  L: number;
  GF: number;
  GA: number;
  GD: number;
  CS: number;
  winPct: number;
  PTS: number;
}

export interface TrendPoint {
  /** Bucket start, ISO. */
  start: string;
  /** The player's rank among everyone who played in that month / week; null if they didn't play. */
  rank: number | null;
  players: number;
}

export interface PlayerProfileStats {
  userId: string;
  periods: Record<StatsPeriod, StatLine & { rank: number | null; rankedPlayers: number }>;
  snapshot: Snapshot;
  topOpponents: TopOpponents;
  load: { monthly: LoadPoint[]; weekly: LoadPoint[] };
  rankTrend: { monthly: TrendPoint[]; weekly: TrendPoint[] };
}

const TREND_BUCKETS = 12;

/** Player and club statistics, computed from confirmed results (see stats.sql.ts for the rules). */
@Injectable()
export class StatsService {
  constructor(private readonly dataSource: DataSource) {}

  /** Runs a query whose SQL binds its own parameters through `param` (no unused ones reach Postgres). */
  private run<T = Record<string, unknown>>(build: (param: Param) => string): Promise<T[]> {
    const params: unknown[] = [];
    const sql = build((value) => `$${params.push(value)}`);
    return this.dataSource.query(sql, params);
  }

  // ---------------------------------------------------------------- players

  /** CTEs: the period's games, per-player totals with the current win streak, and the global ranking. */
  private rankedPlayersSql(period: StatsPeriod): string {
    return `
      games AS (SELECT * FROM (${PLAYER_GAMES_SQL}) pg WHERE ${periodCondition(period)}),
      totals AS (${playerTotalsSql('games')}),
      streaks AS (
        SELECT "userId", count(*)::int AS streak
          FROM (
            SELECT "userId",
                   sum(CASE WHEN result <> 'W' THEN 1 ELSE 0 END)
                     OVER (PARTITION BY "userId" ORDER BY "playedAt" DESC, "gameId" DESC) AS breaks
              FROM games
          ) x
         WHERE breaks = 0
         GROUP BY "userId"
      ),
      ranked AS (
        SELECT t.*, COALESCE(s.streak, 0) AS streak, RANK() OVER (ORDER BY ${PLAYER_RANK_ORDER})::int AS rank
          FROM totals t
          LEFT JOIN streaks s USING ("userId")
      )`;
  }

  async playerRankings(query: PlayerRankingsQueryDto): Promise<PaginatedResult<PlayerRankingRow>> {
    const period = query.period ?? 'all-time';
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const search = query.search?.trim();

    // Club / community views list every member (zeros if they haven't played);
    // the global table lists players with at least one confirmed game.
    const from = (param: Param) => {
      const pool = query.clubId
        ? `SELECT "userId" FROM efootball_profiles WHERE "clubId" = ${param(query.clubId)}`
        : query.communityId
          ? `SELECT ep."userId" FROM community_members cm
               JOIN efootball_profiles ep ON ep.id = cm."profileId"
              WHERE cm."communityId" = ${param(query.communityId)}`
          : `SELECT "userId" FROM ranked`;
      const filter = search ? `WHERE u.name ILIKE ${param(likePattern(search))}` : '';
      return `
        WITH ${this.rankedPlayersSql(period)},
        pool AS (${pool})
        SELECT %SELECT%
          FROM pool
          JOIN users u ON u.id = pool."userId"
          LEFT JOIN efootball_profiles ep ON ep."userId" = u.id
          LEFT JOIN clubs c ON c.id = ep."clubId"
          LEFT JOIN ranked r ON r."userId" = u.id
          ${filter}`;
    };

    const [rows, [{ total }]] = await Promise.all([
      this.run<Record<string, unknown>>(
        (param) =>
          `${from(param).replace('%SELECT%', 'u.id, u.name, u."dpUrl", c.name AS "clubName", r.*')}
           ORDER BY r.rank ASC NULLS LAST, u.name ASC, u.id
           LIMIT ${param(limit)} OFFSET ${param((page - 1) * limit)}`,
      ),
      this.run<{ total: number }>((param) => from(param).replace('%SELECT%', 'count(*)::int AS total')),
    ]);

    return createPaginatedResult(rows.map(toPlayerRow), total, page, limit);
  }

  async playerProfile(userId: string): Promise<PlayerProfileStats> {
    const [user] = await this.run((param) => `SELECT id FROM users WHERE id = ${param(userId)}`);
    if (!user) throw new NotFoundException('Player not found');

    const games = (
      await this.run<PlayerGame & { playedAt: Date | string }>(
        (param) => `SELECT * FROM (${PLAYER_GAMES_SQL}) pg WHERE "userId" = ${param(userId)} ORDER BY "playedAt", "gameId"`,
      )
    ).map((g) => ({ ...g, playedAt: new Date(g.playedAt) }));

    const now = new Date();
    const [ranks, monthlyTrend, weeklyTrend] = await Promise.all([
      Promise.all(STATS_PERIODS.map((period) => this.playerRank(userId, period))),
      this.rankTrend(userId, 'month', now),
      this.rankTrend(userId, 'week', now),
    ]);

    const periods = Object.fromEntries(
      STATS_PERIODS.map((period, i) => [
        period,
        { ...statLine(games.filter((g) => inPeriod(g.playedAt, period, now))), ...ranks[i] },
      ]),
    ) as PlayerProfileStats['periods'];

    return {
      userId,
      periods,
      snapshot: snapshot(games),
      topOpponents: topOpponents(games),
      load: { monthly: matchLoad(games, 'month', TREND_BUCKETS, now), weekly: matchLoad(games, 'week', TREND_BUCKETS, now) },
      rankTrend: { monthly: monthlyTrend, weekly: weeklyTrend },
    };
  }

  /** The player's rank in the period, and how many players are ranked in it. */
  private async playerRank(userId: string, period: StatsPeriod): Promise<{ rank: number | null; rankedPlayers: number }> {
    const [row] = await this.run<{ rank: number | null; rankedPlayers: number }>(
      (param) => `
        WITH ${this.rankedPlayersSql(period)}
        SELECT (SELECT rank FROM ranked WHERE "userId" = ${param(userId)}) AS rank,
               (SELECT count(*)::int FROM ranked) AS "rankedPlayers"`,
    );
    return { rank: row?.rank ?? null, rankedPlayers: row?.rankedPlayers ?? 0 };
  }

  /** The player's rank in each of the last 12 months / weeks (among everyone who played in it). */
  private async rankTrend(userId: string, unit: 'month' | 'week', now: Date): Promise<TrendPoint[]> {
    const rows = await this.run<{ start: Date | string; rank: number; players: number }>(
      (param) => `
        WITH games AS (
               SELECT pg.*, date_trunc('${unit}', pg."playedAt" AT TIME ZONE 'Asia/Dhaka') AS bucket
                 FROM (${PLAYER_GAMES_SQL}) pg
                WHERE (pg."playedAt" AT TIME ZONE 'Asia/Dhaka')
                      >= date_trunc('${unit}', now() AT TIME ZONE 'Asia/Dhaka') - interval '${TREND_BUCKETS - 1} ${unit}'
             ),
             totals AS (${playerTotalsSql('games', ['bucket'])}),
             ranked AS (
               SELECT bucket, "userId",
                      RANK() OVER (PARTITION BY bucket ORDER BY ${PLAYER_RANK_ORDER})::int AS rank,
                      count(*) OVER (PARTITION BY bucket)::int AS players
                 FROM totals
             )
        SELECT bucket AT TIME ZONE 'Asia/Dhaka' AS start, rank, players
          FROM ranked
         WHERE "userId" = ${param(userId)}`,
    );
    const byStart = new Map(rows.map((r) => [new Date(r.start).toISOString(), r]));
    // The same buckets as the match-load chart, so both line up.
    return matchLoad([], unit, TREND_BUCKETS, now).map(({ start }) => {
      const row = byStart.get(start);
      return { start, rank: row?.rank ?? null, players: row?.players ?? 0 };
    });
  }

  // ------------------------------------------------------------------ clubs

  private rankedClubsSql(period: StatsPeriod): string {
    return `
      fixtures AS (SELECT * FROM (${CLUB_FIXTURES_SQL}) cf WHERE ${periodCondition(period)}),
      totals AS (${clubTotalsSql('fixtures')}),
      ranked AS (SELECT t.*, RANK() OVER (ORDER BY ${CLUB_RANK_ORDER})::int AS rank FROM totals t)`;
  }

  async clubRankings(query: ClubRankingsQueryDto): Promise<PaginatedResult<ClubRankingRow>> {
    const period = query.period ?? 'all-time';
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const search = query.search?.trim();

    const from = (param: Param) => {
      const pool = query.communityId
        ? `SELECT "clubId" FROM community_clubs WHERE "communityId" = ${param(query.communityId)}`
        : `SELECT "clubId" FROM ranked`;
      const filter = search ? `WHERE c.name ILIKE ${param(likePattern(search))}` : '';
      return `
        WITH ${this.rankedClubsSql(period)},
        pool AS (${pool})
        SELECT %SELECT%
          FROM pool
          JOIN clubs c ON c.id = pool."clubId"
          LEFT JOIN ranked r ON r."clubId" = c.id
          ${filter}`;
    };

    const [rows, [{ total }]] = await Promise.all([
      this.run<Record<string, unknown>>(
        (param) =>
          `${from(param).replace('%SELECT%', 'c.id, c.name, c.color, c.initials, c."dpUrl", c.stage, r.*')}
           ORDER BY r.rank ASC NULLS LAST, c.name ASC, c.id
           LIMIT ${param(limit)} OFFSET ${param((page - 1) * limit)}`,
      ),
      this.run<{ total: number }>((param) => from(param).replace('%SELECT%', 'count(*)::int AS total')),
    ]);

    return createPaginatedResult(rows.map(toClubRow), total, page, limit);
  }

  /** A club's line (with rank) for every period. */
  async clubProfile(clubId: string): Promise<{ clubId: string; periods: Record<StatsPeriod, ClubRankingRow> }> {
    const [club] = await this.run((param) => `SELECT id FROM clubs WHERE id = ${param(clubId)}`);
    if (!club) throw new NotFoundException('Club not found');

    const lines = await Promise.all(
      STATS_PERIODS.map(async (period) => {
        const [row] = await this.run<Record<string, unknown>>(
          (param) => `
            WITH ${this.rankedClubsSql(period)}
            SELECT c.id, c.name, c.color, c.initials, c."dpUrl", c.stage, r.*
              FROM clubs c
              LEFT JOIN ranked r ON r."clubId" = c.id
             WHERE c.id = ${param(clubId)}`,
        );
        return [period, toClubRow(row)] as const;
      }),
    );
    return { clubId, periods: Object.fromEntries(lines) as Record<StatsPeriod, ClubRankingRow> };
  }
}

/** ILIKE pattern matching `text` anywhere, with LIKE wildcards in it taken literally. */
function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

const num = (value: unknown) => Number(value ?? 0);
const pct = (wins: number, played: number) => (played ? Math.round((wins / played) * 1000) / 10 : 0);

function toPlayerRow(r: Record<string, unknown>): PlayerRankingRow {
  const PL = num(r.PL);
  const W = num(r.W);
  const GF = num(r.GF);
  const GA = num(r.GA);
  return {
    id: String(r.id),
    name: String(r.name),
    dpUrl: (r.dpUrl as string | null) ?? null,
    clubName: (r.clubName as string | null) ?? null,
    rank: r.rank == null ? null : num(r.rank),
    PL,
    W,
    D: num(r.D),
    L: num(r.L),
    GF,
    GA,
    GD: GF - GA,
    CS: num(r.CS),
    HT: num(r.HT),
    DHT: num(r.DHT),
    streak: num(r.streak),
    motm: 0,
    winPct: pct(W, PL),
    PTS: num(r.PTS),
  };
}

function toClubRow(r: Record<string, unknown>): ClubRankingRow {
  const M = num(r.M);
  const W = num(r.W);
  const GF = num(r.GF);
  const GA = num(r.GA);
  return {
    id: String(r.id),
    name: String(r.name),
    color: (r.color as string | null) ?? null,
    initials: (r.initials as string | null) ?? null,
    dpUrl: (r.dpUrl as string | null) ?? null,
    stage: (r.stage as string | null) ?? null,
    rank: r.rank == null ? null : num(r.rank),
    M,
    W,
    D: num(r.D),
    L: num(r.L),
    GF,
    GA,
    GD: GF - GA,
    CS: num(r.CS),
    winPct: pct(W, M),
    PTS: num(r.PTS),
  };
}
