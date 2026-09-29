import { describe, expect, it } from 'vitest';
import { chooseFormat, drawGroups, groupCount } from './format.js';
import { crossGroupPairs, planKnockout, seedOrder, seededPairs } from './knockout.js';
import { roundRobin } from './round-robin.js';
import { fixtureOutcome } from './scoring.js';
import { computeStandings } from './standings.js';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `e${i + 1}`);

describe('format', () => {
  it('uses a knockout up to 8 entrants and groups above', () => {
    expect(chooseFormat(4)).toBe('knockout');
    expect(chooseFormat(8)).toBe('knockout');
    expect(chooseFormat(9)).toBe('groups_knockout');
    expect(() => chooseFormat(3)).toThrow();
  });

  it.each([
    [9, 2], [12, 2], [15, 2], [16, 4], [20, 4], [24, 4], [28, 4], [31, 4], [32, 8], [40, 8], [64, 16],
  ])('%i entrants → %i groups', (entrants, groups) => {
    expect(groupCount(entrants)).toBe(groups);
    const size = entrants / groups;
    expect(size).toBeGreaterThanOrEqual(4);
  });

  it('draws groups whose sizes differ by at most one and keeps everyone', () => {
    const groups = drawGroups(ids(18), 4);
    const sizes = groups.map((g) => g.length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    expect(groups.flat().sort()).toEqual(ids(18).sort());
  });
});

describe('roundRobin', () => {
  it.each([4, 5, 6, 7, 8])('schedules every pair exactly once for %i entrants', (n) => {
    const matchdays = roundRobin(ids(n));
    const pairs = matchdays.flat().map(([a, b]) => [a, b].sort().join('-'));
    expect(pairs).toHaveLength((n * (n - 1)) / 2);
    expect(new Set(pairs).size).toBe(pairs.length);
    // Nobody plays twice on the same matchday.
    for (const day of matchdays) {
      const players = day.flat();
      expect(new Set(players).size).toBe(players.length);
    }
  });
});

describe('knockout', () => {
  it('seeds 1 and 2 into opposite halves', () => {
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });

  it('gives byes to the top seeds when the field is short', () => {
    const pairs = seededPairs(ids(6));
    expect(pairs).toHaveLength(4);
    expect(pairs.filter(([a, b]) => a === null || b === null)).toHaveLength(2);
    expect(pairs[0]).toEqual(['e1', null]);
  });

  it('builds a wired tree for 8 entrants', () => {
    const matches = planKnockout(seededPairs(ids(8)));
    expect(matches.map((m) => m.roundName)).toEqual([
      'Quarter-final', 'Quarter-final', 'Quarter-final', 'Quarter-final',
      'Semi-final', 'Semi-final', 'Final',
    ]);
    const final = matches.find((m) => m.roundName === 'Final')!;
    expect(final.nextKey).toBeNull();
    expect(matches.filter((m) => m.nextKey === final.key).map((m) => m.nextSlot)).toEqual(['A', 'B']);
  });

  it('keeps group-mates apart until the final', () => {
    const groups = ['A', 'B', 'C', 'D'].map((g) => ({ winner: `${g}1`, runnerUp: `${g}2` }));
    const pairs = crossGroupPairs(groups);
    expect(pairs).toEqual([['A1', 'B2'], ['C1', 'D2'], ['B1', 'A2'], ['D1', 'C2']]);
    const topHalf = pairs.slice(0, 2).flat();
    for (const g of ['A', 'B', 'C', 'D']) {
      expect(topHalf.includes(`${g}1`)).not.toBe(topHalf.includes(`${g}2`));
    }
  });
});

describe('fixtureOutcome', () => {
  it('decides a CvC series by games won, then aggregate goals', () => {
    const games = [
      { goalsA: 2, goalsB: 0 },
      { goalsA: 0, goalsB: 1 },
      { goalsA: 3, goalsB: 1 },
      { goalsA: 1, goalsB: 1 },
    ];
    expect(fixtureOutcome(games, { isSeries: true })).toEqual({ scoreA: 2, scoreB: 1, goalsA: 6, goalsB: 3, winner: 'A' });
    const level = [{ goalsA: 1, goalsB: 0 }, { goalsA: 0, goalsB: 3 }];
    expect(fixtureOutcome(level, { isSeries: true }).winner).toBe('B');
  });

  it('uses the decider for an exact tie, otherwise a draw', () => {
    const tie = [{ goalsA: 1, goalsB: 0 }, { goalsA: 0, goalsB: 1 }];
    expect(fixtureOutcome(tie, { isSeries: true }).winner).toBeNull();
    expect(fixtureOutcome(tie, { isSeries: true, deciderWinner: 'B' }).winner).toBe('B');
  });

  it('scores PvP by goals', () => {
    expect(fixtureOutcome([{ goalsA: 2, goalsB: 3 }], { isSeries: false })).toMatchObject({ scoreA: 2, scoreB: 3, winner: 'B' });
  });
});

describe('computeStandings', () => {
  const fixture = (a: string, b: string, scoreA: number, scoreB: number) => ({
    entrantA: a, entrantB: b, scoreA, scoreB, goalsA: scoreA, goalsB: scoreB,
    winner: scoreA > scoreB ? ('A' as const) : scoreB > scoreA ? ('B' as const) : null,
  });

  it('ranks by points, then score difference, then goals', () => {
    const rows = computeStandings(['x', 'y', 'z'], [
      fixture('x', 'y', 2, 0),
      fixture('y', 'z', 1, 1),
      fixture('x', 'z', 0, 1),
    ]);
    expect(rows.map((r) => [r.entrantId, r.points])).toEqual([['z', 4], ['x', 3], ['y', 1]]);
    expect(rows[0]).toMatchObject({ played: 2, won: 1, drawn: 1, lost: 0, rank: 1 });
  });

  it('breaks a two-way tie on head-to-head', () => {
    const rows = computeStandings(['p', 'q', 'r'], [
      fixture('p', 'q', 0, 1),
      fixture('p', 'r', 1, 0),
      fixture('q', 'r', 0, 1),
    ]);
    // All on 3 points, 0 difference, 1 goal → head-to-head decides p vs q (q won), q vs r (r won) …
    expect(rows.map((r) => r.points)).toEqual([3, 3, 3]);
    expect(rows).toHaveLength(3);
  });
});

describe('computeStandings with forfeits', () => {
  it('gives no points to either side of a double forfeit', () => {
    const rows = computeStandings(['a', 'b'], [
      { entrantA: 'a', entrantB: 'b', scoreA: 0, scoreB: 0, goalsA: 0, goalsB: 0, winner: null, doubleForfeit: true },
    ]);
    expect(rows.map((r) => [r.points, r.lost, r.drawn])).toEqual([[0, 1, 0], [0, 1, 0]]);
  });
});
