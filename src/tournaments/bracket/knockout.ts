/** A knockout match planned before it is stored; later rounds start empty. */
export interface PlannedKnockoutMatch {
  key: string;
  round: number;
  roundName: string;
  matchNumber: number;
  entrantA: string | null;
  entrantB: string | null;
  /** Match the winner moves into, and which side of it. */
  nextKey: string | null;
  nextSlot: 'A' | 'B' | null;
  /** First-round match with only one entrant: they advance automatically. */
  isBye: boolean;
}

export function roundName(entrantsInRound: number): string {
  if (entrantsInRound <= 2) return 'Final';
  if (entrantsInRound === 4) return 'Semi-final';
  if (entrantsInRound === 8) return 'Quarter-final';
  return `Round of ${entrantsInRound}`;
}

/** Smallest power of 2 that fits `entrants` (at least 2). */
export function bracketSize(entrants: number): number {
  let size = 2;
  while (size < entrants) size *= 2;
  return size;
}

/**
 * Standard seeding order for a bracket of `size`: seed 1 meets the lowest
 * seed, and seeds 1 and 2 can only meet in the final (size 8 → 1,8,4,5,2,7,3,6).
 */
export function seedOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const total = order.length * 2 + 1;
    order = order.flatMap((seed) => [seed, total - seed]);
  }
  return order;
}

/** First-round pairings for seeded entrants; missing seeds are byes (null). */
export function seededPairs(seededEntrants: readonly string[]): Array<[string | null, string | null]> {
  const size = bracketSize(seededEntrants.length);
  const order = seedOrder(size);
  const pairs: Array<[string | null, string | null]> = [];
  for (let i = 0; i < size; i += 2) {
    pairs.push([seededEntrants[order[i] - 1] ?? null, seededEntrants[order[i + 1] - 1] ?? null]);
  }
  return pairs;
}

/**
 * Group-stage qualifiers → first-round pairings. Groups are paired (A+B, C+D …);
 * each winner meets the paired group's runner-up, and winners of paired groups
 * land in opposite halves, so group-mates can only meet again in the final.
 */
export function crossGroupPairs(
  groups: ReadonlyArray<{ winner: string; runnerUp: string }>,
): Array<[string, string]> {
  const topHalf: Array<[string, string]> = [];
  const bottomHalf: Array<[string, string]> = [];
  for (let i = 0; i < groups.length; i += 2) {
    const first = groups[i];
    const second = groups[i + 1] ?? groups[i];
    topHalf.push([first.winner, second.runnerUp]);
    bottomHalf.push([second.winner, first.runnerUp]);
  }
  return [...topHalf, ...bottomHalf];
}

/** Builds the full bracket tree from first-round pairings (length must be a power of 2). */
export function planKnockout(
  firstRound: ReadonlyArray<[string | null, string | null]>,
): PlannedKnockoutMatch[] {
  const matches: PlannedKnockoutMatch[] = [];
  let matchNumber = 1;
  let roundMatches = firstRound.length;
  let round = 1;

  const keyOf = (r: number, index: number) => `r${r}m${index + 1}`;

  while (roundMatches >= 1) {
    for (let i = 0; i < roundMatches; i++) {
      const isFinal = roundMatches === 1;
      const pair = round === 1 ? firstRound[i] : ([null, null] as const);
      matches.push({
        key: keyOf(round, i),
        round,
        roundName: roundName(roundMatches * 2),
        matchNumber: matchNumber++,
        entrantA: pair[0],
        entrantB: pair[1],
        nextKey: isFinal ? null : keyOf(round + 1, Math.floor(i / 2)),
        nextSlot: isFinal ? null : i % 2 === 0 ? 'A' : 'B',
        isBye: round === 1 && (pair[0] === null) !== (pair[1] === null),
      });
    }
    roundMatches /= 2;
    round++;
  }

  return matches;
}
