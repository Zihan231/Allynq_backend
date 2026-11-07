/**
 * SQL building blocks for player and club stats. Stats are computed on read
 * from confirmed results, so they always match the games and pick up
 * corrections (a rejected result) automatically.
 */

export const STATS_PERIODS = ['all-time', 'this-week', 'last-week', 'this-month', 'last-month'] as const;
export type StatsPeriod = (typeof STATS_PERIODS)[number];

/** Rankings can also be limited to the active season (staff set its dates); empty when none is active. */
export const RANKING_PERIODS = [...STATS_PERIODS, 'this-season'] as const;
export type RankingPeriod = (typeof RANKING_PERIODS)[number];

/** Games / fixtures whose result is final: reviewed by officials, or decided by the system. */
export const CONFIRMED_GAME_STATUSES = `('approved', 'walkover', 'forfeited')`;

/**
 * Calendar buckets are in Bangladesh time (UTC+6, no daylight saving, so a fixed offset is exact); weeks start on Monday.
 * Dates are stored in UTC and the session time zone is UTC (see mysql-session.ts), so `CONVERT_TZ(x, '+00:00', '+06:00')` is local time.
 */
export const LOCAL_OFFSET = `'+06:00'`;

/** `expr` (a UTC datetime) as Bangladesh local time. */
export const localTime = (expr: string) => `CONVERT_TZ(${expr}, '+00:00', ${LOCAL_OFFSET})`;
/** Midnight on the Monday of `expr`'s week (`expr` already in local time): MySQL's replacement for `date_trunc('week', ...)`. */
export const weekStart = (expr: string) => `DATE_SUB(DATE(${expr}), INTERVAL WEEKDAY(${expr}) DAY)`;
/** Midnight on the first day of `expr`'s month (`expr` already in local time): replaces `date_trunc('month', ...)`. */
export const monthStart = (expr: string) => `DATE_SUB(DATE(${expr}), INTERVAL DAYOFMONTH(${expr}) - 1 DAY)`;

const LOCAL_NOW = localTime('NOW()');

/** SQL condition keeping rows of `column` (a UTC datetime) inside the period. */
export function periodCondition(period: RankingPeriod, column = '"playedAt"'): string {
  const local = localTime(column);
  const unit = period.endsWith('week') ? 'WEEK' : 'MONTH';
  const start = period.endsWith('week') ? weekStart(LOCAL_NOW) : monthStart(LOCAL_NOW);
  switch (period) {
    case 'all-time':
      return 'TRUE';
    case 'this-season':
      return `EXISTS (SELECT 1 FROM seasons s WHERE s.status = 'active' AND ${column} >= s."startsAt" AND ${column} < s."endsAt")`;
    case 'this-week':
    case 'this-month':
      return `${local} >= ${start}`;
    case 'last-week':
    case 'last-month':
      return `${local} >= DATE_SUB(${start}, INTERVAL 1 ${unit}) AND ${local} < ${start}`;
  }
}

/**
 * One row per (player, confirmed game), from that player's side:
 * - result: W / D / L from the score; a forfeit (neither side uploaded) is a loss for both;
 *   a walkover carries its awarded score, so it reads as W / L;
 * - countsGoals: only reviewed games count towards goals, clean sheets and hat-tricks
 *   (walkovers and forfeits don't);
 * - clubId: the player's club in a CvC fixture (null in PvP).
 */
export const PLAYER_GAMES_SQL = `
  SELECT s."gameId", s."tournamentId", s."playedAt", s."userId", s."opponentUserId", s."opponentName",
         s."myGoals", s."oppGoals", s."clubId",
         s.status = 'approved' AS "countsGoals",
         CASE
           WHEN s.status = 'forfeited' THEN 'L'
           WHEN s."myGoals" > s."oppGoals" THEN 'W'
           WHEN s."myGoals" < s."oppGoals" THEN 'L'
           ELSE 'D'
         END AS result
    FROM (
      SELECT u.* FROM (
        -- Each game gives two rows, one per side (side 0 = player A, side 1 = player B).
        SELECT g.id AS "gameId", g.status, m."tournamentId",
               COALESCE(g."scheduledStart", g."createdAt") AS "playedAt",
               CASE x.side WHEN 0 THEN g."playerAUserId" ELSE g."playerBUserId" END AS "userId",
               CASE x.side WHEN 0 THEN g."playerBUserId" ELSE g."playerAUserId" END AS "opponentUserId",
               CASE x.side WHEN 0 THEN g."playerBName" ELSE g."playerAName" END AS "opponentName",
               CASE x.side WHEN 0 THEN COALESCE(g."goalsA", 0) ELSE COALESCE(g."goalsB", 0) END AS "myGoals",
               CASE x.side WHEN 0 THEN COALESCE(g."goalsB", 0) ELSE COALESCE(g."goalsA", 0) END AS "oppGoals",
               CASE x.side WHEN 0 THEN pa."clubId" ELSE pb."clubId" END AS "clubId"
          FROM tournament_match_games g
          JOIN tournament_matches m ON m.id = g."matchId"
          JOIN tournaments t ON t.id = m."tournamentId" AND t.status <> 'cancelled' AND t."deletedAt" IS NULL
          LEFT JOIN tournament_participants pa ON pa.id = m."participantAId"
          LEFT JOIN tournament_participants pb ON pb.id = m."participantBId"
          CROSS JOIN (SELECT 0 AS side UNION ALL SELECT 1) x
         WHERE g.status IN ${CONFIRMED_GAME_STATUSES}
      ) u
      WHERE u."userId" IS NOT NULL
    ) s`;

