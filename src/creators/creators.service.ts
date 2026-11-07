import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { DataSource, IsNull, Not } from 'typeorm';
import { AuditService } from '../admin/audit.service.js';
import { StoreItem, type DesignAssets, type StoreItemCategory, type StoreItemTarget } from '../admin/entities/store-item.entity.js';
import { hasSystemRole } from '../admin/system-role.guard.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { User } from '../users/entities/user.entity.js';
import { SystemRole } from '../users/enums/user-attributes.enum.js';
import { assetsFromFiles, assetUrls, removeDesignFiles, type CreatorCategory, type DesignFiles } from './creators-upload.js';

export const RARITIES = ['common', 'rare', 'epic', 'legendary', 'mythic'] as const;
export type Rarity = (typeof RARITIES)[number];

/**
 * Words that make a design read like a rank, an award or an official status. Badges and
 * titles that mean something are ALLYNQ's to give; a creator's design is artwork.
 */
export const RESERVED_NAME_WORDS = [
  'king', 'queen', 'champion', 'champ', 'mvp', 'legend', 'official', 'verified', 'staff', 'admin',
  'moderator', 'goat', 'winner', 'pro', 'best', 'top', 'number one', '#1', 'allynq', 'allync',
];

/** Refuses names that claim a rank or status (whole words, any case). */
export function assertNeutralName(name: string): void {
  const lower = ` ${name.toLowerCase().replace(/[^a-z0-9#]+/g, ' ')} `;
  const hit = RESERVED_NAME_WORDS.find((w) => lower.includes(` ${w} `));
  if (hit) {
    throw new BadRequestException(
      `"${hit}" can't be in a design's name: names can't claim a rank, award or official status. Describe the look instead (e.g. "Neon Wave", "Crimson Ember").`,
    );
  }
}

const TARGET: Record<CreatorCategory, StoreItemTarget> = {
  badge: 'player',
  frame: 'player',
  theme: 'player',
  sticker_pack: 'player',
  club_theme: 'club',
  tournament_banner: 'tournament',
};
const HEX = /^#[0-9a-fA-F]{6}$/;

export interface DesignInput {
  category?: CreatorCategory;
  name?: string;
  description?: string;
  priceTk?: number;
  rarity?: Rarity;
  primaryColor?: string;
  secondaryColor?: string;
  active?: boolean;
  /** A rejected design sent back to review without changes to its files. */
  resubmit?: boolean;
}

/**
 * Creator designs for the store: a creator (the "creative" role) uploads a design and sets
 * a price; staff approve it (and may adjust price and rarity) before it goes on sale. Price
 * changes and pausing take effect at once; a new design waits in `pendingAssets` while the
 * approved one keeps selling. Sales pay the creator minus the platform's cut (StoreService).
 */
