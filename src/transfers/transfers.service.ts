import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { Club } from '../clubs/entities/club.entity.js';
import { createPaginatedResult, type PaginatedResult } from '../common/interfaces/paginated-result.interface.js';
import { CommunitiesService } from '../communities/communities.service.js';
import type { NotificationParams } from '../notifications/entities/notification.entity.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { EfootballProfile } from '../users/entities/efootball-profile.entity.js';
import { User } from '../users/entities/user.entity.js';
import { ClubRole } from '../users/enums/user-attributes.enum.js';
import { currentFee, daysLeft, decayingTk, isLocked, paymentRef } from './contract-fee.js';
import { startContract } from './contracts.js';
import type {
  CounterOfferDto,
  CreateOfferDto,
  FreeAgentsQueryDto,
  RespondOfferDto,
  TransferHistoryQueryDto,
  WalletHistoryQueryDto,
} from './dto/transfer.dto.js';
import { PlayerContract, type ContractEndReason } from './entities/player-contract.entity.js';
import { TransferOfferBid } from './entities/transfer-offer-bid.entity.js';
import { TransferOffer, type TransferOfferKind, type TransferOfferParty } from './entities/transfer-offer.entity.js';
import { WalletsService, type WalletOwner } from './wallets.service.js';
import { assertNotFrozen } from '../common/frozen.js';

const LEADER_ROLES: string[] = [ClubRole.PRESIDENT, ClubRole.GENERAL_SECRETARY];
const PLAYER_LINK = '/dashboard/efootball/transfers';
const clubLink = (clubId: string) => `/dashboard/efootball/clubs/${clubId}?tab=transfers`;
const DAY_MS = 24 * 60 * 60 * 1000;
/** A tournament blocks a move while it runs, or once it starts within this many days. */
const COMMITMENT_WINDOW_DAYS = 3;

type NoticeTarget = 'player' | 'clubLeaders' | 'fromClubLeaders' | 'clubMembers' | 'fromClubMembers';

/** An active tournament the player is playing with his current club (blocks the move until it ends). */
export interface ClubCommitment {
  tournamentId: string;
  tournamentName: string;
  startAt: string;
  endAt: string | null;
}

export interface ContractView {
  id: string;
  contractNo: string;
  userId: string;
  clubId: string;
  clubName: string;
  frozenTk: number;
  baseTk: number;
  lockDays: number;
  startAt: string;
  lockEndsAt: string;
  status: 'active' | 'ended';
  endedAt: string | null;
  endReason: ContractEndReason | null;
  offerId: string | null;
  /** Live values. */
  feeTk: number;
  decayingTk: number;
  daysLeft: number;
  locked: boolean;
}

export type PaymentStatus = 'none' | 'held' | 'paid' | 'refunded' | 'reversed';

/** Where the club's money for a deal is, from its status and hold. */
export function paymentStatusOf(o: Pick<TransferOffer, 'status' | 'amountTk' | 'heldTk' | 'paidAt'>): PaymentStatus {
  if (o.status === 'reversed') return 'reversed';
  if (o.status === 'completed') return o.amountTk > 0 ? 'paid' : 'none';
  if (o.heldTk > 0) return 'held';
  return o.paidAt ? 'refunded' : 'none';
}

/** A tournament of the old club (not started yet) with the player in its lineup or entered by him. */
export interface UpcomingEntry {
  participantId: string;
  tournamentId: string;
  tournamentName: string;
  /** `lineup`: he is in the club's lineup (removed when he moves); `solo`: he entered the club's own tournament. */
  entry: 'lineup' | 'solo';
}

export interface BidView {
  id: string;
  party: TransferOfferParty;
  byUserId: string;
  byName: string | null;
  amountTk: number;
  message: string | null;
  createdAt: string;
}

export interface OfferView {
  id: string;
  kind: TransferOfferKind;
  status: TransferOffer['status'];
  /** Who answers next while pending. */
  turn: TransferOfferParty;
  amountTk: number;
  /** Club money held for this deal right now. */
  heldTk: number;
  /**
   * Where the club's money is: `held` (taken from the club wallet, not yet with the payee),
   * `paid` (transfer completed), `refunded` (deal closed, money back with the club),
   * `reversed` (staff undid the transfer) or `none` (no money involved yet).
   */
  paymentStatus: PaymentStatus;
  payeeType: 'player' | 'club';
  message: string | null;
  player: { id: string; name: string; dpUrl: string | null };
  fromClub: { id: string; name: string; dpUrl: string | null; color: string | null } | null;
  toClub: { id: string; name: string; dpUrl: string | null; color: string | null };
  createdByUserId: string;
  expiresAt: string;
  createdAt: string;
  completedAt: string | null;
  playerSignedAt: string | null;
  clubSignedAt: string | null;
  clubSignedBy: string | null;
  paymentMethod: string | null;
  paymentRef: string | null;
  paidAt: string | null;
  /** Set while scheduled: the tournament he must finish first. */
  scheduledTournament: ClubCommitment | null;
  contractNo: string | null;
}

interface Notice {
  code: string;
  title: string;
  message: string;
  link: string;
  params: NotificationParams;
}

/**
 * The transfer market: contracts with a lock and a decaying fee, offers between
 * players and clubs, and demo payments (clubs pay upfront into a hold; the hold
 * is paid out on acceptance or refunded on decline / cancel / expiry).
 */
