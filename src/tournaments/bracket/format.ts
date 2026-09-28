/**
 * Tournament structure rules:
 * - at least 4 entrants;
 * - up to 8 entrants → single-elimination knockout;
 * - more than 8 → groups of 4–8 (single round-robin), top 2 of each group
 *   advance to a knockout of 2 × groups (4, 8, 16 …).
 */

export type TournamentFormat = 'knockout' | 'groups_knockout';

export const MIN_ENTRANTS = 4;
export const KNOCKOUT_ONLY_MAX = 8;
export const MIN_GROUP_SIZE = 4;
export const QUALIFIERS_PER_GROUP = 2;

export function chooseFormat(entrants: number): TournamentFormat {
  if (entrants < MIN_ENTRANTS) {
    throw new Error(`At least ${MIN_ENTRANTS} entrants are required`);
  }
  return entrants <= KNOCKOUT_ONLY_MAX ? 'knockout' : 'groups_knockout';
}

/**
 * Number of groups: the largest power of 2 that still leaves at least 4
 * entrants per group (12 → 2, 16 → 4, 20 → 4, 32 → 8). A power of 2 keeps the
 * knockout (2 qualifiers per group) a clean 4 / 8 / 16 bracket.
 */
export function groupCount(entrants: number): number {
  let groups = 1;
  while (entrants / (groups * 2) >= MIN_GROUP_SIZE) groups *= 2;
  return groups;
}

export function groupLabel(index: number): string {
  return String.fromCharCode(65 + index);
}

/** Fisher–Yates shuffle (pure: returns a new array). */
export function shuffle<T>(items: readonly T[], rng: () => number = Math.random): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Randomly draws entrants into `groups` groups whose sizes differ by at most 1. */
export function drawGroups<T>(entrants: readonly T[], groups: number, rng: () => number = Math.random): T[][] {
  const result: T[][] = Array.from({ length: groups }, () => []);
  shuffle(entrants, rng).forEach((entrant, index) => result[index % groups].push(entrant));
  return result;
}