@Injectable()
export class CreatorsService {
  private readonly logger = new Logger(CreatorsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  private assertCreator(user: User) {
    if (!(user.roles ?? []).includes('creative')) {
      throw new ForbiddenException('Add the Creative artist role in your profile to sell designs');
    }
  }

  private colors(input: DesignInput, category: StoreItemCategory, required: boolean): DesignAssets['colors'] | undefined {
    const themed = category === 'theme' || category === 'club_theme';
    if (!themed) return undefined;
    const { primaryColor: p, secondaryColor: s } = input;
    if (!p && !s && !required) return undefined;
    if (!p || !s || !HEX.test(p) || !HEX.test(s)) throw new BadRequestException('Pick two colours (like #e11d48)');
    return { primary: p.toLowerCase(), secondary: s.toLowerCase() };
  }

  private async own(user: User, id: string): Promise<StoreItem> {
    const item = await this.dataSource.getRepository(StoreItem).findOne({ where: { id } });
    if (!item || item.creatorUserId !== user.id) throw new NotFoundException('Design not found');
    return item;
  }

  private notify(userId: string, code: string, title: string, message: string) {
    return this.notifications
      .createNotification(userId, { title, message, type: 'system', link: '/dashboard/creator/designs', code, params: {} })
      .catch((err) => this.logger.error(`Creator notification failed: ${(err as Error).message}`));
  }

  /** Tells every staff member a design is waiting for review (a new design, or a change to a live one). */
  private async notifyStaff(creator: User, item: StoreItem, change: boolean) {
    try {
      const staff = await this.dataSource.getRepository(User).find({ where: { systemRole: Not(IsNull()) } });
      const title = change ? 'Design change waiting for review' : 'Design waiting for review';
      await Promise.all(
        staff.map((s) =>
          this.notifications
            .createNotification(s.id, {
              title,
              message: `${creator.name} sent "${item.name}" for review.`,
              type: 'system',
              link: '/dashboard/admin/creators',
              code: 'creator.designSubmitted',
              params: { name: item.name, creator: creator.name },
            })
            .catch((err) => this.logger.error(`Staff notification failed: ${(err as Error).message}`)),
        ),
      );
    } catch (err) {
      this.logger.error(`Staff notification failed: ${(err as Error).message}`);
    }
  }

  // ------------------------------------------------------------------ creator

  async create(user: User, input: DesignInput, files: DesignFiles) {
    try {
      this.assertCreator(user);
      const category = input.category;
      if (!category || !(category in TARGET)) throw new BadRequestException('Pick what kind of design this is');
      const name = (input.name ?? '').trim();
      if (name.length < 2 || name.length > 60) throw new BadRequestException('Give the design a name (2–60 characters)');
      assertNeutralName(name);
      if (input.priceTk == null || input.priceTk < 0) throw new BadRequestException('Set a price (0 for free)');
      const assets: DesignAssets = { ...assetsFromFiles(category, files), colors: this.colors(input, category, true) };
      const repo = this.dataSource.getRepository(StoreItem);
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'design';
      const saved = await repo.save(
        repo.create({
          sku: `cr-${slug}-${randomBytes(3).toString('hex')}`,
          name,
          description: input.description?.trim() || null,
          category,
          priceTk: input.priceTk,
          active: false,
          reviewStatus: 'pending',
          target: TARGET[category],
          assets,
          creatorUserId: user.id,
          version: 1,
          versions: [],
          metadata: { rarity: input.rarity ?? 'common' },
        }),
      );
      await this.notifyStaff(user, saved, false);
      return saved;
    } catch (err) {
      await removeDesignFiles(files);
      throw err;
    }
  }

  /**
   * Price, description and pausing apply at once (pausing only once approved). New files or
   * colours go to review as `pendingAssets`; until staff approve them the approved look sells.
   */
  async update(user: User, id: string, input: DesignInput, files: DesignFiles) {
    try {
      this.assertCreator(user);
      const item = await this.own(user, id);
      if (input.name !== undefined) {
        const name = input.name.trim();
        if (name.length < 2 || name.length > 60) throw new BadRequestException('Give the design a name (2–60 characters)');
        assertNeutralName(name);
        item.name = name;
      }
      if (input.description !== undefined) item.description = input.description.trim() || null;
      if (input.priceTk !== undefined) {
        if (input.priceTk < 0) throw new BadRequestException('The price can’t be negative');
        item.priceTk = input.priceTk;
      }
      if (input.rarity) item.metadata = { ...item.metadata, rarity: input.rarity };
      // Buyers count on a design staying available: creators can't pause or pull it.
      if (input.active !== undefined) throw new BadRequestException("Designs stay on sale once approved; they can't be paused");

      const fileAssets = assetsFromFiles(item.category, files, true);
      const colors = this.colors(input, item.category, false);
      const changesDesign = Object.keys(fileAssets).length > 0 || Boolean(colors);
      const wasLive = item.reviewStatus === 'approved';
      let sentToReview = false;
      if (changesDesign) {
        sentToReview = true;
        const base = item.reviewStatus === 'approved' ? { ...item.assets, ...item.pendingAssets } : { ...item.assets };
        const next: DesignAssets = { ...base, ...fileAssets, ...(colors ? { colors } : {}) };
        if (item.reviewStatus === 'approved') {
          await removeDesignFiles(assetUrls(item.pendingAssets).filter((u) => !assetUrls(item.assets).includes(u)));
          item.pendingAssets = next;
        } else {
          // Not on sale yet (pending or rejected): replace the design and (re)send it to review.
          await removeDesignFiles(assetUrls(item.assets).filter((u) => !assetUrls(next).includes(u)));
          item.assets = next;
          item.reviewStatus = 'pending';
          item.rejectReason = null;
        }
      } else if (item.reviewStatus === 'rejected' && input.resubmit) {
        item.reviewStatus = 'pending';
        item.rejectReason = null;
        sentToReview = true;
      }
      const saved = await this.dataSource.getRepository(StoreItem).save(item);
      if (sentToReview) await this.notifyStaff(user, saved, wasLive);
      return saved;
    } catch (err) {
      await removeDesignFiles(files);
      throw err;
    }
  }

  /** Only a design nobody owns can be removed; once sold it stays (owners keep using it). */
  async remove(user: User, id: string) {
    this.assertCreator(user);
    const item = await this.own(user, id);
    if (item.salesCount > 0) throw new BadRequestException("A design that has sold can't be removed: its owners keep using it");
    await this.dataSource.getRepository(StoreItem).delete({ id });
    await removeDesignFiles([...assetUrls(item.assets), ...assetUrls(item.pendingAssets)]);
    return { deleted: true };
  }

  async me(user: User) {
    const designs = await this.dataSource.getRepository(StoreItem).find({ where: { creatorUserId: user.id }, order: { createdAt: 'DESC' } });
    const [{ earned }] = await this.dataSource.query(
      `SELECT COALESCE(sum(t."amountTk"), 0)::int AS earned
         FROM wallet_transactions t JOIN wallets w ON w.id = t."walletId"
        WHERE w."ownerType" = 'user' AND w."ownerId" = $1 AND t.kind = 'sale'`,
      [user.id],
    );
    const { creatorCommissionPct } = await this.settings.transfers();
    return {
      designs,
      stats: {
        earnedTk: earned as number,
        sales: designs.reduce((n, d) => n + d.salesCount, 0),
        live: designs.filter((d) => d.reviewStatus === 'approved' && d.active).length,
        inReview: designs.filter((d) => d.reviewStatus === 'pending' || d.pendingAssets).length,
      },
      commissionPct: creatorCommissionPct,
    };
  }

  /** A creator's public page: their designs on sale. */
  async publicCreator(userId: string) {
    const user = await this.dataSource.getRepository(User).findOne({ where: { id: userId } });
    if (!user || user.deletedAt) throw new NotFoundException('Creator not found');
    const designs = await this.dataSource.getRepository(StoreItem).find({
      where: { creatorUserId: userId, reviewStatus: 'approved', active: true },
      order: { salesCount: 'DESC', createdAt: 'DESC' },
    });
    return {
      user: { id: user.id, name: user.name, dpUrl: user.dpUrl, coverUrl: user.coverUrl, joinedAt: user.createdAt },
      designs: designs.map(({ pendingAssets: _p, rejectReason: _r, revenueTk: _rev, ...d }) => d),
      sales: designs.reduce((n, d) => n + d.salesCount, 0),
    };
  }

  // -------------------------------------------------------------------- staff

  async adminList(status: 'pending' | 'approved' | 'rejected', page = 1, limit = 20) {
    const repo = this.dataSource.getRepository(StoreItem);
    const where =
      status === 'pending'
        ? [
            { creatorUserId: Not(IsNull()), reviewStatus: 'pending' as const },
            { creatorUserId: Not(IsNull()), pendingAssets: Not(IsNull()) },
          ]
        : { creatorUserId: Not(IsNull()), reviewStatus: status };
    const [rows, total] = await repo.findAndCount({ where, order: { updatedAt: 'ASC' }, skip: (page - 1) * limit, take: limit });
    const creators: Array<{ id: string; name: string }> = rows.length
      ? await this.dataSource.query(`SELECT id, name FROM users WHERE id = ANY($1)`, [[...new Set(rows.map((r) => r.creatorUserId))]])
      : [];
    const [counts] = await this.dataSource.query(
      `SELECT COUNT(CASE WHEN "reviewStatus" = 'pending' OR "pendingAssets" IS NOT NULL THEN 1 END)::int AS pending,
              COUNT(CASE WHEN "reviewStatus" = 'approved' THEN 1 END)::int AS approved,
              COUNT(CASE WHEN "reviewStatus" = 'rejected' THEN 1 END)::int AS rejected
         FROM store_items WHERE "creatorUserId" IS NOT NULL`,
    );
    return {
      data: rows.map((r) => ({ ...r, creator: creators.find((c) => c.id === r.creatorUserId) ?? null })),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 },
      counts,
    };
  }

