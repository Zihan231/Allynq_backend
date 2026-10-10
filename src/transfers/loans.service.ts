import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, In, LessThanOrEqual } from 'typeorm';
import { Club } from '../clubs/entities/club.entity.js';
import { assertNotFrozen } from '../common/frozen.js';
import { CommunitiesService } from '../communities/communities.service.js';
import { SettingsService, type TransferSettings } from '../settings/settings.service.js';
import { EfootballProfile } from '../users/entities/efootball-profile.entity.js';
import { User } from '../users/entities/user.entity.js';
import { ClubRole } from '../users/enums/user-attributes.enum.js';
import { currentFee, paymentRef } from './contract-fee.js';
import { startContract } from './contracts.js';
import type { BuyLoanDto, CounterLoanDto, CreateLoanDto, RespondOfferDto } from './dto/transfer.dto.js';
import { PlayerLoanBid } from './entities/player-loan-bid.entity.js';
import {
  OPEN_LOAN_STATUSES,
  PlayerLoan,
  type LoanEndReason,
  type LoanParty,
  type LoanStatus,
} from './entities/player-loan.entity.js';
import { TransferOffer, type PaymentMethod } from './entities/transfer-offer.entity.js';
import { TransfersService, type ClubCommitment, type Notice, type PaymentStatus, type UpcomingEntry } from './transfers.service.js';
import { WalletsService, type WalletOwner } from './wallets.service.js';

const PLAYER_LINK = '/dashboard/efootball/transfers';
const clubLink = (clubId: string) => `/dashboard/efootball/clubs/${clubId}?tab=transfers`;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Loans that tie a player to the borrowing club (or are about to); they count toward its limit. */
const RUNNING: LoanStatus[] = ['scheduled', 'active', 'returning'];

interface ClubRef {
  id: string;
  name: string;
  dpUrl: string | null;
  color: string | null;
}

export interface LoanView {
  id: string;
  status: LoanStatus;
  /** Which club answers next while pending. */
  turn: LoanParty;
  feeTk: number;
  heldTk: number;
  paymentStatus: PaymentStatus;
  matches: number;
  matchesPlayed: number;
  maxDays: number;
  message: string | null;
  player: { id: string; name: string; dpUrl: string | null };
  parentClub: ClubRef;
  borrowClub: ClubRef;
  createdByUserId: string;
  expiresAt: string;
  createdAt: string;
  startedAt: string | null;
  endsBy: string | null;
  endedAt: string | null;
  endReason: LoanEndReason | null;
  paymentMethod: PaymentMethod | null;
  paymentRef: string | null;
  paidAt: string | null;
  /** While scheduled / returning: the tournament he has to finish first. */
  scheduledTournament: ClubCommitment | null;
  /** While he's on loan: what the borrowing club pays to buy him now (his current transfer fee). */
  buyPriceTk: number | null;
}

export interface LoanBidView {
  id: string;
  party: LoanParty;
  byUserId: string;
  byName: string | null;
  feeTk: number;
  message: string | null;
  createdAt: string;
}

type Recipient = { to: 'player' | LoanParty; notice: Notice };

/** Where the borrowing club's money for a loan is. */
export function loanPaymentStatus(l: Pick<PlayerLoan, 'status' | 'feeTk' | 'heldTk' | 'paidAt'>): PaymentStatus {
  if (l.heldTk > 0) return 'held';
  if (!l.paidAt || l.feeTk <= 0) return 'none';
  return ['declined', 'cancelled', 'expired'].includes(l.status) ? 'refunded' : 'paid';
}

/**
 * Player loans. A club lends a player (keeping his contract) to another club for a
 * number of matches, or at most a number of days. Only the two clubs agree; the fee
 * can be countered back and forth and is paid by the borrowing club: held while the
 * deal is open, paid to the parent club when the loan starts. The per-minute tick
 * expires proposals, starts loans waiting for a tournament, counts matches and
 * brings players back. The borrowing club can buy the player at his current fee.
 */
@Injectable()
export class LoansService {
  private readonly logger = new Logger(LoansService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly settingsService: SettingsService,
    private readonly walletsService: WalletsService,
    private readonly transfers: TransfersService,
    private readonly communitiesService: CommunitiesService,
  ) {}

  // ------------------------------------------------------------------ helpers

  private clubOfParty(loan: PlayerLoan, party: LoanParty): string {
    return party === 'parent' ? loan.parentClubId : loan.borrowClubId;
  }

  private borrowerWallet(loan: PlayerLoan): WalletOwner {
    return { type: 'club', id: loan.borrowClubId };
  }

  private async lockLoan(em: EntityManager, loanId: string): Promise<PlayerLoan> {
    const loan = await em
      .getRepository(PlayerLoan)
      .createQueryBuilder('l')
      .setLock('pessimistic_write')
      .where('l.id = :loanId', { loanId })
      .getOne();
    if (!loan) throw new NotFoundException('Loan not found');
    return loan;
  }

  /** Only the club whose turn it is may accept, reject or counter. */
  private async assertTurn(em: EntityManager, loan: PlayerLoan, callerId: string): Promise<void> {
    await this.transfers.assertClubLeader(em, this.clubOfParty(loan, loan.turn), callerId);
  }

  private assertTerms(matches: number, maxDays: number, settings: TransferSettings): void {
    if (matches < 1 || matches > settings.maxLoanMatches) {
      throw new BadRequestException(`A loan can be for 1 to ${settings.maxLoanMatches} matches`);
    }
    if (maxDays < 7 || maxDays > settings.maxLoanDays) {
      throw new BadRequestException(`A loan can last 7 to ${settings.maxLoanDays} days`);
    }
  }