/**
 * Per-player totals over `source` (rows shaped like PLAYER_GAMES_SQL), with
 * PTS = W×3 + D + HT×2 + DHT×5 (+ MOTM, not recorded yet).
 * A hat-trick is a reviewed game with 3–5 goals; 6+ is a double hat-trick (counted once, as DHT).
 * `groupBy` adds extra grouping columns (e.g. a time bucket).
 */
export function playerTotalsSql(source: string, groupBy: string[] = []): string {
  const keys = [...groupBy, '"userId"'].join(', ');
  return `
    SELECT ${keys},
           count(*)::int AS "PL",
           COUNT(CASE WHEN result = 'W' THEN 1 END)::int AS "W",
           COUNT(CASE WHEN result = 'D' THEN 1 END)::int AS "D",
           COUNT(CASE WHEN result = 'L' THEN 1 END)::int AS "L",
           COALESCE(SUM(CASE WHEN "countsGoals" THEN "myGoals" END), 0)::int AS "GF",
           COALESCE(SUM(CASE WHEN "countsGoals" THEN "oppGoals" END), 0)::int AS "GA",
           COUNT(CASE WHEN "countsGoals" AND "oppGoals" = 0 THEN 1 END)::int AS "CS",
           COUNT(CASE WHEN "countsGoals" AND "myGoals" BETWEEN 3 AND 5 THEN 1 END)::int AS "HT",
           COUNT(CASE WHEN "countsGoals" AND "myGoals" >= 6 THEN 1 END)::int AS "DHT",
           (COUNT(CASE WHEN result = 'W' THEN 1 END) * 3
             + COUNT(CASE WHEN result = 'D' THEN 1 END)
             + COUNT(CASE WHEN "countsGoals" AND "myGoals" BETWEEN 3 AND 5 THEN 1 END) * 2
             + COUNT(CASE WHEN "countsGoals" AND "myGoals" >= 6 THEN 1 END) * 5)::int AS "PTS"
      FROM ${source}
     GROUP BY ${keys}`;
}

/** Ranking order shared by every player table: PTS, then wins, goal difference, goals. */
export const PLAYER_RANK_ORDER = `"PTS" DESC, "W" DESC, ("GF" - "GA") DESC, "GF" DESC`;

/**
 * One row per (club, completed CvC fixture), from that club's side. Goals are
 * summed from the fixture's reviewed games only (walkovers / forfeits add none).
 */
export const CLUB_FIXTURES_SQL = `
  SELECT f."matchId", f."playedAt", f."clubId", f."opponentClubId", f."GF", f."GA", f.result
    FROM (
      SELECT u.* FROM (
        -- Each fixture gives two rows, one per club (side 0 = club A, side 1 = club B).
        SELECT m.id AS "matchId", COALESCE(m."completedAt", m."updatedAt") AS "playedAt",
               CASE x.side WHEN 0 THEN pa."clubId" ELSE pb."clubId" END AS "clubId",
               CASE x.side WHEN 0 THEN pb."clubId" ELSE pa."clubId" END AS "opponentClubId",
               CASE x.side WHEN 0 THEN COALESCE(goals.a, 0) ELSE COALESCE(goals.b, 0) END AS "GF",
               CASE x.side WHEN 0 THEN COALESCE(goals.b, 0) ELSE COALESCE(goals.a, 0) END AS "GA",
               CASE x.side
                 WHEN 0 THEN CASE WHEN m."doubleForfeit" OR m."winnerParticipantId" = pb.id THEN 'L'
                                  WHEN m."winnerParticipantId" = pa.id THEN 'W' ELSE 'D' END
                 ELSE CASE WHEN m."doubleForfeit" OR m."winnerParticipantId" = pa.id THEN 'L'
                           WHEN m."winnerParticipantId" = pb.id THEN 'W' ELSE 'D' END
               END AS result
          FROM tournament_matches m
          JOIN tournaments t ON t.id = m."tournamentId" AND t.type = 'cvc' AND t.status <> 'cancelled' AND t."deletedAt" IS NULL
          JOIN tournament_participants pa ON pa.id = m."participantAId"
          JOIN tournament_participants pb ON pb.id = m."participantBId"
          -- Goals of the fixture's reviewed games only (walkovers / forfeits add none).
          LEFT JOIN (
            SELECT g."matchId",
                   SUM(CASE WHEN g.status = 'approved' THEN g."goalsA" END) AS a,
                   SUM(CASE WHEN g.status = 'approved' THEN g."goalsB" END) AS b
              FROM tournament_match_games g
             GROUP BY g."matchId"
          ) goals ON goals."matchId" = m.id
          CROSS JOIN (SELECT 0 AS side UNION ALL SELECT 1) x
         WHERE m.status = 'completed'
      ) u
      WHERE u."clubId" IS NOT NULL
    ) f`;

/** Per-club totals over `source` (rows shaped like CLUB_FIXTURES_SQL); PTS = W×3 + D. */
export function clubTotalsSql(source: string): string {
  return `
    SELECT "clubId",
           count(*)::int AS "M",
           COUNT(CASE WHEN result = 'W' THEN 1 END)::int AS "W",
           COUNT(CASE WHEN result = 'D' THEN 1 END)::int AS "D",
           COUNT(CASE WHEN result = 'L' THEN 1 END)::int AS "L",
           COALESCE(sum("GF"), 0)::int AS "GF",
           COALESCE(sum("GA"), 0)::int AS "GA",
           COUNT(CASE WHEN "GA" = 0 THEN 1 END)::int AS "CS",
           (COUNT(CASE WHEN result = 'W' THEN 1 END) * 3 + COUNT(CASE WHEN result = 'D' THEN 1 END))::int AS "PTS"
      FROM ${source}
     GROUP BY "clubId"`;
}

export const CLUB_RANK_ORDER = `"PTS" DESC, "W" DESC, ("GF" - "GA") DESC, "GF" DESC`;