  /**
   * Approve a new design (it goes on sale) or a design change (it replaces the live look),
   * or reject either with a reason. Changing price or rarity needs an admin.
   */
  async review(actor: User, id: string, dto: { approve: boolean; reason?: string; priceTk?: number; rarity?: Rarity }, ip: string | null) {
    const repo = this.dataSource.getRepository(StoreItem);
    const item = await repo.findOne({ where: { id, creatorUserId: Not(IsNull()) } });
    if (!item) throw new NotFoundException('Design not found');
    const isChange = item.reviewStatus === 'approved' && Boolean(item.pendingAssets);
    if (item.reviewStatus !== 'pending' && !isChange) throw new BadRequestException('Nothing to review on this design');
    if ((dto.priceTk !== undefined || dto.rarity) && !hasSystemRole(actor, SystemRole.ADMIN)) {
      throw new ForbiddenException('Only admins can change the price or rarity');
    }
    if (!dto.approve && !dto.reason?.trim()) throw new BadRequestException('Give a reason when rejecting');
    const before = { status: item.reviewStatus, priceTk: item.priceTk, rarity: item.metadata?.rarity };

    if (dto.approve) {
      if (isChange) {
        // The old look stays available, and owners who haven't chosen keep it until they update.
        if (item.assets) item.versions = [...(item.versions ?? []), { version: item.version, assets: item.assets, approvedAt: item.reviewedAt?.toISOString() ?? null }];
        await this.pinOwners(item.sku, item.version);
        item.assets = item.pendingAssets;
        item.pendingAssets = null;
        item.version += 1;
      } else {
        item.reviewStatus = 'approved';
        item.active = true;
      }
      if (dto.priceTk !== undefined) item.priceTk = dto.priceTk;
      if (dto.rarity) item.metadata = { ...item.metadata, rarity: dto.rarity };
      item.rejectReason = null;
    } else if (isChange) {
      await removeDesignFiles(assetUrls(item.pendingAssets).filter((u) => !assetUrls(item.assets).includes(u)));
      item.pendingAssets = null;
      item.rejectReason = dto.reason!.trim();
    } else {
      item.reviewStatus = 'rejected';
      item.rejectReason = dto.reason!.trim();
    }
    item.reviewedById = actor.id;
    item.reviewedAt = new Date();
    await repo.save(item);
    await this.audit.record(actor, {
      action: dto.approve ? 'creator.design.approve' : 'creator.design.reject',
      targetType: 'store_item',
      targetId: item.id,
      targetName: item.name,
      before,
      after: { status: item.reviewStatus, priceTk: item.priceTk, rarity: item.metadata?.rarity },
      reason: item.rejectReason,
      ip,
    });
    const adjusted = dto.approve && (before.priceTk !== item.priceTk || before.rarity !== item.metadata?.rarity);
    await this.notify(
      item.creatorUserId!,
      dto.approve ? 'creator.designApproved' : 'creator.designRejected',
      dto.approve ? (isChange ? 'Design update approved' : 'Design approved') : 'Design not approved',
      dto.approve
        ? `"${item.name}" is ${isChange ? 'updated' : 'on sale'} in the store${adjusted ? ` (price ${item.priceTk} tk, ${String(item.metadata?.rarity)})` : ''}.`
        : `"${item.name}" wasn't approved: ${item.rejectReason}`,
    );
    if (dto.approve && isChange) await this.notifyOwners(item);
    return item;
  }