@Injectable()
export class TransfersService {
  private readonly logger = new Logger(TransfersService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly settingsService: SettingsService,
    private readonly walletsService: WalletsService,
    private readonly communitiesService: CommunitiesService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // ------------------------------------------------------------------ helpers

  private async profileOf(em: EntityManager, userId: string): Promise<EfootballProfile & { user?: User }> {
    const profile = await em.getRepository(EfootballProfile).findOne({ where: { userId }, relations: { user: true } });
    if (!profile) throw new NotFoundException('Player profile not found');
    return profile;
  }

  private async clubOf(em: EntityManager, clubId: string): Promise<Club> {
    const club = await em.getRepository(Club).findOne({ where: { id: clubId } });
    if (!club) throw new NotFoundException('Club not found');
    return club;
  }

  private async activeContract(em: EntityManager, userId: string): Promise<PlayerContract | null> {
    return em.getRepository(PlayerContract).findOne({ where: { userId, status: 'active' } });
  }

  /** The caller must be the club's President or General Secretary. */
  private async assertClubLeader(em: EntityManager, clubId: string, userId: string): Promise<void> {
    const profile = await em.getRepository(EfootballProfile).findOne({ where: { userId } });
    if (!profile || profile.clubId !== clubId || !LEADER_ROLES.includes(profile.clubRole ?? '')) {
      throw new ForbiddenException('Only the club President or General Secretary can manage transfers');
    }
  }

  private async isClubLeader(em: EntityManager, clubId: string, userId: string): Promise<boolean> {
    const profile = await em.getRepository(EfootballProfile).findOne({ where: { userId } });
    return Boolean(profile && profile.clubId === clubId && LEADER_ROLES.includes(profile.clubRole ?? ''));
  }

  /** A player who can be part of a transfer: not a club leader, not a community leader. */
  private async assertTransferable(profile: EfootballProfile, who: 'you' | 'player'): Promise<void> {
    const subject = who === 'you' ? 'You' : 'This player';
    if (LEADER_ROLES.includes(profile.clubRole ?? '')) {
      throw new BadRequestException(
        `${subject} ${who === 'you' ? 'are' : 'is'} the club's ${profile.clubRole}. Hand over the role before any transfer.`,
      );
    }
    if (await this.communitiesService.isCommunityLeader(profile.userId)) {
      throw new BadRequestException(`Community Presidents and Vice Presidents can't join clubs.`);
    }
  }

  /**
   * Tournament the player is playing in with his current club that holds up a move:
   * one that is running, or starts within COMMITMENT_WINDOW_DAYS. Later ones don't
   * block; he is taken out of them when he moves (see upcomingEntries).
   */
  async clubCommitment(
    em: EntityManager | DataSource,
    profile: Pick<EfootballProfile, 'id' | 'userId' | 'clubId'>,
  ): Promise<ClubCommitment | null> {
    if (!profile.clubId) return null;
    const [row] = await em.query(
      `SELECT t.id AS "tournamentId", t.name AS "tournamentName", t."startAt", t."endAt"
         FROM tournaments t
         JOIN tournament_participants p ON p."tournamentId" = t.id
        WHERE t.status NOT IN ('completed', 'cancelled')
          AND t."deletedAt" IS NULL
          AND (t.status = 'ongoing' OR t."startAt" <= now() + make_interval(days => $4))
          AND (
            (p."participantType" = 'club' AND p."clubId" = $1 AND EXISTS (
               SELECT 1 FROM jsonb_array_elements(
                 COALESCE(p.lineup->'starters', '[]'::jsonb) || COALESCE(p.lineup->'substitutes', '[]'::jsonb)
               ) e WHERE e->>'profileId' = $2))
            OR (t."hostClubId" = $1 AND p."participantType" = 'player' AND p."userId" = $3)
          )
        ORDER BY t."startAt"
        LIMIT 1`,
      [profile.clubId, profile.id, profile.userId, COMMITMENT_WINDOW_DAYS],
    );
    return row
      ? {
          tournamentId: row.tournamentId,
          tournamentName: row.tournamentName,
          startAt: new Date(row.startAt).toISOString(),
          endAt: row.endAt ? new Date(row.endAt).toISOString() : null,
        }
      : null;
  }

  /** His current club's tournaments that haven't started, where he's in the lineup (or entered himself). */
  async upcomingEntries(
    em: EntityManager | DataSource,
    profile: Pick<EfootballProfile, 'id' | 'userId' | 'clubId'>,
  ): Promise<UpcomingEntry[]> {
    if (!profile.clubId) return [];
    return em.query(
      `SELECT p.id AS "participantId", tr.id AS "tournamentId", tr.name AS "tournamentName",
              CASE WHEN p."participantType" = 'club' THEN 'lineup' ELSE 'solo' END AS entry
         FROM tournament_participants p
         JOIN tournaments tr ON tr.id = p."tournamentId"
        WHERE tr.status IN ('registration_open', 'submission_phase')
          AND tr."deletedAt" IS NULL
          AND (
            (p."participantType" = 'club' AND p."clubId" = $1 AND EXISTS (
               SELECT 1 FROM jsonb_array_elements(
                 COALESCE(p.lineup->'starters', '[]'::jsonb) || COALESCE(p.lineup->'substitutes', '[]'::jsonb)
               ) e WHERE e->>'profileId' = $2))
            OR (tr."hostClubId" = $1 AND p."participantType" = 'player' AND p."userId" = $3)
          )
        ORDER BY tr."startAt"`,
      [profile.clubId, profile.id, profile.userId],
    );
  }

  /** Takes the player out of the given club lineups (starters and substitutes). */
  private async removeFromLineups(em: EntityManager, participantIds: string[], profileId: string): Promise<void> {
    if (!participantIds.length) return;
    await em.query(
      `UPDATE tournament_participants p
          SET lineup = p.lineup || jsonb_build_object(
            'starters', COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements(COALESCE(p.lineup->'starters', '[]'::jsonb)) e
                                   WHERE e->>'profileId' IS DISTINCT FROM $2), '[]'::jsonb),
            'substitutes', COALESCE((SELECT jsonb_agg(e) FROM jsonb_array_elements(COALESCE(p.lineup->'substitutes', '[]'::jsonb)) e
                                      WHERE e->>'profileId' IS DISTINCT FROM $2), '[]'::jsonb))
        WHERE p.id = ANY($1) AND p.lineup IS NOT NULL`,
      [participantIds, profileId],
    );
  }

  /** Which side of the deal the caller is on; throws if he's on neither. */
  private async partyOf(em: EntityManager, offer: TransferOffer, callerId: string): Promise<TransferOfferParty> {
    if (callerId === offer.playerUserId) return 'player';
    await this.assertClubLeader(em, offer.toClubId, callerId);
    return 'club';
  }

  /** Only the side whose turn it is may accept, reject or counter. */
  private async assertTurn(em: EntityManager, offer: TransferOffer, callerId: string): Promise<void> {
    if (offer.turn === 'club') await this.assertClubLeader(em, offer.toClubId, callerId);
    else if (callerId !== offer.playerUserId) throw new ForbiddenException('Only the player can answer this offer');
  }

  /** A player whose move is waiting for a tournament can't take up another deal until he has moved. */
  private async assertNoScheduledMove(em: EntityManager, playerUserId: string, offerId: string): Promise<void> {
    const scheduled = await em.getRepository(TransferOffer).findOne({ where: { playerUserId, status: 'scheduled' } });
    if (scheduled && scheduled.id !== offerId) {
      throw new BadRequestException(
        'This player has a move waiting for a tournament to end. New offers can be accepted after he joins his new club.',
      );
    }
  }

  private async recordBid(em: EntityManager, offer: TransferOffer, party: TransferOfferParty, byUserId: string, message: string | null) {
    await em.getRepository(TransferOfferBid).insert({ offerId: offer.id, party, byUserId, amountTk: offer.amountTk, message });
  }

  /** Club side of an offer pays / gets refunds. */
  private clubWallet(clubId: string): WalletOwner {
    return { type: 'club', id: clubId };
  }

  private payee(offer: TransferOffer): WalletOwner {
    return offer.payeeType === 'club' && offer.fromClubId
      ? { type: 'club', id: offer.fromClubId }
      : { type: 'user', id: offer.playerUserId };
  }

  // ------------------------------------------------------------------ create

  async createOffer(caller: User, dto: CreateOfferDto): Promise<OfferView> {
    const notices: Array<{ to: NoticeTarget; notice: Notice }> = [];
    const settings = await this.settingsService.transfers();
    const now = new Date();

    await this.assertMarketOpen();
    const offerId = await this.dataSource.transaction(async (em) => {
      await assertNotFrozen(em, 'club', dto.clubId);
      const club = await this.clubOf(em, dto.clubId);
      const isPlayerProposal = !dto.playerUserId;
      const playerUserId = dto.playerUserId ?? caller.id;
      const profile = await this.profileOf(em, playerUserId);
      const playerName = profile.user?.name ?? 'Player';

      if (isPlayerProposal) {
        await this.assertTransferable(profile, 'you');
      } else {
        await this.assertClubLeader(em, club.id, caller.id);
        if (playerUserId === caller.id) throw new BadRequestException("You can't make an offer to yourself");
        await this.assertTransferable(profile, 'player');
      }

      // A deal already waiting for a tournament blocks new offers.
      const scheduled = await em.getRepository(TransferOffer).findOne({ where: { playerUserId, status: 'scheduled' } });
      if (scheduled) {
        throw new BadRequestException('This player already has an agreed transfer waiting for a tournament to end');
      }
      const open = await em.getRepository(TransferOffer).findOne({
        where: { playerUserId, toClubId: club.id, status: 'pending' },
      });
      if (open) {
        throw new BadRequestException(
          isPlayerProposal
            ? `You already have an open deal with ${club.name}. Wait until it's accepted, declined or expires — or withdraw it — before sending another.`
            : `There's already an open offer between ${club.name} and ${playerName}. Wait for an answer or withdraw it first.`,
        );
      }

      const contract = await this.activeContract(em, playerUserId);
      const locked = Boolean(contract && profile.clubId && isLocked(contract.lockEndsAt, now));

      let kind: TransferOfferKind;
      let amountTk = dto.amountTk;
      let payeeType: 'player' | 'club' = 'player';
      if (isPlayerProposal) {
        if (locked) {
          throw new BadRequestException(
            `You're under contract until ${contract!.lockEndsAt.toISOString().slice(0, 10)}. Clubs can buy you out until then.`,
          );
        }
        kind = 'player_proposal';
      } else if (profile.clubId === club.id) {
        kind = 'renewal';
      } else if (locked) {
        // Buyout: the price is his current fee, paid to his club (which can't refuse).
        kind = 'buyout';
        amountTk = currentFee(contract!, now);
        payeeType = 'club';
      } else {
        kind = 'club_offer';
      }

      const clubPays = !isPlayerProposal && amountTk > 0;
      if (clubPays && !dto.paymentMethod) throw new BadRequestException('Choose a payment method');

      const offer = em.getRepository(TransferOffer).create({
        kind,
        playerUserId,
        fromClubId: profile.clubId ?? null,
        toClubId: club.id,
        amountTk,
        heldTk: clubPays ? amountTk : 0,
        payeeType,
        turn: isPlayerProposal ? 'club' : 'player',
        message: dto.message?.trim() || null,
        createdByUserId: caller.id,
        expiresAt: new Date(now.getTime() + settings.offerExpiryDays * DAY_MS),
        // The sender signs by sending: the player for a proposal, the club otherwise.
        playerSignedAt: isPlayerProposal ? now : null,
        clubSignedByUserId: isPlayerProposal ? null : caller.id,
        clubSignedAt: isPlayerProposal ? null : now,
        paymentMethod: clubPays ? dto.paymentMethod! : null,
        paymentRef: clubPays ? paymentRef() : null,
        paidAt: clubPays ? now : null,
      });
      await em.save(offer);
      await this.recordBid(em, offer, isPlayerProposal ? 'player' : 'club', caller.id, offer.message);

      // Club offers are paid upfront into a hold.
      if (clubPays) {
        await this.walletsService.hold(em, this.clubWallet(club.id), amountTk, {
          offerId: offer.id,
          counterparty: playerName,
          reference: offer.paymentRef,
        });
      }

      const params = {
        player: playerName,
        club: club.name,
        amount: amountTk,
        expiresAt: offer.expiresAt.toISOString(),
        kind,
      };
      if (isPlayerProposal) {
        notices.push({
          to: 'clubLeaders',
          notice: {
            code: 'transfer.proposalReceived',
            title: 'New transfer proposal',
            message: `${playerName} wants to join ${club.name} for ${amountTk} tk.`,
            link: clubLink(club.id),
            params,
          },
        });
        notices.push({
          to: 'player',
          notice: {
            code: 'transfer.proposalSent',
            title: 'Proposal sent',
            message: `Your proposal to ${club.name} (${amountTk} tk) is valid for ${settings.offerExpiryDays} days.`,
            link: PLAYER_LINK,
            params,
          },
        });
      } else {
        notices.push({
          to: 'player',
          notice: {
            code: 'transfer.offerReceived',
            title: kind === 'renewal' ? 'Contract renewal offer' : 'New transfer offer',
            message: `${club.name} offers you ${amountTk} tk.`,
            link: PLAYER_LINK,
            params,
          },
        });
        notices.push({
          to: 'clubLeaders',
          notice: {
            code: 'transfer.offerSent',
            title: 'Offer sent',
            message: `Offer to ${playerName} sent. ${amountTk} tk is held from the club wallet until he answers.`,
            link: clubLink(club.id),
            params,
          },
        });
        if (kind === 'buyout' && profile.clubId) {
          notices.push({
            to: 'fromClubLeaders',
            notice: {
              code: 'transfer.buyoutHeadsUp',
              title: 'Buyout offer for your player',
              message: `${club.name} offered the ${amountTk} tk buyout for ${playerName}. If he accepts, he moves and your club receives the fee.`,
              link: clubLink(profile.clubId),
              params,
            },
          });
        }
      }
      return offer.id;
    });

    const offer = await this.dataSource.getRepository(TransferOffer).findOneOrFail({ where: { id: offerId } });
    await this.dispatch(offer, notices);
    return this.offerView(offerId);
  }

  // ----------------------------------------------------------------- respond

  /**
   * The side whose turn it is accepts or rejects the current amount. Rejecting ends
   * the negotiation (its bids stay on record); accepting signs the contract.
   */
  async respond(caller: User, offerId: string, dto: RespondOfferDto): Promise<OfferView> {
    const notices: Array<{ to: NoticeTarget; notice: Notice }> = [];
    let removed: UpcomingEntry[] | null = null;

    await this.dataSource.transaction(async (em) => {
      const offer = await this.lockOffer(em, offerId);
      if (dto.accept) await this.assertMarketOpen();
      if (dto.accept) await assertNotFrozen(em, 'club', offer.toClubId);
      if (offer.status !== 'pending') throw new BadRequestException(`This offer is already ${offer.status}`);
      if (offer.expiresAt <= new Date()) throw new BadRequestException('This offer has expired');
      await this.assertTurn(em, offer, caller.id);
      const byClub = offer.turn === 'club';

      const club = await this.clubOf(em, offer.toClubId);
      const profile = await this.profileOf(em, offer.playerUserId);
      const playerName = profile.user?.name ?? 'Player';
      const params = { player: playerName, club: club.name, amount: offer.amountTk, kind: offer.kind };
      offer.respondedByUserId = caller.id;

      if (!dto.accept) {
        const refunded = offer.heldTk;
        offer.status = 'declined';
        await this.refundHold(em, offer, playerName);
        notices.push(
          byClub
            ? {
                to: 'player',
                notice: {
                  code: 'transfer.declinedByClub',
                  title: offer.kind === 'player_proposal' ? 'Proposal declined' : 'Offer declined',
                  message: `${club.name} declined your ${offer.amountTk} tk ask. This negotiation is closed.`,
                  link: PLAYER_LINK,
                  params,
                },
              }
            : {
                to: 'clubLeaders',
                notice: {
                  code: 'transfer.declinedByPlayer',
                  title: 'Offer declined',
                  message: `${playerName} declined your offer.${refunded > 0 ? ` ${refunded} tk was returned to the club wallet.` : ''}`,
                  link: clubLink(club.id),
                  params,
                },
              },
        );
        return;
      }

      // Accepting signs the contract.
      await this.assertNoScheduledMove(em, offer.playerUserId, offer.id);
      await this.assertTransferable(profile, 'player');
      const now = new Date();
      if (byClub) {
        if (offer.kind === 'player_proposal') {
          const current = await this.activeContract(em, profile.userId);
          if (current && profile.clubId && profile.clubId !== offer.toClubId && isLocked(current.lockEndsAt, now)) {
            throw new BadRequestException('This player is now under contract at another club; make a buyout offer instead');
          }
        }
        if (offer.amountTk > offer.heldTk && !dto.paymentMethod) throw new BadRequestException('Choose a payment method');
        offer.clubSignedByUserId = caller.id;
        offer.clubSignedAt = now;
        await this.chargeClub(em, offer, playerName, dto.paymentMethod, now);
      } else {
        offer.playerSignedAt = now;
      }

      // The player must still be where the offer found him (e.g. not bought by someone else meanwhile).
      if ((profile.clubId ?? null) !== (offer.fromClubId ?? null) && offer.kind !== 'player_proposal') {
        throw new BadRequestException('The player has moved since this offer was made');
      }
      if (offer.kind === 'player_proposal') offer.fromClubId = profile.clubId ?? null;

      notices.push({
        to: byClub ? 'player' : 'clubLeaders',
        notice: {
          code: 'transfer.accepted',
          title: byClub ? (offer.kind === 'player_proposal' ? 'Proposal accepted' : 'Your ask was accepted') : 'Offer accepted',
          message: byClub ? `${club.name} accepted ${offer.amountTk} tk.` : `${playerName} accepted your ${offer.amountTk} tk offer.`,
          link: byClub ? PLAYER_LINK : clubLink(club.id),
          params,
        },
      });

      const moving = profile.clubId !== offer.toClubId;
      const commitment = moving ? await this.clubCommitment(em, profile) : null;
      if (commitment) {
        offer.status = 'scheduled';
        offer.scheduledTournamentId = commitment.tournamentId;
        await em.save(offer);
        const scheduledParams = {
          ...params,
          tournament: commitment.tournamentName,
          startAt: commitment.startAt,
          endAt: commitment.endAt,
        };
        const notice = {
          code: 'transfer.scheduled',
          title: 'Transfer scheduled',
          message: `${playerName} is in "${commitment.tournamentName}". The move to ${club.name} completes automatically when it ends.`,
          params: scheduledParams,
        };
        notices.push({ to: 'player', notice: { ...notice, link: PLAYER_LINK } });
        notices.push({ to: 'clubLeaders', notice: { ...notice, link: clubLink(club.id) } });
        if (offer.fromClubId) {
          notices.push({ to: 'fromClubLeaders', notice: { ...notice, link: clubLink(offer.fromClubId) } });
          // Later tournaments he's entered for his old club: warn now, he's taken out when he moves.
          const later = (await this.upcomingEntries(em, profile)).filter((e) => e.tournamentId !== commitment.tournamentId);
          if (later.length) {
            const names = [...new Set(later.map((e) => e.tournamentName))].join(', ');
            notices.push({
              to: 'fromClubLeaders',
              notice: {
                code: 'transfer.lineupWarning',
                title: 'Player leaving: pick a replacement',
                message: `${playerName} is leaving for ${club.name} and is entered for ${names}. He'll be taken out of those lineups when he moves, so pick a replacement.`,
                link: clubLink(offer.fromClubId),
                params: { ...params, tournaments: names },
              },
            });
          }
        }
        return;
      }

      await em.save(offer);
      removed = await this.completeInTransaction(em, offer, profile, club);
    });

    const offer = await this.dataSource.getRepository(TransferOffer).findOneOrFail({ where: { id: offerId } });
    await this.dispatch(offer, notices);
    if (removed) await this.afterCompletion(offer, removed);
    return this.offerView(offerId);
  }

  // ----------------------------------------------------------------- counter

  /**
   * The side whose turn it is answers with a new amount instead of accepting or
   * rejecting; the turn passes to the other side. A club counter is paid into the
   * hold at once (more held, or the difference refunded); a player counter leaves
   * the club's hold as it is until the club answers. Buyouts can't be countered:
   * their price is the player's fee.
   */
  async counter(caller: User, offerId: string, dto: CounterOfferDto): Promise<OfferView> {
    const notices: Array<{ to: NoticeTarget; notice: Notice }> = [];
    const settings = await this.settingsService.transfers();
    await this.assertMarketOpen();

    await this.dataSource.transaction(async (em) => {
      const offer = await this.lockOffer(em, offerId);
      if (offer.status !== 'pending') throw new BadRequestException(`This offer is already ${offer.status}`);
      if (offer.expiresAt <= new Date()) throw new BadRequestException('This offer has expired');
      if (offer.kind === 'buyout') {
        throw new BadRequestException("A buyout is at the player's current transfer fee, so it can't be countered");
      }
      await this.assertTurn(em, offer, caller.id);
      const party = offer.turn;
      if (party === 'club') await assertNotFrozen(em, 'club', offer.toClubId);
      await this.assertNoScheduledMove(em, offer.playerUserId, offer.id);
      if (dto.amountTk === offer.amountTk) {
        throw new BadRequestException(`${offer.amountTk} tk is already on the table. Accept it instead of countering.`);
      }

      const club = await this.clubOf(em, offer.toClubId);
      const profile = await this.profileOf(em, offer.playerUserId);
      const playerName = profile.user?.name ?? 'Player';
      const now = new Date();

      offer.amountTk = dto.amountTk;
      if (party === 'club') {
        if (dto.amountTk > offer.heldTk && !dto.paymentMethod) throw new BadRequestException('Choose a payment method');
        await this.chargeClub(em, offer, playerName, dto.paymentMethod, now);
        offer.clubSignedByUserId = caller.id;
        offer.clubSignedAt = now;
        offer.playerSignedAt = null;
      } else {
        offer.playerSignedAt = now;
        offer.clubSignedByUserId = null;
        offer.clubSignedAt = null;
      }
      offer.turn = party === 'club' ? 'player' : 'club';
      offer.respondedByUserId = caller.id;
      offer.expiresAt = new Date(now.getTime() + settings.offerExpiryDays * DAY_MS);
      await em.save(offer);
      const message = dto.message?.trim() || null;
      await this.recordBid(em, offer, party, caller.id, message);

      const params = {
        player: playerName,
        club: club.name,
        amount: offer.amountTk,
        kind: offer.kind,
        expiresAt: offer.expiresAt.toISOString(),
        message,
      };
      notices.push(
        party === 'club'
          ? {
              to: 'player',
              notice: {
                code: 'transfer.counterReceived',
                title: 'Counter-offer',
                message: `${club.name} counters with ${offer.amountTk} tk.`,
                link: PLAYER_LINK,
                params,
              },
            }
          : {
              to: 'clubLeaders',
              notice: {
                code: 'transfer.counterReceived',
                title: 'Counter-offer',
                message: `${playerName} asks for ${offer.amountTk} tk.`,
                link: clubLink(club.id),
                params,
              },
            },
      );
    });

    const offer = await this.dataSource.getRepository(TransferOffer).findOneOrFail({ where: { id: offerId } });
    await this.dispatch(offer, notices);
    return this.offerView(offerId);
  }

  /** Brings the club's hold for the offer up (or down) to the amount on the table. */
  private async chargeClub(
    em: EntityManager,
    offer: TransferOffer,
    playerName: string,
    method: TransferOffer['paymentMethod'] | undefined,
    now: Date,
  ): Promise<void> {
    if (offer.amountTk === offer.heldTk && (offer.amountTk === 0 || offer.paidAt)) return;
    offer.paymentMethod = offer.amountTk > 0 ? (method ?? offer.paymentMethod) : null;
    offer.paymentRef = offer.amountTk > 0 ? paymentRef() : null;
    offer.paidAt = offer.amountTk > 0 ? now : null;
    await this.walletsService.rehold(em, this.clubWallet(offer.toClubId), offer.heldTk, offer.amountTk, {
      offerId: offer.id,
      counterparty: playerName,
      reference: offer.paymentRef,
    });
    offer.heldTk = offer.amountTk;
  }

  // ------------------------------------------------------------------ cancel

  /** The side waiting for an answer withdraws its offer (any club money held is refunded). */
  async cancel(caller: User, offerId: string): Promise<OfferView> {
    const notices: Array<{ to: NoticeTarget; notice: Notice }> = [];
    await this.dataSource.transaction(async (em) => {
      const offer = await this.lockOffer(em, offerId);
      if (offer.status !== 'pending') throw new BadRequestException(`This offer is already ${offer.status}`);
      const club = await this.clubOf(em, offer.toClubId);
      const profile = await this.profileOf(em, offer.playerUserId);
      const playerName = profile.user?.name ?? 'Player';
      const params = { player: playerName, club: club.name, amount: offer.amountTk };

      if (offer.turn === 'club') {
        if (caller.id !== offer.playerUserId) throw new ForbiddenException('Only the player can withdraw this offer');
        notices.push({
          to: 'clubLeaders',
          notice: {
            code: 'transfer.cancelledByPlayer',
            title: offer.kind === 'player_proposal' ? 'Proposal withdrawn' : 'Offer withdrawn',
            message: `${playerName} withdrew from the deal.`,
            link: clubLink(club.id),
            params,
          },
        });
      } else {
        await this.assertClubLeader(em, offer.toClubId, caller.id);
        notices.push({
          to: 'player',
          notice: {
            code: 'transfer.cancelledByClub',
            title: 'Offer withdrawn',
            message: `${club.name} withdrew its offer.`,
            link: PLAYER_LINK,
            params,
          },
        });
      }
      offer.status = 'cancelled';
      offer.respondedByUserId = caller.id;
      await this.refundHold(em, offer, playerName);
    });
    const offer = await this.dataSource.getRepository(TransferOffer).findOneOrFail({ where: { id: offerId } });
    await this.dispatch(offer, notices);
    return this.offerView(offerId);
  }

  // -------------------------------------------------------------- completion

  private async lockOffer(em: EntityManager, offerId: string): Promise<TransferOffer> {
    const offer = await em
      .getRepository(TransferOffer)
      .createQueryBuilder('o')
      .setLock('pessimistic_write')
      .where('o.id = :offerId', { offerId })
      .getOne();
    if (!offer) throw new NotFoundException('Offer not found');
    return offer;
  }

  /** Returns the club money held for the offer and saves it (the caller sets the new status first). */
  private async refundHold(em: EntityManager, offer: TransferOffer, playerName: string): Promise<void> {
    const held = offer.heldTk;
    offer.heldTk = 0;
    offer.scheduledTournamentId = null;
    await em.save(offer);
    if (held <= 0) return;
    await this.walletsService.refund(em, this.clubWallet(offer.toClubId), held, {
      offerId: offer.id,
      counterparty: playerName,
    });
  }

  /**
   * Pays the hold out, ends the old contract, moves the player and starts the new
   * contract (frozen part = the amount). A player leaving his club is taken out of its
   * lineups for tournaments that haven't started. Runs inside the caller's transaction;
   * returns the old club's upcoming tournaments he was entered for.
   */
  private async completeInTransaction(
    em: EntityManager,
    offer: TransferOffer,
    profile: EfootballProfile & { user?: User },
    club: Club,
  ): Promise<UpcomingEntry[]> {
    const settings = await this.settingsService.transfers();
    const now = new Date();
    const playerName = profile.user?.name ?? 'Player';
    const fromClub = offer.fromClubId ? await em.getRepository(Club).findOne({ where: { id: offer.fromClubId } }) : null;

    if (offer.amountTk > 0) {
      await this.walletsService.payOut(em, this.clubWallet(club.id), this.payee(offer), offer.amountTk, {
        offerId: offer.id,
        fromName: club.name,
        toName: offer.payeeType === 'club' ? (fromClub?.name ?? 'Club') : playerName,
        reference: offer.paymentRef,
      });
    }
    offer.heldTk = 0;

    const old = await this.activeContract(em, offer.playerUserId);
    const moving = profile.clubId !== club.id;
    const entries = moving ? await this.upcomingEntries(em, profile) : [];
    await this.removeFromLineups(
      em,
      entries.filter((e) => e.entry === 'lineup').map((e) => e.participantId),
      profile.id,
    );
    if (old) {
      old.status = 'ended';
      old.endedAt = now;
      old.endReason = moving ? 'transfer' : 'renewal';
      await em.save(old);
    }

    if (moving) {
      await em
        .getRepository(EfootballProfile)
        .update({ id: profile.id }, { clubId: club.id, clubRole: ClubRole.PLAYER, teamId: null });
    }

    await startContract(em, settings, { userId: offer.playerUserId, clubId: club.id, offerId: offer.id, frozenTk: offer.amountTk }, now);

    offer.status = 'completed';
    offer.completedAt = now;
    offer.scheduledTournamentId = null;
    await em.save(offer);

    // His other open deals no longer fit (he's now locked at a new club): close and refund them.
    const others = await em.getRepository(TransferOffer).find({
      where: { playerUserId: offer.playerUserId, status: 'pending' },
    });
    for (const other of others) {
      other.status = 'cancelled';
      await this.refundHold(em, other, playerName);
    }
    return entries;
  }

  /**
   * Community membership and the notifications for a completed move (after commit).
   * `entries`: the old club's upcoming tournaments he was entered for (lineups he was taken out of).
   */
  private async afterCompletion(offer: TransferOffer, entries: UpcomingEntry[] = []): Promise<void> {
    const ds = this.dataSource;
    const profile = await ds.getRepository(EfootballProfile).findOne({ where: { userId: offer.playerUserId }, relations: { user: true } });
    const club = await ds.getRepository(Club).findOne({ where: { id: offer.toClubId } });
    const fromClub = offer.fromClubId ? await ds.getRepository(Club).findOne({ where: { id: offer.fromClubId } }) : null;
    const contract = await ds.getRepository(PlayerContract).findOne({ where: { offerId: offer.id } });
    if (!profile || !club || !contract) return;
    const playerName = profile.user?.name ?? 'Player';
    const moved = fromClub?.id !== club.id;

    if (moved) {
      try {
        if (fromClub) await this.communitiesService.onClubMemberRemoved(fromClub.id, profile.id);
        await this.communitiesService.onClubMemberAdded(club.id, profile.id);
      } catch (err) {
        this.logger.error(`Community membership update after transfer ${offer.id} failed: ${(err as Error).message}`);
      }
    }

    const fee = currentFee(contract);
    const params = {
      player: playerName,
      club: club.name,
      fromClub: fromClub?.name ?? null,
      amount: offer.amountTk,
      fee,
      contractNo: contract.contractNo,
      lockEndsAt: contract.lockEndsAt.toISOString(),
    };
    const notices: Array<{ to: NoticeTarget; notice: Notice }> = [];
    if (moved) {
      notices.push({
        to: 'player',
        notice: {
          code: 'transfer.completed',
          title: `Welcome to ${club.name}`,
          message: `Your transfer is complete (contract ${contract.contractNo}). Your transfer fee is now ${fee} tk.`,
          link: PLAYER_LINK,
          params,
        },
      });
      notices.push({
        to: 'clubMembers',
        notice: {
          code: 'transfer.memberJoined',
          title: 'New signing',
          message: `${playerName} joined ${club.name}.`,
          link: clubLink(club.id),
          params,
        },
      });
      if (fromClub) {
        notices.push({
          to: 'fromClubMembers',
          notice: {
            code: 'transfer.memberLeft',
            title: 'Player transferred',
            message: `${playerName} left ${fromClub.name} for ${club.name}.`,
            link: clubLink(fromClub.id),
            params,
          },
        });
        if (entries.length) {
          const names = [...new Set(entries.map((e) => e.tournamentName))].join(', ');
          notices.push({
            to: 'fromClubLeaders',
            notice: {
              code: 'transfer.lineupRemoved',
              title: 'Pick a replacement',
              message: `${playerName} has left ${fromClub.name}. He was entered for ${names}; he's been taken out of the club lineups, so pick a replacement.`,
              link: clubLink(fromClub.id),
              params: { ...params, tournaments: names },
            },
          });
        }
      }
    } else {
      const renewed = {
        code: 'transfer.renewed',
        title: 'Contract renewed',
        message: `${playerName}'s contract with ${club.name} is renewed (contract ${contract.contractNo}). New ${contract.lockDays}-day lock started.`,
        params,
      };
      notices.push({ to: 'player', notice: { ...renewed, link: PLAYER_LINK } });
      notices.push({ to: 'clubLeaders', notice: { ...renewed, link: clubLink(club.id) } });
    }
    if (offer.amountTk > 0) {
      const received = {
        code: 'transfer.paymentReceived',
        title: 'Payment received',
        message: `${offer.amountTk} tk received from ${club.name} for ${playerName}.`,
        params,
      };
      if (offer.payeeType === 'club' && fromClub) {
        notices.push({ to: 'fromClubLeaders', notice: { ...received, link: clubLink(fromClub.id) } });
      } else {
        notices.push({ to: 'player', notice: { ...received, link: PLAYER_LINK } });
      }
    }
    await this.dispatch(offer, notices);
  }

  // -------------------------------------------------------------- background

  /** Every minute: expire offers, complete scheduled transfers, send lock reminders. */
  async tick(now = new Date()): Promise<{ expired: number; completed: number; reminders: number }> {
    const expired = await this.expireDue(now);
    const completed = await this.completeScheduled();
    const reminders = await this.lockReminders(now);
    return { expired, completed, reminders };
  }

  async expireDue(now = new Date()): Promise<number> {
    const due = await this.dataSource.getRepository(TransferOffer).find({
      where: { status: 'pending' },
      select: { id: true, expiresAt: true },
    });
    let count = 0;
    for (const { id, expiresAt } of due) {
      if (expiresAt > now) continue;
      const notices: Array<{ to: 'player' | 'clubLeaders'; notice: Notice }> = [];
      await this.dataSource.transaction(async (em) => {
        const offer = await this.lockOffer(em, id);
        if (offer.status !== 'pending') return;
        const club = await this.clubOf(em, offer.toClubId);
        const profile = await this.profileOf(em, offer.playerUserId);
        const playerName = profile.user?.name ?? 'Player';
        const refundedTk = offer.heldTk;
        offer.status = 'expired';
        await this.refundHold(em, offer, playerName);
        const refunded = refundedTk > 0;
        const params = { player: playerName, club: club.name, amount: offer.amountTk, refunded: refunded ? 1 : 0 };
        notices.push({
          to: 'player',
          notice: {
            code: 'transfer.expired',
            title: 'Offer expired',
            message:
              offer.kind === 'player_proposal'
                ? `Your proposal to ${club.name} expired without an answer.`
                : `The offer from ${club.name} expired.`,
            link: PLAYER_LINK,
            params,
          },
        });
        notices.push({
          to: 'clubLeaders',
          notice: {
            code: 'transfer.expiredClub',
            title: 'Offer expired',
            message:
              offer.kind === 'player_proposal'
                ? `${playerName}'s proposal expired without an answer.`
                : `Your offer to ${playerName} expired after no answer${refunded ? ` — ${refundedTk} tk returned to the club wallet` : ''}.`,
            link: clubLink(club.id),
            params,
          },
        });
      });
      const offer = await this.dataSource.getRepository(TransferOffer).findOneOrFail({ where: { id } });
      if (notices.length) {
        await this.dispatch(offer, notices);
        count++;
      }
    }
    return count;
  }

  /**
   * Completes scheduled moves whose tournament is over. The rules are checked again
   * first: while the market is closed the move waits; if the buying club is frozen,
   * the player can no longer transfer or has moved meanwhile, the deal is cancelled
   * and the club's money refunded.
   */
  async completeScheduled(): Promise<number> {
    const scheduled = await this.dataSource.getRepository(TransferOffer).find({ where: { status: 'scheduled' } });
    if (!scheduled.length || !(await this.settingsService.features()).transfersOpen) return 0;
    let count = 0;
    for (const { id } of scheduled) {
      let removed: UpcomingEntry[] | null = null;
      let cancelled: { reason: string; player: string; club: string } | null = null;
      await this.dataSource.transaction(async (em) => {
        const offer = await this.lockOffer(em, id);
        if (offer.status !== 'scheduled') return;
        const profile = await this.profileOf(em, offer.playerUserId);
        if (await this.clubCommitment(em, profile)) return; // still playing
        const club = await this.clubOf(em, offer.toClubId);
        const reason = await this.completionProblem(em, offer, profile);
        if (reason) {
          const playerName = profile.user?.name ?? 'Player';
          offer.status = 'cancelled';
          await this.refundHold(em, offer, playerName);
          cancelled = { reason, player: playerName, club: club.name };
          return;
        }
        removed = await this.completeInTransaction(em, offer, profile, club);
      });
      const offer = await this.dataSource.getRepository(TransferOffer).findOneOrFail({ where: { id } });
      if (removed) {
        await this.afterCompletion(offer, removed);
        count++;
      } else if (cancelled) {
        const { reason, player, club } = cancelled;
        const notice: Notice = {
          code: 'transfer.cancelledAtCompletion',
          title: 'Transfer cancelled',
          message: `${player}'s move to ${club} was cancelled: ${reason} Any money the club paid was refunded.`,
          link: PLAYER_LINK,
          params: { player, club, reason },
        };
        await this.dispatch(offer, [
          { to: 'player', notice },
          { to: 'clubLeaders', notice: { ...notice, link: clubLink(offer.toClubId) } },
          ...(offer.fromClubId ? [{ to: 'fromClubLeaders' as const, notice: { ...notice, link: clubLink(offer.fromClubId) } }] : []),
        ]);
      }
    }
    return count;
  }

  /** Why a scheduled move can no longer go ahead, or null if it still can. */
  private async completionProblem(em: EntityManager, offer: TransferOffer, profile: EfootballProfile): Promise<string | null> {
    try {
      await assertNotFrozen(em, 'club', offer.toClubId);
      await this.assertTransferable(profile, 'player');
    } catch (err) {
      return (err as Error).message;
    }
    if ((profile.clubId ?? null) !== (offer.fromClubId ?? null)) return 'The player has moved since the deal was agreed.';
    return null;
  }

  /** "Lock ends in 7 days / 1 day" and "now a free agent", once each. */
  async lockReminders(now = new Date()): Promise<number> {
    const repo = this.dataSource.getRepository(PlayerContract);
    const contracts = await repo
      .createQueryBuilder('c')
      .where(`c.status = 'active'`)
      .andWhere(`c."notifiedFreeAt" IS NULL`)
      .andWhere(`c."lockEndsAt" <= :soon`, { soon: new Date(now.getTime() + 7 * DAY_MS) })
      .getMany();
    let sent = 0;
    for (const c of contracts) {
      const left = daysLeft(c.lockEndsAt, now);
      const stage: 'free' | '1d' | '7d' | null =
        left === 0 ? 'free' : left <= 1 && !c.notified1dAt ? '1d' : left <= 7 && !c.notified7dAt ? '7d' : null;
      if (!stage) continue;
      const user = await this.dataSource.getRepository(User).findOne({ where: { id: c.userId } });
      const club = await this.dataSource.getRepository(Club).findOne({ where: { id: c.clubId } });
      if (!user || !club) continue;
      const params = { player: user.name, club: club.name, days: left };
      if (stage === 'free') {
        await repo.update({ id: c.id }, { notifiedFreeAt: now });
        await this.notifyUsers([c.userId], {
          code: 'transfer.freeAgent',
          title: "You're a free agent",
          message: `Your lock with ${club.name} has ended. You can now propose to any club, or renew.`,
          link: PLAYER_LINK,
          params,
        });
        await this.notifyUsers(await this.clubLeaderIds(club.id), {
          code: 'transfer.freeAgentClub',
          title: 'Player out of lock',
          message: `${user.name}'s lock has ended — renew him before another club signs him.`,
          link: clubLink(club.id),
          params,
        });
      } else {
        await repo.update({ id: c.id }, stage === '1d' ? { notified1dAt: now } : { notified7dAt: now });
        await this.notifyUsers([c.userId], {
          code: 'transfer.lockSoon',
          title: 'Contract lock ending soon',
          message: `Your lock with ${club.name} ends in ${left} day(s).`,
          link: PLAYER_LINK,
          params,
        });
        await this.notifyUsers(await this.clubLeaderIds(club.id), {
          code: 'transfer.lockSoonClub',
          title: 'Contract lock ending soon',
          message: `${user.name}'s lock ends in ${left} day(s).`,
          link: clubLink(club.id),
          params,
        });
      }
      sent++;
    }
    return sent;
  }

  // ------------------------------------------------------------------- reads

  async contractView(c: PlayerContract, clubName?: string, now = new Date()): Promise<ContractView> {
    const name = clubName ?? (await this.dataSource.getRepository(Club).findOne({ where: { id: c.clubId } }))?.name ?? 'Club';
    const active = c.status === 'active';
    return {
      id: c.id,
      contractNo: c.contractNo,
      userId: c.userId,
      clubId: c.clubId,
      clubName: name,
      frozenTk: c.frozenTk,
      baseTk: c.baseTk,
      lockDays: c.lockDays,
      startAt: c.startAt.toISOString(),
      lockEndsAt: c.lockEndsAt.toISOString(),
      status: c.status,
      endedAt: c.endedAt ? c.endedAt.toISOString() : null,
      endReason: c.endReason,
      offerId: c.offerId,
      feeTk: active ? currentFee(c, now) : c.frozenTk,
      decayingTk: active ? decayingTk(c, now) : 0,
      daysLeft: active ? daysLeft(c.lockEndsAt, now) : 0,
      locked: active && isLocked(c.lockEndsAt, now),
    };
  }

  async offerView(offerId: string): Promise<OfferView> {
    const [view] = await this.offerViews({ ids: [offerId] });
    if (!view) throw new NotFoundException('Offer not found');
    return view;
  }

  private async offerViews(filter: { ids?: string[]; where?: string; params?: unknown[]; limit?: number }): Promise<OfferView[]> {
    const params: unknown[] = [...(filter.params ?? [])];
    const conditions: string[] = [];
    if (filter.ids) {
      params.push(filter.ids);
      conditions.push(`o.id = ANY($${params.length})`);
    }
    if (filter.where) conditions.push(filter.where);
    const rows = await this.dataSource.query(
      `SELECT o.*, u.name AS "playerName", u."dpUrl" AS "playerDpUrl",
              fc.name AS "fromName", fc."dpUrl" AS "fromDpUrl", fc.color AS "fromColor",
              tc.name AS "toName", tc."dpUrl" AS "toDpUrl", tc.color AS "toColor",
              signer.name AS "signerName",
              t.name AS "tName", t."startAt" AS "tStart", t."endAt" AS "tEnd",
              pc."contractNo"
         FROM transfer_offers o
         JOIN users u ON u.id = o."playerUserId"
         LEFT JOIN clubs fc ON fc.id = o."fromClubId"
         JOIN clubs tc ON tc.id = o."toClubId"
         LEFT JOIN users signer ON signer.id = o."clubSignedByUserId"
         LEFT JOIN tournaments t ON t.id = o."scheduledTournamentId"
         LEFT JOIN player_contracts pc ON pc."offerId" = o.id
        ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
        ORDER BY o."createdAt" DESC
        ${filter.limit ? `LIMIT ${Number(filter.limit)}` : ''}`,
      params,
    );
    const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);
    return rows.map(
      (r: Record<string, any>): OfferView => ({
        id: r.id,
        kind: r.kind,
        status: r.status,
        turn: r.turn,
        amountTk: r.amountTk,
        heldTk: r.heldTk,
        paymentStatus: paymentStatusOf(r as TransferOffer),
        payeeType: r.payeeType,
        message: r.message,
        player: { id: r.playerUserId, name: r.playerName, dpUrl: r.playerDpUrl },
        fromClub: r.fromClubId ? { id: r.fromClubId, name: r.fromName, dpUrl: r.fromDpUrl, color: r.fromColor } : null,
        toClub: { id: r.toClubId, name: r.toName, dpUrl: r.toDpUrl, color: r.toColor },
        createdByUserId: r.createdByUserId,
        expiresAt: iso(r.expiresAt)!,
        createdAt: iso(r.createdAt)!,
        completedAt: iso(r.completedAt),
        playerSignedAt: iso(r.playerSignedAt),
        clubSignedAt: iso(r.clubSignedAt),
        clubSignedBy: r.signerName ?? null,
        paymentMethod: r.paymentMethod,
        paymentRef: r.paymentRef,
        paidAt: iso(r.paidAt),
        scheduledTournament: r.scheduledTournamentId
          ? { tournamentId: r.scheduledTournamentId, tournamentName: r.tName, startAt: iso(r.tStart)!, endAt: iso(r.tEnd) }
          : null,
        contractNo: r.contractNo ?? null,
      }),
    );
  }

