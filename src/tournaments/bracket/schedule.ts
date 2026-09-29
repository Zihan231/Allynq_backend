/**
 * Match scheduling. Every 1v1 game gets a 3-hour playing range inside the
 * organizer's daily play hours, in Bangladesh time (UTC+6, no DST).
 *
 * Play hours are minutes after local midnight; the end may run past midnight
 * (e.g. 19:00–01:00 = 1140–1500). The system never auto-assigns anything that
 * touches the 01:00–07:00 night block (players may still request such times).
 */

export const MINUTE_MS = 60 * 1000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

export const DHAKA_OFFSET_MS = 6 * HOUR_MS;
export const RANGE_MS = 3 * HOUR_MS;
export const EVIDENCE_GRACE_MS = 30 * MINUTE_MS;
/** Auto-assigned games start at least this long after the tournament starts. */
export const FIRST_GAME_DELAY_MS = 3 * HOUR_MS;
export const SLOT_STEP_MINUTES = 30;

/** Night block 01:00–07:00 local, in minutes after midnight. */
export const NIGHT_START_MIN = 60;
export const NIGHT_END_MIN = 7 * 60;

export interface PlayHours {
  /** Minutes after local midnight (0–1439). */
  start: number;
  /** Minutes after local midnight; > 1440 when the window runs past midnight. */
  end: number;
}

export const DEFAULT_PLAY_HOURS: PlayHours = { start: 19 * 60, end: 25 * 60 };

export interface GameRange {
  start: Date;
  end: Date;
  evidenceDeadline: Date;
}

/** Stored start/end (0–1439 each) → a window whose end is after its start. */
export function normalizePlayHours(start?: number | null, end?: number | null): PlayHours {
  if (start == null || end == null) return DEFAULT_PLAY_HOURS;
  return { start, end: end <= start ? end + 1440 : end };
}

/** Why these play hours are invalid, or null when they are fine. */
export function playHoursError(hours: PlayHours): string | null {
  if (hours.end - hours.start < RANGE_MS / MINUTE_MS) {
    return 'Daily play hours must be at least 3 hours long';
  }
  // Must fit between 07:00 and 01:00 (next day) so it never touches the night block.
  if (hours.start < NIGHT_END_MIN || hours.end > NIGHT_START_MIN + 1440) {
    return 'Daily play hours cannot include 1am–7am';
  }
  return null;
}

/** UTC timestamp of local (Dhaka) midnight for the day containing `instant`. */
export function localDayStart(instant: Date | number): number {
  const t = typeof instant === 'number' ? instant : instant.getTime();
  return Math.floor((t + DHAKA_OFFSET_MS) / DAY_MS) * DAY_MS - DHAKA_OFFSET_MS;
}

/** Every allowed range start (UTC ms) on the local day starting at `dayStart`. */
export function candidateStarts(dayStart: number, hours: PlayHours, stepMinutes = SLOT_STEP_MINUTES): number[] {
  const starts: number[] = [];
  const lastStart = hours.end - RANGE_MS / MINUTE_MS;
  for (let minute = hours.start; minute <= lastStart; minute += stepMinutes) {
    starts.push(dayStart + minute * MINUTE_MS);
  }
  return starts;
}

/** First local day with at least one range starting at or after `earliest`. */
export function firstPlayableDay(earliest: Date, hours: PlayHours): number {
  let day = localDayStart(earliest);
  for (let i = 0; i < 400; i++) {
    if (candidateStarts(day, hours).some((start) => start >= earliest.getTime())) return day;
    day += DAY_MS;
  }
  throw new Error('No playable day found for these play hours');
}

export function rangeFrom(start: Date | number): GameRange {
  const startMs = typeof start === 'number' ? start : start.getTime();
  return {
    start: new Date(startMs),
    end: new Date(startMs + RANGE_MS),
    evidenceDeadline: new Date(startMs + RANGE_MS + EVIDENCE_GRACE_MS),
  };
}

/** A random 3h range on `dayStart` inside the play hours, not before `notBefore`. */
export function assignRange(
  dayStart: number,
  hours: PlayHours,
  rng: () => number = Math.random,
  notBefore?: Date,
): GameRange {
  const floor = notBefore?.getTime() ?? -Infinity;
  const options = candidateStarts(dayStart, hours).filter((start) => start >= floor);
  if (!options.length) throw new Error('No playable range left on this day');
  return rangeFrom(options[Math.floor(rng() * options.length)]);
}

/** True when a 3h range starting at `start` overlaps the 01:00–07:00 night block. */
export function overlapsNightBlock(start: Date): boolean {
  const day = localDayStart(start);
  const rangeStart = start.getTime();
  const rangeEnd = rangeStart + RANGE_MS;
  return [day - DAY_MS, day, day + DAY_MS].some((d) => {
    const nightStart = d + NIGHT_START_MIN * MINUTE_MS;
    const nightEnd = d + NIGHT_END_MIN * MINUTE_MS;
    return rangeStart < nightEnd && rangeEnd > nightStart;
  });
}

/** Local-time label for notifications, e.g. "Sat 5 Sep, 5:00 PM – 8:00 PM". */
export function formatRange(range: { start: Date; end: Date }): string {
  const date = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dhaka',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(range.start);
  const time = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Dhaka', hour: 'numeric', minute: '2-digit' });
  return `${date}, ${time.format(range.start)} – ${time.format(range.end)}`;
}
