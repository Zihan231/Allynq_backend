/**
 * Single round-robin schedule (circle method): every entrant meets every
 * other entrant exactly once. Returns matchdays; with an odd number of
 * entrants one entrant rests each matchday.
 */
export function roundRobin<T>(entrants: readonly T[]): Array<Array<[T, T]>> {
  const slots: Array<T | null> = [...entrants];
  if (slots.length % 2 === 1) slots.push(null);

  const count = slots.length;
  const matchdays: Array<Array<[T, T]>> = [];

  for (let day = 0; day < count - 1; day++) {
    const pairs: Array<[T, T]> = [];
    for (let i = 0; i < count / 2; i++) {
      const home = slots[i];
      const away = slots[count - 1 - i];
      if (home !== null && away !== null) {
        // Alternate sides so nobody is always listed first.
        pairs.push(day % 2 === 0 ? [home, away] : [away, home]);
      }
    }
    matchdays.push(pairs);
    // Keep the first slot fixed, rotate the rest clockwise.
    slots.splice(1, 0, slots.pop() as T | null);
  }

  return matchdays;
}
