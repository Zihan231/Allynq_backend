import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { PLAYER_CATEGORIES, StoreItem, type PlayerItemCategory } from '../admin/entities/store-item.entity.js';
import { SettingsService } from '../settings/settings.service.js';
import { paymentRef } from '../transfers/contract-fee.js';
import { WalletsService } from '../transfers/wallets.service.js';
import { User } from '../users/entities/user.entity.js';

/** The user column that holds the equipped item of each category. */
const EQUIPPED_FIELD: Record<PlayerItemCategory, 'equippedBadgeId' | 'equippedTitleId' | 'equippedFrameId' | 'equippedThemeId'> = {
  badge: 'equippedBadgeId',
  title: 'equippedTitleId',
  frame: 'equippedFrameId',
  theme: 'equippedThemeId',
};

export interface MyStore {
  balanceTk: number;
  /** SKUs of every item the user owns. */
  owned: string[];
  /** Equipped SKU per category (null = none). */
  equipped: Record<PlayerItemCategory, string | null>;
}

/**
 * The cosmetics store: items (store_items, managed by staff) are bought with the user's
 * wallet and kept in `users.ownedCosmeticIds`; a user can equip only what they own,
 * one item per category. Profile edits can't change either (see UsersService).
 */
@Injectable()
export class StoreService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly wallets: WalletsService,
    private readonly settings: SettingsService,
  ) {}

  /** The items on sale: active, and creator designs only once approved (with their creator's name). */
  async catalog() {
    const items = await this.dataSource.getRepository(StoreItem).find({
      where: { active: true, reviewStatus: 'approved' },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
    const creatorIds = [...new Set(items.map((i) => i.creatorUserId).filter((id): id is string => Boolean(id)))];
    const creators: Array<{ id: string; name: string }> = creatorIds.length
      ? await this.dataSource.query(`SELECT id, name FROM users WHERE id = ANY($1)`, [creatorIds])
      : [];
    return items.map(({ pendingAssets: _p, rejectReason: _r, reviewedById: _rb, revenueTk: _rev, ...item }) => ({
      ...item,
      creator: item.creatorUserId ? (creators.find((c) => c.id === item.creatorUserId) ?? null) : null,
    }));
  }

  async mine(userId: string): Promise<MyStore> {
    const user = await this.dataSource.getRepository(User).findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const wallet = await this.dataSource.transaction((em) => this.wallets.lock(em, { type: 'user', id: userId }));
    return this.view(user, wallet.balanceTk);
  }

  /**
   * Buys an item: it must be on sale and not owned yet. A paid item is charged from the
   * wallet (with a ledger entry); a free one is simply added. The new item is equipped
   * unless `equip` is false.
   */
  async purchase(userId: string, sku: string, equip = true): Promise<MyStore> {
    return this.dataSource.transaction(async (em) => {
      const item = await em.getRepository(StoreItem).findOne({ where: { sku } });
      if (!item || !item.active || item.reviewStatus !== 'approved') throw new NotFoundException('This item is not on sale');
      if (item.target !== 'player') throw new BadRequestException('This item is for clubs or tournaments, not for your profile');
      if (item.creatorUserId === userId) throw new BadRequestException("You can't buy your own design");
      const user = await this.lockUser(em, userId);
      const owned = user.ownedCosmeticIds ?? [];
      if (owned.includes(item.sku)) throw new BadRequestException('You already own this item');

      await this.charge(em, { type: 'user', id: userId }, item);
      user.ownedCosmeticIds = [...owned, item.sku];
      const field = EQUIPPED_FIELD[item.category as PlayerItemCategory] as (typeof EQUIPPED_FIELD)[PlayerItemCategory] | undefined;
      const wear = equip && Boolean(field);
      if (wear) user[field!] = item.sku;
      await em.getRepository(User).update(
        { id: userId },
        { ownedCosmeticIds: user.ownedCosmeticIds, ...(wear ? { [field!]: item.sku } : {}) },
      );
      const wallet = await this.wallets.lock(em, { type: 'user', id: userId });
      return this.view(user, wallet.balanceTk);
    });
  }

  /** Equips an owned item, or clears the category when `sku` is null. */
  async equip(userId: string, category: PlayerItemCategory, sku: string | null): Promise<MyStore> {
    if (!PLAYER_CATEGORIES.includes(category)) throw new BadRequestException('Only profile items can be equipped here');
    return this.dataSource.transaction(async (em) => {
      const user = await this.lockUser(em, userId);
      if (sku !== null) {
        if (!(user.ownedCosmeticIds ?? []).includes(sku)) throw new BadRequestException("You don't own this item");
        // A staff item's category comes from the store; built-in ones share the same SKUs.
        const item = await em.getRepository(StoreItem).findOne({ where: { sku } });
        if (item && item.category !== category) throw new BadRequestException(`This item is a ${item.category}, not a ${category}`);
      }
      user[EQUIPPED_FIELD[category]] = sku;
      await em.getRepository(User).update({ id: userId }, { [EQUIPPED_FIELD[category]]: sku });
      const wallet = await this.wallets.lock(em, { type: 'user', id: userId });
      return this.view(user, wallet.balanceTk);
    });
  }

  /**
   * Charges the buyer for an item. ALLYNQ's own items are a plain purchase; a creator's
   * design pays the creator the price minus the platform's cut. Also counts the sale.
   */
  async charge(em: EntityManager, buyer: { type: 'user' | 'club'; id: string }, item: StoreItem): Promise<void> {
    const reference = item.priceTk > 0 ? paymentRef() : null;
    if (item.creatorUserId && item.priceTk > 0) {
      const { creatorCommissionPct } = await this.settings.transfers();
      const creator = await em.getRepository(User).findOne({ where: { id: item.creatorUserId } });
      await this.wallets.sale(em, buyer, { type: 'user', id: item.creatorUserId }, item.priceTk, Math.round((item.priceTk * creatorCommissionPct) / 100), {
        storeItemId: item.id,
        itemName: item.name,
        creatorName: creator?.name ?? 'Creator',
        reference,
      });
    } else {
      await this.wallets.spend(em, buyer, item.priceTk, { storeItemId: item.id, counterparty: `Store: ${item.name}`, reference });
    }
    await em.query(`UPDATE store_items SET "salesCount" = "salesCount" + 1, "revenueTk" = "revenueTk" + $2 WHERE id = $1`, [item.id, item.priceTk]);
  }

  private async lockUser(em: EntityManager, userId: string): Promise<User> {
    const user = await em
      .getRepository(User)
      .createQueryBuilder('u')
      .setLock('pessimistic_write')
      .where('u.id = :userId', { userId })
      .getOne();
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  private view(user: User, balanceTk: number): MyStore {
    return {
      balanceTk,
      owned: user.ownedCosmeticIds ?? [],
      equipped: {
        badge: user.equippedBadgeId,
        title: user.equippedTitleId,
        frame: user.equippedFrameId,
        theme: user.equippedThemeId,
      },
    };
  }
}
