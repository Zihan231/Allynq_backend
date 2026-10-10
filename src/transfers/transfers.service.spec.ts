import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Club } from '../clubs/entities/club.entity.js';
import { DEFAULT_TRANSFER_SETTINGS } from '../settings/settings.service.js';
import { EfootballProfile } from '../users/entities/efootball-profile.entity.js';
import { User } from '../users/entities/user.entity.js';
import { lockEnd } from './contract-fee.js';
import { ensureContract } from './contracts.js';
import { PlayerContract } from './entities/player-contract.entity.js';
import { TransferOfferBid } from './entities/transfer-offer-bid.entity.js';
import { TransferOffer } from './entities/transfer-offer.entity.js';
import { WalletTransaction } from './entities/wallet-transaction.entity.js';
import { Wallet } from './entities/wallet.entity.js';
import { TransfersService } from './transfers.service.js';
import { WalletsService } from './wallets.service.js';

/**
 * A small in-memory stand-in for TypeORM: just the repository calls, row locks
 * and raw queries the transfer services use. A transaction that throws is rolled
 * back, like the real database.
 */
type Row = Record<string, any>;

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (expected && typeof expected === 'object' && '_type' in expected) {
      if (expected._type === 'in') return (expected._value as unknown[]).includes(row[key]);
      throw new Error(`Unsupported operator ${expected._type}`);
    }
    return row[key] === expected;
  });
}

