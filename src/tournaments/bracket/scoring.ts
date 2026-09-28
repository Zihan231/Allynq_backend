export interface GameScore {
  goalsA: number;
  goalsB: number;
}

export interface FixtureOutcome {
  /** Fixture score: games won (CvC series) or goals (PvP single game). */
  scoreA: number;
  scoreB: number;
  /** Aggregate goals across all games. */
  goalsA: number;
  goalsB: number;
  /** null = draw (only allowed in the group stage). */
  winner: 'A' | 'B' | null;
}

/**
 * Decides a fixture from its games. CvC fixtures are a series of 1v1 games:
 * more games won wins, then aggregate goals. PvP is a single game. A remaining
 * tie is settled by `deciderWinner` (knockout decider game), else it is a draw.
 */
export function fixtureOutcome(
  games: readonly GameScore[],
  options: { isSeries: boolean; deciderWinner?: 'A' | 'B' | null },
): FixtureOutcome {
  const goalsA = games.reduce((sum, g) => sum + g.goalsA, 0);
  const goalsB = games.reduce((sum, g) => sum + g.goalsB, 0);
  const scoreA = options.isSeries ? games.filter((g) => g.goalsA > g.goalsB).length : goalsA;
  const scoreB = options.isSeries ? games.filter((g) => g.goalsB > g.goalsA).length : goalsB;

  let winner: 'A' | 'B' | null = null;
  if (scoreA !== scoreB) winner = scoreA > scoreB ? 'A' : 'B';
  else if (goalsA !== goalsB) winner = goalsA > goalsB ? 'A' : 'B';
  else winner = options.deciderWinner ?? null;

  return { scoreA, scoreB, goalsA, goalsB, winner };
}
