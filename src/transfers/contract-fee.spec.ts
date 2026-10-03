import { describe, expect, it } from 'vitest';
import { currentFee, daysLeft, decayingTk, formatContractNo, isLocked, lockEnd, paymentRef } from './contract-fee.js';

const DAY = 24 * 60 * 60 * 1000;
const start = new Date('2026-10-01T12:00:00Z');
const terms = (frozenTk: number) => ({ frozenTk, baseTk: 120, lockDays: 120, lockEndsAt: lockEnd(start, 120) });
const at = (days: number) => new Date(start.getTime() + days * DAY);

describe('transfer fee', () => {
  it('is frozen part + the fixed 120, which decays by day to 0 over the lock', () => {
    // The user's example: signed for 40 tk.
    expect(currentFee(terms(40), at(0))).toBe(160);
    expect(currentFee(terms(40), at(60))).toBe(100);
    expect(currentFee(terms(40), at(119))).toBe(41);
    expect(currentFee(terms(40), at(120))).toBe(40);
    expect(currentFee(terms(40), at(200))).toBe(40);
  });

  it('drops once per full day, not continuously', () => {
    expect(currentFee(terms(0), new Date(start.getTime() + 10 * 60 * 60 * 1000))).toBe(120);
    expect(currentFee(terms(0), new Date(start.getTime() + DAY + 1))).toBe(119);
  });

  it('keeps the frozen part whole: a buyout price becomes the next frozen part', () => {
    const price = currentFee(terms(40), at(110)); // 40 + 10
    expect(price).toBe(50);
    expect(currentFee({ ...terms(price), lockEndsAt: lockEnd(at(110), 120) }, at(110))).toBe(170);
  });

  it('knows when the lock is over', () => {
    expect(isLocked(lockEnd(start, 120), at(119))).toBe(true);
    expect(isLocked(lockEnd(start, 120), at(120))).toBe(false);
    expect(daysLeft(lockEnd(start, 120), at(120))).toBe(0);
    expect(decayingTk(terms(0), at(120))).toBe(0);
  });

  it('follows changed settings (fee and lock length are snapshots per contract)', () => {
    const t = { frozenTk: 0, baseTk: 200, lockDays: 100, lockEndsAt: lockEnd(start, 100) };
    expect(currentFee(t, at(0))).toBe(200);
    expect(currentFee(t, at(50))).toBe(100);
  });

  it('formats contract numbers and payment references', () => {
    expect(formatContractNo(123, start)).toBe('ALQ-2026-000123');
    expect(paymentRef(() => 0)).toBe('TRX-AAAAAAAAAA');
  });
});
