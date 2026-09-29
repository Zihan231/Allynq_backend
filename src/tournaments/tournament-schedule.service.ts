import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { formatRange, localDayStart, MINUTE_MS, rangeFrom } from './bracket/schedule.js';
import { TournamentGameTimeRequest } from './entities/tournament-game-time-request.entity.js';
import { TournamentMatchGame } from './entities/tournament-match-game.entity.js';
import { Tournament } from './entities/tournament.entity.js';
import { TournamentsService } from './tournaments.service.js';

/** Proposed times must leave the opponent at least this long to react. */
const MIN_NOTICE_MS = 30 * MINUTE_MS;

export interface TimeRequestView {
  id: string;
  gameId: string;
  requestedByUserId: string;
  proposedStart: Date;
  status: TournamentGameTimeRequest['status'];
}

/**
 * Time-change requests between the two players of a game. Only the start time
 * can move (same date); the change applies only if the opponent accepts.
 */
@Injectable()
export class TournamentScheduleService {
  constructor(
    @InjectRepository(TournamentMatchGame)
    private readonly gamesRepository: Repository<TournamentMatchGame>,
    @InjectRepository(TournamentGameTimeRequest)
    private readonly requestsRepository: Repository<TournamentGameTimeRequest>,
    private readonly tournamentsService: TournamentsService,
  ) {}

  async requestTimeChange(
    userId: string,
    tournamentId: string,
    gameId: string,
    proposedStartIso: string,
  ): Promise<TimeRequestView> {
    const game = await this.loadGame(tournamentId, gameId);
    const opponentUserId = this.opponentOf(game, userId);
    if (!opponentUserId) {
      throw new ForbiddenException('Only the two players of this game can request a time change');
    }
    this.assertChangeable(game);

    const proposedStart = new Date(proposedStartIso);
    if (Number.isNaN(proposedStart.getTime())) throw new BadRequestException('Invalid time');
    if (localDayStart(proposedStart) !== localDayStart(game.scheduledStart!)) {
      throw new BadRequestException('Only the time can change — pick a time on the same date');
    }
    if (proposedStart.getTime() < Date.now() + MIN_NOTICE_MS) {
      throw new BadRequestException('Pick a time at least 30 minutes from now');
    }
    if (proposedStart.getTime() === game.scheduledStart!.getTime()) {
      throw new BadRequestException('That is already the match time');
    }

    const pending = await this.requestsRepository.findOne({ where: { gameId, status: 'pending' } });
    if (pending && pending.requestedByUserId !== userId) {
      throw new BadRequestException('Your opponent already proposed a new time — accept or decline it first');
    }

    // A player's newer proposal replaces their own pending one.
    const request = pending ?? this.requestsRepository.create({ gameId, requestedByUserId: userId, status: 'pending' });
    request.proposedStart = proposedStart;
    const saved = await this.requestsRepository.save(request);

    const tournament = await this.tournamentsService.findOne(tournamentId);
    await this.tournamentsService.sendNotifications([opponentUserId], {
      title: 'Time change requested',
      message: `${this.nameOf(game, userId)} wants to move your match in "${tournament.name}" to ${formatRange(rangeFrom(proposedStart))} (Bangladesh time). Accept or decline — if you don't answer, the current time stays.`,
      link: this.timingLink(tournament, game),
    });

    return toView(saved);
  }

