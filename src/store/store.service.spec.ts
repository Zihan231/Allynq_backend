import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StoreItem } from '../admin/entities/store-item.entity.js';
import { DEFAULT_TRANSFER_SETTINGS } from '../settings/settings.service.js';
import { Wallet } from '../transfers/entities/wallet.entity.js';
import { WalletTransaction } from '../transfers/entities/wallet-transaction.entity.js';
import { makeDb } from '../transfers/test/in-memory-db.js';
import { WalletsService } from '../transfers/wallets.service.js';
import { User } from '../users/entities/user.entity.js';
import { StoreService } from './store.service.js';

describe('StoreService', () => {
  let db: ReturnType<typeof makeDb>;
  let store: StoreService;
  const user = () => db.table(User).find((u) => u.id === 'u-1')!;
  const wallet = () => db.table(Wallet).find((w) => w.ownerType === 'user' && w.ownerId === 'u-1')!;

  beforeEach(() => {
    db = makeDb();
    const settings = { transfers: vi.fn().mockResolvedValue(DEFAULT_TRANSFER_SETTINGS) };
    store = new StoreService(db.dataSource as never, new WalletsService(db.dataSource as never, settings as never));
    db.table(User).push({ id: 'u-1', name: 'Rakib', ownedCosmeticIds: null, equippedThemeId: null, equippedBadgeId: null });
    db.table(Wallet).push({ id: 'w-1', ownerType: 'user', ownerId: 'u-1', balanceTk: 700, heldTk: 0 });
    db.table(StoreItem).push(
      { id: 'i-free', sku: 'badge-rookie', name: 'Rookie', category: 'badge', priceTk: 0, active: true },
      { id: 'i-epic', sku: 'theme-crimson', name: 'Crimson', category: 'theme', priceTk: 500, active: true },
      { id: 'i-myth', sku: 'theme-nebula', name: 'Nebula', category: 'theme', priceTk: 2000, active: true },
      { id: 'i-hidden', sku: 'theme-old', name: 'Old', category: 'theme', priceTk: 10, active: false },
    );
  });

  it('charges the wallet, records the purchase and equips the new item', async () => {
    const me = await store.purchase('u-1', 'theme-crimson');

    expect(me).toMatchObject({ balanceTk: 200, owned: ['theme-crimson'], equipped: { theme: 'theme-crimson' } });
    expect(wallet().balanceTk).toBe(200);
    expect(user()).toMatchObject({ ownedCosmeticIds: ['theme-crimson'], equippedThemeId: 'theme-crimson' });
    expect(db.table(WalletTransaction)).toEqual([
      expect.objectContaining({ kind: 'purchase', amountTk: -500, storeItemId: 'i-epic', counterparty: 'Store: Crimson' }),
    ]);
  });

  it('gives free items without touching the wallet', async () => {
    await store.purchase('u-1', 'badge-rookie', false);
    expect(wallet().balanceTk).toBe(700);
    expect(user()).toMatchObject({ ownedCosmeticIds: ['badge-rookie'], equippedBadgeId: null });
  });

  it('refuses to buy without enough money, twice, or items not on sale', async () => {
    await expect(store.purchase('u-1', 'theme-nebula')).rejects.toThrow(/Not enough money/);
    expect(user().ownedCosmeticIds).toBeNull();
    await store.purchase('u-1', 'theme-crimson');
    await expect(store.purchase('u-1', 'theme-crimson')).rejects.toThrow('You already own this item');
    await expect(store.purchase('u-1', 'theme-old')).rejects.toThrow('not on sale');
    await expect(store.purchase('u-1', 'no-such-sku')).rejects.toThrow('not on sale');
  });

  it('switches only between owned items, and can take a category off', async () => {
    await expect(store.equip('u-1', 'theme', 'theme-crimson')).rejects.toThrow("You don't own this item");
    await store.purchase('u-1', 'theme-crimson', false);
    await store.purchase('u-1', 'badge-rookie', false);

    await expect(store.equip('u-1', 'theme', 'badge-rookie')).rejects.toThrow('is a badge, not a theme');
    expect((await store.equip('u-1', 'theme', 'theme-crimson')).equipped.theme).toBe('theme-crimson');
    expect((await store.equip('u-1', 'theme', null)).equipped.theme).toBeNull();
    expect(user().equippedThemeId).toBeNull();
  });
});
