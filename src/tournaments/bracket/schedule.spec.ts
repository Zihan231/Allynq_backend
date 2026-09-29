import { describe, expect, it } from 'vitest';
import {
  assignRange,
  candidateStarts,
  DEFAULT_PLAY_HOURS,
  firstPlayableDay,
  formatRange,
  localDayStart,
  normalizePlayHours,
  overlapsNightBlock,
  playHoursError,
  rangeFrom,
} from './schedule.js';

/** Build a UTC Date from a Dhaka local time. */
const dhaka = (iso: string) => new Date(`${iso}+06:00`);

describe('play hours', () => {
  it('normalizes windows that run past midnight', () => {
    expect(normalizePlayHours(19 * 60, 60)).toEqual({ start: 1140, end: 1500 });
    expect(normalizePlayHours(null, null)).toEqual(DEFAULT_PLAY_HOURS);
  });

  it.each([
    [17 * 60, 23 * 60, null],
    [19 * 60, 60, null],
    [7 * 60, 10 * 60, null],
    [17 * 60, 19 * 60, 'Daily play hours must be at least 3 hours long'],
    [22 * 60, 2 * 60, 'Daily play hours cannot include 1am–7am'],
    [5 * 60, 9 * 60, 'Daily play hours cannot include 1am–7am'],
  ])('%i–%i → %s', (start, end, error) => {
    expect(playHoursError(normalizePlayHours(start, end))).toBe(error);
  });
});

describe('localDayStart', () => {
  it('uses the Dhaka calendar day', () => {
    // 00:30 in Dhaka on 5 Sep is still 4 Sep in UTC.
    expect(new Date(localDayStart(dhaka('2026-09-05T00:30:00'))).toISOString()).toBe('2026-09-04T18:00:00.000Z');
  });
});

describe('candidate ranges', () => {
  const day = localDayStart(dhaka('2026-09-05T12:00:00'));

  it('offers every 30-minute start where a full 3h range fits', () => {
    const starts = candidateStarts(day, { start: 17 * 60, end: 23 * 60 }).map((s) => new Date(s).toISOString());
    expect(starts[0]).toBe(dhaka('2026-09-05T17:00:00').toISOString());
    expect(starts.at(-1)).toBe(dhaka('2026-09-05T20:00:00').toISOString());
    expect(starts).toHaveLength(7);
  });

  it('never produces a range touching 1am–7am', () => {
    for (const start of candidateStarts(day, DEFAULT_PLAY_HOURS)) {
      expect(overlapsNightBlock(new Date(start))).toBe(false);
    }
    expect(overlapsNightBlock(dhaka('2026-09-05T23:00:00'))).toBe(true);
  });
});

describe('firstPlayableDay + assignRange', () => {
  const hours = { start: 17 * 60, end: 20 * 60 };

  it('moves to the next day when today has no range left', () => {
    const earliest = dhaka('2026-09-05T18:00:00');
    const day = firstPlayableDay(earliest, hours);
    expect(new Date(day).toISOString()).toBe(new Date(localDayStart(dhaka('2026-09-06T12:00:00'))).toISOString());
    const range = assignRange(day, hours, () => 0, earliest);
    expect(range.start.toISOString()).toBe(dhaka('2026-09-06T17:00:00').toISOString());
  });

  it('respects notBefore on the same day', () => {
    const wide = { start: 9 * 60, end: 23 * 60 };
    const earliest = dhaka('2026-09-05T15:10:00');
    const range = assignRange(firstPlayableDay(earliest, wide), wide, () => 0, earliest);
    expect(range.start.toISOString()).toBe(dhaka('2026-09-05T15:30:00').toISOString());
  });

  it('sets a 3h range with evidence due 30 min after it ends', () => {
    const range = rangeFrom(dhaka('2026-09-05T17:00:00'));
    expect(range.end.toISOString()).toBe(dhaka('2026-09-05T20:00:00').toISOString());
    expect(range.evidenceDeadline.toISOString()).toBe(dhaka('2026-09-05T20:30:00').toISOString());
    expect(formatRange(range)).toBe('Sat 5 Sept, 5:00 PM – 8:00 PM');
  });
});
