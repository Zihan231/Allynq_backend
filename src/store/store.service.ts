import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { StoreItem, type StoreItemCategory } from '../admin/entities/store-item.entity.js';
import { paymentRef } from '../transfers/contract-fee.js';
import { WalletsService } from '../transfers/wallets.service.js';
import { User } from '../users/entities/user.entity.js';

/** The user column that holds the equipped item of each category. */
const EQUIPPED_FIELD: Record<StoreItemCategory, 'equippedBadgeId' | 'equippedTitleId' | 'equippedFrameId' | 'equippedThemeId'> = {
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
  equipped: Record<StoreItemCategory, string | null>;
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
  ) {}

  /** The items on sale (hidden ones are left out). */
  catalog(): Promise<StoreItem[]> {
    return this.dataSource.getRepository(StoreItem).find({
      where: { active: true },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
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
      if (!item || !item.active) throw new NotFoundException('This item is not on sale');
      const user = await this.lockUser(em, userId);
      const owned = user.ownedCosmeticIds ?? [];
      if (owned.includes(item.sku)) throw new BadRequestException('You already own this item');

      await this.wallets.spend(em, { type: 'user', id: userId }, item.priceTk, {
        storeItemId: item.id,
        counterparty: `Store: ${item.name}`,
        reference: item.priceTk > 0 ? paymentRef() : null,
      });
      user.ownedCosmeticIds = [...owned, item.sku];
      if (equip) user[EQUIPPED_FIELD[item.category]] = item.sku;
      await em.getRepository(User).update(
        { id: userId },
        { ownedCosmeticIds: user.ownedCosmeticIds, ...(equip ? { [EQUIPPED_FIELD[item.category]]: item.sku } : {}) },
      );
      const wallet = await this.wallets.lock(em, { type: 'user', id: userId });
      return this.view(user, wallet.balanceTk);
    });
  }

  /** Equips an owned item, or clears the category when `sku` is null. */
  async equip(userId: string, category: StoreItemCategory, sku: string | null): Promise<MyStore> {
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
