/** Pure transfer-fee maths (shared by the service and its tests). */

const DAY_MS = 24 * 60 * 60 * 1000;

export interface FeeTerms {
  frozenTk: number;
  baseTk: number;
  lockDays: number;
  lockEndsAt: Date;
}

/** Whole days left on the lock, counted up (so the fee drops once per full day). 0 once the lock is over. */
export function daysLeft(lockEndsAt: Date, now = new Date()): number {
  return Math.max(0, Math.ceil((lockEndsAt.getTime() - now.getTime()) / DAY_MS));
}

export function isLocked(lockEndsAt: Date, now = new Date()): boolean {
  return now.getTime() < lockEndsAt.getTime();
}

/** The fixed part still left: baseTk scaled by the share of the lock remaining. */
export function decayingTk(terms: FeeTerms, now = new Date()): number {
  if (terms.lockDays <= 0) return 0;
  return Math.round((terms.baseTk * Math.min(terms.lockDays, daysLeft(terms.lockEndsAt, now))) / terms.lockDays);
}

/** Transfer fee right now = frozen part + what's left of the fixed part. */
export function currentFee(terms: FeeTerms, now = new Date()): number {
  return terms.frozenTk + decayingTk(terms, now);
}

/** Lock end for a contract starting at `start`. */
export function lockEnd(start: Date, lockDays: number): Date {
  return new Date(start.getTime() + lockDays * DAY_MS);
}

/** e.g. ALQ-2026-000123 */
export function formatContractNo(sequence: number, at = new Date()): string {
  return `ALQ-${at.getFullYear()}-${String(sequence).padStart(6, '0')}`;
}

/** A demo payment transaction ID, e.g. TRX-8F3K2Q9ZLM. */
export function paymentRef(random: () => number = Math.random): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return `TRX-${Array.from({ length: 10 }, () => chars[Math.floor(random() * chars.length)]).join('')}`;
}
