import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { StoreItem } from '../admin/entities/store-item.entity.js';
import { Club } from '../clubs/entities/club.entity.js';
import { Tournament } from '../tournaments/entities/tournament.entity.js';
import { EfootballProfile } from '../users/entities/efootball-profile.entity.js';
import { DEFAULT_TRANSFER_SETTINGS } from '../settings/settings.service.js';
import { StoreService } from '../store/store.service.js';
import { PLATFORM_WALLET_ID, Wallet } from '../transfers/entities/wallet.entity.js';
import { WalletTransaction } from '../transfers/entities/wallet-transaction.entity.js';
import { makeDb } from '../transfers/test/in-memory-db.js';
import { WalletsService } from '../transfers/wallets.service.js';
import { User } from '../users/entities/user.entity.js';
import { assetsFromFiles } from './creators-upload.js';
import { assertNeutralName, CreatorsService } from './creators.service.js';

vi.mock('./creators-upload.js', async (orig) => ({
  ...(await orig<typeof import('./creators-upload.js')>()),
  // Nothing is written to disk in tests.
  removeDesignFiles: vi.fn().mockResolvedValue(undefined),
}));

const file = (name: string, size = 1000, mimetype = 'image/png') => ({ filename: name, size, mimetype }) as Express.Multer.File;
const CUT = DEFAULT_TRANSFER_SETTINGS.creatorCommissionPct;

describe('design names', () => {
  it('may not claim a rank, award or official status', () => {
    for (const name of ['King Badge', 'MVP frame', 'Official Theme', 'the GOAT', 'Champion aura', 'Allynq Gold']) {
      expect(() => assertNeutralName(name), name).toThrow(/can't be in a design's name/);
    }
    for (const name of ['Neon Wave', 'Crimson Ember', 'Kingfisher Blue', 'Proton Pulse']) {
      expect(() => assertNeutralName(name), name).not.toThrow();
    }
  });
});

