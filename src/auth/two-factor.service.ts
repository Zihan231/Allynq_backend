import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity.js';

type ChallengeMode = 'enroll' | 'verify';
interface ChallengePayload {
  sub: string;
  purpose: 'staff-2fa';
  mode: ChallengeMode;
  tv: number;
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
/** Wrong codes allowed before two-step sign-in locks, and for how long. */
export const MAX_FAILED_CODES = 5;
export const LOCK_MINUTES = 15;

function base32Encode(input: Buffer): string {
  let bits = '';
  for (const byte of input) bits += byte.toString(2).padStart(8, '0');
  let output = '';
  for (let i = 0; i < bits.length; i += 5) {
    output += BASE32[Number.parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  }
  return output;
}

function base32Decode(input: string): Buffer {
  let bits = '';
  for (const char of input.replace(/=+$/u, '').toUpperCase()) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error('Invalid base32');
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8)
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export function totp(secret: string, at = Date.now()): string {
  const counter = Math.floor(at / 30_000);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', base32Decode(secret))
    .update(buffer)
    .digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return value.toString().padStart(6, '0');
}

@Injectable()
export class TwoFactorService {
  private readonly encryptionKey: Buffer;

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    const key =
      config.get<string>('TWO_FACTOR_ENCRYPTION_KEY') ??
      config.get<string>('JWT_SECRET') ??
      'allync-2fa-key';
    this.encryptionKey = createHash('sha256').update(key).digest();
  }

  begin(user: User) {
    const mode: ChallengeMode = user.twoFactorEnabledAt ? 'verify' : 'enroll';
    const challengeToken = this.jwt.sign(
      { sub: user.id, purpose: 'staff-2fa', mode, tv: user.tokenVersion ?? 0 },
      { expiresIn: '5m' },
    );
    return {
      requiresTwoFactor: true as const,
      setupRequired: mode === 'enroll',
      challengeToken,
      expiresInSeconds: 300,
    };
  }

  async setup(token: string) {
    const { user, payload } = await this.challenge(token);
    if (payload.mode !== 'enroll' || user.twoFactorEnabledAt) {
      throw new ConflictException('Two-step sign-in is already configured');
    }
    let secret: string;
    if (user.twoFactorSecretEncrypted)
      secret = this.decrypt(user.twoFactorSecretEncrypted);
    else {
      secret = base32Encode(randomBytes(20));
      await this.users.update(user.id, {
        twoFactorSecretEncrypted: this.encrypt(secret),
      });
    }
    const label = encodeURIComponent(`Allync:${user.email ?? user.id}`);
    const issuer = encodeURIComponent('Allync');
    return {
      secret,
      otpauthUri: `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`,
    };
  }

  async verify(token: string, code: string): Promise<User> {
    const { user, payload } = await this.challenge(token);
    if (!user.twoFactorSecretEncrypted) {
      throw new ConflictException(
        'Set up an authenticator before verifying the code',
      );
    }
    if (user.twoFactorLockedUntil && new Date(user.twoFactorLockedUntil).getTime() > Date.now()) {
      throw this.lockedError(new Date(user.twoFactorLockedUntil));
    }
    const secret = this.decrypt(user.twoFactorSecretEncrypted);
    const currentCounter = Math.floor(Date.now() / 30_000);
    const acceptedWindow = [-1, 0, 1].find((window) => {
      const expected = Buffer.from(totp(secret, Date.now() + window * 30_000));
      const actual = Buffer.from(code);
      return (
        expected.length === actual.length && timingSafeEqual(expected, actual)
      );
    });
    if (acceptedWindow === undefined) return this.recordWrongCode(user);
    const counter = currentCounter + acceptedWindow;
    if (
      user.twoFactorLastCounter !== null &&
      user.twoFactorLastCounter >= counter
    ) {
      throw new UnauthorizedException(
        'That authentication code was already used',
      );
    }
    const enabledAt =
      payload.mode === 'enroll' ? new Date() : user.twoFactorEnabledAt;
    const updated = await this.users
      .createQueryBuilder()
      .update(User)
      .set({
        twoFactorEnabledAt: enabledAt,
        twoFactorLastCounter: counter,
        twoFactorFailedAttempts: 0,
        twoFactorLockedUntil: null,
      })
      .where('id = :id', { id: user.id })
      .andWhere(
        '("twoFactorLastCounter" IS NULL OR "twoFactorLastCounter" < :counter)',
        { counter },
      )
      .execute();
    if (updated.affected !== 1) {
      throw new UnauthorizedException(
        'That authentication code was already used',
      );
    }
    user.twoFactorEnabledAt = enabledAt;
    user.twoFactorLastCounter = counter;
    return user;
  }

  /**
   * Counts a wrong code. At the limit the account's two-step sign-in locks for a while,
   * so a known password can't be paired with guessing codes. Always throws.
   */
  private async recordWrongCode(user: User): Promise<never> {
    // Incremented in SQL so parallel guesses can't each see the old count.
    // (For UPDATE … RETURNING the Postgres driver returns [rows, affectedCount].)
    const [rows] = (await this.users.query(
      `UPDATE users SET "twoFactorFailedAttempts" = "twoFactorFailedAttempts" + 1 WHERE id = $1 RETURNING "twoFactorFailedAttempts"`,
      [user.id],
    )) as [Array<{ twoFactorFailedAttempts: number }>, number];
    const attempts = rows[0]?.twoFactorFailedAttempts ?? MAX_FAILED_CODES;
    if (attempts >= MAX_FAILED_CODES) {
      const until = new Date(Date.now() + LOCK_MINUTES * 60_000);
      await this.users.update(user.id, { twoFactorFailedAttempts: 0, twoFactorLockedUntil: until });
      throw this.lockedError(until);
    }
    throw new UnauthorizedException(
      `That authentication code is invalid or expired. ${MAX_FAILED_CODES - attempts} tries left.`,
    );
  }

  private lockedError(until: Date): HttpException {
    const minutes = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60_000));
    return new HttpException(
      `Too many wrong codes. Two-step sign-in is locked for ${minutes} more minute${minutes === 1 ? '' : 's'}.`,
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private async challenge(
    token: string,
  ): Promise<{ user: User; payload: ChallengePayload }> {
    let payload: ChallengePayload;
    try {
      payload = await this.jwt.verifyAsync<ChallengePayload>(token);
    } catch {
      throw new UnauthorizedException(
        'The two-step sign-in request expired. Sign in again.',
      );
    }
    if (
      payload.purpose !== 'staff-2fa' ||
      !['enroll', 'verify'].includes(payload.mode)
    ) {
      throw new UnauthorizedException('Invalid two-step sign-in request');
    }
    const user = await this.users
      .createQueryBuilder('user')
      .addSelect('user.twoFactorSecretEncrypted')
      .where('user.id = :id', { id: payload.sub })
      .getOne();
    if (!user?.systemRole || user.tokenVersion !== payload.tv) {
      throw new UnauthorizedException('Invalid two-step sign-in request');
    }
    return { user, payload };
  }

  private encrypt(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const encrypted = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);
    return [iv, cipher.getAuthTag(), encrypted]
      .map((part) => part.toString('base64url'))
      .join('.');
  }

  private decrypt(value: string): string {
    const [iv, tag, encrypted] = value
      .split('.')
      .map((part) => Buffer.from(part, 'base64url'));
    if (!iv || !tag || !encrypted)
      throw new UnauthorizedException(
        'Two-step sign-in must be configured again',
      );
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new UnauthorizedException(
        'Two-step sign-in must be configured again',
      );
    }
  }
}