  /** No other open loan and no transfer waiting to complete. */
  private async assertFree(em: EntityManager, playerUserId: string, loanId: string | null): Promise<void> {
    const open = await em.getRepository(PlayerLoan).findOne({ where: { playerUserId, status: In(OPEN_LOAN_STATUSES) } });
    if (open && open.id !== loanId) throw new BadRequestException('This player already has an open loan deal');
    const scheduled = await em.getRepository(TransferOffer).findOne({ where: { playerUserId, status: 'scheduled' } });
    if (scheduled) throw new BadRequestException('This player has a transfer waiting for a tournament to end');
  }

  /** The borrowing club may have at most `maxLoansPerClub` loans running. */
  private async assertCapacity(em: EntityManager, borrowClubId: string, settings: TransferSettings, loanId: string | null) {
    const running = await em.getRepository(PlayerLoan).find({ where: { borrowClubId, status: In(RUNNING) } });
    if (running.filter((l) => l.id !== loanId).length >= settings.maxLoansPerClub) {
      throw new BadRequestException(`A club can have at most ${settings.maxLoansPerClub} players on loan at once`);
    }
  }

  /** Brings the borrowing club's hold up (or down) to the fee on the table. */
  private async charge(em: EntityManager, loan: PlayerLoan, playerName: string, method: PaymentMethod | undefined, now: Date) {
    if (loan.feeTk === loan.heldTk && (loan.feeTk === 0 || loan.paidAt)) return;
    loan.paymentMethod = loan.feeTk > 0 ? (method ?? loan.paymentMethod) : null;
    loan.paymentRef = loan.feeTk > 0 ? paymentRef() : null;
    loan.paidAt = loan.feeTk > 0 ? now : null;
    await this.walletsService.rehold(em, this.borrowerWallet(loan), loan.heldTk, loan.feeTk, {
      loanId: loan.id,
      counterparty: `Loan: ${playerName}`,
      reference: loan.paymentRef,
    });
    loan.heldTk = loan.feeTk;
  }

  /** Returns the held fee to the borrowing club and saves the loan (the caller sets the status first). */
  private async refundHold(em: EntityManager, loan: PlayerLoan, playerName: string): Promise<void> {
    const held = loan.heldTk;
    loan.heldTk = 0;
    loan.scheduledTournamentId = null;
    await em.save(loan);
    if (held > 0) {
      await this.walletsService.refund(em, this.borrowerWallet(loan), held, { loanId: loan.id, counterparty: `Loan: ${playerName}` });
    }
  }

  private async recordBid(em: EntityManager, loan: PlayerLoan, party: LoanParty, byUserId: string, message: string | null) {
    await em.getRepository(PlayerLoanBid).insert({ loanId: loan.id, party, byUserId, feeTk: loan.feeTk, message });
  }

  private async names(em: EntityManager, loan: PlayerLoan) {
    const [parent, borrower] = await Promise.all([
      this.transfers.clubOf(em, loan.parentClubId),
      this.transfers.clubOf(em, loan.borrowClubId),
    ]);
    return { parent, borrower };
  }

  private async dispatch(loan: PlayerLoan, recipients: Recipient[]): Promise<void> {
    for (const { to, notice } of recipients) {
      const ids =
        to === 'player' ? [loan.playerUserId] : await this.transfers.clubLeaderIds(this.clubOfParty(loan, to));
      await this.transfers.notifyUsers(ids, { ...notice, params: { ...notice.params, loanId: loan.id } });
    }
  }

  /** The same notice to the player and both clubs, each with its own link. */
  private toAll(notice: Omit<Notice, 'link'>, loan: PlayerLoan): Recipient[] {
    return [
      { to: 'player', notice: { ...notice, link: PLAYER_LINK } },
      { to: 'parent', notice: { ...notice, link: clubLink(loan.parentClubId) } },
      { to: 'borrower', notice: { ...notice, link: clubLink(loan.borrowClubId) } },
    ];
  }

  // ------------------------------------------------------------------ create

  /**
   * A club leader proposes a loan: a borrow request for another club's player, or
   * (player in his club, `otherClubId` set) lending his player out. The borrowing
   * club's fee is held at once; the other club answers.
   */
  async create(caller: User, dto: CreateLoanDto): Promise<LoanView> {
    const settings = await this.settingsService.transfers();
    this.assertTerms(dto.matches, dto.maxDays, settings);
    await this.transfers.assertMarketOpen();
    const recipients: Recipient[] = [];

    const loanId = await this.dataSource.transaction(async (em) => {
      await this.transfers.assertClubLeader(em, dto.clubId, caller.id);
      const profile = await this.transfers.profileOf(em, dto.playerUserId);
      const playerName = profile.user?.name ?? 'Player';
      await this.assertFree(em, profile.userId, null);
      const lending = profile.clubId === dto.clubId;
      let parentClubId: string;
      let borrowClubId: string;
      if (lending) {
        if (!dto.otherClubId || dto.otherClubId === dto.clubId) throw new BadRequestException('Choose the club to lend him to');
        [parentClubId, borrowClubId] = [dto.clubId, dto.otherClubId];
      } else {
        if (!profile.clubId) {
          throw new BadRequestException("This player has no club to borrow him from. Make him a transfer offer instead.");
        }
        [parentClubId, borrowClubId] = [profile.clubId, dto.clubId];
      }
      const parent = await this.transfers.clubOf(em, parentClubId);
      const borrower = await this.transfers.clubOf(em, borrowClubId);
      await assertNotFrozen(em, 'club', parentClubId);
      await assertNotFrozen(em, 'club', borrowClubId);
      await this.transfers.assertTransferable(profile, 'player');
      const contract = await this.transfers.activeContract(em, profile.userId);
      if (!contract || contract.clubId !== parentClubId) {
        throw new BadRequestException(`${playerName} has no contract with ${parent.name}, so he can't be loaned`);
      }
      await this.assertCapacity(em, borrowClubId, settings, null);

      const party: LoanParty = lending ? 'parent' : 'borrower';
      if (party === 'borrower' && dto.feeTk > 0 && !dto.paymentMethod) throw new BadRequestException('Choose a payment method');
      const now = new Date();
      const message = dto.message?.trim() || null;
      const loan = em.getRepository(PlayerLoan).create({
        playerUserId: profile.userId,
        parentClubId,
        borrowClubId,
        contractId: contract.id,
        feeTk: dto.feeTk,
        heldTk: 0,
        matches: dto.matches,
        maxDays: dto.maxDays,
        matchesPlayed: 0,
        turn: lending ? 'borrower' : 'parent',
        status: 'pending',
        endReason: null,
        message,
        createdByUserId: caller.id,
        expiresAt: new Date(now.getTime() + settings.offerExpiryDays * DAY_MS),
        paymentMethod: null,
        paymentRef: null,
        paidAt: null,
        scheduledTournamentId: null,
        startedAt: null,
        endsBy: null,
        endedAt: null,
      });
      await em.save(loan);
      if (party === 'borrower') {
        await this.charge(em, loan, playerName, dto.paymentMethod, now);
        await em.save(loan);
      }
      await this.recordBid(em, loan, party, caller.id, message);

      const params = {
        player: playerName,
        parentClub: parent.name,
        borrowClub: borrower.name,
        amount: loan.feeTk,
        matches: loan.matches,
        days: loan.maxDays,
        expiresAt: loan.expiresAt.toISOString(),
      };
      const other: LoanParty = lending ? 'borrower' : 'parent';
      recipients.push({
        to: other,
        notice: {
          code: 'loan.requested',
          title: lending ? 'Loan offer' : 'Loan request',
          message: lending
            ? `${parent.name} offers to lend you ${playerName} for ${loan.matches} matches (${loan.feeTk} tk).`
            : `${borrower.name} wants ${playerName} on loan for ${loan.matches} matches (${loan.feeTk} tk).`,
          link: clubLink(this.clubOfParty(loan, other)),
          params,
        },
      });
      recipients.push({
        to: 'player',
        notice: {
          code: 'loan.proposed',
          title: 'Loan talks',
          message: `${parent.name} and ${borrower.name} are discussing a loan for you (${loan.matches} matches).`,
          link: PLAYER_LINK,
          params,
        },
      });
      return loan.id;
    });

    const loan = await this.dataSource.getRepository(PlayerLoan).findOneOrFail({ where: { id: loanId } });
    await this.dispatch(loan, recipients);
    return this.view(loanId);
  }