  /**
   * Before a new look goes live: every owner who hasn't chosen a look (users, clubs, and
   * tournaments showing it as their banner) is pinned to the current one. Owners who chose
   * "latest" (stored as 0) follow the update.
   */
  private async pinOwners(sku: string, version: number) {
    const pin = JSON.stringify({ [sku]: version });
    await this.dataSource.query(
      `UPDATE users SET "designVersions" = JSON_MERGE_PATCH("designVersions", $2)
        WHERE JSON_CONTAINS("ownedCosmeticIds", JSON_QUOTE($1)) AND NOT JSON_CONTAINS_PATH("designVersions", 'one', CONCAT('$."', $1, '"'))`,
      [sku, pin],
    );
    await this.dataSource.query(
      `UPDATE clubs SET "designVersions" = JSON_MERGE_PATCH("designVersions", $2)
        WHERE JSON_CONTAINS("ownedThemeSkus", JSON_QUOTE($1)) AND NOT JSON_CONTAINS_PATH("designVersions", 'one', CONCAT('$."', $1, '"'))`,
      [sku, pin],
    );
    await this.dataSource.query(`UPDATE tournaments SET "bannerVersion" = $2 WHERE "bannerSku" = $1 AND "bannerVersion" IS NULL`, [sku, version]);
  }

  /** A new look was approved: owners keep their look until they choose to update. */
  private async notifyOwners(item: StoreItem) {
    const owners: Array<{ id: string }> =
      item.target === 'club'
        ? await this.dataSource.query(
            `SELECT p."userId" AS id FROM clubs c JOIN efootball_profiles p ON p."clubId" = c.id AND p."clubRole" IN ('President', 'General Secretary')
              WHERE c."ownedThemeSkus" ? $1 AND c."deletedAt" IS NULL`,
            [item.sku],
          )
        : await this.dataSource.query(`SELECT id FROM users WHERE JSON_CONTAINS("ownedCosmeticIds", JSON_QUOTE($1)) AND "deletedAt" IS NULL`, [item.sku]);
    for (const { id } of owners) {
      await this.notifications
        .createNotification(id, {
          title: 'New look available',
          message: `"${item.name}" has a new look. You keep yours until you choose to update it in the store.`,
          type: 'system',
          link: '/dashboard/efootball/store?owned=1',
          code: 'store.designUpdated',
          params: { name: item.name },
        })
        .catch((err) => this.logger.error(`Owner notification failed: ${(err as Error).message}`));
    }
  }
}
