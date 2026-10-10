import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type EntityManager } from 'typeorm';
import { FileStorageService } from '../common/services/file-storage.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { startContract } from '../transfers/contracts.js';
import { ClubRole } from '../users/enums/user-attributes.enum.js';
import { type BinEntityType, type BinMember, type BinSnapshot, RecycleBinItem } from './recycle-bin-item.entity.js';
import { JobMonitorService } from '../health/job-monitor.service.js';

const TABLE: Record<BinEntityType, string> = {
  user: 'users',
  club: 'clubs',
  community: 'communities',
  tournament: 'tournaments',
};
const DAY_MS = 24 * 60 * 60 * 1000;
const LEADER_ROLES: string[] = [ClubRole.PRESIDENT, ClubRole.GENERAL_SECRETARY];

export interface BinListQuery {
  type?: BinEntityType;
  search?: string;
  page?: number;
  limit?: number;
}

/**
 * Soft delete with restore. Deleting hides the item everywhere (clubs, communities and
 * tournaments through TypeORM's soft delete; binned users can no longer sign in). Members
 * are detached from a binned club or community and remembered, so a restore can bring them
 * back. Items are deleted for good after the retention period (admin setting).
 */
@Injectable()
export class RecycleBinService {
  private readonly logger = new Logger(RecycleBinService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly settings: SettingsService,
    private readonly fileStorage: FileStorageService,
    private readonly monitor: JobMonitorService,
  ) {}

  async moveToBin(type: BinEntityType, id: string, actorId: string | null, reason?: string | null): Promise<RecycleBinItem> {
    const { binRetentionDays } = await this.settings.admin();
    return this.dataSource.transaction(async (em) => {
      const table = TABLE[type];
      const [row] = await em.query(`SELECT id, name, "deletedAt" FROM "${table}" WHERE id = $1 FOR UPDATE`, [id]);
      if (!row) throw new NotFoundException(`${type} not found`);
      if (row.deletedAt) throw new BadRequestException(`This ${type} is already in the recycle bin`);

      let members: BinMember[] | undefined;
      if (type === 'club') {
        const [open] = await em.query(
          `SELECT count(*)::int AS n FROM transfer_offers
            WHERE status IN ('pending', 'scheduled') AND ("toClubId" = $1 OR "fromClubId" = $1)`,
          [id],
        );
        if (open.n > 0) {
          throw new BadRequestException('This club has open transfer offers. Cancel or finish them first.');
        }
        members = await em.query(
          `SELECT id AS "profileId", "userId", "clubRole" AS role, "teamId" FROM efootball_profiles WHERE "clubId" = $1`,
          [id],
        );
        await em.query(
          `UPDATE player_contracts SET status = 'ended', "endedAt" = now(), "endReason" = 'club_deleted'
            WHERE "clubId" = $1 AND status = 'active'`,
          [id],
        );
        await em.query(`UPDATE efootball_profiles SET "clubId" = NULL, "clubRole" = NULL, "teamId" = NULL WHERE "clubId" = $1`, [id]);
      } else if (type === 'community') {
        members = await em.query(
          `SELECT id AS "profileId", "userId", "communityRole" AS role FROM efootball_profiles WHERE "communityId" = $1`,
          [id],
        );
        await em.query(`UPDATE efootball_profiles SET "communityId" = NULL, "communityRole" = NULL WHERE "communityId" = $1`, [id]);
      }

      // A binned user is also signed out everywhere.
      const extra = type === 'user' ? `, "tokenVersion" = "tokenVersion" + 1` : '';
      await em.query(`UPDATE "${table}" SET "deletedAt" = now()${extra} WHERE id = $1`, [id]);

      const repo = em.getRepository(RecycleBinItem);
      await repo.delete({ entityType: type, entityId: id });
      const snapshot: BinSnapshot | null = members ? { members } : null;
      return repo.save(
        repo.create({
          entityType: type,
          entityId: id,
          name: String(row.name ?? '').slice(0, 255) || type,
          deletedById: actorId,
          reason: reason?.trim() || null,
          snapshot,
          purgeAfter: new Date(Date.now() + binRetentionDays * DAY_MS),
        }),
      );
    });
  }

  /** Brings an item back, re-attaching detached members who haven't joined somewhere else meanwhile. */
  async restore(type: BinEntityType, id: string): Promise<{ item: RecycleBinItem; reattached: number; skipped: number }> {
    return this.dataSource.transaction(async (em) => {
      const item = await em.getRepository(RecycleBinItem).findOne({ where: { entityType: type, entityId: id } });
      if (!item) throw new NotFoundException('Not in the recycle bin');
      await em.query(`UPDATE "${TABLE[type]}" SET "deletedAt" = NULL WHERE id = $1`, [id]);

      let reattached = 0;
      let skipped = 0;
      for (const member of item.snapshot?.members ?? []) {
        const ok = type === 'club' ? await this.reattachClubMember(em, id, member) : await this.reattachCommunityMember(em, id, member);
        if (ok) reattached++;
        else skipped++;
      }
      await em.getRepository(RecycleBinItem).delete({ id: item.id });
      return { item, reattached, skipped };
    });
  }