  // ----------------------------------------------------------------- respond

  /** The club whose turn it is accepts (the loan starts, or waits for a tournament) or rejects (ends the talks). */
  async respond(caller: User, loanId: string, dto: RespondOfferDto): Promise<LoanView> {
    const settings = await this.settingsService.transfers();
    const recipients: Recipient[] = [];
    let started: UpcomingEntry[] | null = null;

    await this.dataSource.transaction(async (em) => {
      const loan = await this.lockLoan(em, loanId);
      if (loan.status !== 'pending') throw new BadRequestException(`This loan is already ${loan.status}`);
      if (loan.expiresAt <= new Date()) throw new BadRequestException('This loan proposal has expired');
      await this.assertTurn(em, loan, caller.id);
      const byBorrower = loan.turn === 'borrower';
      const other: LoanParty = byBorrower ? 'parent' : 'borrower';
      const profile = await this.transfers.profileOf(em, loan.playerUserId);
      const playerName = profile.user?.name ?? 'Player';
      const { parent, borrower } = await this.names(em, loan);
      const params = { player: playerName, parentClub: parent.name, borrowClub: borrower.name, amount: loan.feeTk, matches: loan.matches };

      if (!dto.accept) {
        loan.status = 'declined';
        await this.refundHold(em, loan, playerName);
        recipients.push({
          to: other,
          notice: {
            code: 'loan.declined',
            title: 'Loan declined',
            message: `${byBorrower ? borrower.name : parent.name} declined the loan of ${playerName}. These talks are closed.`,
            link: clubLink(this.clubOfParty(loan, other)),
            params,
          },
        });
        return;
      }

      await this.transfers.assertMarketOpen();
      await assertNotFrozen(em, 'club', loan.parentClubId);
      await assertNotFrozen(em, 'club', loan.borrowClubId);
      if ((profile.clubId ?? null) !== loan.parentClubId) {
        throw new BadRequestException('The player has moved since this loan was proposed');
      }
      await this.transfers.assertTransferable(profile, 'player');
      await this.assertFree(em, profile.userId, loan.id);
      await this.assertCapacity(em, loan.borrowClubId, settings, loan.id);
      const now = new Date();
      if (byBorrower) {
        if (loan.feeTk > loan.heldTk && !dto.paymentMethod) throw new BadRequestException('Choose a payment method');
        await this.charge(em, loan, playerName, dto.paymentMethod, now);
      }

      recipients.push({
        to: other,
        notice: {
          code: 'loan.accepted',
          title: 'Loan agreed',
          message: `${byBorrower ? borrower.name : parent.name} accepted the loan of ${playerName} for ${loan.feeTk} tk.`,
          link: clubLink(this.clubOfParty(loan, other)),
          params,
        },
      });

      const commitment = await this.transfers.clubCommitment(em, profile);
      if (commitment) {
        loan.status = 'scheduled';
        loan.scheduledTournamentId = commitment.tournamentId;
        await em.save(loan);
        recipients.push(
          ...this.toAll(
            {
              code: 'loan.scheduled',
              title: 'Loan scheduled',
              message: `${playerName} is in "${commitment.tournamentName}" with ${parent.name}. His loan to ${borrower.name} starts when it ends.`,
              params: { ...params, tournament: commitment.tournamentName },
            },
            loan,
          ),
        );
        return;
      }
      started = await this.startInTransaction(em, loan, profile);
    });

    const loan = await this.dataSource.getRepository(PlayerLoan).findOneOrFail({ where: { id: loanId } });
    await this.dispatch(loan, recipients);
    if (started) await this.afterStart(loan, started);
    return this.view(loanId);
  }

  // ----------------------------------------------------------------- counter

