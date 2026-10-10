import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import { Club } from '../../clubs/entities/club.entity.js';
import { DEFAULT_TRANSFER_SETTINGS } from '../../settings/settings.service.js';
import { EfootballProfile } from '../../users/entities/efootball-profile.entity.js';
import { Tournament } from '../../tournaments/entities/tournament.entity.js';
import { User } from '../../users/entities/user.entity.js';
import { lockEnd } from '../contract-fee.js';
import { PlayerContract } from '../entities/player-contract.entity.js';
import { PlayerLoan } from '../entities/player-loan.entity.js';
import { TransferOfferBid } from '../entities/transfer-offer-bid.entity.js';
import { TransferOffer } from '../entities/transfer-offer.entity.js';
import { Wallet } from '../entities/wallet.entity.js';
import { LoansService } from '../loans.service.js';
import { TransfersService } from '../transfers.service.js';
import { WalletsService } from '../wallets.service.js';

/* Test-only (excluded from the build): the in-memory database and setup shared by the transfer and loan specs. */
/**
 * A small in-memory stand-in for TypeORM: just the repository calls, row locks
 * and raw queries the transfer services use. A transaction that throws is rolled
 * back, like the real database.
 */
export type Row = Record<string, any>;

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (expected && typeof expected === 'object' && '_type' in expected) {
      if (expected._type === 'in') return (expected._value as unknown[]).includes(row[key]);
      if (expected._type === 'lessThanOrEqual') return row[key] <= expected._value;
      throw new Error(`Unsupported operator ${expected._type}`);
    }
    return row[key] === expected;
  });
}

export function makeDb() {
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
  /** Matches each player (by profile id) has played for his loan club. */
  const played = new Map<string, number>();
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
    if (params.loanId) return rows.find((r) => r.id === params.loanId) ?? null;
    if (params.userId) return rows.find((r) => r.id === params.userId) ?? null;
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
    if (sql.includes('FROM player_loans l JOIN clubs c')) {
      const loan = table(PlayerLoan).find(
        (l) => l.playerUserId === params[0] && ['scheduled', 'active', 'returning'].includes(l.status),
      );
      return loan ? [{ name: table(Club).find((c) => c.id === loan.borrowClubId)?.name }] : [];
    }
    if (sql.includes('FROM tournament_matches m')) return [{ n: played.get(params[0] as string) ?? 0 }];
    if (sql.includes('"prizeHeldTk" FROM tournaments')) {
      const t = table(Tournament).find((r) => r.id === params[0]);
      return t ? [{ prizeHeldTk: t.prizeHeldTk ?? 0 }] : [];
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
  return { dataSource, table, commitments, upcoming, removedFromLineups, played };
}

// ------------------------------------------------------------------- setup

export const PADMA = 'club-padma';
export const T4 = 'club-t4';

export function setup() {
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
  const loans = new LoansService(db.dataSource as never, settings as never, wallets, service, communities as never);
  vi.spyOn(loans, 'view').mockImplementation(async (id: string) => db.table(PlayerLoan).find((l) => l.id === id) as never);

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
  const loan = (id: string) => db.table(PlayerLoan).find((l) => l.id === id)!;
  return { db, service, loans, users, communities, offer, loan, wallet, profile, activeContract, codesTo, features, bids, settings };
}
