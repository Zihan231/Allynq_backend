import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { PLAYER_CATEGORIES, StoreItem, type PlayerItemCategory } from '../admin/entities/store-item.entity.js';
import { Club } from '../clubs/entities/club.entity.js';
import { SettingsService } from '../settings/settings.service.js';
import { Tournament } from '../tournaments/entities/tournament.entity.js';
import { TournamentsService } from '../tournaments/tournaments.service.js';
import { paymentRef } from '../transfers/contract-fee.js';
import { WalletsService } from '../transfers/wallets.service.js';
import { EfootballProfile } from '../users/entities/efootball-profile.entity.js';
import { User } from '../users/entities/user.entity.js';
import { ClubRole } from '../users/enums/user-attributes.enum.js';

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
  /** Creator designs' chosen looks: SKU → version (0 = follows the latest). */
  versions: Record<string, number>;
}

/** A club's side of the store (for its President / General Secretary). */
export interface ClubStore {
  clubId: string;
  /** The club wallet's balance: club themes are paid from it. */
  balanceTk: number;
  owned: string[];
  equipped: string | null;
  versions: Record<string, number>;
}

const CLUB_LEADERS: Array<string | null> = [ClubRole.PRESIDENT, ClubRole.GENERAL_SECRETARY];

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
    private readonly tournaments: TournamentsService,
  ) {}

  /**
   * The store's items with their looks: approved ones, with the creator's name. `onSale`
   * tells which can be bought; the rest are listed so their owners keep showing them.
   */
  async catalog() {
    const items = await this.dataSource.getRepository(StoreItem).find({
      where: { reviewStatus: 'approved' },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
    const creatorIds = [...new Set(items.map((i) => i.creatorUserId).filter((id): id is string => Boolean(id)))];
    const creators: Array<{ id: string; name: string }> = creatorIds.length
      ? await this.dataSource.query(`SELECT id, name FROM users WHERE id = ANY($1)`, [creatorIds])
      : [];
    return items.map(({ pendingAssets: _p, rejectReason: _r, reviewedById: _rb, revenueTk: _rev, ...item }) => ({
      ...item,
      onSale: item.active,
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
  async purchase(userId: string, sku: string, equip = true, tournamentId?: string): Promise<MyStore> {
    // Tournament banners are the organizer's too, but they go on tournaments, not the profile.
    const target = (await this.dataSource.getRepository(StoreItem).findOne({ where: { sku } }))?.target;
    if (target === 'tournament' || tournamentId) return this.purchaseBanner(userId, sku, tournamentId);
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
      user.designVersions = { ...user.designVersions, [item.sku]: item.version };
      const field = EQUIPPED_FIELD[item.category as PlayerItemCategory] as (typeof EQUIPPED_FIELD)[PlayerItemCategory] | undefined;
      const wear = equip && Boolean(field);
      if (wear) user[field!] = item.sku;
      await em.getRepository(User).update(
        { id: userId },
        { ownedCosmeticIds: user.ownedCosmeticIds, designVersions: user.designVersions, ...(wear ? { [field!]: item.sku } : {}) },
      );
      const wallet = await this.wallets.lock(em, { type: 'user', id: userId });
      return this.view(user, wallet.balanceTk);
    });
  }

  /** The item on sale for `target` (club themes for clubs, banners for tournaments). */
  private async onSale(em: EntityManager, sku: string, target: StoreItem['target'], buyerUserId: string): Promise<StoreItem> {
    const item = await em.getRepository(StoreItem).findOne({ where: { sku } });
    if (!item || !item.active || item.reviewStatus !== 'approved') throw new NotFoundException('This item is not on sale');
    if (item.target !== target) {
      throw new BadRequestException(target === 'club' ? 'Only club themes can be bought for a club' : 'Only tournament banners can be bought for a tournament');
    }
    if (item.creatorUserId === buyerUserId) throw new BadRequestException("You can't buy your own design");
    return item;
  }

  private async assertClubLeader(em: EntityManager, clubId: string, userId: string): Promise<void> {
    const profile = await em.getRepository(EfootballProfile).findOne({ where: { userId } });
    if (!profile || profile.clubId !== clubId || !CLUB_LEADERS.includes(profile.clubRole)) {
      throw new ForbiddenException("Only the club's President or General Secretary can change its theme");
    }
  }

  private async lockClub(em: EntityManager, clubId: string): Promise<Club> {
    const club = await em.getRepository(Club).createQueryBuilder('c').setLock('pessimistic_write').where('c.id = :id', { id: clubId }).getOne();
    if (!club || club.deletedAt) throw new NotFoundException('Club not found');
    return club;
  }

  private async clubView(em: EntityManager, club: Club): Promise<ClubStore> {
    const wallet = await this.wallets.lock(em, { type: 'club', id: club.id });
    return {
      clubId: club.id,
      balanceTk: wallet.balanceTk,
      owned: club.ownedThemeSkus ?? [],
      equipped: club.equippedThemeSku,
      versions: club.designVersions ?? {},
    };
  }

  /** A club's themes and wallet (leaders only). */
  async club(userId: string, clubId: string): Promise<ClubStore> {
    return this.dataSource.transaction(async (em) => {
      await this.assertClubLeader(em, clubId, userId);
      return this.clubView(em, await this.lockClub(em, clubId));
    });
  }

  /** A club leader buys a club theme from the club wallet; it goes on the club page unless `equip` is false. */
  async purchaseForClub(userId: string, clubId: string, sku: string, equip = true): Promise<ClubStore> {
    return this.dataSource.transaction(async (em) => {
      await this.assertClubLeader(em, clubId, userId);
      const item = await this.onSale(em, sku, 'club', userId);
      const club = await this.lockClub(em, clubId);
      const owned = club.ownedThemeSkus ?? [];
      if (owned.includes(item.sku)) throw new BadRequestException('The club already owns this theme');
      await this.charge(em, { type: 'club', id: clubId }, item);
      club.ownedThemeSkus = [...owned, item.sku];
      club.designVersions = { ...club.designVersions, [item.sku]: item.version };
      if (equip) club.equippedThemeSku = item.sku;
      await em.getRepository(Club).update(
        { id: clubId },
        { ownedThemeSkus: club.ownedThemeSkus, equippedThemeSku: club.equippedThemeSku, designVersions: club.designVersions },
      );
      return this.clubView(em, club);
    });
  }

  /** Puts one of the club's themes on its page, or (null) goes back to the plain page. */
  async setClubTheme(userId: string, clubId: string, sku: string | null): Promise<ClubStore> {
    return this.dataSource.transaction(async (em) => {
      await this.assertClubLeader(em, clubId, userId);
      const club = await this.lockClub(em, clubId);
      if (sku !== null && !(club.ownedThemeSkus ?? []).includes(sku)) throw new BadRequestException("The club doesn't own this theme");
      club.equippedThemeSku = sku;
      await em.getRepository(Club).update({ id: clubId }, { equippedThemeSku: sku });
      return this.clubView(em, club);
    });
  }

  /**
   * An organizer buys a tournament banner from their wallet. It's theirs to use on any
   * tournament they manage; with `tournamentId` it goes on that tournament straight away.
   */
  async purchaseBanner(userId: string, sku: string, tournamentId?: string): Promise<MyStore> {
    if (tournamentId) await this.assertCanManage(userId, tournamentId);
    return this.dataSource.transaction(async (em) => {
      const item = await this.onSale(em, sku, 'tournament', userId);
      const user = await this.lockUser(em, userId);
      const owned = user.ownedCosmeticIds ?? [];
      if (owned.includes(item.sku)) throw new BadRequestException('You already own this banner');
      await this.charge(em, { type: 'user', id: userId }, item);
      user.ownedCosmeticIds = [...owned, item.sku];
      user.designVersions = { ...user.designVersions, [item.sku]: item.version };
      await em.getRepository(User).update({ id: userId }, { ownedCosmeticIds: user.ownedCosmeticIds, designVersions: user.designVersions });
      if (tournamentId) await em.getRepository(Tournament).update({ id: tournamentId }, { bannerSku: item.sku, bannerVersion: item.version });
      const wallet = await this.wallets.lock(em, { type: 'user', id: userId });
      return this.view(user, wallet.balanceTk);
    });
  }

  /** Puts a banner the caller owns on a tournament they manage, or (null) takes it off. */
  async setTournamentBanner(userId: string, tournamentId: string, sku: string | null): Promise<{ tournamentId: string; bannerSku: string | null }> {
    await this.assertCanManage(userId, tournamentId);
    let bannerVersion: number | null = null;
    if (sku !== null) {
      const user = await this.dataSource.getRepository(User).findOne({ where: { id: userId } });
      if (!(user?.ownedCosmeticIds ?? []).includes(sku)) throw new BadRequestException("You don't own this banner");
      const item = await this.dataSource.getRepository(StoreItem).findOne({ where: { sku } });
      if (item?.target !== 'tournament') throw new BadRequestException('This item is not a tournament banner');
      bannerVersion = user?.designVersions?.[sku] ?? item.version;
    }
    await this.dataSource.getRepository(Tournament).update({ id: tournamentId }, { bannerSku: sku, bannerVersion });
    return { tournamentId, bannerSku: sku };
  }

  /**
   * Which look of a creator design an owner shows: an earlier version they had, or (null)
   * always the latest. For a club theme the club's leaders choose. A banner's choice also
   * applies to the general tournaments the user runs with it.
   */
  async setDesignVersion(userId: string, sku: string, version: number | null, clubId?: string): Promise<MyStore | ClubStore> {
    return this.dataSource.transaction(async (em) => {
      const item = await em.getRepository(StoreItem).findOne({ where: { sku } });
      if (!item || item.reviewStatus !== 'approved') throw new NotFoundException('Design not found');
      if (version !== null && version !== item.version && !(item.versions ?? []).some((v) => v.version === version)) {
        throw new BadRequestException('This design has no such version');
      }
      // null = follow the latest (stored as 0, so later new looks aren't pinned for this owner).
      const pick = (map: Record<string, number> | null | undefined) => ({ ...map, [sku]: version ?? 0 });

      if (clubId) {
        await this.assertClubLeader(em, clubId, userId);
        const club = await this.lockClub(em, clubId);
        if (!(club.ownedThemeSkus ?? []).includes(sku)) throw new BadRequestException("The club doesn't own this theme");
        club.designVersions = pick(club.designVersions);
        await em.getRepository(Club).update({ id: clubId }, { designVersions: club.designVersions });
        return this.clubView(em, club);
      }

      const user = await this.lockUser(em, userId);
      if (!(user.ownedCosmeticIds ?? []).includes(sku)) throw new BadRequestException("You don't own this design");
      user.designVersions = pick(user.designVersions);
      await em.getRepository(User).update({ id: userId }, { designVersions: user.designVersions });
      if (item.target === 'tournament') {
        await em.getRepository(Tournament).update({ bannerSku: sku, creatorId: userId }, { bannerVersion: version ?? 0 });
      }
      const wallet = await this.wallets.lock(em, { type: 'user', id: userId });
      return this.view(user, wallet.balanceTk);
    });
  }

  private async assertCanManage(userId: string, tournamentId: string): Promise<void> {
    const tournament = await this.dataSource.getRepository(Tournament).findOne({ where: { id: tournamentId }, relations: { community: true } });
    if (!tournament) throw new NotFoundException('Tournament not found');
    await this.tournaments.assertCanManage(userId, tournament, 'change its banner');
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
      versions: user.designVersions ?? {},
    };
  }
}