  /** The signed-in player's transfer page. */
  async me(caller: User) {
    const profile = await this.dataSource.getRepository(EfootballProfile).findOne({ where: { userId: caller.id } });
    const contract = await this.dataSource.getRepository(PlayerContract).findOne({ where: { userId: caller.id, status: 'active' } });
    const settings = await this.settingsService.transfers();
    const [offers, proposals, wallet, commitment] = await Promise.all([
      this.offerViews({ where: `o."playerUserId" = $1 AND o.status IN ('pending', 'scheduled')`, params: [caller.id] }),
      // Every club he has proposed to recently (open and closed), newest first.
      this.offerViews({ where: `o."playerUserId" = $1 AND o.kind = 'player_proposal'`, params: [caller.id], limit: 30 }),
      this.walletsService.view({ type: 'user', id: caller.id }),
      profile ? this.clubCommitment(this.dataSource, profile) : Promise.resolve(null),
    ]);
    return {
      settings: { baseFeeTk: settings.baseFeeTk, lockDays: settings.lockDays, offerExpiryDays: settings.offerExpiryDays },
      clubId: profile?.clubId ?? null,
      clubName: profile?.clubId
        ? ((await this.dataSource.getRepository(Club).findOne({ where: { id: profile.clubId } }))?.name ?? null)
        : null,
      clubRole: profile?.clubRole ?? null,
      contract: contract && profile?.clubId ? await this.contractView(contract) : null,
      commitment,
      offers,
      proposals,
      wallet,
    };
  }