  /** The club whose turn it is answers with a new fee; a borrowing club's counter is held at once. */
  async counter(caller: User, loanId: string, dto: CounterLoanDto): Promise<LoanView> {
    const settings = await this.settingsService.transfers();
    await this.transfers.assertMarketOpen();
    const recipients: Recipient[] = [];

    await this.dataSource.transaction(async (em) => {
      const loan = await this.lockLoan(em, loanId);
      if (loan.status !== 'pending') throw new BadRequestException(`This loan is already ${loan.status}`);
      if (loan.expiresAt <= new Date()) throw new BadRequestException('This loan proposal has expired');
      await this.assertTurn(em, loan, caller.id);
      const party = loan.turn;
      if (dto.feeTk === loan.feeTk) {
        throw new BadRequestException(`${loan.feeTk} tk is already on the table. Accept it instead of countering.`);
      }
      await assertNotFrozen(em, 'club', this.clubOfParty(loan, party));
      const profile = await this.transfers.profileOf(em, loan.playerUserId);
      const playerName = profile.user?.name ?? 'Player';
      const { parent, borrower } = await this.names(em, loan);
      const now = new Date();

      loan.feeTk = dto.feeTk;
      if (party === 'borrower') {
        if (dto.feeTk > loan.heldTk && !dto.paymentMethod) throw new BadRequestException('Choose a payment method');
        await this.charge(em, loan, playerName, dto.paymentMethod, now);
      }
      loan.turn = party === 'parent' ? 'borrower' : 'parent';
      loan.expiresAt = new Date(now.getTime() + settings.offerExpiryDays * DAY_MS);
      await em.save(loan);
      const message = dto.message?.trim() || null;
      await this.recordBid(em, loan, party, caller.id, message);

      const fromName = party === 'parent' ? parent.name : borrower.name;
      recipients.push({
        to: loan.turn,
        notice: {
          code: 'loan.counterReceived',
          title: 'Loan counter-offer',
          message: `${fromName} counters with ${loan.feeTk} tk for ${playerName}'s loan.`,
          link: clubLink(this.clubOfParty(loan, loan.turn)),
          params: {
            player: playerName,
            parentClub: parent.name,
            borrowClub: borrower.name,
            amount: loan.feeTk,
            expiresAt: loan.expiresAt.toISOString(),
            message,
          },
        },
      });
    });

    const loan = await this.dataSource.getRepository(PlayerLoan).findOneOrFail({ where: { id: loanId } });
    await this.dispatch(loan, recipients);
    return this.view(loanId);
  }

  // ------------------------------------------------------------------ cancel

  /** The club waiting for an answer withdraws its proposal (a held fee is refunded). */
  async cancel(caller: User, loanId: string): Promise<LoanView> {
    const recipients: Recipient[] = [];
    await this.dataSource.transaction(async (em) => {
      const loan = await this.lockLoan(em, loanId);
      if (loan.status !== 'pending') throw new BadRequestException(`This loan is already ${loan.status}`);
      const waiting: LoanParty = loan.turn === 'parent' ? 'borrower' : 'parent';
      await this.transfers.assertClubLeader(em, this.clubOfParty(loan, waiting), caller.id);
      const profile = await this.transfers.profileOf(em, loan.playerUserId);
      const playerName = profile.user?.name ?? 'Player';
      const { parent, borrower } = await this.names(em, loan);
      loan.status = 'cancelled';
      await this.refundHold(em, loan, playerName);
      recipients.push({
        to: loan.turn,
        notice: {
          code: 'loan.withdrawn',
          title: 'Loan withdrawn',
          message: `${waiting === 'parent' ? parent.name : borrower.name} withdrew the loan proposal for ${playerName}.`,
          link: clubLink(this.clubOfParty(loan, loan.turn)),
          params: { player: playerName, parentClub: parent.name, borrowClub: borrower.name },
        },
      });
    });
    const loan = await this.dataSource.getRepository(PlayerLoan).findOneOrFail({ where: { id: loanId } });
    await this.dispatch(loan, recipients);
    return this.view(loanId);
  }

  // ------------------------------------------------------------- start / end

  /**
   * Pays the fee to the parent club, takes him out of the parent club's upcoming
   * lineups and moves him to the borrowing club. His contract is untouched. Runs in
   * the caller's transaction; returns the parent club's tournaments he was entered for.
   */
  private async startInTransaction(em: EntityManager, loan: PlayerLoan, profile: EfootballProfile & { user?: User }) {
    const now = new Date();
    const playerName = profile.user?.name ?? 'Player';
    const { parent, borrower } = await this.names(em, loan);
    if (loan.feeTk > 0) {
      await this.walletsService.payOut(em, this.borrowerWallet(loan), { type: 'club', id: loan.parentClubId }, loan.feeTk, {
        loanId: loan.id,
        fromName: borrower.name,
        toName: parent.name,
        reference: loan.paymentRef,
      });
    }
    loan.heldTk = 0;

    const entries = await this.transfers.upcomingEntries(em, profile);
    await this.transfers.removeFromLineups(
      em,
      entries.filter((e) => e.entry === 'lineup').map((e) => e.participantId),
      profile.id,
    );
    await em.getRepository(EfootballProfile).update({ id: profile.id }, { clubId: loan.borrowClubId, clubRole: ClubRole.PLAYER, teamId: null });
    await this.transfers.closeOpenOffers(em, loan.playerUserId, playerName);

    // He can't turn out for the borrowing club in tournaments he was entered in for his own club.
    loan.cupTiedTournamentIds = [...new Set(entries.filter((e) => e.entry === 'lineup').map((e) => e.tournamentId))];
    loan.status = 'active';
    loan.startedAt = now;
    loan.endsBy = new Date(now.getTime() + loan.maxDays * DAY_MS);
    loan.scheduledTournamentId = null;
    loan.matchesPlayed = 0;
    await em.save(loan);
    return entries;
  }

