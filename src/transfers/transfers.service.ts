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
import { currentFee, daysLeft, decayingTk, formatContractNo, isLocked, lockEnd, paymentRef } from './contract-fee.js';
import type { CreateOfferDto, FreeAgentsQueryDto, RespondOfferDto, TransferHistoryQueryDto } from './dto/transfer.dto.js';
import { PlayerContract, type ContractEndReason } from './entities/player-contract.entity.js';
import { TransferOffer, type TransferOfferKind } from './entities/transfer-offer.entity.js';
import { WalletsService, type WalletOwner } from './wallets.service.js';

const LEADER_ROLES: string[] = [ClubRole.PRESIDENT, ClubRole.GENERAL_SECRETARY];
const PLAYER_LINK = '/dashboard/efootball/transfers';
const clubLink = (clubId: string) => `/dashboard/efootball/clubs/${clubId}?tab=transfers`;
const DAY_MS = 24 * 60 * 60 * 1000;

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

export interface OfferView {
  id: string;
  kind: TransferOfferKind;
  status: TransferOffer['status'];
  amountTk: number;
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

  /** Active tournament the player is playing in with his current club, if any. */
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
          AND (
            (p."participantType" = 'club' AND p."clubId" = $1 AND EXISTS (
               SELECT 1 FROM jsonb_array_elements(
                 COALESCE(p.lineup->'starters', '[]'::jsonb) || COALESCE(p.lineup->'substitutes', '[]'::jsonb)
               ) e WHERE e->>'profileId' = $2))
            OR (t."hostClubId" = $1 AND p."participantType" = 'player' AND p."userId" = $3)
          )
        ORDER BY t."startAt"
        LIMIT 1`,
      [profile.clubId, profile.id, profile.userId],
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
    const notices: Array<{ to: 'player' | 'clubLeaders' | 'fromClubLeaders'; notice: Notice }> = [];
    const settings = await this.settingsService.transfers();
    const now = new Date();

    const offerId = await this.dataSource.transaction(async (em) => {
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
        payeeType,
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

  async respond(caller: User, offerId: string, dto: RespondOfferDto): Promise<OfferView> {
    const notices: Array<{ to: 'player' | 'clubLeaders' | 'fromClubLeaders'; notice: Notice }> = [];
    let completion: { offerId: string; moved: boolean } | null = null;

    await this.dataSource.transaction(async (em) => {
      const offer = await this.lockOffer(em, offerId);
      if (offer.status !== 'pending') throw new BadRequestException(`This offer is already ${offer.status}`);
      if (offer.expiresAt <= new Date()) throw new BadRequestException('This offer has expired');

      const isProposal = offer.kind === 'player_proposal';
      if (isProposal) await this.assertClubLeader(em, offer.toClubId, caller.id);
      else if (caller.id !== offer.playerUserId) throw new ForbiddenException('Only the player can answer this offer');

      const club = await this.clubOf(em, offer.toClubId);
      const profile = await this.profileOf(em, offer.playerUserId);
      const playerName = profile.user?.name ?? 'Player';
      const params = { player: playerName, club: club.name, amount: offer.amountTk, kind: offer.kind };
      offer.respondedByUserId = caller.id;

      if (!dto.accept) {
        offer.status = 'declined';
        await em.save(offer);
        if (!isProposal) await this.refundHold(em, offer, playerName);
        notices.push(
          isProposal
            ? {
                to: 'player',
                notice: {
                  code: 'transfer.declinedByClub',
                  title: 'Proposal declined',
                  message: `${club.name} declined your proposal.`,
                  link: PLAYER_LINK,
                  params,
                },
              }
            : {
                to: 'clubLeaders',
                notice: {
                  code: 'transfer.declinedByPlayer',
                  title: 'Offer declined',
                  message: `${playerName} declined your offer. ${offer.amountTk} tk was returned to the club wallet.`,
                  link: clubLink(club.id),
                  params,
                },
              },
        );
        return;
      }

      // Accepting signs the contract.
      const now = new Date();
      if (isProposal) {
        if (offer.amountTk > 0 && !dto.paymentMethod) throw new BadRequestException('Choose a payment method');
        await this.assertTransferable(profile, 'player');
        const current = await this.activeContract(em, profile.userId);
        if (current && profile.clubId && profile.clubId !== offer.toClubId && isLocked(current.lockEndsAt, now)) {
          throw new BadRequestException('This player is now under contract at another club; make a buyout offer instead');
        }
        offer.clubSignedByUserId = caller.id;
        offer.clubSignedAt = now;
        if (offer.amountTk > 0) {
          offer.paymentMethod = dto.paymentMethod!;
          offer.paymentRef = paymentRef();
          offer.paidAt = now;
          await this.walletsService.hold(em, this.clubWallet(club.id), offer.amountTk, {
            offerId: offer.id,
            counterparty: playerName,
            reference: offer.paymentRef,
          });
        }
      } else {
        offer.playerSignedAt = now;
      }

      // The player must still be where the offer found him (e.g. not bought by someone else meanwhile).
      if ((profile.clubId ?? null) !== (offer.fromClubId ?? null) && offer.kind !== 'player_proposal') {
        throw new BadRequestException('The player has moved since this offer was made');
      }
      if (offer.kind === 'player_proposal') offer.fromClubId = profile.clubId ?? null;

      notices.push({
        to: isProposal ? 'player' : 'clubLeaders',
        notice: {
          code: 'transfer.accepted',
          title: isProposal ? 'Proposal accepted' : 'Offer accepted',
          message: isProposal
            ? `${club.name} accepted your proposal.`
            : `${playerName} accepted your offer.`,
          link: isProposal ? PLAYER_LINK : clubLink(club.id),
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
        if (offer.fromClubId) notices.push({ to: 'fromClubLeaders', notice: { ...notice, link: clubLink(offer.fromClubId) } });
        return;
      }

      await em.save(offer);
      completion = { offerId: offer.id, moved: moving };
      await this.completeInTransaction(em, offer, profile, club);
    });

    const offer = await this.dataSource.getRepository(TransferOffer).findOneOrFail({ where: { id: offerId } });
    await this.dispatch(offer, notices);
    if (completion) await this.afterCompletion(offer);
    return this.offerView(offerId);
  }

  // ------------------------------------------------------------------ cancel

  async cancel(caller: User, offerId: string): Promise<OfferView> {
    const notices: Array<{ to: 'player' | 'clubLeaders' | 'fromClubLeaders'; notice: Notice }> = [];
    await this.dataSource.transaction(async (em) => {
      const offer = await this.lockOffer(em, offerId);
      if (offer.status !== 'pending') throw new BadRequestException(`This offer is already ${offer.status}`);
      const club = await this.clubOf(em, offer.toClubId);
      const profile = await this.profileOf(em, offer.playerUserId);
      const playerName = profile.user?.name ?? 'Player';
      const params = { player: playerName, club: club.name, amount: offer.amountTk };

      if (offer.kind === 'player_proposal') {
        if (caller.id !== offer.playerUserId) throw new ForbiddenException('Only the player can withdraw his proposal');
        notices.push({
          to: 'clubLeaders',
          notice: {
            code: 'transfer.cancelledByPlayer',
            title: 'Proposal withdrawn',
            message: `${playerName} withdrew his proposal.`,
            link: clubLink(club.id),
            params,
          },
        });
      } else {
        await this.assertClubLeader(em, offer.toClubId, caller.id);
        await this.refundHold(em, offer, playerName);
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
      await em.save(offer);
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

  private async refundHold(em: EntityManager, offer: TransferOffer, playerName: string): Promise<void> {
    if (offer.kind === 'player_proposal' || offer.amountTk <= 0 || !offer.paidAt) return;
    await this.walletsService.refund(em, this.clubWallet(offer.toClubId), offer.amountTk, {
      offerId: offer.id,
      counterparty: playerName,
    });
  }

  /**
   * Pays the hold out, ends the old contract, moves the player and starts the new
   * contract (frozen part = the amount). Runs inside the caller's transaction.
   */
  private async completeInTransaction(
    em: EntityManager,
    offer: TransferOffer,
    profile: EfootballProfile & { user?: User },
    club: Club,
  ): Promise<void> {
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

    const old = await this.activeContract(em, offer.playerUserId);
    const moving = profile.clubId !== club.id;
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

    const [{ seq }] = await em.query(`SELECT nextval('contract_no_seq')::int AS seq`);
    await em.getRepository(PlayerContract).insert({
      contractNo: formatContractNo(seq, now),
      userId: offer.playerUserId,
      clubId: club.id,
      offerId: offer.id,
      frozenTk: offer.amountTk,
      baseTk: settings.baseFeeTk,
      lockDays: settings.lockDays,
      startAt: now,
      lockEndsAt: lockEnd(now, settings.lockDays),
      status: 'active',
    });

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
      await em.save(other);
      await this.refundHold(em, other, playerName);
    }
  }

  /** Community membership and the notifications for a completed move (after commit). */
  private async afterCompletion(offer: TransferOffer): Promise<void> {
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
    const notices: Array<{ to: 'player' | 'clubLeaders' | 'fromClubLeaders' | 'clubMembers' | 'fromClubMembers'; notice: Notice }> = [];
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
      }
    } else {
      const renewed = {
        code: 'transfer.renewed',
        title: 'Contract renewed',
        message: `${playerName}'s contract with ${club.name} is renewed (contract ${contract.contractNo}). New 120-day lock started.`,
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
        offer.status = 'expired';
        await em.save(offer);
        await this.refundHold(em, offer, playerName);
        const refunded = offer.kind !== 'player_proposal' && offer.amountTk > 0;
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
                : `Your offer to ${playerName} expired after no answer${refunded ? ` — ${offer.amountTk} tk returned to the club wallet` : ''}.`,
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

