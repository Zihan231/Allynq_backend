import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_TRANSFER_SETTINGS } from '../settings/settings.service.js';
import { PLATFORM_WALLET_ID, Wallet } from '../transfers/entities/wallet.entity.js';
import { PADMA, setup, T4 } from '../transfers/test/in-memory-db.js';
import { CoachingService, parseLinks } from './coaching.service.js';
import { CoachPost } from './entities/coach-post.entity.js';
import { CoachProfile } from './entities/coach-profile.entity.js';
import { CoachingDeal } from './entities/coaching-deal.entity.js';

/** Coaching on the transfers' in-memory database: Padma and t4 (club starting balance 5000), a free coach. */
function world() {
  const base = setup();
  const { db, users, service: transfers } = base;
  const notifications = { createNotification: vi.fn().mockResolvedValue({}) };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const coaching = new CoachingService(
    db.dataSource as never,
    base.settings as never,
    (transfers as unknown as { walletsService: never }).walletsService,
    transfers,
    notifications as never,
    audit as never,
  );
  // The read model joins coach and club; the tests read the stored rows.
  vi.spyOn(coaching, 'dealView').mockImplementation(async (id: string) => db.table(CoachingDeal).find((d) => d.id === id) as never);

  const coach = users.free;
  coach.roles = ['player', 'coach'];
  db.table(CoachProfile).push({ userId: coach.id, headline: 'Set pieces', specialities: [], available: true });
  const deal = (id: string) => db.table(CoachingDeal).find((d) => d.id === id)!;
  const wallet = (type: 'club' | 'user' | 'platform', id: string) => db.table(Wallet).find((w) => w.ownerType === type && w.ownerId === id);
  return { ...base, coaching, coach, deal, wallet, notifications, audit };
}

const PCT = DEFAULT_TRANSFER_SETTINGS.coachingCommissionPct;
const START = DEFAULT_TRANSFER_SETTINGS.clubStartingBalanceTk;

describe('coaching deals: money', () => {
  it('a club offer holds the fee; when the coach accepts he gets it minus the platform cut', async () => {
    const { coaching, coach, users, deal, wallet } = world();
    const offer = await coaching.create(users.padmaPres, { clubId: PADMA, coachUserId: coach.id, feeTk: 500, days: 30, paymentMethod: 'bkash' });
    expect(wallet('club', PADMA)).toMatchObject({ balanceTk: START - 500, heldTk: 500 });

    await coaching.respond(coach, offer.id, { accept: true });
    const cut = Math.round((500 * PCT) / 100);
    expect(wallet('club', PADMA)).toMatchObject({ balanceTk: START - 500, heldTk: 0 });
    expect(wallet('user', coach.id)?.balanceTk).toBe(500 - cut);
    expect(wallet('platform', PLATFORM_WALLET_ID)?.balanceTk).toBe(cut);
    expect(deal(offer.id)).toMatchObject({ status: 'active', commissionPct: PCT, commissionTk: cut, heldTk: 0 });
    expect(deal(offer.id).endsAt.getTime() - deal(offer.id).startedAt.getTime()).toBe(30 * 24 * 3600_000);
  });

  it("a coach's request is paid when the club accepts; counters move the hold", async () => {
    const { coaching, coach, users, deal, wallet } = world();
    const req = await coaching.create(coach, { clubId: PADMA, feeTk: 300, days: 14 });
    expect(wallet('club', PADMA)?.heldTk ?? 0).toBe(0);

    await coaching.counter(users.padmaPres, req.id, { feeTk: 200, paymentMethod: 'nagad' });
    expect(wallet('club', PADMA)).toMatchObject({ heldTk: 200 });
    expect(deal(req.id).turn).toBe('coach');

    await coaching.counter(coach, req.id, { feeTk: 250 });
    expect(wallet('club', PADMA)).toMatchObject({ heldTk: 200 }); // the club pays the rest when it accepts
    await coaching.respond(users.padmaPres, req.id, { accept: true });
    expect(wallet('club', PADMA)).toMatchObject({ balanceTk: START - 250, heldTk: 0 });
    expect(wallet('user', coach.id)?.balanceTk).toBe(250 - Math.round((250 * PCT) / 100));
    expect(deal(req.id).bids.map((b) => [b.party, b.feeTk])).toEqual([
      ['coach', 300],
      ['club', 200],
      ['coach', 250],
    ]);
  });

  it('declining, withdrawing or letting it expire gives the club its money back', async () => {
    const { coaching, coach, users, deal, wallet } = world();
    const a = await coaching.create(users.padmaPres, { clubId: PADMA, coachUserId: coach.id, feeTk: 100, days: 10, paymentMethod: 'bkash' });
    await coaching.respond(coach, a.id, { accept: false });
    expect(deal(a.id).status).toBe('declined');

    const b = await coaching.create(users.padmaPres, { clubId: PADMA, coachUserId: coach.id, feeTk: 100, days: 10, paymentMethod: 'bkash' });
    await coaching.cancel(users.padmaPres, b.id);
    expect(deal(b.id).status).toBe('cancelled');

    const c = await coaching.create(users.t4Pres, { clubId: T4, coachUserId: coach.id, feeTk: 80, days: 10, paymentMethod: 'bkash' });
    const later = new Date(Date.now() + 10 * 24 * 3600_000);
    expect((await coaching.tick(later)).expired).toBe(1);
    expect(deal(c.id).status).toBe('expired');

    expect(wallet('club', PADMA)).toMatchObject({ balanceTk: START, heldTk: 0 });
    expect(wallet('club', T4)).toMatchObject({ balanceTk: START, heldTk: 0 });
  });
});