  /** A club's transfer tab: squad contracts and history for everyone; offers and wallet for leaders. */
  async club(caller: User | null, clubId: string) {
    const club = await this.clubOf(this.dataSource.manager, clubId);
    const leader = caller ? await this.isClubLeader(this.dataSource.manager, clubId, caller.id) : false;
    const now = new Date();
    const members: Array<Record<string, any>> = await this.dataSource.query(
      `SELECT ep."userId", u.name, u."dpUrl", ep."clubRole", ep."gamePosition", ep.points, c.id AS "contractId"
         FROM efootball_profiles ep
         JOIN users u ON u.id = ep."userId"
         LEFT JOIN player_contracts c ON c."userId" = ep."userId" AND c.status = 'active' AND c."clubId" = ep."clubId"
        WHERE ep."clubId" = $1
        ORDER BY u.name`,
      [clubId],
    );
    const contracts = await this.dataSource.getRepository(PlayerContract).find({
      where: { id: In(members.map((m) => m.contractId).filter(Boolean)) },
    });
    const byId = new Map(contracts.map((c) => [c.id, c]));
    const squad = await Promise.all(
      members.map(async (m) => ({
        userId: m.userId,
        name: m.name,
        dpUrl: m.dpUrl,
        clubRole: m.clubRole,
        gamePosition: m.gamePosition,
        points: m.points,
        contract: m.contractId ? await this.contractView(byId.get(m.contractId)!, club.name, now) : null,
      })),
    );
    const [incoming, outgoing, wallet] = leader
      ? await Promise.all([
          // Waiting for the club's answer (proposals and players' counter-offers).
          this.offerViews({ where: `o."toClubId" = $1 AND o.status = 'pending' AND o.turn = 'club'`, params: [clubId] }),
          // Waiting for the player, agreed moves still to complete, and buyouts of the club's players.
          this.offerViews({
            where: `((o."toClubId" = $1 AND (o.turn = 'player' OR o.status = 'scheduled')) OR (o."fromClubId" = $1 AND o.kind = 'buyout')) AND o.status IN ('pending', 'scheduled')`,
            params: [clubId],
          }),
          this.walletsService.view(this.clubWallet(clubId)),
        ])
      : [[], [], null];
    return { clubId, isLeader: leader, squad, incoming, outgoing, wallet };
  }