  /** Community membership and notices once a loan has started (after commit). */
  private async afterStart(loan: PlayerLoan, entries: UpcomingEntry[]): Promise<void> {
    const profile = await this.dataSource.getRepository(EfootballProfile).findOne({ where: { userId: loan.playerUserId }, relations: { user: true } });
    if (!profile) return;
    await this.moveCommunities(loan.parentClubId, loan.borrowClubId, profile.id, loan.id);
    const { parent, borrower } = await this.names(this.dataSource.manager, loan);
    const playerName = profile.user?.name ?? 'Player';
    const params = {
      player: playerName,
      parentClub: parent.name,
      borrowClub: borrower.name,
      matches: loan.matches,
      endsBy: loan.endsBy?.toISOString() ?? null,
    };
    const recipients = this.toAll(
      {
        code: 'loan.started',
        title: 'Loan started',
        message: `${playerName} joined ${borrower.name} on loan from ${parent.name} for ${loan.matches} matches.`,
        params,
      },
      loan,
    );
    if (entries.length) {
      const names = [...new Set(entries.map((e) => e.tournamentName))].join(', ');
      recipients.push({
        to: 'parent',
        notice: {
          code: 'loan.lineupRemoved',
          title: 'Pick a replacement',
          message: `${playerName} is on loan at ${borrower.name}. He was entered for ${names} and has been taken out of those lineups.`,
          link: clubLink(loan.parentClubId),
          params: { ...params, club: parent.name, tournaments: names },
        },
      });
    }
    await this.dispatch(loan, recipients);
  }

  /**
   * Brings him back to the parent club (or leaves him clubless if it's gone), taking
   * him out of the borrowing club's upcoming lineups. Runs in the caller's transaction.
   */
  private async returnInTransaction(em: EntityManager, loan: PlayerLoan, profile: EfootballProfile, reason: LoanEndReason) {
    const entries = await this.transfers.upcomingEntries(em, profile);
    await this.transfers.removeFromLineups(
      em,
      entries.filter((e) => e.entry === 'lineup').map((e) => e.participantId),
      profile.id,
    );
    const parent = await em.getRepository(Club).findOne({ where: { id: loan.parentClubId } });
    await em
      .getRepository(EfootballProfile)
      .update(
        { id: profile.id },
        parent ? { clubId: parent.id, clubRole: ClubRole.PLAYER, teamId: null } : { clubId: null, clubRole: null, teamId: null },
      );
    loan.status = 'completed';
    loan.endReason = loan.endReason ?? reason;
    loan.endedAt = new Date();
    loan.scheduledTournamentId = null;
    await em.save(loan);
    return entries;
  }

  /** Community membership and notices once he is back (after commit). */
  private async afterReturn(loan: PlayerLoan, entries: UpcomingEntry[], staffReason?: string): Promise<void> {
    const profile = await this.dataSource.getRepository(EfootballProfile).findOne({ where: { userId: loan.playerUserId }, relations: { user: true } });
    if (!profile) return;
    await this.moveCommunities(loan.borrowClubId, loan.parentClubId, profile.id, loan.id);
    const { parent, borrower } = await this.names(this.dataSource.manager, loan);
    const playerName = profile.user?.name ?? 'Player';
    const params = {
      player: playerName,
      parentClub: parent.name,
      borrowClub: borrower.name,
      matches: loan.matches,
      played: loan.matchesPlayed,
      reason: staffReason ?? loan.endReason,
    };
    const recipients = this.toAll(
      staffReason
        ? {
            code: 'loan.endedByStaff',
            title: 'Loan ended by ALLYNQ staff',
            message: `${playerName}'s loan at ${borrower.name} was ended by ALLYNQ staff: ${staffReason}. He is back at ${parent.name}.`,
            params,
          }
        : {
            code: 'loan.returned',
            title: 'Back from loan',
            message: `${playerName}'s loan at ${borrower.name} is over (${loan.matchesPlayed}/${loan.matches} matches). He is back at ${parent.name}.`,
            params,
          },
      loan,
    );
    if (entries.length) {
      const names = [...new Set(entries.map((e) => e.tournamentName))].join(', ');
      recipients.push({
        to: 'borrower',
        notice: {
          code: 'loan.lineupRemoved',
          title: 'Pick a replacement',
          message: `${playerName}'s loan is over. He was entered for ${names} and has been taken out of those lineups.`,
          link: clubLink(loan.borrowClubId),
          params: { ...params, club: borrower.name, tournaments: names },
        },
      });
    }
    await this.dispatch(loan, recipients);
  }

  private async moveCommunities(fromClubId: string, toClubId: string, profileId: string, loanId: string): Promise<void> {
    try {
      await this.communitiesService.onClubMemberRemoved(fromClubId, profileId);
      await this.communitiesService.onClubMemberAdded(toClubId, profileId);
    } catch (err) {
      this.logger.error(`Community membership update for loan ${loanId} failed: ${(err as Error).message}`);
    }
  }

  /**
   * Matches he has played for the borrowing club since the loan started: completed
   * fixtures where the borrowing club's side had him in at least one game.
   */
  private async countMatches(em: EntityManager, loan: PlayerLoan, profileId: string): Promise<number> {
    const [row] = await em.query(
      `SELECT count(DISTINCT m.id)::int AS n
         FROM tournament_matches m
         JOIN tournament_match_games g ON g."matchId" = m.id
         JOIN tournament_participants p
           ON p.id = CASE WHEN g."playerAProfileId" = $1 THEN m."participantAId" ELSE m."participantBId" END
        WHERE m.status = 'completed'
          AND m."completedAt" >= $3
          AND (g."playerAProfileId" = $1 OR g."playerBProfileId" = $1)
          AND g.resolution IS DISTINCT FROM 'double_forfeit'
          AND p."clubId" = $2`,
      [profileId, loan.borrowClubId, loan.startedAt],
    );
    return row?.n ?? 0;
  }

  // ------------------------------------------------------------------ buy

