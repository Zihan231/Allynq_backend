import { HttpException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { describe, expect, it } from 'vitest';
import { LOCK_MINUTES, MAX_FAILED_CODES, TwoFactorService, totp } from './two-factor.service.js';

const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

/** A user row plus a repository fake that supports what TwoFactorService touches. */
function setup() {
  const user: Record<string, unknown> = {
    id: 'staff-1',
    email: 'staff@x.demo',
    systemRole: 'admin',
    tokenVersion: 0,
    twoFactorEnabledAt: new Date(),
    twoFactorLastCounter: null,
    twoFactorFailedAttempts: 0,
    twoFactorLockedUntil: null,
    twoFactorSecretEncrypted: null,
  };
  const users = {
    createQueryBuilder: () => {
      const qb = {
        addSelect: () => qb,
        where: () => qb,
        andWhere: () => qb,
        update: () => qb,
        set: (patch: Record<string, unknown>) => {
          qb.patch = patch;
          return qb;
        },
        patch: {} as Record<string, unknown>,
        getOne: async () => ({ ...user }),
        execute: async () => {
          Object.assign(user, qb.patch);
          return { affected: 1 };
        },
      };
      return qb;
    },
    query: async () => {
      user.twoFactorFailedAttempts = Number(user.twoFactorFailedAttempts) + 1;
      return [[{ twoFactorFailedAttempts: user.twoFactorFailedAttempts }], 1];
    },
    update: async (_id: string, patch: Record<string, unknown>) => Object.assign(user, patch),
  };
  const jwt = new JwtService({ secret: 'test-secret' });
  const config = { get: () => 'test-key' };
  const service = new TwoFactorService(users as never, jwt, config as never);
  // Store the secret the way setup() would.
  user.twoFactorSecretEncrypted = (service as unknown as { encrypt: (v: string) => string }).encrypt(SECRET);
  const token = () => service.begin(user as never).challengeToken;
  const wrong = () => (totp(SECRET) === '000000' ? '111111' : '000000');
  return { service, user, token, wrong };
}

describe('Staff two-step sign-in: wrong codes', () => {
  it('counts wrong codes and tells how many tries are left', async () => {
    const { service, user, token, wrong } = setup();
    await expect(service.verify(token(), wrong())).rejects.toThrow(`${MAX_FAILED_CODES - 1} tries left`);
    expect(user.twoFactorFailedAttempts).toBe(1);
  });

  it(`locks for ${LOCK_MINUTES} minutes after ${MAX_FAILED_CODES} wrong codes — even the right code is refused`, async () => {
    const { service, user, token, wrong } = setup();
    for (let i = 0; i < MAX_FAILED_CODES - 1; i++) await expect(service.verify(token(), wrong())).rejects.toBeInstanceOf(UnauthorizedException);
    const last = service.verify(token(), wrong());
    await expect(last).rejects.toBeInstanceOf(HttpException);
    await expect(last).rejects.toThrow('locked');
    expect(user.twoFactorLockedUntil).toBeInstanceOf(Date);
    await expect(service.verify(token(), totp(SECRET))).rejects.toThrow('locked');
  });

  it('a correct code clears the wrong-code count', async () => {
    const { service, user, token, wrong } = setup();
    await expect(service.verify(token(), wrong())).rejects.toThrow();
    await service.verify(token(), totp(SECRET));
    expect(user).toMatchObject({ twoFactorFailedAttempts: 0, twoFactorLockedUntil: null });
  });
});