  async respondToTimeChange(
    userId: string,
    tournamentId: string,
    requestId: string,
    accept: boolean,
  ): Promise<TimeRequestView> {
    const request = await this.requestsRepository.findOne({ where: { id: requestId } });
    if (!request) throw new NotFoundException('Time change request not found');
    if (request.status !== 'pending') throw new BadRequestException('This request has already been answered');

    const game = await this.loadGame(tournamentId, request.gameId);
    if (this.opponentOf(game, request.requestedByUserId) !== userId) {
      throw new ForbiddenException('Only the opponent can answer this request');
    }

    const tournament = await this.tournamentsService.findOne(tournamentId);
    const link = this.timingLink(tournament, game);

    if (Date.now() >= game.scheduledStart!.getTime() || request.proposedStart.getTime() <= Date.now()) {
      await this.requestsRepository.update({ id: request.id }, { status: 'expired', respondedAt: new Date() });
      throw new BadRequestException('This request has expired — the current match time stays');
    }

    request.status = accept ? 'accepted' : 'declined';
    request.respondedAt = new Date();
    await this.requestsRepository.save(request);

    if (accept) {
      const range = rangeFrom(request.proposedStart);
      await this.gamesRepository.update(
        { id: game.id },
        { scheduledStart: range.start, scheduledEnd: range.end, evidenceDeadline: range.evidenceDeadline },
      );
      await this.tournamentsService.sendNotifications([request.requestedByUserId, userId], {
        title: 'Match time changed',
        message: `Your match ${game.playerAName} vs ${game.playerBName} in "${tournament.name}" is now ${formatRange(range)} (Bangladesh time). Upload your evidence within 30 minutes after it ends.`,
        link,
      });
    } else {
      await this.tournamentsService.sendNotifications([request.requestedByUserId], {
        title: 'Time change declined',
        message: `${this.nameOf(game, userId)} declined your new time. Your match in "${tournament.name}" stays at ${formatRange({ start: game.scheduledStart!, end: game.scheduledEnd! })} (Bangladesh time).`,
        link,
      });
    }

    return toView(request);
  }

  /** Called by the deadline job: unanswered requests lapse once the match range starts. */
  async expireStaleRequests(now = new Date()): Promise<number> {
    const stale = await this.requestsRepository.find({
      where: { status: 'pending', game: { scheduledStart: LessThanOrEqual(now) } },
      relations: { game: { match: true } },
    });
    for (const request of stale) {
      await this.requestsRepository.update({ id: request.id }, { status: 'expired', respondedAt: now });
      const game = request.game!;
      const tournament = await this.tournamentsService.findOne(game.match!.tournamentId);
      await this.tournamentsService.sendNotifications([request.requestedByUserId], {
        title: 'Time change request expired',
        message: `Your opponent didn't answer in time. Your match in "${tournament.name}" stays at ${formatRange({ start: game.scheduledStart!, end: game.scheduledEnd! })} (Bangladesh time).`,
        link: this.timingLink(tournament, game),
      });
    }
    return stale.length;
  }

  private async loadGame(tournamentId: string, gameId: string): Promise<TournamentMatchGame> {
    const game = await this.gamesRepository.findOne({ where: { id: gameId }, relations: { match: true } });
    if (!game?.match || game.match.tournamentId !== tournamentId) {
      throw new NotFoundException('Game not found in this tournament');
    }
    return game;
  }

  /** Time can only move before the range starts and before any evidence is in. */
  private assertChangeable(game: TournamentMatchGame): void {
    if (!game.scheduledStart || !game.scheduledEnd) {
      throw new BadRequestException('This game has no scheduled time yet');
    }
    if (game.status !== 'pending') {
      throw new BadRequestException('Results are already being submitted for this game');
    }
    if (Date.now() >= game.scheduledStart.getTime()) {
      throw new BadRequestException('The match has already started — its time can no longer change');
    }
  }

  private opponentOf(game: TournamentMatchGame, userId: string): string | null {
    if (game.playerAUserId === userId) return game.playerBUserId;
    if (game.playerBUserId === userId) return game.playerAUserId;
    return null;
  }

  private nameOf(game: TournamentMatchGame, userId: string): string {
    return game.playerAUserId === userId ? game.playerAName : game.playerBName;
  }

  private timingLink(tournament: Tournament, game: TournamentMatchGame): string {
    return `/dashboard/efootball/community/${tournament.communityId}/tournaments/${tournament.id}?tab=bracket&match=${game.matchId}&game=${game.id}&panel=time`;
  }
}

function toView(r: TournamentGameTimeRequest): TimeRequestView {
  return {
    id: r.id,
    gameId: r.gameId,
    requestedByUserId: r.requestedByUserId,
    proposedStart: r.proposedStart,
    status: r.status,
  };
}