  /** Players a club can sign without a buyout: clubless, or out of their lock. */
  async freeAgents(query: FreeAgentsQueryDto): Promise<PaginatedResult<Record<string, unknown>>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const params: unknown[] = [];
    let search = '';
    if (query.search?.trim()) {
      params.push(`%${query.search.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
      search = `AND u.name ILIKE $${params.length}`;
    }
    const base = `
      FROM efootball_profiles ep
      JOIN users u ON u.id = ep."userId"
      LEFT JOIN clubs cl ON cl.id = ep."clubId"
      LEFT JOIN player_contracts c ON c."userId" = ep."userId" AND c.status = 'active'
     WHERE COALESCE(ep."clubRole"::text, 'Player') NOT IN ('President', 'General Secretary')
       AND u."deletedAt" IS NULL AND u."bannedAt" IS NULL
       AND (ep."clubId" IS NULL OR c.id IS NULL OR c."lockEndsAt" <= now())
       AND NOT EXISTS (SELECT 1 FROM communities co WHERE co."creatorId" = ep."userId")
       AND NOT EXISTS (SELECT 1 FROM community_members cm WHERE cm."profileId" = ep.id AND cm.role IN ('President', 'Vice President'))
       AND NOT EXISTS (SELECT 1 FROM transfer_offers s WHERE s."playerUserId" = ep."userId" AND s.status = 'scheduled')
       ${search}`;
    const [rows, [{ total }]] = await Promise.all([
      this.dataSource.query(
        `SELECT ep."userId" AS id, u.name, u."dpUrl", ep."gamePosition", ep.points,
                cl.id AS "clubId", cl.name AS "clubName", c."lockEndsAt"
           ${base}
          ORDER BY ep.points DESC, u.name
          LIMIT ${Number(limit)} OFFSET ${Number((page - 1) * limit)}`,
        params,
      ),
      this.dataSource.query(`SELECT count(*)::int AS total ${base}`, params),
    ]);
    return createPaginatedResult(rows, total, page, limit);
  }

  /** Completed transfers (newest first) for a club (in or out) or a player. */
  async history(query: TransferHistoryQueryDto): Promise<PaginatedResult<OfferView>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const params: unknown[] = [];
    const conditions = [`o.status = 'completed'`];
    if (query.clubId) {
      params.push(query.clubId);
      conditions.push(`(o."toClubId" = $${params.length} OR o."fromClubId" = $${params.length})`);
    }
    if (query.userId) {
      params.push(query.userId);
      conditions.push(`o."playerUserId" = $${params.length}`);
    }
    const where = conditions.join(' AND ');
    const [{ total }] = await this.dataSource.query(`SELECT count(*)::int AS total FROM transfer_offers o WHERE ${where}`, params);
    const views = await this.offerViews({ where, params });
    return createPaginatedResult(views.slice((page - 1) * limit, page * limit), total, page, limit);
  }

  /** The player and the leaders of both clubs involved may see a deal's documents. */
  private async assertCanViewDeal(caller: User, offer: OfferView, what: string): Promise<void> {
    const allowed =
      caller.id === offer.player.id ||
      (await this.isClubLeader(this.dataSource.manager, offer.toClub.id, caller.id)) ||
      (offer.fromClub ? await this.isClubLeader(this.dataSource.manager, offer.fromClub.id, caller.id) : false);
    if (!allowed) throw new ForbiddenException(`Only the player and the clubs involved can view this ${what}`);
  }

  /** Every bid of a negotiation, oldest first. */
  async bids(caller: User, offerId: string): Promise<BidView[]> {
    await this.assertCanViewDeal(caller, await this.offerView(offerId), 'negotiation');
    const rows: Array<Record<string, any>> = await this.dataSource.query(
      `SELECT b.id, b.party, b."byUserId", u.name AS "byName", b."amountTk", b.message, b."createdAt"
         FROM transfer_offer_bids b
         LEFT JOIN users u ON u.id = b."byUserId"
        WHERE b."offerId" = $1
        ORDER BY b."createdAt"`,
      [offerId],
    );
    return rows.map((r) => ({
      id: r.id,
      party: r.party,
      byUserId: r.byUserId,
      byName: r.byName ?? null,
      amountTk: r.amountTk,
      message: r.message,
      createdAt: new Date(r.createdAt).toISOString(),
    }));
  }

  /** Everything the contract document needs, for the player or either club's leaders. */
  async contractDocument(caller: User, offerId: string) {
    const offer = await this.offerView(offerId);
    await this.assertCanViewDeal(caller, offer, 'contract');
    const settings = await this.settingsService.transfers();
    const contractRow = await this.dataSource.getRepository(PlayerContract).findOne({ where: { offerId } });
    const contract = contractRow ? await this.contractView(contractRow, offer.toClub.name) : null;
    const baseTk = contract?.baseTk ?? settings.baseFeeTk;
    const lockDays = contract?.lockDays ?? settings.lockDays;
    return {
      offer,
      contract,
      terms: {
        signingAmountTk: offer.amountTk,
        frozenTk: offer.amountTk,
        baseTk,
        lockDays,
        feeAtSigningTk: offer.amountTk + baseTk,
        startAt: contract?.startAt ?? null,
        lockEndsAt: contract?.lockEndsAt ?? null,
      },
    };
  }

  /** For a player's profile: club, contract fee, whether a club can buy him out now. */
  async playerStatus(userId: string) {
    const profile = await this.dataSource.getRepository(EfootballProfile).findOne({ where: { userId } });
    if (!profile) throw new NotFoundException('Player not found');
    const contract = profile.clubId
      ? await this.dataSource.getRepository(PlayerContract).findOne({ where: { userId, status: 'active' } })
      : null;
    const scheduled = await this.dataSource.getRepository(TransferOffer).findOne({ where: { playerUserId: userId, status: 'scheduled' } });
    const [commitment, leader] = await Promise.all([
      this.clubCommitment(this.dataSource, profile),
      this.communitiesService.isCommunityLeader(userId),
    ]);
    return {
      userId,
      clubId: profile.clubId,
      clubRole: profile.clubRole,
      contract: contract ? await this.contractView(contract) : null,
      transferable: !LEADER_ROLES.includes(profile.clubRole ?? '') && !leader && !scheduled,
      scheduled: Boolean(scheduled),
      commitment,
    };
  }

  /** My wallet's ledger, or a club wallet's (its President / GS only). */
  async walletHistory(caller: User, query: WalletHistoryQueryDto) {
    if (query.clubId) await this.assertClubLeader(this.dataSource.manager, query.clubId, caller.id);
    const owner: WalletOwner = query.clubId ? this.clubWallet(query.clubId) : { type: 'user', id: caller.id };
    return this.walletsService.history(owner, query);
  }

  async topUp(caller: User, clubId?: string) {
    if (clubId) await this.assertClubLeader(this.dataSource.manager, clubId, caller.id);
    const owner: WalletOwner = clubId ? this.clubWallet(clubId) : { type: 'user', id: caller.id };
    const { amountTk } = await this.walletsService.topUp(owner);
    await this.notifyUsers([caller.id], {
      code: 'transfer.topUp',
      title: 'Demo funds added',
      message: `${amountTk} tk demo funds added.`,
      link: clubId ? clubLink(clubId) : PLAYER_LINK,
      params: { amount: amountTk },
    });
    return this.walletsService.view(owner);
  }

  // ----------------------------------------------------------- notifications

  // ------------------------------------------------------------ staff tools

  /** Throws when staff have closed the transfer market. */
  private async assertMarketOpen(): Promise<void> {
    if (!(await this.settingsService.features()).transfersOpen) {
      throw new ForbiddenException('The transfer market is closed for now. Please try again later.');
    }
  }

  /** Staff cancel an open or scheduled deal; any money the club paid goes back to it. */
  async staffCancel(offerId: string, reason: string): Promise<OfferView> {
    let offer!: TransferOffer;
    let names = { player: 'Player', club: 'Club' };
    await this.dataSource.transaction(async (em) => {
      offer = await this.lockOffer(em, offerId);
      if (offer.status !== 'pending' && offer.status !== 'scheduled') {
        throw new BadRequestException(`This deal is ${offer.status}, so it can't be cancelled`);
      }
      const club = await this.clubOf(em, offer.toClubId);
      const profile = await this.profileOf(em, offer.playerUserId);
      names = { player: profile.user?.name ?? 'Player', club: club.name };
      offer.status = 'cancelled';
      await this.refundHold(em, offer, names.player);
    });
    const notice: Notice = {
      code: 'transfer.cancelledByStaff',
      title: 'Deal cancelled by ALLYNQ staff',
      message: `The deal between ${names.player} and ${names.club} was cancelled by ALLYNQ staff: ${reason}`,
      link: PLAYER_LINK,
      params: { player: names.player, club: names.club, reason },
    };
    await this.dispatch(offer, [
      { to: 'player', notice },
      { to: 'clubLeaders', notice: { ...notice, link: clubLink(offer.toClubId) } },
      ...(offer.fromClubId && offer.fromClubId !== offer.toClubId
        ? [{ to: 'fromClubLeaders' as const, notice: { ...notice, link: clubLink(offer.fromClubId) } }]
        : []),
    ]);
    return this.offerView(offerId);
  }

  /**
   * Staff undo a completed transfer: the money goes back to the buying club, the player
   * returns to where he was (or becomes clubless), and his previous contract is restored.
   * Only while the contract from this transfer is still his current one.
   */
  async staffReverse(offerId: string, reason: string): Promise<OfferView> {
    let offer!: TransferOffer;
    let moved = false;
    let names = { player: 'Player', club: 'Club', fromClub: null as string | null };
    let profileId = '';
    await this.dataSource.transaction(async (em) => {
      offer = await this.lockOffer(em, offerId);
      if (offer.status !== 'completed') throw new BadRequestException('Only completed transfers can be reversed');
      const current = await this.activeContract(em, offer.playerUserId);
      if (!current || current.offerId !== offer.id) {
        throw new BadRequestException('The player has moved or renewed since, so this transfer can no longer be reversed');
      }
      const club = await this.clubOf(em, offer.toClubId);
      const profile = await this.profileOf(em, offer.playerUserId);
      profileId = profile.id;
      const fromClub = offer.fromClubId
        ? await em.getRepository(Club).findOne({ where: { id: offer.fromClubId } })
        : null;
      names = { player: profile.user?.name ?? 'Player', club: club.name, fromClub: fromClub?.name ?? null };
      moved = offer.fromClubId !== offer.toClubId;

      if (offer.amountTk > 0) {
        await this.walletsService.adjust(em, this.payee(offer), -offer.amountTk, 'reversal', { offerId: offer.id, counterparty: club.name });
        await this.walletsService.adjust(em, this.clubWallet(club.id), offer.amountTk, 'reversal', {
          offerId: offer.id,
          counterparty: offer.payeeType === 'club' ? (fromClub?.name ?? 'Club') : names.player,
        });
      }

      current.status = 'ended';
      current.endedAt = new Date();
      current.endReason = 'reversed';
      await em.save(current);

      // The contract this transfer ended (same moment it completed) comes back as it was.
      const ended = await em.getRepository(PlayerContract).find({ where: { userId: offer.playerUserId, status: 'ended' } });
      const completedAt = offer.completedAt ? new Date(offer.completedAt).getTime() : NaN;
      const previous = ended.find((c) => c.id !== current.id && c.endedAt && new Date(c.endedAt).getTime() === completedAt) ?? null;
      const backToClub = fromClub && !fromClub.deletedAt ? fromClub : null;
      if (previous && (previous.clubId === backToClub?.id || !moved)) {
        previous.status = 'active';
        previous.endedAt = null;
        previous.endReason = null;
        await em.save(previous);
      }
      if (moved) {
        await em
          .getRepository(EfootballProfile)
          .update({ id: profile.id }, backToClub ? { clubId: backToClub.id, clubRole: ClubRole.PLAYER, teamId: null } : { clubId: null, clubRole: null, teamId: null });
      }
      offer.status = 'reversed';
      await em.save(offer);
    });

    if (moved) {
      try {
        await this.communitiesService.onClubMemberRemoved(offer.toClubId, profileId);
        if (offer.fromClubId) await this.communitiesService.onClubMemberAdded(offer.fromClubId, profileId);
      } catch (err) {
        this.logger.error(`Community membership update after reversing ${offer.id} failed: ${(err as Error).message}`);
      }
    }
    const notice: Notice = {
      code: 'transfer.reversedByStaff',
      title: 'Transfer reversed by ALLYNQ staff',
      message: `${names.player}'s move to ${names.club} was reversed by ALLYNQ staff: ${reason}`,
      link: PLAYER_LINK,
      params: { player: names.player, club: names.club, amount: offer.amountTk, reason },
    };
    await this.dispatch(offer, [
      { to: 'player', notice },
      { to: 'clubLeaders', notice: { ...notice, link: clubLink(offer.toClubId) } },
      ...(offer.fromClubId && moved ? [{ to: 'fromClubLeaders' as const, notice: { ...notice, link: clubLink(offer.fromClubId) } }] : []),
    ]);
    return this.offerView(offerId);
  }

  /** Staff end a player's lock now: he becomes a free agent at his club. */
  async staffEndLock(userId: string, reason: string): Promise<ContractView> {
    const contract = await this.dataSource.getRepository(PlayerContract).findOne({ where: { userId, status: 'active' } });
    if (!contract) throw new BadRequestException('This player has no active contract');
    if (!isLocked(contract.lockEndsAt)) throw new BadRequestException('The lock has already ended');
    contract.lockEndsAt = new Date();
    contract.notifiedFreeAt = new Date();
    await this.dataSource.getRepository(PlayerContract).save(contract);
    const club = await this.dataSource.getRepository(Club).findOne({ where: { id: contract.clubId } });
    const player = await this.dataSource.getRepository(User).findOne({ where: { id: userId } });
    const notice: Notice = {
      code: 'transfer.lockEndedByStaff',
      title: 'Lock ended by ALLYNQ staff',
      message: `${player?.name ?? 'The player'}'s lock at ${club?.name ?? 'the club'} was ended early by ALLYNQ staff: ${reason}. He is now a free agent.`,
      link: PLAYER_LINK,
      params: { player: player?.name ?? '', club: club?.name ?? '', reason },
    };
    await this.notifyUsers([userId], notice);
    await this.notifyUsers(await this.clubLeaderIds(contract.clubId), { ...notice, link: clubLink(contract.clubId) });
    return this.contractView(contract, club?.name);
  }

  private async clubLeaderIds(clubId: string): Promise<string[]> {
    const rows = await this.dataSource.getRepository(EfootballProfile).find({
      where: { clubId, clubRole: In(LEADER_ROLES as ClubRole[]) },
      select: { userId: true },
    });
    return rows.map((r) => r.userId);
  }

  private async clubMemberIds(clubId: string): Promise<string[]> {
    const rows = await this.dataSource.getRepository(EfootballProfile).find({ where: { clubId }, select: { userId: true } });
    return rows.map((r) => r.userId);
  }

  private async dispatch(
    offer: TransferOffer,
    notices: Array<{ to: NoticeTarget; notice: Notice }>,
  ): Promise<void> {
    for (const { to, notice } of notices) {
      const ids =
        to === 'player'
          ? [offer.playerUserId]
          : to === 'clubLeaders'
            ? await this.clubLeaderIds(offer.toClubId)
            : to === 'clubMembers'
              ? (await this.clubMemberIds(offer.toClubId)).filter((id) => id !== offer.playerUserId)
              : offer.fromClubId
                ? to === 'fromClubLeaders'
                  ? await this.clubLeaderIds(offer.fromClubId)
                  : await this.clubMemberIds(offer.fromClubId)
                : [];
      await this.notifyUsers(ids, { ...notice, params: { ...notice.params, offerId: offer.id } });
    }
  }

  private async notifyUsers(userIds: string[], notice: Notice): Promise<void> {
    await Promise.all(
      [...new Set(userIds)].map((userId) =>
        this.notificationsService
          .createNotification(userId, {
            title: notice.title,
            message: notice.message,
            type: 'transfer',
            link: notice.link,
            code: notice.code,
            params: notice.params,
          })
          .catch((err) => this.logger.error(`Transfer notification to ${userId} failed: ${err.message}`)),
      ),
    );
  }
}
