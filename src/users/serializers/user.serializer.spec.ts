import { describe, expect, it } from 'vitest';
import type { User } from '../entities/user.entity.js';
import { serializeUser } from './user.serializer.js';

describe('serializeUser', () => {
  it('never exposes passwords, token versions, or two-factor secrets', () => {
    const user = {
      id: 'user-1',
      name: 'Staff',
      password: 'hash',
      tokenVersion: 4,
      twoFactorSecretEncrypted: 'iv.tag.ciphertext',
      twoFactorLastCounter: 123,
      twoFactorEnabledAt: new Date('2026-10-07T10:00:00Z'),
      authContext: { viewOnly: true, actorId: 'admin-1' },
    } as User;

    expect(serializeUser(user, true)).toEqual({
      id: 'user-1',
      name: 'Staff',
      twoFactorEnabledAt: new Date('2026-10-07T10:00:00Z'),
    });
  });
});
