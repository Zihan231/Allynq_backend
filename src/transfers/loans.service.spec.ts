import { ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TRANSFER_SETTINGS } from '../settings/settings.service.js';
import { EfootballProfile } from '../users/entities/efootball-profile.entity.js';
import { User } from '../users/entities/user.entity.js';
import { lockEnd } from './contract-fee.js';
import { PlayerContract } from './entities/player-contract.entity.js';
import { PlayerLoanBid } from './entities/player-loan-bid.entity.js';
import { TransferOffer } from './entities/transfer-offer.entity.js';
import { loanPaymentStatus } from './loans.service.js';
import { PADMA, setup, T4 } from './test/in-memory-db.js';

// "locked" is under contract at t4 (the parent club); Padma borrows him.
describe('LoansService', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
  });

  const borrow = (feeTk = 100, terms: { matches?: number; maxDays?: number } = {}) =>
    t.loans.create(t.users.padmaPres, {
      clubId: PADMA,
      playerUserId: t.users.locked.id,
      feeTk,
      matches: terms.matches ?? 3,
      maxDays: terms.maxDays ?? 30,
      paymentMethod: 'bkash',
    });

  /** A loan that's running: requested by Padma and accepted by t4. */
  const running = async (terms: { matches?: number; maxDays?: number } = {}) => {
    const l = await borrow(100, terms);
    await t.loans.respond(t.users.t4Pres, l.id, { accept: true });
    return l;
  };

  it('negotiates the fee; on acceptance the fee goes to the parent club and he moves, keeping his contract', async () => {
    const { loans, users, loan, wallet, profile, activeContract, codesTo, communities, db } = t;
    const l = await borrow(100);
    expect(loan(l.id)).toMatchObject({ status: 'pending', turn: 'parent', parentClubId: T4, borrowClubId: PADMA, heldTk: 100 });
    expect(wallet('club', PADMA)).toMatchObject({ balanceTk: 4900, heldTk: 100 });
    expect(codesTo(users.t4Pres)).toContain('loan.requested');
    expect(codesTo(users.locked)).toContain('loan.proposed');

    // Not Padma's turn.
    await expect(loans.counter(users.padmaPres, l.id, { feeTk: 120 })).rejects.toThrow(ForbiddenException);
    await loans.counter(users.t4Pres, l.id, { feeTk: 150 });
    expect(loan(l.id)).toMatchObject({ turn: 'borrower', feeTk: 150, heldTk: 100 });
    expect(codesTo(users.padmaPres)).toContain('loan.counterReceived');

    await expect(loans.respond(users.padmaPres, l.id, { accept: true })).rejects.toThrow('payment method');
    await loans.respond(users.padmaPres, l.id, { accept: true, paymentMethod: 'nagad' });

    expect(loan(l.id)).toMatchObject({ status: 'active', heldTk: 0, matchesPlayed: 0 });
    expect(loan(l.id).endsBy.getTime() - loan(l.id).startedAt.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
    expect(wallet('club', PADMA)).toMatchObject({ balanceTk: 4850, heldTk: 0 });
    expect(wallet('club', T4)).toMatchObject({ balanceTk: 5150 });
    expect(profile(users.locked)).toMatchObject({ clubId: PADMA, clubRole: 'Player' });
    expect(activeContract(users.locked)).toMatchObject({ id: 'contract-locked', clubId: T4 });
    expect(communities.onClubMemberRemoved).toHaveBeenCalledWith(T4, 'p-locked');
    expect(communities.onClubMemberAdded).toHaveBeenCalledWith(PADMA, 'p-locked');
    expect(codesTo(users.locked)).toContain('loan.started');
    expect(db.table(PlayerLoanBid).map((b) => [b.party, b.feeTk])).toEqual([
      ['borrower', 100],
      ['parent', 150],
    ]);
  });

  it('a club can lend its own player out; the borrowing club pays when it accepts', async () => {
    const { loans, users, loan, wallet, profile } = t;
    const l = await loans.create(users.t4Pres, {
      clubId: T4,
      playerUserId: users.locked.id,
      otherClubId: PADMA,
      feeTk: 60,
      matches: 2,
      maxDays: 14,
    });
    expect(loan(l.id)).toMatchObject({ turn: 'borrower', heldTk: 0 });
    await loans.respond(users.padmaPres, l.id, { accept: true, paymentMethod: 'card' });

    expect(loan(l.id).status).toBe('active');
    expect(wallet('club', PADMA)).toMatchObject({ balanceTk: 4940, heldTk: 0 });
    expect(wallet('club', T4)).toMatchObject({ balanceTk: 5060 });
    expect(profile(users.locked).clubId).toBe(PADMA);
  });

  it('rejecting ends the talks and refunds the held fee; so does expiry', async () => {
    const { loans, users, loan, wallet, codesTo } = t;
    const l = await borrow(100);
    await loans.respond(users.t4Pres, l.id, { accept: false });
    expect(loan(l.id).status).toBe('declined');
    expect(wallet('club', PADMA)).toMatchObject({ balanceTk: 5000, heldTk: 0 });
    expect(codesTo(users.padmaPres)).toContain('loan.declined');
    expect(loanPaymentStatus(loan(l.id) as never)).toBe('refunded');

    const again = await borrow(80);
    loan(again.id).expiresAt = new Date(Date.now() - 60_000);
    expect(await loans.expireDue()).toBe(1);
    expect(loan(again.id).status).toBe('expired');
    expect(wallet('club', PADMA)).toMatchObject({ balanceTk: 5000, heldTk: 0 });
  });

  it("records the parent club's upcoming tournaments he can't play in for the borrowing club", async () => {
    const { loan, db } = t;
    db.upcoming.set('p-locked', [
      { participantId: 'tp-1', tournamentId: 't-cup', tournamentName: 'Winter Cup', entry: 'lineup' },
      { participantId: 'tp-2', tournamentId: 't-solo', tournamentName: 'Club Solo Night', entry: 'solo' },
    ]);
    const l = await running();
    expect(loan(l.id).cupTiedTournamentIds).toEqual(['t-cup']);
  });

  it('waits for a tournament he is playing with the parent club, then starts', async () => {
    const { loans, users, loan, profile, db } = t;
    db.commitments.set('p-locked', { tournamentId: 't-1', tournamentName: 'Night League', startAt: new Date(), endAt: null });
    const l = await running();
    expect(loan(l.id)).toMatchObject({ status: 'scheduled', scheduledTournamentId: 't-1', heldTk: 100 });
    expect(profile(users.locked).clubId).toBe(T4);

    expect(await loans.startScheduled()).toBe(0);
    db.commitments.clear();
    expect(await loans.startScheduled()).toBe(1);
    expect(loan(l.id).status).toBe('active');
    expect(profile(users.locked).clubId).toBe(PADMA);
  });

  it('brings him back once he has played the agreed matches, out of the borrowing club lineups', async () => {
    const { loans, users, loan, profile, db, codesTo } = t;
    const l = await running({ matches: 2 });
    db.played.set('p-locked', 1);
    expect(await loans.progress()).toBe(0);
    expect(loan(l.id)).toMatchObject({ status: 'active', matchesPlayed: 1 });

    db.played.set('p-locked', 2);
    db.upcoming.set('p-locked', [{ participantId: 'tp-9', tournamentId: 't-9', tournamentName: 'Padma Cup', entry: 'lineup' }]);
    expect(await loans.progress()).toBe(1);

    expect(loan(l.id)).toMatchObject({ status: 'completed', endReason: 'matches', matchesPlayed: 2 });
    expect(profile(users.locked).clubId).toBe(T4);
    expect(db.removedFromLineups).toEqual([{ participantIds: ['tp-9'], profileId: 'p-locked' }]);
    expect(codesTo(users.locked)).toContain('loan.returned');
    expect(codesTo(users.padmaPres)).toContain('loan.lineupRemoved');
  });

  it('brings him back when the days run out, even short of the matches', async () => {
    const { loans, users, loan, profile } = t;
    const l = await running({ matches: 5, maxDays: 7 });
    expect(await loans.progress(new Date(Date.now() + 8 * 24 * 60 * 60 * 1000))).toBe(1);
    expect(loan(l.id)).toMatchObject({ status: 'completed', endReason: 'time' });
    expect(profile(users.locked).clubId).toBe(T4);
  });

  it('a finished loan waits for a tournament he is playing for the borrowing club', async () => {
    const { loans, users, loan, profile, db, codesTo } = t;
    const l = await running({ matches: 1 });
    db.played.set('p-locked', 1);
    db.commitments.set('p-locked', { tournamentId: 't-2', tournamentName: 'Padma Derby', startAt: new Date(), endAt: null });
    expect(await loans.progress()).toBe(0);
    expect(loan(l.id)).toMatchObject({ status: 'returning', scheduledTournamentId: 't-2', endReason: 'matches' });
    expect(profile(users.locked).clubId).toBe(PADMA);
    expect(codesTo(users.t4Pres)).toContain('loan.returning');

    db.commitments.clear();
    expect(await loans.progress()).toBe(1);
    expect(loan(l.id).status).toBe('completed');
    expect(profile(users.locked).clubId).toBe(T4);
  });

  it('the borrowing club can buy him at his current fee: new contract, transfer history, loan over', async () => {
    const { loans, users, loan, wallet, profile, activeContract, db, codesTo } = t;
    const l = await running();
    await expect(loans.buy(users.t4Pres, l.id, { paymentMethod: 'card' })).rejects.toThrow(ForbiddenException);
    await loans.buy(users.padmaPres, l.id, { paymentMethod: 'card' });

    expect(loan(l.id)).toMatchObject({ status: 'completed', endReason: 'bought' });
    // Fee: 0 tk frozen + the 120 tk base, barely decayed.
    expect(wallet('club', T4)).toMatchObject({ balanceTk: 5100 + 120 });
    expect(wallet('club', PADMA)).toMatchObject({ balanceTk: 4900 - 120, heldTk: 0 });
    expect(db.table(PlayerContract).find((c) => c.id === 'contract-locked')).toMatchObject({ status: 'ended', endReason: 'transfer' });
    expect(activeContract(users.locked)).toMatchObject({ clubId: PADMA, frozenTk: 120 });
    expect(db.table(TransferOffer).find((o) => o.kind === 'buyout')).toMatchObject({
      status: 'completed',
      fromClubId: T4,
      toClubId: PADMA,
      amountTk: 120,
    });
    expect(profile(users.locked).clubId).toBe(PADMA);
    expect(codesTo(users.locked)).toContain('loan.bought');
  });

  it('blocks transfers and another loan while he is on loan', async () => {
    const { service, users } = t;
    await running();
    await expect(
      service.createOffer(users.t4Pres, { clubId: T4, playerUserId: users.locked.id, amountTk: 10, paymentMethod: 'bkash' }),
    ).rejects.toThrow(/on loan at Padma/);
    await expect(borrow(50)).rejects.toThrow(/open loan deal/);
  });

  it('caps the matches, the days and the loans a club can have at once', async () => {
    const { loans, users, db, settings } = t;
    await expect(borrow(10, { matches: 11 })).rejects.toThrow('1 to 10 matches');
    await expect(borrow(10, { maxDays: 61 })).rejects.toThrow('7 to 60 days');

    // A second t4 player under contract, and a limit of one loan per club.
    const other = { id: 'u-other', name: 'other' } as User;
    db.table(User).push(other);
    db.table(EfootballProfile).push({ id: 'p-other', userId: other.id, clubId: T4, clubRole: 'Player', teamId: null, user: other });
    const now = new Date();
    db.table(PlayerContract).push({
      id: 'contract-other',
      contractNo: 'ALQ-2026-000002',
      userId: other.id,
      clubId: T4,
      frozenTk: 0,
      baseTk: 120,
      lockDays: 120,
      startAt: now,
      lockEndsAt: lockEnd(now, 120),
      status: 'active',
    });
    settings.transfers.mockResolvedValue({ ...DEFAULT_TRANSFER_SETTINGS, maxLoansPerClub: 1 });
    await running();
    await expect(
      loans.create(users.padmaPres, { clubId: PADMA, playerUserId: other.id, feeTk: 0, matches: 2, maxDays: 14 }),
    ).rejects.toThrow('at most 1 players on loan');
  });

  it('staff can end a running loan early; he goes back to the parent club', async () => {
    const { loans, users, loan, profile, codesTo } = t;
    const l = await running();
    await loans.staffEnd(l.id, 'Dispute between the clubs');
    expect(loan(l.id)).toMatchObject({ status: 'completed', endReason: 'staff' });
    expect(profile(users.locked).clubId).toBe(T4);
    expect(codesTo(users.locked)).toContain('loan.endedByStaff');
  });
});