  /**
   * The borrowing club makes the loan permanent: it pays his current transfer fee to
   * the parent club, his parent contract ends and a new one starts at the borrowing
   * club. Recorded as a completed buyout, so it shows in the transfer history.
   */
  async buy(caller: User, loanId: string, dto: BuyLoanDto): Promise<LoanView> {
    const settings = await this.settingsService.transfers();
    await this.transfers.assertMarketOpen();
    const recipients: Recipient[] = [];

    await this.dataSource.transaction(async (em) => {
      const loan = await this.lockLoan(em, loanId);
      if (loan.status !== 'active' && loan.status !== 'returning') {
        throw new BadRequestException('Only a player who is on loan now can be bought');
      }
      await this.transfers.assertClubLeader(em, loan.borrowClubId, caller.id);
      await assertNotFrozen(em, 'club', loan.borrowClubId);
      const profile = await this.transfers.profileOf(em, loan.playerUserId);
      const playerName = profile.user?.name ?? 'Player';
      const { parent, borrower } = await this.names(em, loan);
      const contract = await this.transfers.activeContract(em, loan.playerUserId);
      if (!contract || contract.clubId !== loan.parentClubId) {
        throw new BadRequestException(`${playerName} is no longer under contract with ${parent.name}`);
      }
      const now = new Date();
      const price = currentFee(contract, now);
      if (price > 0 && !dto.paymentMethod) throw new BadRequestException('Choose a payment method');

      const offer = em.getRepository(TransferOffer).create({
        kind: 'buyout',
        playerUserId: loan.playerUserId,
        fromClubId: loan.parentClubId,
        toClubId: loan.borrowClubId,
        amountTk: price,
        heldTk: 0,
        payeeType: 'club',
        turn: 'player',
        status: 'completed',
        message: `Loan made permanent (${loan.matchesPlayed}/${loan.matches} matches played)`,
        createdByUserId: caller.id,
        respondedByUserId: caller.id,
        expiresAt: now,
        playerSignedAt: null,
        clubSignedByUserId: caller.id,
        clubSignedAt: now,
        paymentMethod: price > 0 ? dto.paymentMethod! : null,
        paymentRef: price > 0 ? paymentRef() : null,
        paidAt: price > 0 ? now : null,
        scheduledTournamentId: null,
        completedAt: now,
      });
      await em.save(offer);
      if (price > 0) {
        const wallet = this.borrowerWallet(loan);
        await this.walletsService.hold(em, wallet, price, { offerId: offer.id, counterparty: playerName, reference: offer.paymentRef });
        await this.walletsService.payOut(em, wallet, { type: 'club', id: loan.parentClubId }, price, {
          offerId: offer.id,
          fromName: borrower.name,
          toName: parent.name,
          reference: offer.paymentRef,
        });
      }
      contract.status = 'ended';
      contract.endedAt = now;
      contract.endReason = 'transfer';
      await em.save(contract);
      await startContract(em, settings, { userId: loan.playerUserId, clubId: loan.borrowClubId, offerId: offer.id, frozenTk: price }, now);

      loan.status = 'completed';
      loan.endReason = 'bought';
      loan.endedAt = now;
      loan.scheduledTournamentId = null;
      await em.save(loan);

      recipients.push(
        ...this.toAll(
          {
            code: 'loan.bought',
            title: 'Loan made permanent',
            message: `${borrower.name} bought ${playerName} from ${parent.name} for ${price} tk. His loan is now a permanent transfer.`,
            params: { player: playerName, parentClub: parent.name, borrowClub: borrower.name, amount: price },
          },
          loan,
        ),
      );
    });

    const loan = await this.dataSource.getRepository(PlayerLoan).findOneOrFail({ where: { id: loanId } });
    await this.dispatch(loan, recipients);
    return this.view(loanId);
  }

  // -------------------------------------------------------------- background

  /** Every minute: expire proposals, start loans that were waiting, count matches and bring players back. */
  async tick(now = new Date()): Promise<{ expired: number; started: number; returned: number }> {
    const expired = await this.expireDue(now);
    const started = await this.startScheduled();
    const returned = await this.progress(now);
    return { expired, started, returned };
  }

  async expireDue(now = new Date()): Promise<number> {
    const due = await this.dataSource.getRepository(PlayerLoan).find({
      where: { status: 'pending', expiresAt: LessThanOrEqual(now) },
      select: { id: true },
    });
    let count = 0;
    for (const { id } of due) {
      const recipients: Recipient[] = [];
      await this.dataSource.transaction(async (em) => {
        const loan = await this.lockLoan(em, id);
        if (loan.status !== 'pending') return;
        const profile = await this.transfers.profileOf(em, loan.playerUserId);
        const playerName = profile.user?.name ?? 'Player';
        const { parent, borrower } = await this.names(em, loan);
        loan.status = 'expired';
        await this.refundHold(em, loan, playerName);
        const notice = {
          code: 'loan.expired',
          title: 'Loan proposal expired',
          message: `The loan of ${playerName} between ${parent.name} and ${borrower.name} expired without an answer.`,
          params: { player: playerName, parentClub: parent.name, borrowClub: borrower.name },
        };
        recipients.push(
          { to: 'parent', notice: { ...notice, link: clubLink(loan.parentClubId) } },
          { to: 'borrower', notice: { ...notice, link: clubLink(loan.borrowClubId) } },
        );
      });
      if (recipients.length) {
        const loan = await this.dataSource.getRepository(PlayerLoan).findOneOrFail({ where: { id } });
        await this.dispatch(loan, recipients);
        count++;
      }
    }
    return count;
  }

