import { describe, expect, it } from 'vitest';
import { totp } from './two-factor.service.js';

describe('TOTP', () => {
  it('matches the RFC 6238 SHA-1 vector (truncated to six digits)', () => {
    // ASCII "12345678901234567890" in base32; RFC timestamp 59 seconds.
    expect(totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59_000)).toBe('287082');
  });

  it('changes every 30-second window', () => {
    const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    expect(totp(secret, 29_999)).not.toBe(totp(secret, 30_000));
  });
});
