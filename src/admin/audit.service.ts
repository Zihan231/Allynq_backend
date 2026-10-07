import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity.js';
import type { AuditQueryDto } from './dto/admin.dto.js';
import { AdminAuditLog } from './entities/admin-audit-log.entity.js';

export interface AuditEntry {
  action: string;
  targetType: string;
  targetId?: string | null;
  targetName?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  reason?: string | null;
  ip?: string | null;
}

/** The staff audit log: every admin action, append-only. */
@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AdminAuditLog)
    private readonly logs: Repository<AdminAuditLog>,
  ) {}

  async record(
    actor: Pick<User, 'id' | 'name' | 'systemRole'>,
    entry: AuditEntry,
  ): Promise<void> {
    await this.logs.save(
      this.logs.create({
        actorId: actor.id,
        actorName: actor.name,
        actorRole: actor.systemRole ?? 'none',
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId ?? null,
        targetName: entry.targetName?.slice(0, 255) ?? null,
        before: entry.before ?? null,
        after: entry.after ?? null,
        reason: entry.reason?.trim() || null,
        ip: entry.ip?.slice(0, 64) ?? null,
      }),
    );
  }

  async list(query: AuditQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const qb = this.logs.createQueryBuilder('l').orderBy('l.createdAt', 'DESC');
    if (query.actorId)
      qb.andWhere('l.actorId = :actorId', { actorId: query.actorId });
    if (query.targetId)
      qb.andWhere('l.targetId = :targetId', { targetId: query.targetId });
    if (query.targetType)
      qb.andWhere('l.targetType = :targetType', {
        targetType: query.targetType,
      });
    if (query.action)
      qb.andWhere('l.action LIKE :action', { action: `${query.action}%` });
    if (query.from) qb.andWhere('l.createdAt >= :from', { from: query.from });
    if (query.to) qb.andWhere('l.createdAt <= :to', { to: query.to });
    if (query.search?.trim()) {
      qb.andWhere(
        '(LOWER(l.actorName) LIKE :q OR LOWER(l.targetName) LIKE :q OR LOWER(l.reason) LIKE :q)',
        {
          q: `%${query.search.trim().toLowerCase()}%`,
        },
      );
    }
    const [data, total] = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 },
    };
  }
}
