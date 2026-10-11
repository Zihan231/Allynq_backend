import { describe, expect, it } from 'vitest';
import type { User } from '../entities/user.entity.js';
import { serializeUser, stripPrivateUsers } from './user.serializer.js';

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

describe('stripPrivateUsers', () => {
  const user = {
    id: 'u1',
    name: 'Rahim',
    dpUrl: 'x.png',
    email: 'rahim@example.com',
    phoneNumber: '+8801712345678',
    permanentAddress: 'Dhaka',
    documentDataUrl: 'data:image/png;base64,AAA',
    documentType: 'national_id',
    tokenVersion: 3,
    banReason: 'spam',
    twoFactorLastCounter: 1,
  };

  it('removes private fields from users nested anywhere', () => {
    const club = { id: 'c1', name: 'Club', createdAt: new Date('2026-01-01'), members: [{ id: 'p1', user }], creator: user };
    const out = stripPrivateUsers(club);
    for (const u of [out.members[0].user, out.creator] as Array<Record<string, unknown>>) {
      expect(u).toEqual({ id: 'u1', name: 'Rahim', dpUrl: 'x.png' });
    }
    expect(out.createdAt).toBeInstanceOf(Date);
    expect(out.name).toBe('Club');
  });

  it('leaves the input untouched and non-user objects alone', () => {
    const input = { team: { id: 't', name: 'A', facebookUrl: 'fb' }, user };
    stripPrivateUsers(input);
    expect(input.user.email).toBe('rahim@example.com');
    expect(stripPrivateUsers(input).team).toEqual({ id: 't', name: 'A', facebookUrl: 'fb' });
  });
});
