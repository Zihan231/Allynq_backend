import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Club } from '../clubs/entities/club.entity.js';
import { DEFAULT_TRANSFER_SETTINGS } from '../settings/settings.service.js';
import { Wallet } from '../transfers/entities/wallet.entity.js';
import { WalletTransaction } from '../transfers/entities/wallet-transaction.entity.js';
import { makeDb } from '../transfers/test/in-memory-db.js';
import { WalletsService } from '../transfers/wallets.service.js';
import { TournamentParticipant } from './entities/tournament-participant.entity.js';
import { Tournament } from './entities/tournament.entity.js';
import { TournamentMoneyService } from './tournament-money.service.js';

// A general tournament run by "organizer": 100 tk entry, 1000 tk prize; two players and a club enter.
describe('TournamentMoneyService (general tournaments)', () => {
  let db: ReturnType<typeof makeDb>;
  let money: TournamentMoneyService;
  let notifications: { createNotification: ReturnType<typeof vi.fn> };
  let tournament: Tournament;
  const entrant = (id: string) =>
    db.table(TournamentParticipant).find((p) => p.id === id)!;
  const wallet = (type: 'user' | 'club', id: string) =>
    db.table(Wallet).find((w) => w.ownerType === type && w.ownerId === id) as {
      balanceTk: number;
      heldTk: number;
    };
  const fund = (type: 'user' | 'club', id: string, balanceTk: number) =>
    db
      .table(Wallet)
      .push({
        id: `w-${id}`,
        ownerType: type,
        ownerId: id,
        balanceTk,
        heldTk: 0,
      });

  beforeEach(async () => {
    db = makeDb();
    const settings = {
      transfers: vi.fn().mockResolvedValue(DEFAULT_TRANSFER_SETTINGS),
    };
    notifications = { createNotification: vi.fn().mockResolvedValue({}) };
    money = new TournamentMoneyService(
      db.dataSource as never,
      new WalletsService(db.dataSource as never, settings as never),
      notifications as never,
    );
    fund('user', 'organizer', 2000);
    fund('user', 'p1', 300);
    fund('user', 'p2', 300);
    db.table(Club).push({ id: 'club-1', name: 'Padma' });
    tournament = {
      id: 't-1',
      name: 'Open Cup',
      creatorId: 'organizer',
      entryFeeBdt: 100,
      prizePoolBdt: 1000,
      prizeHeldTk: 0,
    } as Tournament;
    db.table(Tournament).push(tournament);
    for (const [id, type, owner] of [
      ['e1', 'player', 'p1'],
      ['e2', 'player', 'p2'],
      ['e3', 'club', 'club-1'],
    ] as const) {
      db.table(TournamentParticipant).push({
        id,
        tournamentId: 't-1',
        participantType: type,
        userId: type === 'player' ? owner : null,
        clubId: type === 'club' ? owner : null,
        registeredByUserId: type === 'player' ? owner : 'club-pres',
        feeHeldTk: 0,
        feePaidTk: 0,
      });
    }
  });

  const enterAll = () =>
    db.dataSource.transaction(async (em) => {
      for (const id of ['e1', 'e2', 'e3'])
        await money.chargeEntry(
          em as never,
          tournament,
          entrant(id) as never,
          'bkash',
        );
    });

  it('holds the prize from the organizer and each entry fee from the entrant (club wallet for a club)', async () => {
    await db.dataSource.transaction((em) =>
      money.holdPrize(em as never, tournament, 1000),
    );
    expect(wallet('user', 'organizer')).toMatchObject({
      balanceTk: 1000,
      heldTk: 1000,
    });

    await enterAll();
    expect(wallet('user', 'p1')).toMatchObject({ balanceTk: 200, heldTk: 100 });
    expect(wallet('club', 'club-1')).toMatchObject({
      balanceTk: DEFAULT_TRANSFER_SETTINGS.clubStartingBalanceTk - 100,
      heldTk: 100,
    });
    expect(entrant('e1')).toMatchObject({
      feeHeldTk: 100,
      paymentMethod: 'bkash',
      paymentRef: expect.stringMatching(/^TRX-/),
    });
    const ledger = db
      .table(WalletTransaction)
      .filter((tx) => tx.tournamentId === 't-1');
    expect(ledger.length).toBe(4); // prize hold + three entry holds
  });

  it('refunds an entrant who leaves', async () => {
    await enterAll();
    const back = await db.dataSource.transaction((em) =>
      money.refundEntry(em as never, tournament, entrant('e2') as never),
    );
    expect(back).toBe(100);
    expect(wallet('user', 'p2')).toMatchObject({ balanceTk: 300, heldTk: 0 });
  });

  it('pays the entry fees to the organizer when fixtures are out, and the prize to the champion', async () => {
    await db.dataSource.transaction((em) =>
      money.holdPrize(em as never, tournament, 1000),
    );
    await enterAll();

    expect(await money.payOutFees(tournament)).toBe(300);
    expect(wallet('user', 'organizer')).toMatchObject({
      balanceTk: 1300,
      heldTk: 1000,
    });
    expect(wallet('user', 'p1')).toMatchObject({ balanceTk: 200, heldTk: 0 });
    expect(entrant('e1')).toMatchObject({ feeHeldTk: 0, feePaidTk: 100 });

    await money.payPrize(tournament, 'e3');
    expect(wallet('club', 'club-1')).toMatchObject({
      balanceTk: DEFAULT_TRANSFER_SETTINGS.clubStartingBalanceTk - 100 + 1000,
    });
    expect(wallet('user', 'organizer')).toMatchObject({
      balanceTk: 1300,
      heldTk: 0,
    });
    expect(db.table(Tournament)[0].prizeHeldTk).toBe(0);
    const codes = notifications.createNotification.mock.calls.map(
      ([, n]) => (n as { code: string }).code,
    );
    expect(codes).toEqual(
      expect.arrayContaining(['tournament.feesPaidOut', 'tournament.prizeWon']),
    );
  });

  it('returns the prize to the organizer when there is no champion', async () => {
    await db.dataSource.transaction((em) =>
      money.holdPrize(em as never, tournament, 1000),
    );
    await money.payPrize(tournament, null);
    expect(wallet('user', 'organizer')).toMatchObject({
      balanceTk: 2000,
      heldTk: 0,
    });
  });

  it('a cancelled tournament refunds held fees, takes paid ones back from the organizer and returns the prize', async () => {
    await db.dataSource.transaction((em) =>
      money.holdPrize(em as never, tournament, 1000),
    );
    await enterAll();
    await money.payOutFees(tournament); // organizer 1300 balance, 1000 held

    const result = await money.settleCancel(tournament);

    expect(result).toEqual({ refunded: 300, shortfall: 0 });
    expect(wallet('user', 'p1')).toMatchObject({ balanceTk: 300, heldTk: 0 });
    expect(wallet('club', 'club-1')).toMatchObject({
      balanceTk: DEFAULT_TRANSFER_SETTINGS.clubStartingBalanceTk,
      heldTk: 0,
    });
    expect(wallet('user', 'organizer')).toMatchObject({
      balanceTk: 2000,
      heldTk: 0,
    });
    expect(entrant('e1')).toMatchObject({ feeHeldTk: 0, feePaidTk: 0 });
  });

  it('refunds what it can when the organizer has already spent the fees', async () => {
    await enterAll();
    await money.payOutFees(tournament);
    Object.assign(wallet('user', 'organizer'), { balanceTk: 150 });

    const result = await money.settleCancel(tournament);

    expect(result).toEqual({ refunded: 150, shortfall: 150 });
    expect(wallet('user', 'organizer').balanceTk).toBe(0);
  });
});