  /** Deletes for good: the row, everything that cascades from it, and its uploaded files. */
  async purge(type: BinEntityType, id: string): Promise<RecycleBinItem> {
    const item = await this.dataSource.getRepository(RecycleBinItem).findOne({ where: { entityType: type, entityId: id } });
    if (!item) throw new NotFoundException('Not in the recycle bin');
    const table = TABLE[type];
    const [row] = await this.dataSource.query(`SELECT * FROM "${table}" WHERE id = $1`, [id]);
    await this.dataSource.transaction(async (em) => {
      await em.query(`DELETE FROM "${table}" WHERE id = $1`, [id]);
      await em.getRepository(RecycleBinItem).delete({ id: item.id });
    });
    for (const url of [row?.dpUrl, row?.coverUrl, row?.documentDataUrl]) {
      if (typeof url === 'string' && url) await this.fileStorage.deleteFile(url).catch(() => false);
    }
    return item;
  }

  async find(type: BinEntityType, id: string): Promise<RecycleBinItem | null> {
    return this.dataSource.getRepository(RecycleBinItem).findOne({ where: { entityType: type, entityId: id } });
  }

  async list(query: BinListQuery) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const params: unknown[] = [];
    const where: string[] = [];
    if (query.type) {
      params.push(query.type);
      where.push(`b."entityType" = $${params.length}`);
    }
    if (query.search?.trim()) {
      params.push(`%${query.search.trim().toLowerCase()}%`);
      where.push(`LOWER(b.name) LIKE $${params.length}`);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [{ total }] = await this.dataSource.query(`SELECT count(*)::int AS total FROM recycle_bin b ${clause}`, params);
    const rows = await this.dataSource.query(
      `SELECT b.id, b."entityType", b."entityId", b.name, b.reason, b."deletedAt", b."purgeAfter",
              b."deletedById", u.name AS "deletedByName",
              COALESCE(jsonb_array_length(b.snapshot->'members'), 0)::int AS "memberCount"
         FROM recycle_bin b LEFT JOIN users u ON u.id = b."deletedById"
         ${clause}
        ORDER BY b."deletedAt" DESC
        LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      params,
    );
    return { data: rows, meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 } };
  }

  /** Hourly: deletes for good what has been in the bin longer than the retention period. */
  @Cron(CronExpression.EVERY_HOUR)
  async purgeExpired(): Promise<number> {
    return this.monitor.run('recycleBin.purge', () => this.purgeDue(), (n) => `${n} deleted for good`);
  }

  private async purgeDue(): Promise<number> {
    const due = await this.dataSource
      .getRepository(RecycleBinItem)
      .createQueryBuilder('b')
      .where('b."purgeAfter" <= now()')
      .limit(50)
      .getMany();
    let purged = 0;
    for (const item of due) {
      try {
        await this.purge(item.entityType, item.entityId);
        purged++;
      } catch (error) {
        this.logger.warn(`Purge of ${item.entityType} ${item.entityId} failed: ${(error as Error).message}`);
      }
    }
    return purged;
  }

  /** Only players still clubless and not under another contract come back; non-leaders get a fresh contract. */
  private async reattachClubMember(em: EntityManager, clubId: string, member: BinMember): Promise<boolean> {
    const [free] = await em.query(
      `SELECT ep.id FROM efootball_profiles ep
        WHERE ep.id = $1 AND ep."clubId" IS NULL
          AND NOT EXISTS (SELECT 1 FROM player_contracts c WHERE c."userId" = ep."userId" AND c.status = 'active')`,
      [member.profileId],
    );
    if (!free) return false;
    const [team] = member.teamId ? await em.query(`SELECT id FROM teams WHERE id = $1 AND "clubId" = $2`, [member.teamId, clubId]) : [];
    await em.query(`UPDATE efootball_profiles SET "clubId" = $2, "clubRole" = $3, "teamId" = $4 WHERE id = $1`, [
      member.profileId,
      clubId,
      member.role ?? ClubRole.PLAYER,
      team?.id ?? null,
    ]);
    if (!LEADER_ROLES.includes(member.role ?? '')) {
      await startContract(em, await this.settings.transfers(), { userId: member.userId, clubId });
    }
    return true;
  }

  private async reattachCommunityMember(em: EntityManager, communityId: string, member: BinMember): Promise<boolean> {
    const rows = await em.query(
      `UPDATE efootball_profiles SET "communityId" = $2, "communityRole" = $3
        WHERE id = $1 AND "communityId" IS NULL RETURNING id`,
      [member.profileId, communityId, member.role],
    );
    // For UPDATE … RETURNING, TypeORM's postgres driver returns [rows, affectedCount].
    const affected = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0].length : Array.isArray(rows) ? rows.length : 0;
    return affected > 0;
  }
}