describe('coaching deals: rules', () => {
  it('only coaches can be signed, and only by club leaders', async () => {
    const { coaching, coach, users } = world();
    await expect(coaching.create(users.padmaPres, { clubId: PADMA, coachUserId: users.commLeader.id, feeTk: 0, days: 10 })).rejects.toThrow(/isn't a coach/);
    await expect(coaching.create(users.locked, { clubId: PADMA, coachUserId: coach.id, feeTk: 0, days: 10 })).rejects.toThrow(/President or General Secretary/);
    await expect(coaching.create(users.locked, { clubId: PADMA, feeTk: 0, days: 10 })).rejects.toThrow(/isn't a coach/);
  });

  it("a coach can't coach the club he plays for, nor have two open deals with one club", async () => {
    const { coaching, coach, users, profile } = world();
    profile(coach).clubId = PADMA;
    await expect(coaching.create(coach, { clubId: PADMA, feeTk: 0, days: 10 })).rejects.toThrow(/can't be its coach/);
    profile(coach).clubId = null;
    await coaching.create(coach, { clubId: PADMA, feeTk: 0, days: 10 });
    await expect(coaching.create(users.padmaPres, { clubId: PADMA, coachUserId: coach.id, feeTk: 0, days: 10 })).rejects.toThrow(/already an open coaching deal/);
  });

  it('the length must be within the settings', async () => {
    const { coaching, coach } = world();
    await expect(coaching.create(coach, { clubId: PADMA, feeTk: 0, days: 1 })).rejects.toThrow(/7 to 90 days/);
    await expect(coaching.create(coach, { clubId: PADMA, feeTk: 0, days: 200 })).rejects.toThrow(/7 to 90 days/);
  });

  it('one club at a time: a deal agreed meanwhile starts when the current one ends', async () => {
    const { coaching, coach, users, deal } = world();
    const first = await coaching.create(users.padmaPres, { clubId: PADMA, coachUserId: coach.id, feeTk: 0, days: 10 });
    await coaching.respond(coach, first.id, { accept: true });
    const second = await coaching.create(users.t4Pres, { clubId: T4, coachUserId: coach.id, feeTk: 0, days: 10 });
    await coaching.respond(coach, second.id, { accept: true });
    expect(deal(second.id).status).toBe('scheduled');
    expect(deal(second.id).startedAt.getTime()).toBe(deal(first.id).endsAt.getTime());

    // Ending the first early starts the second.
    await coaching.end(users.padmaPres, first.id);
    expect(deal(first.id)).toMatchObject({ status: 'ended', endReason: 'club' });
    expect(deal(second.id).status).toBe('active');
  });

  it('a running deal completes after its days', async () => {
    const { coaching, coach, users, deal } = world();
    const d = await coaching.create(users.padmaPres, { clubId: PADMA, coachUserId: coach.id, feeTk: 0, days: 7 });
    await coaching.respond(coach, d.id, { accept: true });
    await coaching.tick(new Date(Date.now() + 8 * 24 * 3600_000));
    expect(deal(d.id)).toMatchObject({ status: 'completed', endReason: 'time' });
  });
});

describe('coach posts', () => {
  it('are hidden from others until staff approve them', async () => {
    const { coaching, coach, users, db, audit } = world();
    const post = await coaching.createPost(coach, { body: 'Pressing drills', links: 'https://youtu.be/abc' }, []);
    expect(post.status).toBe('pending');
    expect((await coaching.coachDetail(coach.id, users.padmaPres.id)).posts).toHaveLength(0);
    expect((await coaching.coachDetail(coach.id, coach.id)).posts).toHaveLength(1);

    await expect(coaching.reviewPost(users.t4Pres, post.id, { approve: false }, { ip: null })).rejects.toThrow(/reason/);
    await coaching.reviewPost(users.t4Pres, post.id, { approve: true }, { ip: null });
    expect(db.table(CoachPost)[0].status).toBe('approved');
    expect((await coaching.coachDetail(coach.id, users.padmaPres.id)).posts).toHaveLength(1);
    expect(audit.record).toHaveBeenCalled();
  });

  it('need some content', async () => {
    const { coaching, coach } = world();
    await expect(coaching.createPost(coach, { body: '  ' }, [])).rejects.toThrow(/Write something/);
  });
});

describe('parseLinks', () => {
  it('reads one link per line or a JSON list, http(s) only', () => {
    expect(parseLinks('https://youtu.be/a\n\nhttps://youtu.be/b')).toEqual(['https://youtu.be/a', 'https://youtu.be/b']);
    expect(parseLinks('["https://youtube.com/watch?v=1"]')).toEqual(['https://youtube.com/watch?v=1']);
    expect(() => parseLinks('javascript:alert(1)')).toThrow(/valid link/);
    expect(() => parseLinks(Array.from({ length: 6 }, (_, i) => `https://x.com/${i}`).join('\n'))).toThrow(/at most 5/);
  });
});