function makeDb() {
  const tables = new Map<string, Row[]>();
  const table = (entity: { name: string }) => {
    if (!tables.has(entity.name)) tables.set(entity.name, []);
    return tables.get(entity.name)!;
  };
  let contractSeq = 0;
  /** Active tournaments a player plays with his club, keyed by profile id. */
  const commitments = new Map<string, Row>();
  /** His club's tournaments that haven't started, keyed by profile id; and lineups he was taken out of. */
  const upcoming = new Map<string, Row[]>();
  const removedFromLineups: Array<{ participantIds: string[]; profileId: string }> = [];
  const walletStart = { club: DEFAULT_TRANSFER_SETTINGS.clubStartingBalanceTk, user: DEFAULT_TRANSFER_SETTINGS.playerStartingBalanceTk };

  const repo = (entity: { name: string }) => {
    const rows = table(entity);
    const insert = (data: Row) => {
      const row = { ...DEFAULTS[entity.name], id: data.id ?? randomUUID(), createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.push(row);
      return row;
    };
    return {
      // Remember which table a created object belongs to, for em.save().
      create: (data: Row) => Object.defineProperty({ ...data }, '__entity', { value: entity.name, enumerable: false }),
      findOne: async ({ where }: { where: Row }) => rows.find((r) => matches(r, where)) ?? null,
      findOneOrFail: async ({ where }: { where: Row }) => {
        const row = rows.find((r) => matches(r, where));
        if (!row) throw new Error(`${entity.name} not found`);
        return row;
      },
      find: async ({ where }: { where?: Row } = {}) => rows.filter((r) => matches(r, where)),
      findAndCount: async ({ where }: { where?: Row }) => {
        const found = rows.filter((r) => matches(r, where));
        return [found, found.length];
      },
      insert: async (data: Row) => insert(data),
      save: async (data: Row) => save(entity, data),
      update: async (where: Row, patch: Row) => {
        rows.filter((r) => matches(r, where)).forEach((r) => Object.assign(r, patch));
      },
      createQueryBuilder: () => {
        let params: Row = {};
        const builder = {
          setLock: () => builder,
          where: (_sql: string, p: Row = {}) => ((params = { ...params, ...p }), builder),
          andWhere: (_sql: string, p: Row = {}) => ((params = { ...params, ...p }), builder),
          getOne: async () => lookup(entity, params),
          getOneOrFail: async () => {
            const row = lookup(entity, params);
            if (!row) throw new Error('not found');
            return row;
          },
          getMany: async () =>
            entity.name === 'PlayerContract'
              ? rows.filter((r) => r.status === 'active' && !r.notifiedFreeAt && r.lockEndsAt <= params.soon)
              : rows,
        };
        return builder;
      },
    };
  };

  const lookup = (entity: { name: string }, params: Row) => {
    const rows = table(entity);
    if (params.offerId) return rows.find((r) => r.id === params.offerId) ?? null;
    if (params.type && params.id) return rows.find((r) => r.ownerType === params.type && r.ownerId === params.id) ?? null;
    return null;
  };

  /** Column defaults the database fills in on insert. */
  const DEFAULTS: Record<string, Row> = { TransferOffer: { status: 'pending' }, PlayerContract: { status: 'active' } };

  const save = (entity: { name: string }, data: Row) => {
    const rows = table(entity);
    const existing = rows.find((r) => r === data || (data.id && r.id === data.id));
    if (existing) {
      Object.assign(existing, data, { updatedAt: new Date() });
      return existing;
    }
    const row = { ...DEFAULTS[entity.name], id: data.id ?? randomUUID(), createdAt: new Date(), updatedAt: new Date(), ...data };
    for (const [key, value] of Object.entries(row)) if (data[key] === undefined) data[key] = value;
    rows.push(data);
    return data;
  };

  const query = async (sql: string, params: unknown[] = []) => {
    if (sql.includes('INSERT INTO wallets')) {
      const [ownerType, ownerId] = params as [string, string];
      const wallets = table(Wallet);
      if (!wallets.some((w) => w.ownerType === ownerType && w.ownerId === ownerId)) {
        wallets.push({ id: randomUUID(), ownerType, ownerId, balanceTk: walletStart[ownerType as 'club' | 'user'], heldTk: 0 });
      }
      return [];
    }
    if (sql.includes("nextval('contract_no_seq')")) return [{ seq: ++contractSeq }];
    if (sql.includes('INSERT INTO player_contracts')) {
      const [contractNo, userId, clubId, offerId, frozenTk, baseTk, lockDays, startAt, lockEndsAt] = params as any[];
      table(PlayerContract).push({
        id: randomUUID(),
        contractNo,
        userId,
        clubId,
        offerId,
        frozenTk,
        baseTk,
        lockDays,
        startAt,
        lockEndsAt,
        status: 'active',
        createdAt: new Date(),
      });
      return [];
    }
    if (sql.includes('SELECT id FROM player_contracts')) {
      return table(PlayerContract).filter((c) => c.userId === params[0] && c.status === 'active').map((c) => ({ id: c.id }));
    }
    if (sql.includes('FROM tournament_participants p')) return upcoming.get(params[1] as string) ?? [];
    if (sql.includes('UPDATE tournament_participants')) {
      removedFromLineups.push({ participantIds: params[0] as string[], profileId: params[1] as string });
      return [];
    }
    if (sql.includes('"frozenAt", "frozenReason" FROM "clubs"')) {
      const club = table(Club).find((c) => c.id === params[0]);
      return club ? [{ name: club.name, frozenAt: club.frozenAt ?? null, frozenReason: club.frozenReason ?? null }] : [];
    }
    if (sql.includes('FROM tournaments t')) {
      const found = commitments.get(params[1] as string);
      return found ? [found] : [];
    }
    throw new Error(`Unexpected query: ${sql.slice(0, 80)}`);
  };

  const em = {
    getRepository: repo,
    query,
    save: async (data: Row) => {
      for (const [name, rows] of tables) if (rows.includes(data)) return save({ name }, data);
      if (data.__entity) return save({ name: data.__entity }, data);
      throw new Error('save: unknown entity');
    },
  };
  const dataSource = {
    manager: em,
    getRepository: repo,
    query,
    transaction: async <T>(work: (manager: typeof em) => Promise<T>): Promise<T> => {
      const snapshot = new Map([...tables].map(([name, rows]) => [name, rows.map((r) => structuredClone(r))]));
      try {
        return await work(em);
      } catch (err) {
        // Roll back: restore every table, including ones first written inside the transaction.
        for (const name of tables.keys()) tables.set(name, snapshot.get(name) ?? []);
        throw err;
      }
    },
  };
  return { dataSource, table, commitments, upcoming, removedFromLineups };
}

// ------------------------------------------------------------------- setup

const PADMA = 'club-padma';
const T4 = 'club-t4';

function setup() {
  const db = makeDb();
  const users: Record<string, User> = {};
  const addPerson = (key: string, clubId: string | null, clubRole: string | null) => {
    const user = { id: `u-${key}`, name: key } as User;
    users[key] = user;
    db.table(User).push(user);
    db.table(EfootballProfile).push({ id: `p-${key}`, userId: user.id, clubId, clubRole, teamId: null, user });
    return user;
  };
  db.table(Club).push({ id: PADMA, name: 'Padma' }, { id: T4, name: 't4' });
  addPerson('padmaPres', PADMA, 'President');
  addPerson('t4Pres', T4, 'President');
  addPerson('free', null, null); // clubless free agent
  addPerson('locked', T4, 'Player'); // under a fresh contract at t4
  addPerson('commLeader', null, null);
  const now = new Date();
  db.table(PlayerContract).push({
    id: 'contract-locked',
    contractNo: 'ALQ-2026-000001',
    userId: users.locked.id,
    clubId: T4,
    frozenTk: 0,
    baseTk: 120,
    lockDays: 120,
    startAt: now,
    lockEndsAt: lockEnd(now, 120),
    status: 'active',
  });

  const features = { signupsOpen: true, transfersOpen: true, reportsOpen: true };
  const settings = { transfers: vi.fn().mockResolvedValue(DEFAULT_TRANSFER_SETTINGS), features: vi.fn(async () => features) };
  const wallets = new WalletsService(db.dataSource as never, settings as never);
  const communities = {
    isCommunityLeader: vi.fn(async (userId: string) => userId === users.commLeader.id),
    onClubMemberAdded: vi.fn().mockResolvedValue(undefined),
    onClubMemberRemoved: vi.fn().mockResolvedValue(undefined),
  };
  const notifications = { createNotification: vi.fn().mockResolvedValue({}) };
  const service = new TransfersService(
    db.dataSource as never,
    settings as never,
    wallets,
    communities as never,
    notifications as never,
  );
  // The read model is SQL; the tests look at the stored rows instead.
  vi.spyOn(service, 'offerView').mockImplementation(async (id: string) => db.table(TransferOffer).find((o) => o.id === id) as never);

  const offer = (id: string) => db.table(TransferOffer).find((o) => o.id === id)!;
  const wallet = (type: 'club' | 'user', id: string) => db.table(Wallet).find((w) => w.ownerType === type && w.ownerId === id);
  const profile = (u: User) => db.table(EfootballProfile).find((p) => p.userId === u.id)!;
  const activeContract = (u: User) => db.table(PlayerContract).find((c) => c.userId === u.id && c.status === 'active');
  const codesTo = (u: User) =>
    notifications.createNotification.mock.calls.filter(([to]) => to === u.id).map(([, n]) => (n as { code: string }).code);
  const bids = (offerId: string) =>
    db
      .table(TransferOfferBid)
      .filter((b) => b.offerId === offerId)
      .map((b) => [b.party, b.amountTk]);
  return { db, service, users, communities, offer, wallet, profile, activeContract, codesTo, features, bids };
}

// ------------------------------------------------------------------- tests

describe('TransfersService', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
  });

  it('a free player proposes; the club accepts and pays; he joins with a locked contract', async () => {
    const { service, users, offer, wallet, profile, activeContract, communities, codesTo } = t;
    const proposal = await service.createOffer(users.free, { clubId: PADMA, amountTk: 40, message: 'hi' });
    expect(offer(proposal.id)).toMatchObject({ kind: 'player_proposal', status: 'pending', payeeType: 'player' });
    expect(codesTo(users.padmaPres)).toContain('transfer.proposalReceived');

    await service.respond(users.padmaPres, proposal.id, { accept: true, paymentMethod: 'bkash' });

    expect(offer(proposal.id)).toMatchObject({ status: 'completed', paymentMethod: 'bkash' });
    expect(wallet('club', PADMA)).toMatchObject({ balanceTk: 4960, heldTk: 0 });
    expect(wallet('user', users.free.id)).toMatchObject({ balanceTk: 40 });
    expect(profile(users.free)).toMatchObject({ clubId: PADMA, clubRole: 'Player' });
    expect(activeContract(users.free)).toMatchObject({ clubId: PADMA, frozenTk: 40, baseTk: 120 });
    expect(communities.onClubMemberAdded).toHaveBeenCalledWith(PADMA, 'p-free');
    expect(codesTo(users.free)).toEqual(expect.arrayContaining(['transfer.accepted', 'transfer.completed', 'transfer.paymentReceived']));
  });

  it('allows only one open deal per player and club, until it is withdrawn', async () => {
    const { service, users } = t;
    const first = await service.createOffer(users.free, { clubId: PADMA, amountTk: 10 });
    await expect(service.createOffer(users.free, { clubId: PADMA, amountTk: 20 })).rejects.toThrow(/open deal/);
    await service.cancel(users.free, first.id);
    await expect(service.createOffer(users.free, { clubId: PADMA, amountTk: 20 })).resolves.toBeTruthy();
  });

  it('a club offer holds the money at once; declining refunds it', async () => {
    const { service, users, offer, wallet, codesTo } = t;
    const o = await service.createOffer(users.padmaPres, { clubId: PADMA, playerUserId: users.free.id, amountTk: 500, paymentMethod: 'card' });
    expect(offer(o.id)).toMatchObject({ kind: 'club_offer', paidAt: expect.any(Date) });
    expect(wallet('club', PADMA)).toMatchObject({ balanceTk: 4500, heldTk: 500 });

    await service.respond(users.free, o.id, { accept: false });

    expect(offer(o.id).status).toBe('declined');
    expect(wallet('club', PADMA)).toMatchObject({ balanceTk: 5000, heldTk: 0 });
    expect(codesTo(users.padmaPres)).toContain('transfer.declinedByPlayer');
  });

  it('a club frozen by staff can neither send offers nor accept proposals', async () => {
    const { service, users, db } = t;
    const proposal = await service.createOffer(users.free, { clubId: PADMA, amountTk: 0 });
    Object.assign(db.table(Club).find((c) => c.id === PADMA)!, { frozenAt: new Date(), frozenReason: 'Investigation' });
    await expect(
      service.createOffer(users.padmaPres, { clubId: PADMA, playerUserId: users.free.id, amountTk: 100, paymentMethod: 'card' }),
    ).rejects.toThrow('frozen by ALLYNQ staff: Investigation');
    await expect(service.respond(users.padmaPres, proposal.id, { accept: true, paymentMethod: 'card' })).rejects.toThrow('frozen');
  });

  it('staff can cancel an open offer, refunding the club', async () => {
    const { service, users, offer, wallet, codesTo } = t;
    const o = await service.createOffer(users.padmaPres, { clubId: PADMA, playerUserId: users.free.id, amountTk: 400, paymentMethod: 'card' });
    await service.staffCancel(o.id, 'Suspicious deal');
    expect(offer(o.id).status).toBe('cancelled');
    expect(wallet('club', PADMA)).toMatchObject({ balanceTk: 5000, heldTk: 0 });
    expect(codesTo(users.free)).toContain('transfer.cancelledByStaff');
    await expect(service.staffCancel(o.id, 'again')).rejects.toThrow('cancelled');
  });

  it('staff can reverse a completed buyout: money back, player back, old contract restored', async () => {
    const { service, users, offer, wallet, profile, activeContract, codesTo } = t;
    const b = await service.createOffer(users.padmaPres, { clubId: PADMA, playerUserId: users.locked.id, amountTk: 1, paymentMethod: 'nagad' });
    await service.respond(users.locked, b.id, { accept: true });
    expect(profile(users.locked).clubId).toBe(PADMA);

    await service.staffReverse(b.id, 'Fraudulent buyout');
    expect(offer(b.id).status).toBe('reversed');
    expect(wallet('club', T4)).toMatchObject({ balanceTk: 5000 });
    expect(wallet('club', PADMA)).toMatchObject({ balanceTk: 5000, heldTk: 0 });
    expect(profile(users.locked).clubId).toBe(T4);
    expect(activeContract(users.locked)).toMatchObject({ id: 'contract-locked', clubId: T4 });
    expect(codesTo(users.t4Pres)).toContain('transfer.reversedByStaff');
    await expect(service.staffReverse(b.id, 'twice')).rejects.toThrow('Only completed');
  });

  it("won't reverse once the selling club has spent the money", async () => {
    const { service, users, db } = t;
    const b = await service.createOffer(users.padmaPres, { clubId: PADMA, playerUserId: users.locked.id, amountTk: 1, paymentMethod: 'nagad' });
    await service.respond(users.locked, b.id, { accept: true });
    Object.assign(db.table(Wallet).find((w) => w.ownerType === 'club' && w.ownerId === T4)!, { balanceTk: 50 });
    await expect(service.staffReverse(b.id, 'Fraud')).rejects.toThrow("can't be taken");
  });

  it('staff can end a lock early, making the player a free agent', async () => {
    const { service, users, activeContract, codesTo } = t;
    await service.staffEndLock(users.locked.id, 'Club stopped playing');
    expect(new Date(activeContract(users.locked)!.lockEndsAt).getTime()).toBeLessThanOrEqual(Date.now());
    expect(codesTo(users.locked)).toContain('transfer.lockEndedByStaff');
    await expect(service.staffEndLock(users.locked.id, 'again')).rejects.toThrow('already ended');
  });

  it('a closed transfer market refuses new deals', async () => {
    const { service, users, features } = t;
    features.transfersOpen = false;
    await expect(service.createOffer(users.free, { clubId: PADMA, amountTk: 0 })).rejects.toThrow('transfer market is closed');
  });

  it('withdrawing a club offer refunds the hold; only the sender side may withdraw', async () => {
    const { service, users, offer, wallet } = t;
    const o = await service.createOffer(users.padmaPres, { clubId: PADMA, playerUserId: users.free.id, amountTk: 300, paymentMethod: 'bkash' });
    await expect(service.cancel(users.free, o.id)).rejects.toThrow(ForbiddenException);
    await service.cancel(users.padmaPres, o.id);
    expect(offer(o.id).status).toBe('cancelled');
    expect(wallet('club', PADMA)).toMatchObject({ balanceTk: 5000, heldTk: 0 });
  });

  it('a locked player is bought out at his current fee, paid to his club, which cannot refuse', async () => {
    const { service, users, offer, wallet, profile, activeContract, db } = t;
    const b = await service.createOffer(users.padmaPres, { clubId: PADMA, playerUserId: users.locked.id, amountTk: 1, paymentMethod: 'nagad' });
    expect(offer(b.id)).toMatchObject({ kind: 'buyout', amountTk: 120, payeeType: 'club', fromClubId: T4 });

    // His club can't answer (or block) a buyout; only the player can.
    await expect(service.respond(users.t4Pres, b.id, { accept: false })).rejects.toThrow(ForbiddenException);
    await service.respond(users.locked, b.id, { accept: true });

    expect(wallet('club', T4)).toMatchObject({ balanceTk: 5120 });
    expect(wallet('club', PADMA)).toMatchObject({ balanceTk: 4880, heldTk: 0 });
    expect(profile(users.locked).clubId).toBe(PADMA);
    expect(db.table(PlayerContract).find((c) => c.id === 'contract-locked')).toMatchObject({ status: 'ended', endReason: 'transfer' });
    expect(activeContract(users.locked)).toMatchObject({ clubId: PADMA, frozenTk: 120 });
  });

  it('refuses an offer the club cannot afford, leaving nothing behind', async () => {
    const { service, users, db, wallet } = t;
    await expect(
      service.createOffer(users.padmaPres, { clubId: PADMA, playerUserId: users.free.id, amountTk: 999_999, paymentMethod: 'bkash' }),
    ).rejects.toThrow(/Not enough money/);
    expect(db.table(TransferOffer)).toHaveLength(0);
    expect(wallet('club', PADMA)?.balanceTk ?? 5000).toBe(5000);
  });

  it('keeps club leaders, community leaders and locked players out of the market', async () => {
    const { service, users } = t;
    await expect(
      service.createOffer(users.padmaPres, { clubId: PADMA, playerUserId: users.t4Pres.id, amountTk: 10, paymentMethod: 'bkash' }),
    ).rejects.toThrow(/President/);
    await expect(service.createOffer(users.commLeader, { clubId: PADMA, amountTk: 0 })).rejects.toThrow(/Community Presidents/);
    await expect(service.createOffer(users.locked, { clubId: PADMA, amountTk: 0 })).rejects.toThrow(/under contract/);
    await expect(
      service.createOffer(users.free, { clubId: PADMA, playerUserId: users.locked.id, amountTk: 0 }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('expires a pending offer after its deadline, refunds the hold and tells both sides', async () => {
    const { service, users, offer, wallet, codesTo } = t;
    const o = await service.createOffer(users.padmaPres, { clubId: PADMA, playerUserId: users.free.id, amountTk: 100, paymentMethod: 'bkash' });
    offer(o.id).expiresAt = new Date(Date.now() - 60_000);

    expect(await service.expireDue()).toBe(1);

    expect(offer(o.id).status).toBe('expired');
    expect(wallet('club', PADMA)).toMatchObject({ balanceTk: 5000, heldTk: 0 });
    expect(codesTo(users.free)).toContain('transfer.expired');
    expect(codesTo(users.padmaPres)).toContain('transfer.expiredClub');
    await expect(service.respond(users.free, o.id, { accept: true })).rejects.toThrow(BadRequestException);
  });

  it('schedules a transfer while the player is in a tournament, and completes it when the tournament ends', async () => {
    const { service, users, offer, wallet, profile, db, codesTo } = t;
    db.commitments.set('p-locked', { tournamentId: 't-1', tournamentName: 'Night League', startAt: new Date(), endAt: null });
    const b = await service.createOffer(users.padmaPres, { clubId: PADMA, playerUserId: users.locked.id, amountTk: 0, paymentMethod: 'bkash' });
    await service.respond(users.locked, b.id, { accept: true });

    expect(offer(b.id)).toMatchObject({ status: 'scheduled', scheduledTournamentId: 't-1' });
    expect(wallet('club', PADMA)).toMatchObject({ heldTk: 120 }); // still held
    expect(profile(users.locked).clubId).toBe(T4); // not moved yet
    expect(codesTo(users.locked)).toContain('transfer.scheduled');
    await expect(
      service.createOffer(users.t4Pres, { clubId: T4, playerUserId: users.locked.id, amountTk: 10, paymentMethod: 'bkash' }),
    ).rejects.toThrow(/waiting for a tournament/);

    expect(await service.completeScheduled()).toBe(0); // tournament still running

    db.commitments.clear(); // tournament over
    expect(await service.completeScheduled()).toBe(1);
    expect(offer(b.id).status).toBe('completed');
    expect(profile(users.locked).clubId).toBe(PADMA);
    expect(wallet('club', PADMA)).toMatchObject({ heldTk: 0 });
    expect(wallet('club', T4)).toMatchObject({ balanceTk: 5120 });
  });

  it('a renewal keeps him at the club, pays him and restarts the lock', async () => {
    const { service, users, offer, wallet, profile, db, activeContract } = t;
    const r = await service.createOffer(users.t4Pres, { clubId: T4, playerUserId: users.locked.id, amountTk: 50, paymentMethod: 'bkash' });
    expect(offer(r.id).kind).toBe('renewal');
    await service.respond(users.locked, r.id, { accept: true });

    expect(profile(users.locked).clubId).toBe(T4);
    expect(wallet('user', users.locked.id)).toMatchObject({ balanceTk: 50 });
    expect(db.table(PlayerContract).find((c) => c.id === 'contract-locked')).toMatchObject({ status: 'ended', endReason: 'renewal' });
    expect(activeContract(users.locked)).toMatchObject({ clubId: T4, frozenTk: 50 });
  });

  it('closes and refunds his other open offers once he moves', async () => {
    const { service, users, offer, wallet } = t;
    const fromT4 = await service.createOffer(users.t4Pres, { clubId: T4, playerUserId: users.free.id, amountTk: 200, paymentMethod: 'bkash' });
    const proposal = await service.createOffer(users.free, { clubId: PADMA, amountTk: 0 });
    await service.respond(users.padmaPres, proposal.id, { accept: true });

    expect(offer(fromT4.id).status).toBe('cancelled');
    expect(wallet('club', T4)).toMatchObject({ balanceTk: 5000, heldTk: 0 });
  });

  it('records every wallet movement in the ledger', async () => {
    const { service, users, db } = t;
    const o = await service.createOffer(users.padmaPres, { clubId: PADMA, playerUserId: users.free.id, amountTk: 70, paymentMethod: 'bkash' });
    await service.respond(users.free, o.id, { accept: true });
    const kinds = db.table(WalletTransaction).filter((x) => x.offerId === o.id).map((x) => x.kind);
    expect(kinds).toEqual(['hold', 'payout_sent', 'received']);
  });

  // ------------------------------------------------------------ negotiation

  it('negotiates with counter-offers; the agreed amount is paid and frozen into the contract', async () => {
    const { service, users, offer, wallet, activeContract, codesTo, bids } = t;
    const o = await service.createOffer(users.padmaPres, { clubId: PADMA, playerUserId: users.free.id, amountTk: 100, paymentMethod: 'bkash' });
    expect(offer(o.id)).toMatchObject({ turn: 'player', heldTk: 100 });

    // Not the club's turn.
    await expect(service.counter(users.padmaPres, o.id, { amountTk: 90 })).rejects.toThrow(ForbiddenException);

    await service.counter(users.free, o.id, { amountTk: 150, message: 'I want more' });
    expect(offer(o.id)).toMatchObject({ turn: 'club', amountTk: 150, heldTk: 100, clubSignedAt: null });
    expect(wallet('club', PADMA)).toMatchObject({ balanceTk: 4900, heldTk: 100 }); // unchanged until the club answers
    expect(codesTo(users.padmaPres)).toContain('transfer.counterReceived');

    await expect(service.counter(users.padmaPres, o.id, { amountTk: 120 })).rejects.toThrow('payment method');
    await service.counter(users.padmaPres, o.id, { amountTk: 120, paymentMethod: 'nagad' });
    expect(offer(o.id)).toMatchObject({ turn: 'player', amountTk: 120, heldTk: 120 });
    expect(wallet('club', PADMA)).toMatchObject({ balanceTk: 4880, heldTk: 120 });

    await service.respond(users.free, o.id, { accept: true });

    expect(offer(o.id).status).toBe('completed');
    expect(wallet('club', PADMA)).toMatchObject({ balanceTk: 4880, heldTk: 0 });
    expect(wallet('user', users.free.id)).toMatchObject({ balanceTk: 120 });
    expect(activeContract(users.free)).toMatchObject({ clubId: PADMA, frozenTk: 120, baseTk: 120 });
    expect(bids(o.id)).toEqual([
      ['club', 100],
      ['player', 150],
      ['club', 120],
    ]);
  });

  it("the club can accept a player's higher ask, paying the difference", async () => {
    const { service, users, offer, wallet } = t;
    const o = await service.createOffer(users.padmaPres, { clubId: PADMA, playerUserId: users.free.id, amountTk: 100, paymentMethod: 'bkash' });
    await service.counter(users.free, o.id, { amountTk: 200 });
    await expect(service.respond(users.padmaPres, o.id, { accept: true })).rejects.toThrow('payment method');

    await service.respond(users.padmaPres, o.id, { accept: true, paymentMethod: 'card' });

    expect(offer(o.id)).toMatchObject({ status: 'completed', amountTk: 200, heldTk: 0 });
    expect(wallet('club', PADMA)).toMatchObject({ balanceTk: 4800, heldTk: 0 });
    expect(wallet('user', users.free.id)).toMatchObject({ balanceTk: 200 });
  });

  it('rejecting a counter-offer ends the negotiation, refunds the hold and keeps the bids', async () => {
    const { service, users, offer, wallet, codesTo, bids } = t;
    const o = await service.createOffer(users.padmaPres, { clubId: PADMA, playerUserId: users.free.id, amountTk: 100, paymentMethod: 'bkash' });
    await service.counter(users.free, o.id, { amountTk: 300 });

    await service.respond(users.padmaPres, o.id, { accept: false });

    expect(offer(o.id)).toMatchObject({ status: 'declined', heldTk: 0 });
    expect(wallet('club', PADMA)).toMatchObject({ balanceTk: 5000, heldTk: 0 });
    expect(codesTo(users.free)).toContain('transfer.declinedByClub');
    expect(bids(o.id)).toHaveLength(2);
    await expect(service.counter(users.free, o.id, { amountTk: 200 })).rejects.toThrow('already declined');
  });

  it("a player's proposal can be countered by the club; then only the club can withdraw", async () => {
    const { service, users, offer, wallet } = t;
    const p = await service.createOffer(users.free, { clubId: PADMA, amountTk: 80 });
    await service.counter(users.padmaPres, p.id, { amountTk: 50, paymentMethod: 'bkash' });
    expect(offer(p.id)).toMatchObject({ turn: 'player', heldTk: 50 });
    expect(wallet('club', PADMA)).toMatchObject({ balanceTk: 4950, heldTk: 50 });

    await expect(service.cancel(users.free, p.id)).rejects.toThrow(ForbiddenException);
    await service.cancel(users.padmaPres, p.id);
    expect(wallet('club', PADMA)).toMatchObject({ balanceTk: 5000, heldTk: 0 });
  });

  it("a buyout can't be countered", async () => {
    const { service, users } = t;
    const b = await service.createOffer(users.padmaPres, { clubId: PADMA, playerUserId: users.locked.id, amountTk: 1, paymentMethod: 'nagad' });
    await expect(service.counter(users.locked, b.id, { amountTk: 500 })).rejects.toThrow("can't be countered");
  });

  // -------------------------------------------------------- scheduled moves

  it('a player with a scheduled move cannot take up another deal until he has moved', async () => {
    const { service, users, db } = t;
    const renewal = await service.createOffer(users.t4Pres, { clubId: T4, playerUserId: users.locked.id, amountTk: 30, paymentMethod: 'bkash' });
    db.commitments.set('p-locked', { tournamentId: 't-1', tournamentName: 'Night League', startAt: new Date(), endAt: null });
    const b = await service.createOffer(users.padmaPres, { clubId: PADMA, playerUserId: users.locked.id, amountTk: 0, paymentMethod: 'bkash' });
    await service.respond(users.locked, b.id, { accept: true });

    await expect(service.respond(users.locked, renewal.id, { accept: true })).rejects.toThrow(/move waiting/);
    await expect(service.counter(users.locked, renewal.id, { amountTk: 60 })).rejects.toThrow(/move waiting/);
  });

  it('cancels a scheduled move and refunds the club if the rules no longer allow it when the tournament ends', async () => {
    const { service, users, offer, wallet, profile, db, codesTo } = t;
    db.commitments.set('p-locked', { tournamentId: 't-1', tournamentName: 'Night League', startAt: new Date(), endAt: null });
    const b = await service.createOffer(users.padmaPres, { clubId: PADMA, playerUserId: users.locked.id, amountTk: 0, paymentMethod: 'bkash' });
    await service.respond(users.locked, b.id, { accept: true });
    expect(offer(b.id).status).toBe('scheduled');

    Object.assign(db.table(Club).find((c) => c.id === PADMA)!, { frozenAt: new Date(), frozenReason: 'Investigation' });
    db.commitments.clear();
    expect(await service.completeScheduled()).toBe(0);

    expect(offer(b.id)).toMatchObject({ status: 'cancelled', heldTk: 0 });
    expect(wallet('club', PADMA)).toMatchObject({ balanceTk: 5000, heldTk: 0 });
    expect(profile(users.locked).clubId).toBe(T4);
    expect(codesTo(users.locked)).toContain('transfer.cancelledAtCompletion');
    expect(codesTo(users.t4Pres)).toContain('transfer.cancelledAtCompletion');
  });

  it('a closed market makes a scheduled move wait instead of completing', async () => {
    const { service, users, offer, db, features } = t;
    db.commitments.set('p-locked', { tournamentId: 't-1', tournamentName: 'Night League', startAt: new Date(), endAt: null });
    const b = await service.createOffer(users.padmaPres, { clubId: PADMA, playerUserId: users.locked.id, amountTk: 0, paymentMethod: 'bkash' });
    await service.respond(users.locked, b.id, { accept: true });
    db.commitments.clear();
    features.transfersOpen = false;

    expect(await service.completeScheduled()).toBe(0);
    expect(offer(b.id).status).toBe('scheduled');
  });

  // ------------------------------------------------------- upcoming lineups

  it("takes a moving player out of his old club's upcoming lineups and tells its leaders", async () => {
    const { service, users, db, codesTo } = t;
    db.upcoming.set('p-locked', [
      { participantId: 'tp-1', tournamentId: 't-9', tournamentName: 'Winter Cup', entry: 'lineup' },
      { participantId: 'tp-2', tournamentId: 't-10', tournamentName: 'Club Solo Night', entry: 'solo' },
    ]);
    const b = await service.createOffer(users.padmaPres, { clubId: PADMA, playerUserId: users.locked.id, amountTk: 0, paymentMethod: 'bkash' });
    await service.respond(users.locked, b.id, { accept: true });

    expect(db.removedFromLineups).toEqual([{ participantIds: ['tp-1'], profileId: 'p-locked' }]);
    expect(codesTo(users.t4Pres)).toContain('transfer.lineupRemoved');
  });

  it('warns the old club when an agreed move waits, so it can pick a replacement for later tournaments', async () => {
    const { service, users, db, codesTo } = t;
    db.commitments.set('p-locked', { tournamentId: 't-1', tournamentName: 'Night League', startAt: new Date(), endAt: null });
    db.upcoming.set('p-locked', [{ participantId: 'tp-1', tournamentId: 't-9', tournamentName: 'Winter Cup', entry: 'lineup' }]);
    const b = await service.createOffer(users.padmaPres, { clubId: PADMA, playerUserId: users.locked.id, amountTk: 0, paymentMethod: 'bkash' });
    await service.respond(users.locked, b.id, { accept: true });

    expect(codesTo(users.t4Pres)).toContain('transfer.lineupWarning');
    expect(db.removedFromLineups).toHaveLength(0); // not until he moves
  });

  // -------------------------------------------------------------- contracts

  it('gives a member without a contract a 0 tk contract, once', async () => {
    const { db, users, activeContract } = t;
    expect(await ensureContract(db.dataSource, DEFAULT_TRANSFER_SETTINGS, users.padmaPres.id, PADMA)).toBe(true);
    expect(activeContract(users.padmaPres)).toMatchObject({ clubId: PADMA, frozenTk: 0, baseTk: 120, lockDays: 120 });
    expect(await ensureContract(db.dataSource, DEFAULT_TRANSFER_SETTINGS, users.padmaPres.id, PADMA)).toBe(false);
  });
});