  /**
   * Starts loans that waited for a tournament with the parent club. The rules are
   * checked again: a closed market makes it wait; otherwise a broken rule cancels
   * the loan and refunds the fee.
   */
  async startScheduled(): Promise<number> {
    const scheduled = await this.dataSource.getRepository(PlayerLoan).find({ where: { status: 'scheduled' }, select: { id: true } });
    if (!scheduled.length || !(await this.settingsService.features()).transfersOpen) return 0;
    const settings = await this.settingsService.transfers();
    let count = 0;
    for (const { id } of scheduled) {
      let started: UpcomingEntry[] | null = null;
      const recipients: Recipient[] = [];
      await this.dataSource.transaction(async (em) => {
        const loan = await this.lockLoan(em, id);
        if (loan.status !== 'scheduled') return;
        const profile = await this.transfers.profileOf(em, loan.playerUserId);
        if (await this.transfers.clubCommitment(em, profile)) return; // still playing for the parent club
        let problem: string | null = null;
        try {
          await assertNotFrozen(em, 'club', loan.borrowClubId);
          await this.transfers.assertTransferable(profile, 'player');
          if ((profile.clubId ?? null) !== loan.parentClubId) throw new Error('The player has moved since the loan was agreed.');
          await this.assertCapacity(em, loan.borrowClubId, settings, loan.id);
        } catch (err) {
          problem = (err as Error).message;
        }
        if (problem) {
          const playerName = profile.user?.name ?? 'Player';
          const { parent, borrower } = await this.names(em, loan);
          loan.status = 'cancelled';
          await this.refundHold(em, loan, playerName);
          recipients.push(
            ...this.toAll(
              {
                code: 'loan.cancelledAtStart',
                title: 'Loan cancelled',
                message: `${playerName}'s loan to ${borrower.name} was cancelled: ${problem} The fee was refunded.`,
                params: { player: playerName, parentClub: parent.name, borrowClub: borrower.name, reason: problem },
              },
              loan,
            ),
          );
          return;
        }
        started = await this.startInTransaction(em, loan, profile);
      });
      const loan = await this.dataSource.getRepository(PlayerLoan).findOneOrFail({ where: { id } });
      if (started) {
        await this.afterStart(loan, started);
        count++;
      } else if (recipients.length) {
        await this.dispatch(loan, recipients);
      }
    }
    return count;
  }

  /**
   * Running loans: updates the matches played; once they're all played (or the days
   * run out) he goes back, after any tournament he's playing for the borrowing club.
   */
  async progress(now = new Date()): Promise<number> {
    const running = await this.dataSource.getRepository(PlayerLoan).find({
      where: { status: In(['active', 'returning']) },
      select: { id: true },
    });
    let count = 0;
    for (const { id } of running) {
      let returned: UpcomingEntry[] | null = null;
      const recipients: Recipient[] = [];
      await this.dataSource.transaction(async (em) => {
        const loan = await this.lockLoan(em, id);
        if (loan.status !== 'active' && loan.status !== 'returning') return;
        const profile = await this.transfers.profileOf(em, loan.playerUserId);
        if (loan.status === 'active') {
          loan.matchesPlayed = await this.countMatches(em, loan, profile.id);
          const due: LoanEndReason | null =
            loan.matchesPlayed >= loan.matches ? 'matches' : loan.endsBy && now >= loan.endsBy ? 'time' : null;
          if (!due) {
            await em.save(loan);
            return;
          }
          loan.endReason = due;
        }
        const commitment = await this.transfers.clubCommitment(em, profile);
        if (commitment) {
          if (loan.status === 'active') {
            const playerName = profile.user?.name ?? 'Player';
            const { parent, borrower } = await this.names(em, loan);
            recipients.push(
              ...this.toAll(
                {
                  code: 'loan.returning',
                  title: 'Loan ending',
                  message: `${playerName}'s loan at ${borrower.name} is done. He returns to ${parent.name} when "${commitment.tournamentName}" ends.`,
                  params: { player: playerName, parentClub: parent.name, borrowClub: borrower.name, tournament: commitment.tournamentName },
                },
                loan,
              ),
            );
          }
          loan.status = 'returning';
          loan.scheduledTournamentId = commitment.tournamentId;
          await em.save(loan);
          return;
        }
        returned = await this.returnInTransaction(em, loan, profile, loan.endReason ?? 'time');
      });
      const loan = await this.dataSource.getRepository(PlayerLoan).findOneOrFail({ where: { id } });
      if (recipients.length) await this.dispatch(loan, recipients);
      if (returned) {
        await this.afterReturn(loan, returned);
        count++;
      }
    }
    return count;
  }

  // ------------------------------------------------------------ staff tools

  /** Staff end a loan: an open proposal is cancelled (fee refunded); a running loan ends now and he goes back. */
  async staffEnd(loanId: string, reason: string): Promise<LoanView> {
    let returned: UpcomingEntry[] | null = null;
    const recipients: Recipient[] = [];
    await this.dataSource.transaction(async (em) => {
      const loan = await this.lockLoan(em, loanId);
      const profile = await this.transfers.profileOf(em, loan.playerUserId);
      const playerName = profile.user?.name ?? 'Player';
      if (loan.status === 'pending' || loan.status === 'scheduled') {
        const { parent, borrower } = await this.names(em, loan);
        loan.status = 'cancelled';
        loan.endReason = 'staff';
        await this.refundHold(em, loan, playerName);
        recipients.push(
          ...this.toAll(
            {
              code: 'loan.endedByStaff',
              title: 'Loan cancelled by ALLYNQ staff',
              message: `The loan of ${playerName} between ${parent.name} and ${borrower.name} was cancelled by ALLYNQ staff: ${reason}`,
              params: { player: playerName, parentClub: parent.name, borrowClub: borrower.name, reason },
            },
            loan,
          ),
        );
      } else if (loan.status === 'active' || loan.status === 'returning') {
        loan.endReason = 'staff';
        returned = await this.returnInTransaction(em, loan, profile, 'staff');
      } else {
        throw new BadRequestException(`This loan is ${loan.status}, so it can't be ended`);
      }
    });
    const loan = await this.dataSource.getRepository(PlayerLoan).findOneOrFail({ where: { id: loanId } });
    if (recipients.length) await this.dispatch(loan, recipients);
    if (returned) await this.afterReturn(loan, returned, reason);
    return this.view(loanId);
  }

