import type { StatsPeriod } from './stats.sql.js';

/** One confirmed game from the player's side (a PLAYER_GAMES_SQL row). */
export interface PlayerGame {
  gameId: string;
  playedAt: Date;
  opponentUserId: string | null;
  opponentName: string;
  myGoals: number;
  oppGoals: number;
  countsGoals: boolean;
  result: 'W' | 'D' | 'L';
}

export interface StatLine {
  PL: number;
  W: number;
  D: number;
  L: number;
  GF: number;
  GA: number;
  GD: number;
  CS: number;
  HT: number;
  DHT: number;
  /** Current run of consecutive wins (most recent games). */
  streak: number;
  motm: number;
  winPct: number;
  PTS: number;
}

/** Totals for a list of games, using the same rules as `playerTotalsSql`. */
export function statLine(games: PlayerGame[]): StatLine {
  const line = { PL: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0, CS: 0, HT: 0, DHT: 0 };
  for (const g of games) {
    line.PL++;
    line[g.result]++;
    if (g.countsGoals) {
      line.GF += g.myGoals;
      line.GA += g.oppGoals;
      if (g.oppGoals === 0) line.CS++;
      if (g.myGoals >= 6) line.DHT++;
      else if (g.myGoals >= 3) line.HT++;
    }
  }
  return {
    ...line,
    GD: line.GF - line.GA,
    streak: currentWinStreak(games),
    motm: 0, // not recorded yet
    winPct: line.PL ? Math.round((line.W / line.PL) * 1000) / 10 : 0,
    PTS: line.W * 3 + line.D + line.HT * 2 + line.DHT * 5,
  };
}

const byDate = (games: PlayerGame[]) =>
  [...games].sort((a, b) => a.playedAt.getTime() - b.playedAt.getTime() || a.gameId.localeCompare(b.gameId));

/** Consecutive wins counting back from the most recent game. */
export function currentWinStreak(games: PlayerGame[]): number {
  const ordered = byDate(games);
  let streak = 0;
  for (let i = ordered.length - 1; i >= 0 && ordered[i].result === 'W'; i--) streak++;
  return streak;
}

/** Longest run without a loss, with the dates it started and ended. */
export function bestUnbeatenRun(games: PlayerGame[]): { matches: number; from: Date; to: Date } | null {
  let best: { matches: number; from: Date; to: Date } | null = null;
  let length = 0;
  let from: Date | null = null;
  for (const g of byDate(games)) {
    if (g.result === 'L') {
      length = 0;
      from = null;
      continue;
    }
    length++;
    from ??= g.playedAt;
    if (!best || length > best.matches) best = { matches: length, from, to: g.playedAt };
  }
  return best;
}

// ---- Calendar buckets (Bangladesh time, UTC+6 all year; weeks start Monday) ----

const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Start (as a UTC instant) of the Dhaka-local month or week containing `date`. */
export function bucketStart(date: Date, unit: 'month' | 'week'): Date {
  const local = new Date(date.getTime() + DHAKA_OFFSET_MS);
  if (unit === 'month') {
    return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - DHAKA_OFFSET_MS);
  }
  const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const sinceMonday = (local.getUTCDay() + 6) % 7;
  return new Date(midnight - sinceMonday * DAY_MS - DHAKA_OFFSET_MS);
}

/** The bucket `steps` months / weeks before (negative) or after `start`. */
export function shiftBucket(start: Date, unit: 'month' | 'week', steps: number): Date {
  if (unit === 'week') return new Date(start.getTime() + steps * 7 * DAY_MS);
  const local = new Date(start.getTime() + DHAKA_OFFSET_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + steps, 1) - DHAKA_OFFSET_MS);
}

/** Whether `date` falls in the period, matching `periodCondition` in SQL. */
export function inPeriod(date: Date, period: StatsPeriod, now = new Date()): boolean {
  if (period === 'all-time') return true;
  const unit = period.endsWith('week') ? 'week' : 'month';
  const current = bucketStart(now, unit);
  const from = period.startsWith('last') ? shiftBucket(current, unit, -1) : current;
  const to = period.startsWith('last') ? current : null;
  return date >= from && (!to || date < to);
}

