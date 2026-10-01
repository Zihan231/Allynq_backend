/**
 * SQL building blocks for player and club stats. Stats are computed on read
 * from confirmed results, so they always match the games and pick up
 * corrections (a rejected result) automatically.
 */

export const STATS_PERIODS = ['all-time', 'this-week', 'last-week', 'this-month', 'last-month'] as const;
export type StatsPeriod = (typeof STATS_PERIODS)[number];

/** Games / fixtures whose result is final: reviewed by officials, or decided by the system. */
export const CONFIRMED_GAME_STATUSES = `('approved', 'walkover', 'forfeited')`;

/** Calendar buckets are in Bangladesh time; weeks start on Monday (Postgres `date_trunc('week')`). */
const TZ = `'Asia/Dhaka'`;
const LOCAL_NOW = `(now() AT TIME ZONE ${TZ})`;

/** SQL condition keeping rows of `column` (a timestamptz) inside the period. */
export function periodCondition(period: StatsPeriod, column = '"playedAt"'): string {
  const local = `(${column} AT TIME ZONE ${TZ})`;
  const unit = period.endsWith('week') ? 'week' : 'month';
  const start = `date_trunc('${unit}', ${LOCAL_NOW})`;
  switch (period) {
    case 'all-time':
      return 'TRUE';
    case 'this-week':
    case 'this-month':
      return `${local} >= ${start}`;
    case 'last-week':
    case 'last-month':
      return `${local} >= ${start} - interval '1 ${unit}' AND ${local} < ${start}`;
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
      SELECT g.id AS "gameId", g.status, m."tournamentId",
             COALESCE(g."scheduledStart", g."createdAt") AS "playedAt",
             sd."userId", sd."opponentUserId", sd."opponentName", sd."myGoals", sd."oppGoals", sd."clubId"
        FROM tournament_match_games g
        JOIN tournament_matches m ON m.id = g."matchId"
        JOIN tournaments t ON t.id = m."tournamentId" AND t.status <> 'cancelled'
        LEFT JOIN tournament_participants pa ON pa.id = m."participantAId"
        LEFT JOIN tournament_participants pb ON pb.id = m."participantBId"
        CROSS JOIN LATERAL (
          VALUES
            (g."playerAUserId", g."playerBUserId", g."playerBName",
             COALESCE(g."goalsA", 0), COALESCE(g."goalsB", 0), pa."clubId"),
            (g."playerBUserId", g."playerAUserId", g."playerAName",
             COALESCE(g."goalsB", 0), COALESCE(g."goalsA", 0), pb."clubId")
        ) AS sd("userId", "opponentUserId", "opponentName", "myGoals", "oppGoals", "clubId")
       WHERE g.status IN ${CONFIRMED_GAME_STATUSES}
         AND sd."userId" IS NOT NULL
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
           count(*) FILTER (WHERE result = 'W')::int AS "W",
           count(*) FILTER (WHERE result = 'D')::int AS "D",
           count(*) FILTER (WHERE result = 'L')::int AS "L",
           COALESCE(sum("myGoals") FILTER (WHERE "countsGoals"), 0)::int AS "GF",
           COALESCE(sum("oppGoals") FILTER (WHERE "countsGoals"), 0)::int AS "GA",
           count(*) FILTER (WHERE "countsGoals" AND "oppGoals" = 0)::int AS "CS",
           count(*) FILTER (WHERE "countsGoals" AND "myGoals" BETWEEN 3 AND 5)::int AS "HT",
           count(*) FILTER (WHERE "countsGoals" AND "myGoals" >= 6)::int AS "DHT",
           (count(*) FILTER (WHERE result = 'W') * 3
             + count(*) FILTER (WHERE result = 'D')
             + count(*) FILTER (WHERE "countsGoals" AND "myGoals" BETWEEN 3 AND 5) * 2
             + count(*) FILTER (WHERE "countsGoals" AND "myGoals" >= 6) * 5)::int AS "PTS"
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
      SELECT m.id AS "matchId", COALESCE(m."completedAt", m."updatedAt") AS "playedAt",
             sd."clubId", sd."opponentClubId", sd."GF", sd."GA", sd.result
        FROM tournament_matches m
        JOIN tournaments t ON t.id = m."tournamentId" AND t.type = 'cvc' AND t.status <> 'cancelled'
        JOIN tournament_participants pa ON pa.id = m."participantAId"
        JOIN tournament_participants pb ON pb.id = m."participantBId"
        CROSS JOIN LATERAL (
          SELECT COALESCE(sum(g."goalsA") FILTER (WHERE g.status = 'approved'), 0)::int AS a,
                 COALESCE(sum(g."goalsB") FILTER (WHERE g.status = 'approved'), 0)::int AS b
            FROM tournament_match_games g
           WHERE g."matchId" = m.id
        ) goals
        CROSS JOIN LATERAL (
          VALUES
            (pa."clubId", pb."clubId", goals.a, goals.b,
             CASE WHEN m."doubleForfeit" OR m."winnerParticipantId" = pb.id THEN 'L'
                  WHEN m."winnerParticipantId" = pa.id THEN 'W' ELSE 'D' END),
            (pb."clubId", pa."clubId", goals.b, goals.a,
             CASE WHEN m."doubleForfeit" OR m."winnerParticipantId" = pa.id THEN 'L'
                  WHEN m."winnerParticipantId" = pb.id THEN 'W' ELSE 'D' END)
        ) AS sd("clubId", "opponentClubId", "GF", "GA", result)
       WHERE m.status = 'completed'
         AND sd."clubId" IS NOT NULL
    ) f`;

/** Per-club totals over `source` (rows shaped like CLUB_FIXTURES_SQL); PTS = W×3 + D. */
export function clubTotalsSql(source: string): string {
  return `
    SELECT "clubId",
           count(*)::int AS "M",
           count(*) FILTER (WHERE result = 'W')::int AS "W",
           count(*) FILTER (WHERE result = 'D')::int AS "D",
           count(*) FILTER (WHERE result = 'L')::int AS "L",
           COALESCE(sum("GF"), 0)::int AS "GF",
           COALESCE(sum("GA"), 0)::int AS "GA",
           count(*) FILTER (WHERE "GA" = 0)::int AS "CS",
           (count(*) FILTER (WHERE result = 'W') * 3 + count(*) FILTER (WHERE result = 'D'))::int AS "PTS"
      FROM ${source}
     GROUP BY "clubId"`;
}

export const CLUB_RANK_ORDER = `"PTS" DESC, "W" DESC, ("GF" - "GA") DESC, "GF" DESC`;
