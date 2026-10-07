import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import { IsNull, MoreThan, Repository } from 'typeorm';
import { LoginEvent } from '../activity/entities/login-event.entity.js';
import { SecurityBan, type SecurityBanKind } from './security-ban.entity.js';

export interface SecurityClient {
  ip?: string | null;
  deviceId?: string | null;
}

@Injectable()
export class SecurityService {
  private readonly hashKey: string;

  constructor(
    @InjectRepository(SecurityBan)
    private readonly bans: Repository<SecurityBan>,
    @InjectRepository(LoginEvent)
    private readonly logins: Repository<LoginEvent>,
    config: ConfigService,
  ) {
    this.hashKey =
      config.get<string>('SECURITY_HASH_KEY') ??
      config.get<string>('JWT_SECRET') ??
      'allync-security-key';
  }

  hash(kind: SecurityBanKind, value: string): string {
    return createHmac('sha256', this.hashKey)
      .update(`${kind}:${this.normalize(kind, value)}`)
      .digest('hex');
  }

  describe(client: SecurityClient) {
    const ip = client.ip?.trim() || null;
    const deviceId = client.deviceId?.trim() || null;
    return {
      ip,
      deviceHash: deviceId ? this.hash('device', deviceId) : null,
      deviceHint: deviceId ? this.hint('device', deviceId) : null,
    };
  }

  async assertAllowed(client: SecurityClient): Promise<void> {
    const checks: Array<{ kind: SecurityBanKind; hash: string }> = [];
    if (client.ip?.trim())
      checks.push({ kind: 'ip', hash: this.hash('ip', client.ip) });
    if (client.deviceId?.trim())
      checks.push({
        kind: 'device',
        hash: this.hash('device', client.deviceId),
      });
    if (!checks.length) return;

    const now = new Date();
    for (const check of checks) {
      const ban = await this.bans.findOne({
        where: [
          {
            kind: check.kind,
            valueHash: check.hash,
            revokedAt: IsNull(),
            expiresAt: IsNull(),
          },
          {
            kind: check.kind,
            valueHash: check.hash,
            revokedAt: IsNull(),
            expiresAt: MoreThan(now),
          },
        ],
      });
      if (ban)
        throw new ForbiddenException(
          'This network or device is not allowed to use Allync.',
        );
    }
  }

  async list(page = 1, limit = 50) {
    const safePage = Number.isFinite(page) ? Math.max(Math.trunc(page), 1) : 1;
    const take = Number.isFinite(limit)
      ? Math.min(Math.max(Math.trunc(limit), 1), 200)
      : 50;
    const [data, total] = await this.bans.findAndCount({
      order: { createdAt: 'DESC' },
      skip: (safePage - 1) * take,
      take,
    });
    return {
      data,
      meta: {
        total,
        page: safePage,
        limit: take,
        totalPages: Math.ceil(total / take) || 1,
      },
    };
  }

  async create(input: {
    kind: SecurityBanKind;
    value: string;
    reason: string;
    expiresAt?: Date | null;
    actorId?: string | null;
  }): Promise<SecurityBan> {
    if (input.kind === 'ip' && isIP(this.normalize('ip', input.value)) === 0) {
      throw new BadRequestException('Enter a valid IPv4 or IPv6 address');
    }
    return this.createHashed({
      ...input,
      valueHash: this.hash(input.kind, input.value),
      valueHint: this.hint(input.kind, input.value),
    });
  }

  async createFromLogin(
    loginId: string,
    kind: SecurityBanKind,
    reason: string,
    expiresAt: Date | null,
    actorId: string,
  ): Promise<SecurityBan> {
    const login = await this.logins.findOne({ where: { id: loginId } });
    if (!login) throw new NotFoundException('Sign-in event not found');
    if (kind === 'ip') {
      if (!login.ip)
        throw new ConflictException(
          'That sign-in did not record an IP address',
        );
      return this.create({ kind, value: login.ip, reason, expiresAt, actorId });
    }
    if (!login.deviceHash)
      throw new ConflictException('That sign-in did not include a device id');
    return this.createHashed({
      kind,
      valueHash: login.deviceHash,
      valueHint: login.deviceHint ?? 'Device',
      reason,
      expiresAt,
      actorId,
    });
  }

  async revoke(id: string, actorId: string): Promise<SecurityBan> {
    const ban = await this.bans.findOne({ where: { id } });
    if (!ban) throw new NotFoundException('Security ban not found');
    if (!ban.revokedAt) {
      ban.revokedAt = new Date();
      ban.revokedById = actorId;
      await this.bans.save(ban);
    }
    return ban;
  }

  private async createHashed(input: {
    kind: SecurityBanKind;
    valueHash: string;
    valueHint: string;
    reason: string;
    expiresAt?: Date | null;
    actorId?: string | null;
  }): Promise<SecurityBan> {
    const existing = await this.bans.findOne({
      where: {
        kind: input.kind,
        valueHash: input.valueHash,
        revokedAt: IsNull(),
      },
    });
    if (
      existing &&
      (!existing.expiresAt || existing.expiresAt.getTime() > Date.now())
    ) {
      throw new ConflictException(`That ${input.kind} is already banned`);
    }
    const row = this.bans.create({
      kind: input.kind,
      valueHash: input.valueHash,
      valueHint: input.valueHint,
      reason: input.reason.trim(),
      createdById: input.actorId ?? null,
      expiresAt: input.expiresAt ?? null,
      revokedAt: null,
      revokedById: null,
    });
    return this.bans.save(row);
  }

  private normalize(kind: SecurityBanKind, value: string): string {
    const clean = value.trim().toLowerCase();
    return kind === 'ip' && clean.startsWith('::ffff:')
      ? clean.slice(7)
      : clean;
  }

  private hint(kind: SecurityBanKind, value: string): string {
    const clean = this.normalize(kind, value);
    if (kind === 'ip') {
      const ipv4 = clean.split('.');
      if (ipv4.length === 4) return `${ipv4[0]}.${ipv4[1]}.${ipv4[2]}.*`;
      const ipv6 = clean.split(':').filter(Boolean);
      return `${ipv6.slice(0, 3).join(':')}:…`;
    }
    return clean.length <= 12
      ? `${clean.slice(0, 3)}…`
      : `${clean.slice(0, 6)}…${clean.slice(-4)}`;
  }
}