export interface LoadPoint {
  /** Bucket start, ISO. */
  start: string;
  matches: number;
  wins: number;
  goalsFor: number;
}

/** Games, wins and goals per month or week for the last `count` buckets (oldest first). */
export function matchLoad(games: PlayerGame[], unit: 'month' | 'week', count: number, now = new Date()): LoadPoint[] {
  const current = bucketStart(now, unit);
  const points = Array.from({ length: count }, (_, i) => ({
    start: shiftBucket(current, unit, i - count + 1).toISOString(),
    matches: 0,
    wins: 0,
    goalsFor: 0,
  }));
  const index = new Map(points.map((p, i) => [p.start, i]));
  for (const g of games) {
    const i = index.get(bucketStart(g.playedAt, unit).toISOString());
    if (i === undefined) continue;
    points[i].matches++;
    if (g.result === 'W') points[i].wins++;
    if (g.countsGoals) points[i].goalsFor += g.myGoals;
  }
  return points;
}

export interface Snapshot {
  debut: string | null;
  lastPlayed: string | null;
  /** Average / longest time between consecutive games, in milliseconds. */
  avgGapMs: number | null;
  maxGapMs: number | null;
  unbeatenRun: { matches: number; from: string; to: string } | null;
  highestScoring: { goals: number; conceded: number; opponent: string; date: string } | null;
}

export function snapshot(games: PlayerGame[]): Snapshot {
  const ordered = byDate(games);
  const gaps = ordered.slice(1).map((g, i) => g.playedAt.getTime() - ordered[i].playedAt.getTime());
  const run = bestUnbeatenRun(ordered);
  // Highest-scoring reviewed game; ties go to the earlier one.
  const top = ordered
    .filter((g) => g.countsGoals)
    .reduce<PlayerGame | null>((best, g) => (!best || g.myGoals > best.myGoals ? g : best), null);
  return {
    debut: ordered[0]?.playedAt.toISOString() ?? null,
    lastPlayed: ordered.at(-1)?.playedAt.toISOString() ?? null,
    avgGapMs: gaps.length ? Math.round(gaps.reduce((s, x) => s + x, 0) / gaps.length) : null,
    maxGapMs: gaps.length ? Math.max(...gaps) : null,
    unbeatenRun: run ? { matches: run.matches, from: run.from.toISOString(), to: run.to.toISOString() } : null,
    highestScoring: top
      ? { goals: top.myGoals, conceded: top.oppGoals, opponent: top.opponentName, date: top.playedAt.toISOString() }
      : null,
  };
}

export interface TopOpponents {
  mostPlayed: { userId: string | null; name: string; matches: number } | null;
  mostWins: { userId: string | null; name: string; wins: number } | null;
}

/** The opponent faced most often, and the one beaten most often (ties: whoever was faced first). */
export function topOpponents(games: PlayerGame[]): TopOpponents {
  const tally = new Map<string, { userId: string | null; name: string; matches: number; wins: number }>();
  for (const g of byDate(games)) {
    const key = g.opponentUserId ?? `name:${g.opponentName}`;
    const row = tally.get(key) ?? { userId: g.opponentUserId, name: g.opponentName, matches: 0, wins: 0 };
    row.name = g.opponentName;
    row.matches++;
    if (g.result === 'W') row.wins++;
    tally.set(key, row);
  }
  const rows = [...tally.values()];
  const played = rows.reduce<(typeof rows)[number] | null>((best, r) => (!best || r.matches > best.matches ? r : best), null);
  const beaten = rows
    .filter((r) => r.wins > 0)
    .reduce<(typeof rows)[number] | null>((best, r) => (!best || r.wins > best.wins ? r : best), null);
  return {
    mostPlayed: played ? { userId: played.userId, name: played.name, matches: played.matches } : null,
    mostWins: beaten ? { userId: beaten.userId, name: beaten.name, wins: beaten.wins } : null,
  };
}
