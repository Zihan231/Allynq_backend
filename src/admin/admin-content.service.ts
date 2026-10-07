import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { BinEntityType } from '../recycle-bin/recycle-bin-item.entity.js';
import { RecycleBinService } from '../recycle-bin/recycle-bin.service.js';
import { AuditService } from './audit.service.js';
import type { Actor, ActionContext } from './admin-users.service.js';
import type { BinQueryDto, EntityListQueryDto } from './dto/admin.dto.js';

type ContentType = Exclude<BinEntityType, 'user'>;

/** Clubs, communities and tournaments for staff: lists, and moving them to / from the recycle bin. */
@Injectable()
export class AdminContentService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly bin: RecycleBinService,
    private readonly audit: AuditService,
  ) {}

  async list(type: ContentType, query: EntityListQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const params: unknown[] = [];
    const where = [`x."deletedAt" IS NULL`];
    if (query.search?.trim()) {
      params.push(`%${query.search.trim().toLowerCase()}%`);
      where.push(`LOWER(x.name) LIKE $1`);
    }
    const clause = where.join(' AND ');
    const sql = {
      club: {
        from: `FROM clubs x`,
        select: `x.id, x.name, x."dpUrl", x."createdAt", x.points,
                 (SELECT count(*)::int FROM efootball_profiles ep WHERE ep."clubId" = x.id) AS members,
                 (SELECT u.name FROM efootball_profiles ep JOIN users u ON u.id = ep."userId"
                   WHERE ep."clubId" = x.id AND ep."clubRole" = 'President' LIMIT 1) AS leader`,
      },
      community: {
        from: `FROM communities x`,
        select: `x.id, x.name, x."dpUrl", x."createdAt",
                 (SELECT count(*)::int FROM community_clubs cc WHERE cc."communityId" = x.id) AS clubs,
                 (SELECT u.name FROM users u WHERE u.id = x."creatorId") AS leader`,
      },
      tournament: {
        from: `FROM tournaments x`,
        select: `x.id, x.name, x."createdAt", x.status, x.type, x."startAt", x."endAt", x."communityId", x."hostClubId",
                 COALESCE((SELECT co.name FROM communities co WHERE co.id = x."communityId"),
                          (SELECT c.name FROM clubs c WHERE c.id = x."hostClubId")) AS host,
                 (SELECT count(*)::int FROM tournament_participants tp WHERE tp."tournamentId" = x.id) AS participants`,
      },
    }[type];
    const [{ total }] = await this.dataSource.query(`SELECT count(*)::int AS total ${sql.from} WHERE ${clause}`, params);
    const data = await this.dataSource.query(
      `SELECT ${sql.select} ${sql.from} WHERE ${clause} ORDER BY x."createdAt" DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      params,
    );
    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 } };
  }

  async moveToBin(actor: Actor, type: ContentType, id: string, reason: string, ctx: ActionContext = {}) {
    const item = await this.bin.moveToBin(type, id, actor.id, reason);
    await this.audit.record(actor, {
      action: 'bin.delete',
      targetType: type,
      targetId: id,
      targetName: item.name,
      after: { members: item.snapshot?.members?.length ?? 0 },
      reason,
      ip: ctx.ip,
    });
    return item;
  }

  binList(query: BinQueryDto) {
    return this.bin.list(query);
  }

  async restore(actor: Actor, type: BinEntityType, id: string, ctx: ActionContext = {}) {
    const result = await this.bin.restore(type, id);
    await this.audit.record(actor, {
      action: 'bin.restore',
      targetType: type,
      targetId: id,
      targetName: result.item.name,
      after: { reattached: result.reattached, skipped: result.skipped },
      ip: ctx.ip,
    });
    return { id, reattached: result.reattached, skipped: result.skipped };
  }

  async purge(actor: Actor, type: BinEntityType, id: string, ctx: ActionContext = {}) {
    let item;
    try {
      item = await this.bin.purge(type, id);
    } catch (error) {
      // 23503: still referenced (e.g. a user who created a community).
      if ((error as { code?: string }).code === '23503') {
        throw new BadRequestException('Other records still depend on this. Delete those first (e.g. a community this user created).');
      }
      throw error;
    }
    await this.audit.record(actor, { action: 'bin.purge', targetType: type, targetId: id, targetName: item.name, ip: ctx.ip });
    return { id, purged: true };
  }
}
