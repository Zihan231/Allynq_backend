import { ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CoachPost } from '../coaching/entities/coach-post.entity.js';
import { DEFAULT_TRANSFER_SETTINGS } from '../settings/settings.service.js';
import { Tournament } from '../tournaments/entities/tournament.entity.js';
import { PLATFORM_WALLET_ID, Wallet } from '../transfers/entities/wallet.entity.js';
import { WalletTransaction } from '../transfers/entities/wallet-transaction.entity.js';
import { makeDb } from '../transfers/test/in-memory-db.js';
import { WalletsService } from '../transfers/wallets.service.js';
import { User } from '../users/entities/user.entity.js';
import { SponsorProfile, Sponsorship } from './entities/sponsor.entities.js';
import { SponsorsService } from './sponsors.service.js';

vi.mock('../coaching/coaching-upload.js', async (orig) => ({
  ...(await orig<typeof import('../coaching/coaching-upload.js')>()),
  removeCoachingFiles: vi.fn().mockResolvedValue(undefined),
}));

const CUT = DEFAULT_TRANSFER_SETTINGS.sponsorCommissionPct;

describe('SponsorsService', () => {
  let db: ReturnType<typeof makeDb>;
  let sponsors: SponsorsService;
  let notifications: { createNotification: ReturnType<typeof vi.fn> };
  /** The notifications sent with this code, as [user id, payload]. */
  const sent = (code: string) => notifications.createNotification.mock.calls.filter(([, n]) => n.code === code);
  const users = {
    brand: { id: 'u-brand', name: 'Rahim', roles: ['sponsor', 'player'] } as unknown as User,
    brand2: { id: 'u-brand2', name: 'Karim', roles: ['sponsor', 'player'] } as unknown as User,
    organizer: { id: 'u-org', name: 'Organizer', roles: ['organizer', 'player'] } as unknown as User,
    player: { id: 'u-player', name: 'Player', roles: ['player'] } as unknown as User,
  };
  const wallet = (id: string) => db.table(Wallet).find((w) => w.ownerType === 'user' && w.ownerId === id);
  const platform = () => db.table(Wallet).find((w) => w.ownerType === 'platform' && w.ownerId === PLATFORM_WALLET_ID);
  const deal = (id: string) => db.table(Sponsorship).find((d) => d.id === id)!;
  const offer = (amountTk = 1000, tier: 'title' | 'gold' | 'partner' = 'title') => ({ targetType: 'tournament' as const, targetId: 't1', tier, amountTk });

  beforeEach(() => {
    db = makeDb();
    const settings = { transfers: vi.fn().mockResolvedValue(DEFAULT_TRANSFER_SETTINGS) };
    // Only the organizer manages tournament t1 (a general tournament).
    const tournaments = {
      assertCanManage: vi.fn(async (userId: string) => {
        if (userId !== 'u-org') throw new ForbiddenException('Only the organizer can manage sponsors');
      }),
    };
    notifications = { createNotification: vi.fn().mockResolvedValue({}) };
    sponsors = new SponsorsService(
      db.dataSource as never,
      settings as never,
      new WalletsService(db.dataSource as never, settings as never),
      tournaments as never,
      notifications as never,
      { record: vi.fn().mockResolvedValue(undefined) } as never,
    );
    Object.values(users).forEach((u) => db.table(User).push(u as never));
    db.table(Tournament).push({ id: 't1', name: 'Winter Cup', creatorId: 'u-org', communityId: null, hostClubId: null, status: 'registration_open', deletedAt: null } as never);
    db.table(SponsorProfile).push({ userId: 'u-brand', brandName: 'Gamer Cola', logoUrl: '/l.png', verifiedAt: null } as never);
    db.table(SponsorProfile).push({ userId: 'u-brand2', brandName: 'Pixel Net', logoUrl: null, verifiedAt: null } as never);
    db.table(Wallet).push({ id: 'w-brand', ownerType: 'user', ownerId: 'u-brand', balanceTk: 5000, heldTk: 0 });
    db.table(Wallet).push({ id: 'w-brand2', ownerType: 'user', ownerId: 'u-brand2', balanceTk: 5000, heldTk: 0 });
  });

  it("a sponsor's request holds the money; the organizer accepting pays it out minus the cut", async () => {
    const d = await sponsors.create(users.brand, offer(1000));
    expect(wallet('u-brand')).toMatchObject({ balanceTk: 4000, heldTk: 1000 });
    expect(deal(d.id)).toMatchObject({ status: 'pending', turn: 'host', origin: 'sponsor', heldTk: 1000 });

    await expect(sponsors.respond(users.player, d.id, true)).rejects.toThrow(/isn’t your sponsorship/);
    await expect(sponsors.respond(users.brand, d.id, true)).rejects.toThrow(/other side/);
    const accepted = await sponsors.respond(users.organizer, d.id, true);
    const cut = Math.round((1000 * CUT) / 100);
    expect(accepted).toMatchObject({ status: 'active', paidToUserId: 'u-org', commissionTk: cut });
    expect(wallet('u-brand')).toMatchObject({ balanceTk: 4000, heldTk: 0 });
    expect(wallet('u-org')!.balanceTk).toBe(1000 - cut);
    expect(platform()!.balanceTk).toBe(cut);
    expect(db.table(WalletTransaction).filter((t) => t.sponsorshipId === d.id).map((t) => t.kind)).toEqual(
      expect.arrayContaining(['hold', 'payout_sent', 'received', 'commission']),
    );
  });

  it('withdrawing a request tells the other side, and not the one who withdrew it', async () => {
    const d = await sponsors.create(users.brand, offer(300));
    await sponsors.cancel(users.brand, d.id);
    const toHost = sent('sponsorship.cancelled');
    expect(toHost.map(([to]) => to)).toEqual(['u-org']);
    expect(toHost[0][1].message).toContain('Gamer Cola');

    notifications.createNotification.mockClear();
    const d2 = await sponsors.create(users.brand, offer(200));
    notifications.createNotification.mockClear();
    await sponsors.cancel(users.organizer, d2.id);
    expect(sent('sponsorship.cancelled').map(([to]) => to)).toEqual(['u-brand']);
  });

  it('declining or cancelling refunds the hold; only sponsors can offer, and not on what they run', async () => {
    const d = await sponsors.create(users.brand, offer(800));
    await sponsors.respond(users.organizer, d.id, false);
    expect(wallet('u-brand')).toMatchObject({ balanceTk: 5000, heldTk: 0 });
    expect(deal(d.id).status).toBe('declined');

    const d2 = await sponsors.create(users.brand, offer(300));
    await sponsors.cancel(users.brand, d2.id);
    expect(wallet('u-brand')).toMatchObject({ balanceTk: 5000, heldTk: 0 });

    await expect(sponsors.create(users.player, offer())).rejects.toThrow(/Sponsor role/);
    users.organizer.roles = ['organizer', 'sponsor'];
    db.table(SponsorProfile).push({ userId: 'u-org', brandName: 'Org Brand' } as never);
    await expect(sponsors.create(users.organizer, offer())).rejects.toThrow(/something you run/);
    users.organizer.roles = ['organizer', 'player'];
  });

  it("an organizer's request holds nothing until the sponsor accepts; counters move the hold", async () => {
    await expect(sponsors.create(users.player, { ...offer(500), sponsorUserId: 'u-brand' })).rejects.toThrow(/organizer/);
    const d = await sponsors.create(users.organizer, { ...offer(500, 'gold'), sponsorUserId: 'u-brand' });
    expect(deal(d.id)).toMatchObject({ origin: 'host', turn: 'sponsor', heldTk: 0 });
    expect(wallet('u-brand')!.heldTk).toBe(0);

    // The sponsor counters lower (and holds that), the organizer counters back up.
    await sponsors.counter(users.brand, d.id, { amountTk: 400 });
    expect(wallet('u-brand')).toMatchObject({ balanceTk: 4600, heldTk: 400 });
    await sponsors.counter(users.organizer, d.id, { amountTk: 450 });
    expect(deal(d.id)).toMatchObject({ amountTk: 450, heldTk: 400, turn: 'sponsor' });

    // Accepting tops the hold up to the agreed amount and pays it.
    await sponsors.respond(users.brand, d.id, true);
    expect(wallet('u-brand')).toMatchObject({ balanceTk: 4550, heldTk: 0 });
    expect(wallet('u-org')!.balanceTk).toBe(450 - Math.round((450 * CUT) / 100));
  });

  it('one Title sponsor per tournament, one open deal per sponsor, none once it has ended', async () => {
    const d = await sponsors.create(users.brand, offer(100, 'title'));
    await expect(sponsors.create(users.brand, offer(100, 'gold'))).rejects.toThrow(/already has an open or active deal/);
    await sponsors.respond(users.organizer, d.id, true);
    await expect(sponsors.create(users.brand2, offer(100, 'title'))).rejects.toThrow(/already has a Title sponsor/);
    const gold = await sponsors.create(users.brand2, offer(100, 'gold'));
    expect(gold.status).toBe('pending');

    db.table(Tournament)[0].status = 'completed';
    await expect(sponsors.respond(users.organizer, gold.id, true)).rejects.toThrow(/has ended/);
    const r = await sponsors.tick();
    expect(r.completed).toBe(1);
    expect(deal(d.id)).toMatchObject({ status: 'completed', endReason: 'tournament' });
  });

  it('unanswered requests expire and are refunded', async () => {
    const d = await sponsors.create(users.brand, offer(700));
    deal(d.id).expiresAt = new Date(Date.now() - 1000);
    await sponsors.tick();
    expect(deal(d.id).status).toBe('expired');
    expect(wallet('u-brand')).toMatchObject({ balanceTk: 5000, heldTk: 0 });
  });

  it('sponsor posts wait for review; the target lists its sponsors by tier', async () => {
    const post = await sponsors.createPost(users.brand, { body: 'Cold drinks for every finalist!' }, []);
    expect(db.table(CoachPost).find((p) => p.id === post.id)).toMatchObject({ authorRole: 'sponsor', status: 'pending', coachUserId: 'u-brand' });
    await expect(sponsors.createPost(users.player, { body: 'hi' }, [])).rejects.toThrow(/Sponsor role/);

    const gold = await sponsors.create(users.brand2, offer(100, 'gold'));
    const title = await sponsors.create(users.brand, offer(200, 'title'));
    await sponsors.respond(users.organizer, gold.id, true);
    await sponsors.respond(users.organizer, title.id, true);
    const view = await sponsors.forTarget('tournament', 't1', null);
    expect(view.sponsors.map((s) => s.sponsor.brandName)).toEqual(['Gamer Cola', 'Pixel Net']);
    expect(view.title?.sponsor.brandName).toBe('Gamer Cola');
    expect(view.canManage).toBe(false);
    expect((view.sponsors[0] as Record<string, unknown>).amountTk).toBeUndefined();
    expect((await sponsors.forTarget('tournament', 't1', 'u-org')).canManage).toBe(true);
  });
});
