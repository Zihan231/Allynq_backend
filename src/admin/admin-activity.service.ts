import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { ActivityFeedQueryDto, LoginFeedQueryDto } from '../reports/dto/report.dto.js';

/** Platform-wide activity timeline and sign-in history for staff. */
@Injectable()
export class AdminActivityService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async feed(query: ActivityFeedQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 30;
    const params: unknown[] = [];
    const p = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };
    const where: string[] = [];
    if (query.userId) where.push(`e."userId" = ${p(query.userId)}`);
    if (query.type) where.push(`e.type LIKE ${p(`${query.type}%`)}`);
    if (query.from) where.push(`e."createdAt" >= ${p(query.from)}`);
    if (query.to) where.push(`e."createdAt" <= ${p(query.to)}`);
    if (query.search?.trim()) {
      const q = p(`%${query.search.trim().toLowerCase()}%`);
      where.push(`(LOWER(u.name) LIKE ${q} OR LOWER(e.summary) LIKE ${q} OR e.ip LIKE ${q})`);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const from = `FROM activity_events e LEFT JOIN users u ON u.id = e."userId" ${clause}`;
    const [{ total }] = await this.dataSource.query(`SELECT count(*)::int AS total ${from}`, params);
    const data = await this.dataSource.query(
      `SELECT e.id, e."userId", u.name AS "userName", u."dpUrl" AS "userDpUrl", e.type, e.summary,
              e."targetType", e."targetId", e.meta, e.ip, e."createdAt",
              CASE e."targetType"
                WHEN 'club' THEN (SELECT name FROM clubs WHERE id = e."targetId")
                WHEN 'community' THEN (SELECT name FROM communities WHERE id = e."targetId")
                WHEN 'tournament' THEN (SELECT name FROM tournaments WHERE id = e."targetId")
                WHEN 'user' THEN (SELECT name FROM users WHERE id = e."targetId")
              END AS "targetName"
         ${from}
        ORDER BY e."createdAt" DESC
        LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      params,
    );
    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 } };
  }

  async logins(query: LoginFeedQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 30;
    const params: unknown[] = [];
    const p = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };
    const where: string[] = [];
    if (query.result === 'success') where.push('l.success');
    if (query.result === 'failed') where.push('NOT l.success');
    if (query.ip) where.push(`l.ip = ${p(query.ip)}`);
    if (query.from) where.push(`l."createdAt" >= ${p(query.from)}`);
    if (query.to) where.push(`l."createdAt" <= ${p(query.to)}`);
    if (query.search?.trim()) {
      const q = p(`%${query.search.trim().toLowerCase()}%`);
      where.push(`(LOWER(l.email) LIKE ${q} OR LOWER(u.name) LIKE ${q})`);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const from = `FROM login_events l LEFT JOIN users u ON u.id = l."userId" ${clause}`;
    const [{ total }] = await this.dataSource.query(`SELECT count(*)::int AS total ${from}`, params);
    const data = await this.dataSource.query(
      `SELECT l.id, l."userId", u.name AS "userName", l.email, l.success, l."failureReason", l.ip, l."userAgent", l."createdAt",
              (SELECT count(DISTINCT x."userId")::int FROM login_events x WHERE x.ip = l.ip AND x.success AND x."createdAt" > now() - interval '30 days') AS "accountsOnIp"
         ${from}
        ORDER BY l."createdAt" DESC
        LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      params,
    );
    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 } };
  }
}
