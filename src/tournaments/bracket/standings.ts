export interface CompletedFixture {
  entrantA: string;
  entrantB: string;
  scoreA: number;
  scoreB: number;
  goalsA: number;
  goalsB: number;
  winner: 'A' | 'B' | null;
}

export interface StandingRow {
  entrantId: string;
  rank: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  /** Games won/lost (CvC) or goals (PvP) — the fixture score. */
  scoreFor: number;
  scoreAgainst: number;
  scoreDiff: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
}

export const POINTS = { win: 3, draw: 1, loss: 0 } as const;

/**
 * Group table. Order: points → score difference (games for CvC, goals for
 * PvP) → goals scored → head-to-head (two-way ties) → entrant id (stable lots).
 */
export function computeStandings(
  entrantIds: readonly string[],
  fixtures: readonly CompletedFixture[],
): StandingRow[] {
  const rows = new Map<string, StandingRow>(
    entrantIds.map((id) => [
      id,
      { entrantId: id, rank: 0, played: 0, won: 0, drawn: 0, lost: 0, scoreFor: 0, scoreAgainst: 0, scoreDiff: 0, goalsFor: 0, goalsAgainst: 0, points: 0 },
    ]),
  );

  for (const f of fixtures) {
    const a = rows.get(f.entrantA);
    const b = rows.get(f.entrantB);
    if (!a || !b) continue;
    apply(a, f.scoreA, f.scoreB, f.goalsA, f.goalsB, f.winner === 'A' ? 'W' : f.winner === 'B' ? 'L' : 'D');
    apply(b, f.scoreB, f.scoreA, f.goalsB, f.goalsA, f.winner === 'B' ? 'W' : f.winner === 'A' ? 'L' : 'D');
  }

  const headToHead = (x: string, y: string) => {
    const game = fixtures.find(
      (f) => (f.entrantA === x && f.entrantB === y) || (f.entrantA === y && f.entrantB === x),
    );
    if (!game || !game.winner) return 0;
    const winnerId = game.winner === 'A' ? game.entrantA : game.entrantB;
    return winnerId === x ? -1 : 1;
  };

  const sorted = [...rows.values()].sort(
    (x, y) =>
      y.points - x.points ||
      y.scoreDiff - x.scoreDiff ||
      y.goalsFor - x.goalsFor ||
      headToHead(x.entrantId, y.entrantId) ||
      x.entrantId.localeCompare(y.entrantId),
  );
  sorted.forEach((row, index) => (row.rank = index + 1));
  return sorted;
}

function apply(
  row: StandingRow,
  scoreFor: number,
  scoreAgainst: number,
  goalsFor: number,
  goalsAgainst: number,
  result: 'W' | 'D' | 'L',
) {
  row.played++;
  row.scoreFor += scoreFor;
  row.scoreAgainst += scoreAgainst;
  row.scoreDiff = row.scoreFor - row.scoreAgainst;
  row.goalsFor += goalsFor;
  row.goalsAgainst += goalsAgainst;
  if (result === 'W') {
    row.won++;
    row.points += POINTS.win;
  } else if (result === 'D') {
    row.drawn++;
    row.points += POINTS.draw;
  } else {
    row.lost++;
  }
}
