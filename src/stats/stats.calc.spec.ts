import { describe, expect, it } from 'vitest';
import {
  bestUnbeatenRun,
  bucketStart,
  currentWinStreak,
  inPeriod,
  matchLoad,
  type PlayerGame,
  snapshot,
  statLine,
  topOpponents,
} from './stats.calc.js';

let seq = 0;
const game = (result: 'W' | 'D' | 'L', mine: number, theirs: number, at: string, extra: Partial<PlayerGame> = {}) =>
  ({
    gameId: `g${++seq}`,
    playedAt: new Date(at),
    opponentUserId: 'opp',
    opponentName: 'Opponent',
    myGoals: mine,
    oppGoals: theirs,
    countsGoals: true,
    result,
    ...extra,
  }) satisfies PlayerGame;

describe('statLine', () => {
  it('counts walkovers and forfeits in W / L but not in goals', () => {
    const line = statLine([
      game('W', 2, 1, '2026-10-01T12:00:00Z'),
      game('W', 3, 0, '2026-10-02T12:00:00Z', { countsGoals: false }), // walkover
      game('L', 0, 0, '2026-10-03T12:00:00Z', { countsGoals: false }), // forfeit
    ]);
    expect(line).toMatchObject({ PL: 3, W: 2, D: 0, L: 1, GF: 2, GA: 1, CS: 0, winPct: 66.7 });
  });

  it('scores a hat-trick for 3–5 goals and a double hat-trick (only) for 6+', () => {
    const line = statLine([
      game('W', 3, 1, '2026-10-01T12:00:00Z'),
      game('W', 5, 0, '2026-10-02T12:00:00Z'),
      game('W', 6, 2, '2026-10-03T12:00:00Z'),
      game('D', 2, 2, '2026-10-04T12:00:00Z'),
    ]);
    expect(line).toMatchObject({ HT: 2, DHT: 1, CS: 1 });
    // W×3 + D + HT×2 + DHT×5 (MOTM not recorded yet)
    expect(line.PTS).toBe(3 * 3 + 1 + 2 * 2 + 1 * 5);
  });
});

describe('streaks', () => {
  const games = [
    game('W', 1, 0, '2026-09-01T12:00:00Z'),
    game('D', 1, 1, '2026-09-02T12:00:00Z'),
    game('W', 2, 0, '2026-09-03T12:00:00Z'),
    game('L', 0, 1, '2026-09-04T12:00:00Z'),
    game('W', 1, 0, '2026-09-05T12:00:00Z'),
    game('W', 3, 0, '2026-09-06T12:00:00Z'),
  ];

  it('current win streak counts back from the latest game, whatever the input order', () => {
    expect(currentWinStreak([...games].reverse())).toBe(2);
  });

  it('finds the longest unbeaten run with its dates', () => {
    expect(bestUnbeatenRun(games)).toEqual({
      matches: 3,
      from: new Date('2026-09-01T12:00:00Z'),
      to: new Date('2026-09-03T12:00:00Z'),
    });
  });
});

describe('Bangladesh-time buckets', () => {
  it('puts 23:30 Dhaka on the 31st into that month, and starts weeks on Monday', () => {
    const lateOnAug31 = new Date('2026-08-31T17:30:00Z'); // 23:30 in Dhaka
    expect(bucketStart(lateOnAug31, 'month').toISOString()).toBe('2026-07-31T18:00:00.000Z'); // Aug 1, 00:00 Dhaka
    expect(bucketStart(lateOnAug31, 'week').toISOString()).toBe('2026-08-30T18:00:00.000Z'); // Mon Aug 31, 00:00 Dhaka
  });

  it('matches this / last week and month', () => {
    const now = new Date('2026-10-01T06:00:00Z'); // Thu Oct 1, noon Dhaka
    expect(inPeriod(new Date('2026-09-28T00:00:00Z'), 'this-week', now)).toBe(true); // Mon Sep 28, 06:00 Dhaka
    expect(inPeriod(new Date('2026-09-27T17:00:00Z'), 'this-week', now)).toBe(false); // Sun Sep 27, 23:00 Dhaka
    expect(inPeriod(new Date('2026-09-27T17:00:00Z'), 'last-week', now)).toBe(true);
    expect(inPeriod(new Date('2026-09-15T00:00:00Z'), 'last-month', now)).toBe(true);
    expect(inPeriod(new Date('2026-09-15T00:00:00Z'), 'this-month', now)).toBe(false);
  });

  it('builds a fixed run of buckets with games, wins and reviewed goals', () => {
    const now = new Date('2026-10-01T06:00:00Z');
    const load = matchLoad(
      [game('W', 4, 0, '2026-09-20T12:00:00Z'), game('W', 3, 0, '2026-09-21T12:00:00Z', { countsGoals: false })],
      'month',
      3,
      now,
    );
    expect(load.map((p) => [p.start, p.matches, p.wins, p.goalsFor])).toEqual([
      ['2026-07-31T18:00:00.000Z', 0, 0, 0],
      ['2026-08-31T18:00:00.000Z', 2, 2, 4],
      ['2026-09-30T18:00:00.000Z', 0, 0, 0],
    ]);
  });
});

describe('snapshot and opponents', () => {
  it('summarises debut, gaps, the best game and the top opponents', () => {
    const games = [
      game('W', 2, 0, '2026-09-01T12:00:00Z', { opponentUserId: 'a', opponentName: 'Alice' }),
      game('W', 5, 1, '2026-09-03T12:00:00Z', { opponentUserId: 'b', opponentName: 'Bob' }),
      game('L', 0, 1, '2026-09-04T12:00:00Z', { opponentUserId: 'b', opponentName: 'Bob' }),
    ];
    expect(snapshot(games)).toMatchObject({
      debut: '2026-09-01T12:00:00.000Z',
      lastPlayed: '2026-09-04T12:00:00.000Z',
      avgGapMs: 1.5 * 86_400_000,
      maxGapMs: 2 * 86_400_000,
      unbeatenRun: { matches: 2 },
      highestScoring: { goals: 5, conceded: 1, opponent: 'Bob' },
    });
    expect(topOpponents(games)).toEqual({
      mostPlayed: { userId: 'b', name: 'Bob', matches: 2 },
      mostWins: { userId: 'a', name: 'Alice', wins: 1 },
    });
  });

  it('is empty for a player with no confirmed games', () => {
    expect(snapshot([])).toMatchObject({ debut: null, avgGapMs: null, unbeatenRun: null, highestScoring: null });
    expect(topOpponents([])).toEqual({ mostPlayed: null, mostWins: null });
  });
});