  // ------------------------------------------------------------------- reads

  async view(loanId: string): Promise<LoanView> {
    const [view] = await this.views({ where: `l.id = $1`, params: [loanId] });
    if (!view) throw new NotFoundException('Loan not found');
    return view;
  }

  private async views(filter: { where: string; params: unknown[]; limit?: number }): Promise<LoanView[]> {
    const rows: Array<Record<string, any>> = await this.dataSource.query(
      `SELECT l.*, u.name AS "playerName", u."dpUrl" AS "playerDpUrl",
              pc.name AS "parentName", pc."dpUrl" AS "parentDpUrl", pc.color AS "parentColor",
              bc.name AS "borrowName", bc."dpUrl" AS "borrowDpUrl", bc.color AS "borrowColor",
              t.name AS "tName", t."startAt" AS "tStart", t."endAt" AS "tEnd",
              c."frozenTk" AS "cFrozen", c."baseTk" AS "cBase", c."lockDays" AS "cDays", c."lockEndsAt" AS "cLockEnds"
         FROM player_loans l
         JOIN users u ON u.id = l."playerUserId"
         JOIN clubs pc ON pc.id = l."parentClubId"
         JOIN clubs bc ON bc.id = l."borrowClubId"
         LEFT JOIN tournaments t ON t.id = l."scheduledTournamentId"
         LEFT JOIN player_contracts c ON c."userId" = l."playerUserId" AND c.status = 'active' AND c."clubId" = l."parentClubId"
        WHERE ${filter.where}
        ORDER BY l."createdAt" DESC
        ${filter.limit ? `LIMIT ${Number(filter.limit)}` : ''}`,
      filter.params,
    );
    const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);
    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      turn: r.turn,
      feeTk: r.feeTk,
      heldTk: r.heldTk,
      paymentStatus: loanPaymentStatus(r as PlayerLoan),
      matches: r.matches,
      matchesPlayed: r.matchesPlayed,
      maxDays: r.maxDays,
      message: r.message,
      player: { id: r.playerUserId, name: r.playerName, dpUrl: r.playerDpUrl },
      parentClub: { id: r.parentClubId, name: r.parentName, dpUrl: r.parentDpUrl, color: r.parentColor },
      borrowClub: { id: r.borrowClubId, name: r.borrowName, dpUrl: r.borrowDpUrl, color: r.borrowColor },
      createdByUserId: r.createdByUserId,
      expiresAt: iso(r.expiresAt)!,
      createdAt: iso(r.createdAt)!,
      startedAt: iso(r.startedAt),
      endsBy: iso(r.endsBy),
      endedAt: iso(r.endedAt),
      endReason: r.endReason,
      paymentMethod: r.paymentMethod,
      paymentRef: r.paymentRef,
      paidAt: iso(r.paidAt),
      scheduledTournament: r.scheduledTournamentId
        ? { tournamentId: r.scheduledTournamentId, tournamentName: r.tName, startAt: iso(r.tStart)!, endAt: iso(r.tEnd) }
        : null,
      buyPriceTk:
        (r.status === 'active' || r.status === 'returning') && r.cBase !== null
          ? currentFee({ frozenTk: r.cFrozen, baseTk: r.cBase, lockDays: r.cDays, lockEndsAt: new Date(r.cLockEnds) })
          : null,
    }));
  }

  /** A loan with its negotiation, for the player and the leaders of both clubs. */
  async get(caller: User, loanId: string): Promise<LoanView & { bids: LoanBidView[] }> {
    const loan = await this.view(loanId);
    const em = this.dataSource.manager;
    const allowed =
      caller.id === loan.player.id ||
      (await this.transfers.isClubLeader(em, loan.parentClub.id, caller.id)) ||
      (await this.transfers.isClubLeader(em, loan.borrowClub.id, caller.id));
    if (!allowed) throw new ForbiddenException('Only the player and the clubs involved can view this loan');
    const rows: Array<Record<string, any>> = await this.dataSource.query(
      `SELECT b.id, b.party, b."byUserId", u.name AS "byName", b."feeTk", b.message, b."createdAt"
         FROM player_loan_bids b LEFT JOIN users u ON u.id = b."byUserId"
        WHERE b."loanId" = $1
        ORDER BY b."createdAt"`,
      [loanId],
    );
    return {
      ...loan,
      bids: rows.map((r) => ({
        id: r.id,
        party: r.party,
        byUserId: r.byUserId,
        byName: r.byName ?? null,
        feeTk: r.feeTk,
        message: r.message,
        createdAt: new Date(r.createdAt).toISOString(),
      })),
    };
  }

  /**
   * A club's loans: players borrowed (in) and lent (out). Its President / GS also see
   * open proposals and recently finished loans; everyone else sees running ones.
   */
  async forClub(caller: User | null, clubId: string) {
    const leader = caller ? await this.transfers.isClubLeader(this.dataSource.manager, clubId, caller.id) : false;
    const statuses = leader ? [...OPEN_LOAN_STATUSES] : RUNNING;
    const recent = leader ? ` OR (l.status = 'completed' AND l."endedAt" > now() - interval '30 days')` : '';
    const [loansIn, loansOut] = await Promise.all([
      this.views({ where: `l."borrowClubId" = $1 AND (l.status = ANY($2)${recent})`, params: [clubId, statuses] }),
      this.views({ where: `l."parentClubId" = $1 AND (l.status = ANY($2)${recent})`, params: [clubId, statuses] }),
    ]);
    return { clubId, isLeader: leader, loansIn, loansOut };
  }

  /** The signed-in player's loans: talks about him, a running loan, and recent ones. */
  async mine(caller: User): Promise<LoanView[]> {
    return this.views({
      where: `l."playerUserId" = $1 AND (l.status = ANY($2) OR l."endedAt" > now() - interval '30 days')`,
      params: [caller.id, [...OPEN_LOAN_STATUSES]],
      limit: 10,
    });
  }
}