  async completeScheduled(): Promise<number> {
    const scheduled = await this.dataSource.getRepository(TransferOffer).find({ where: { status: 'scheduled' } });
    let count = 0;
    for (const { id } of scheduled) {
      let done = false;
      await this.dataSource.transaction(async (em) => {
        const offer = await this.lockOffer(em, id);
        if (offer.status !== 'scheduled') return;
        const profile = await this.profileOf(em, offer.playerUserId);
        if (await this.clubCommitment(em, profile)) return; // still playing
        const club = await this.clubOf(em, offer.toClubId);
        await this.completeInTransaction(em, offer, profile, club);
        done = true;
      });
      if (done) {
        const offer = await this.dataSource.getRepository(TransferOffer).findOneOrFail({ where: { id } });
        await this.afterCompletion(offer);
        count++;
      }
    }
    return count;
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
        amountTk: r.amountTk,
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
          this.offerViews({ where: `o."toClubId" = $1 AND o.kind = 'player_proposal' AND o.status = 'pending'`, params: [clubId] }),
          this.offerViews({
            where: `((o."toClubId" = $1 AND o.kind <> 'player_proposal') OR (o."fromClubId" = $1 AND o.kind = 'buyout')) AND o.status IN ('pending', 'scheduled')`,
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

  /** Everything the contract document needs, for the player or either club's leaders. */
  async contractDocument(caller: User, offerId: string) {
    const offer = await this.offerView(offerId);
    const allowed =
      caller.id === offer.player.id ||
      (await this.isClubLeader(this.dataSource.manager, offer.toClub.id, caller.id)) ||
      (offer.fromClub ? await this.isClubLeader(this.dataSource.manager, offer.fromClub.id, caller.id) : false);
    if (!allowed) throw new ForbiddenException('Only the player and the clubs involved can view this contract');
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
    notices: Array<{ to: 'player' | 'clubLeaders' | 'fromClubLeaders' | 'clubMembers' | 'fromClubMembers'; notice: Notice }>,
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