describe('design files', () => {
  it('each kind takes its own files, within its limits', () => {
    expect(assetsFromFiles('badge', { image: [file('b.png')] })).toEqual({ imageUrl: '/uploads/creators/b.png' });
    expect(() => assetsFromFiles('badge', {})).toThrow(/Upload the badge image/);
    expect(() => assetsFromFiles('badge', { image: [file('b.png', 2 * 1024 * 1024)] })).toThrow(/1024 KB or smaller/);
    expect(() => assetsFromFiles('frame', { frame: [file('f.jpg', 1000, 'image/jpeg')] })).toThrow(/transparent PNG/);
    expect(() => assetsFromFiles('theme', { image: [file('x.png')], banner: [file('t.png')] })).toThrow(/doesn't take a image/);
    expect(() => assetsFromFiles('sticker_pack', { stickers: [file('1.png'), file('2.png')] })).toThrow(/4 to 12 stickers/);
    expect(assetsFromFiles('sticker_pack', { stickers: ['1', '2', '3', '4'].map((n) => file(`${n}.png`)) }).stickers).toHaveLength(4);
  });
});

describe('CreatorsService + StoreService', () => {
  let db: ReturnType<typeof makeDb>;
  let creators: CreatorsService;
  let store: StoreService;
  const users = {
    creator: { id: 'u-creator', name: 'Mitu', roles: ['creative', 'player'], ownedCosmeticIds: null } as unknown as User,
    buyer: { id: 'u-buyer', name: 'Rakib', roles: ['player'], ownedCosmeticIds: null } as unknown as User,
    mod: { id: 'u-mod', name: 'Mod', roles: ['player'], systemRole: 'moderator' } as unknown as User,
    admin: { id: 'u-admin', name: 'Admin', roles: ['player'], systemRole: 'admin' } as unknown as User,
  };
  const wallet = (type: string, id: string) => db.table(Wallet).find((w) => w.ownerType === type && w.ownerId === id);
  const item = (id: string) => db.table(StoreItem).find((i) => i.id === id)!;

  beforeEach(() => {
    db = makeDb();
    const settings = { transfers: vi.fn().mockResolvedValue(DEFAULT_TRANSFER_SETTINGS) };
    const wallets = new WalletsService(db.dataSource as never, settings as never);
    // Only the buyer manages tournament t1.
    const tournaments = {
      assertCanManage: vi.fn(async (userId: string) => {
        if (userId !== 'u-buyer') throw new ForbiddenException('Only the organizer can change its banner');
      }),
    };
    store = new StoreService(db.dataSource as never, wallets, settings as never, tournaments as never);
    creators = new CreatorsService(
      db.dataSource as never,
      settings as never,
      { createNotification: vi.fn().mockResolvedValue({}) } as never,
      { record: vi.fn().mockResolvedValue(undefined) } as never,
    );
    Object.values(users).forEach((u) => db.table(User).push(u as never));
    db.table(Wallet).push({ id: 'w-buyer', ownerType: 'user', ownerId: 'u-buyer', balanceTk: 1000, heldTk: 0 });
  });

  const submitBadge = (priceTk = 200) =>
    creators.create(users.creator, { category: 'badge', name: 'Neon Wave', priceTk, rarity: 'rare' }, { image: [file('neon.png')] });

  it('only creators can submit; a new design waits for review and is not for sale', async () => {
    await expect(creators.create(users.buyer, { category: 'badge', name: 'Neon', priceTk: 10 }, { image: [file('x.png')] })).rejects.toThrow(
      /Creative artist role/,
    );
    const design = await submitBadge();
    expect(item(design.id)).toMatchObject({ reviewStatus: 'pending', active: false, target: 'player', creatorUserId: 'u-creator' });
    await expect(store.purchase('u-buyer', design.sku)).rejects.toThrow(/not on sale/);
  });

  it('a sale pays the creator the price minus the platform cut', async () => {
    const design = await submitBadge(200);
    await creators.review(users.mod, design.id, { approve: true }, null);
    await store.purchase('u-buyer', design.sku);

    const cut = Math.round((200 * CUT) / 100);
    expect(wallet('user', 'u-buyer')!.balanceTk).toBe(800);
    expect(wallet('user', 'u-creator')!.balanceTk).toBe(200 - cut);
    expect(wallet('platform', PLATFORM_WALLET_ID)!.balanceTk).toBe(cut);
    expect(db.table(WalletTransaction).map((t) => [t.kind, t.amountTk])).toEqual(
      expect.arrayContaining([
        ['purchase', -200],
        ['sale', 200 - cut],
        ['commission', cut],
      ]),
    );
    expect(item(design.id)).toMatchObject({ salesCount: 1, revenueTk: 200 });
  });

  it("creators can't buy their own design; free designs pay nobody", async () => {
    const paid = await submitBadge(100);
    await creators.review(users.mod, paid.id, { approve: true }, null);
    db.table(Wallet).push({ id: 'w-c', ownerType: 'user', ownerId: 'u-creator', balanceTk: 500, heldTk: 0 });
    await expect(store.purchase('u-creator', paid.sku)).rejects.toThrow(/your own design/);

    const free = await creators.create(users.creator, { category: 'badge', name: 'Free Wave', priceTk: 0 }, { image: [file('f.png')] });
    await creators.review(users.mod, free.id, { approve: true }, null);
    await store.purchase('u-buyer', free.sku);
    expect(wallet('user', 'u-buyer')!.balanceTk).toBe(1000);
    expect(wallet('user', 'u-creator')!.balanceTk).toBe(500);
  });

  it('a design change waits for review while the approved look keeps selling', async () => {
    const design = await submitBadge();
    await creators.review(users.mod, design.id, { approve: true }, null);
    await creators.update(users.creator, design.id, { priceTk: 250 }, { image: [file('neon-v2.png')] });
    expect(item(design.id)).toMatchObject({
      priceTk: 250,
      active: true,
      assets: { imageUrl: '/uploads/creators/neon.png' },
      pendingAssets: { imageUrl: '/uploads/creators/neon-v2.png' },
    });

    await creators.review(users.mod, design.id, { approve: false, reason: 'Too blurry' }, null);
    expect(item(design.id)).toMatchObject({ assets: { imageUrl: '/uploads/creators/neon.png' }, pendingAssets: null, active: true });

    await creators.update(users.creator, design.id, {}, { image: [file('neon-v3.png')] });
    await creators.review(users.mod, design.id, { approve: true }, null);
    expect(item(design.id)).toMatchObject({ assets: { imageUrl: '/uploads/creators/neon-v3.png' }, pendingAssets: null, version: 2 });
  });

  it('only admins can change price or rarity when approving; rejecting needs a reason', async () => {
    const design = await submitBadge(200);
    await expect(creators.review(users.mod, design.id, { approve: true, priceTk: 50 }, null)).rejects.toThrow(/Only admins/);
    await expect(creators.review(users.mod, design.id, { approve: false }, null)).rejects.toThrow(/reason/);
    await creators.review(users.admin, design.id, { approve: true, priceTk: 150, rarity: 'epic' }, null);
    expect(item(design.id)).toMatchObject({ priceTk: 150, metadata: { rarity: 'epic' }, reviewStatus: 'approved', active: true });
  });

  it("creators can't pause or remove a sold design, and a club theme is not a profile item", async () => {
    const design = await submitBadge();
    await creators.review(users.mod, design.id, { approve: true }, null);
    await expect(creators.update(users.creator, design.id, { active: false }, {})).rejects.toThrow(/can't be paused/);
    await store.purchase('u-buyer', design.sku);
    await expect(creators.remove(users.creator, design.id)).rejects.toThrow(/has sold can't be removed/);
    const unsold = await creators.create(users.creator, { category: 'badge', name: 'Quiet Wave', priceTk: 10 }, { image: [file('q.png')] });
    expect(await creators.remove(users.creator, unsold.id)).toEqual({ deleted: true });

    const club = await creators.create(
      users.creator,
      { category: 'club_theme', name: 'Night Stadium', priceTk: 300, primaryColor: '#112233', secondaryColor: '#ffcc00' },
      { banner: [file('stadium.png')] },
    );
    expect(item(club.id)).toMatchObject({ target: 'club', assets: { colors: { primary: '#112233', secondary: '#ffcc00' } } });
    await creators.review(users.mod, club.id, { approve: true }, null);
    await expect(store.purchase('u-buyer', club.sku)).rejects.toThrow(/clubs or tournaments/);
  });

  it('an approved new look keeps the old one: buyers stay on theirs until they choose', async () => {
    const design = await submitBadge();
    await creators.review(users.mod, design.id, { approve: true }, null);
    const bought = await store.purchase('u-buyer', design.sku);
    expect(bought.versions[design.sku]).toBe(1);

    await creators.update(users.creator, design.id, {}, { image: [file('neon-v2.png')] });
    await creators.review(users.mod, design.id, { approve: true }, null);
    expect(item(design.id)).toMatchObject({
      version: 2,
      assets: { imageUrl: '/uploads/creators/neon-v2.png' },
      versions: [{ version: 1, assets: { imageUrl: '/uploads/creators/neon.png' } }],
    });

    // Follow updates, go back to the old look; versions that don't exist are refused.
    expect((await store.setDesignVersion('u-buyer', design.sku, null)).versions[design.sku]).toBeUndefined();
    expect((await store.setDesignVersion('u-buyer', design.sku, 1)).versions[design.sku]).toBe(1);
    await expect(store.setDesignVersion('u-buyer', design.sku, 7)).rejects.toThrow(/no such version/);
    await expect(store.setDesignVersion('u-admin', design.sku, 1)).rejects.toThrow(/don't own/);

    // A later buyer gets the new look.
    db.table(Wallet).push({ id: 'w-a', ownerType: 'user', ownerId: 'u-admin', balanceTk: 500, heldTk: 0 });
    expect((await store.purchase('u-admin', design.sku)).versions[design.sku]).toBe(2);
  });

  it("club leaders buy club themes from the club wallet and switch them; others can't", async () => {
    db.table(Club).push({ id: 'c1', name: 'Dhaka Kings', ownedThemeSkus: [], equippedThemeSku: null, deletedAt: null } as never);
    db.table(Wallet).push({ id: 'w-c1', ownerType: 'club', ownerId: 'c1', balanceTk: 1000, heldTk: 0 });
    db.table(EfootballProfile).push({ id: 'p1', userId: 'u-buyer', clubId: 'c1', clubRole: 'President' } as never);
    db.table(EfootballProfile).push({ id: 'p2', userId: 'u-admin', clubId: 'c1', clubRole: 'Captain' } as never);
    const theme = await creators.create(
      users.creator,
      { category: 'club_theme', name: 'Night Stadium', priceTk: 300, primaryColor: '#112233', secondaryColor: '#ffcc00' },
      { banner: [file('stadium.png')] },
    );
    await creators.review(users.mod, theme.id, { approve: true }, null);

    await expect(store.purchaseForClub('u-admin', 'c1', theme.sku)).rejects.toThrow(/President or General Secretary/);
    const after = await store.purchaseForClub('u-buyer', 'c1', theme.sku);
    const cut = Math.round((300 * CUT) / 100);
    expect(after).toMatchObject({ balanceTk: 700, owned: [theme.sku], equipped: theme.sku });
    expect(wallet('user', 'u-buyer')!.balanceTk).toBe(1000);
    expect(wallet('user', 'u-creator')!.balanceTk).toBe(300 - cut);
    await expect(store.purchaseForClub('u-buyer', 'c1', theme.sku)).rejects.toThrow(/already owns/);

    expect(await store.setClubTheme('u-buyer', 'c1', null)).toMatchObject({ equipped: null });
    await expect(store.setClubTheme('u-buyer', 'c1', 'cr-not-owned')).rejects.toThrow(/doesn't own/);
    const badge = await submitBadge();
    await creators.review(users.mod, badge.id, { approve: true }, null);
    await expect(store.purchaseForClub('u-buyer', 'c1', badge.sku)).rejects.toThrow(/Only club themes/);
  });

  it('organizers buy banners and put them on tournaments they manage', async () => {
    db.table(Tournament).push({ id: 't1', name: 'Winter Cup', bannerSku: null } as never);
    const banner = await creators.create(users.creator, { category: 'tournament_banner', name: 'Ice Arena', priceTk: 100 }, { banner: [file('ice.png')] });
    await creators.review(users.mod, banner.id, { approve: true }, null);

    const mine = await store.purchase('u-buyer', banner.sku, true, 't1');
    expect(mine.owned).toContain(banner.sku);
    expect(mine.equipped.theme).toBeFalsy();
    expect(db.table(Tournament)[0]).toMatchObject({ bannerSku: banner.sku });
    expect(wallet('user', 'u-buyer')!.balanceTk).toBe(900);

    await store.setTournamentBanner('u-buyer', 't1', null);
    expect(db.table(Tournament)[0]).toMatchObject({ bannerSku: null });
    await expect(store.setTournamentBanner('u-creator', 't1', banner.sku)).rejects.toThrow(/Only the organizer/);
    await expect(store.setTournamentBanner('u-buyer', 't1', 'cr-not-owned')).rejects.toThrow(/don't own/);
  });
});
