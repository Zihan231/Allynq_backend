import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In } from 'typeorm';
import { NotificationsService } from '../notifications/notifications.service.js';
import { paymentRef } from '../transfers/contract-fee.js';
import {
  WalletsService,
  type WalletOwner,
} from '../transfers/wallets.service.js';
import { EfootballProfile } from '../users/entities/efootball-profile.entity.js';
import { ClubRole } from '../users/enums/user-attributes.enum.js';
import { TournamentParticipant } from './entities/tournament-participant.entity.js';
import { Tournament, tournamentLink } from './entities/tournament.entity.js';

type PaymentMethod = 'bkash' | 'nagad' | 'card';
const CLUB_LEADERS = [ClubRole.PRESIDENT, ClubRole.GENERAL_SECRETARY];

/**
 * Money of general (organizer-run) tournaments, on the demo wallets:
 * - entry fees are held from each entrant's wallet (the player, or the club for CvC),
 *   refunded if the entrant leaves, and paid to the organizer once fixtures are out;
 * - the prize is held from the organizer's wallet and paid to the champion (or back
 *   to the organizer if there is none);
 * - a cancelled or deleted tournament refunds everything.
 * Community and club tournaments don't move money: their fees are display only.
 */
@Injectable()
export class TournamentMoneyService {
  private readonly logger = new Logger(TournamentMoneyService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly wallets: WalletsService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Who pays an entrant's fee: the player, or the club (CvC). */
  private payerOf(
    p: Pick<TournamentParticipant, 'participantType' | 'clubId' | 'userId'>,
  ): WalletOwner {
    return p.participantType === 'club' && p.clubId
      ? { type: 'club', id: p.clubId }
      : { type: 'user', id: p.userId! };
  }

  private organizerOf(t: Pick<Tournament, 'creatorId'>): WalletOwner {
    return { type: 'user', id: t.creatorId! };
  }

  /** Holds the entry fee from the entrant's wallet; runs in the caller's transaction (the entrant is saved). */
  async chargeEntry(
    em: EntityManager,
    t: Tournament,
    p: TournamentParticipant,
    method: PaymentMethod,
  ): Promise<void> {
    const fee = t.entryFeeBdt;
    if (fee <= 0) return;
    p.paymentMethod = method;
    p.paymentRef = paymentRef();
    p.paidAt = new Date();
    await this.wallets.hold(em, this.payerOf(p), fee, {
      tournamentId: t.id,
      counterparty: `Entry: ${t.name}`,
      reference: p.paymentRef,
    });
    p.feeHeldTk = fee;
    await em.getRepository(TournamentParticipant).save(p);
  }

  /** Returns an entrant's held fee (leaving before fixtures); runs in the caller's transaction. */
  async refundEntry(
    em: EntityManager,
    t: Tournament,
    p: TournamentParticipant,
  ): Promise<number> {
    const held = p.feeHeldTk ?? 0;
    if (held <= 0) return 0;
    await this.wallets.refund(em, this.payerOf(p), held, {
      tournamentId: t.id,
      counterparty: `Entry: ${t.name}`,
    });
    p.feeHeldTk = 0;
    await em
      .getRepository(TournamentParticipant)
      .update({ id: p.id }, { feeHeldTk: 0 });
    return held;
  }

  /** Holds the prize from the organizer's wallet (creation). Runs in the caller's transaction. */
  async holdPrize(
    em: EntityManager,
    t: Tournament,
    amountTk: number,
  ): Promise<void> {
    if (amountTk <= 0) return;
    await this.wallets.hold(em, this.organizerOf(t), amountTk, {
      tournamentId: t.id,
      counterparty: `Prize: ${t.name}`,
      reference: null,
    });
    t.prizeHeldTk = amountTk;
    await em
      .getRepository(Tournament)
      .update({ id: t.id }, { prizeHeldTk: amountTk });
  }

  /** Brings the organizer's prize hold to a new prize amount (an edit). Runs in the caller's transaction. */
  async reholdPrize(
    em: EntityManager,
    t: Pick<Tournament, 'id' | 'name' | 'creatorId' | 'prizeHeldTk'>,
    amountTk: number,
  ) {
    await this.wallets.rehold(
      em,
      this.organizerOf(t),
      t.prizeHeldTk ?? 0,
      amountTk,
      {
        tournamentId: t.id,
        counterparty: `Prize: ${t.name}`,
        reference: null,
      },
    );
    t.prizeHeldTk = amountTk;
  }

  /** Fixtures are out: every held entry fee goes to the organizer. Returns the total paid. */
  async payOutFees(t: Tournament): Promise<number> {
    const paid = await this.dataSource.transaction(async (em) => {
      const entrants = await em
        .getRepository(TournamentParticipant)
        .find({ where: { tournamentId: t.id } });
      let total = 0;
      for (const p of entrants) {
        const held = p.feeHeldTk ?? 0;
        if (held <= 0) continue;
        await this.wallets.payOut(
          em,
          this.payerOf(p),
          this.organizerOf(t),
          held,
          {
            tournamentId: t.id,
            fromName: `Entry: ${t.name}`,
            toName: `Organizer of ${t.name}`,
            reference: p.paymentRef,
          },
        );
        await em
          .getRepository(TournamentParticipant)
          .update(
            { id: p.id },
            { feeHeldTk: 0, feePaidTk: (p.feePaidTk ?? 0) + held },
          );
        total += held;
      }
      return total;
    });
    if (paid > 0) {
      await this.notify([t.creatorId!], {
        title: 'Entry fees received',
        message: `${paid} tk of entry fees for "${t.name}" were paid to your wallet.`,
        link: tournamentLink(t),
        code: 'tournament.feesPaidOut',
        params: { tournament: t.name, amount: paid },
      });
    }
    return paid;
  }

  /** The final is decided: the prize goes to the champion, or back to the organizer if there is none. */
  async payPrize(
    t: Tournament,
    championParticipantId: string | null,
  ): Promise<void> {
    const result = await this.dataSource.transaction(async (em) => {
      const [row] = await em.query(
        `SELECT "prizeHeldTk" FROM tournaments WHERE id = $1 FOR UPDATE`,
        [t.id],
      );
      const prize: number = row?.prizeHeldTk ?? 0;
      if (prize <= 0) return null;
      const champion = championParticipantId
        ? await em
            .getRepository(TournamentParticipant)
            .findOne({ where: { id: championParticipantId } })
        : null;
      if (champion) {
        await this.wallets.payOut(
          em,
          this.organizerOf(t),
          this.payerOf(champion),
          prize,
          {
            tournamentId: t.id,
            fromName: `Prize: ${t.name}`,
            toName: `Champion of ${t.name}`,
            reference: null,
          },
        );
      } else {
        await this.wallets.refund(em, this.organizerOf(t), prize, {
          tournamentId: t.id,
          counterparty: `Prize: ${t.name}`,
        });
      }
      await em
        .getRepository(Tournament)
        .update({ id: t.id }, { prizeHeldTk: 0 });
      return { prize, champion };
    });
    if (!result) return;
    if (result.champion) {
      await this.notify(await this.entrantUserIds([result.champion]), {
        title: 'Prize won',
        message: `${result.prize} tk prize for winning "${t.name}" was paid to your ${result.champion.clubId ? 'club ' : ''}wallet.`,
        link: tournamentLink(t),
        code: 'tournament.prizeWon',
        params: { tournament: t.name, amount: result.prize },
      });
    } else {
      await this.notify([t.creatorId!], {
        title: 'Prize returned',
        message: `"${t.name}" ended without a champion; the ${result.prize} tk prize went back to your wallet.`,
        link: tournamentLink(t),
        code: 'tournament.prizeReleased',
        params: { tournament: t.name, amount: result.prize },
      });
    }
  }

  /**
   * A cancelled or deleted tournament: held fees are refunded; fees already paid to
   * the organizer are taken back from the organizer's wallet as far as it allows;
   * the prize hold returns to the organizer. Returns what couldn't be refunded.
   */
  async settleCancel(
    t: Tournament,
  ): Promise<{ refunded: number; shortfall: number }> {
    const outcome = await this.dataSource.transaction(async (em) => {
      const entrants = await em
        .getRepository(TournamentParticipant)
        .find({ where: { tournamentId: t.id } });
      let refunded = 0;
      let shortfall = 0;
      const refundedEntrants: TournamentParticipant[] = [];
      for (const p of entrants) {
        const held = p.feeHeldTk ?? 0;
        if (held > 0) {
          await this.wallets.refund(em, this.payerOf(p), held, {
            tournamentId: t.id,
            counterparty: `Entry: ${t.name}`,
          });
          refunded += held;
        }
        const paid = p.feePaidTk ?? 0;
        let back = 0;
        if (paid > 0) {
          const organizer = await this.wallets.lock(em, this.organizerOf(t));
          back = Math.min(paid, Math.max(0, organizer.balanceTk));
          if (back > 0) {
            await this.wallets.adjust(
              em,
              this.organizerOf(t),
              -back,
              'reversal',
              { tournamentId: t.id, counterparty: `Entry refund: ${t.name}` },
            );
            await this.wallets.adjust(em, this.payerOf(p), back, 'reversal', {
              tournamentId: t.id,
              counterparty: `Entry refund: ${t.name}`,
            });
          }
          refunded += back;
          shortfall += paid - back;
        }
        if (held > 0 || back > 0) refundedEntrants.push(p);
        await em
          .getRepository(TournamentParticipant)
          .update({ id: p.id }, { feeHeldTk: 0, feePaidTk: paid - back });
      }
      const [row] = await em.query(
        `SELECT "prizeHeldTk" FROM tournaments WHERE id = $1 FOR UPDATE`,
        [t.id],
      );
      const prize: number = row?.prizeHeldTk ?? 0;
      if (prize > 0) {
        await this.wallets.refund(em, this.organizerOf(t), prize, {
          tournamentId: t.id,
          counterparty: `Prize: ${t.name}`,
        });
        await em
          .getRepository(Tournament)
          .update({ id: t.id }, { prizeHeldTk: 0 });
      }
      return { refunded, shortfall, refundedEntrants };
    });
    if (outcome.refundedEntrants.length) {
      await this.notify(await this.entrantUserIds(outcome.refundedEntrants), {
        title: 'Entry fee refunded',
        message: `"${t.name}" was cancelled; your entry fee was refunded.`,
        link: '/dashboard/efootball/wallet',
        code: 'tournament.entryRefunded',
        params: { tournament: t.name, amount: t.entryFeeBdt },
      });
    }
    if (outcome.shortfall > 0) {
      this.logger.warn(
        `Cancelling "${t.name}" (${t.id}): ${outcome.shortfall} tk of paid entry fees could not be taken back from the organizer`,
      );
    }
    return { refunded: outcome.refunded, shortfall: outcome.shortfall };
  }

  /** A participant's people: the player, or the club's President / GS and whoever registered it. */
  private async entrantUserIds(
    entrants: TournamentParticipant[],
  ): Promise<string[]> {
    const ids = new Set<string>();
    const clubIds: string[] = [];
    for (const p of entrants) {
      if (p.userId) ids.add(p.userId);
      if (p.registeredByUserId) ids.add(p.registeredByUserId);
      if (p.clubId) clubIds.push(p.clubId);
    }
    if (clubIds.length) {
      const leaders = await this.dataSource
        .getRepository(EfootballProfile)
        .find({
          where: { clubId: In(clubIds), clubRole: In(CLUB_LEADERS) },
          select: { userId: true },
        });
      leaders.forEach((l) => ids.add(l.userId));
    }
    return [...ids];
  }

  private async notify(
    userIds: string[],
    n: {
      title: string;
      message: string;
      link: string;
      code: string;
      params: Record<string, string | number | null>;
    },
  ): Promise<void> {
    await Promise.all(
      userIds.map((id) =>
        this.notifications
          .createNotification(id, { ...n, type: 'tournament_update' })
          .catch((err) =>
            this.logger.error(
              `Tournament money notification to ${id} failed: ${err.message}`,
            ),
          ),
      ),
    );
  }
}

/** Thrown when a paid general tournament is joined without choosing how to pay. */
export const paymentMethodRequired = () =>
  new BadRequestException('Choose a payment method for the entry fee');
