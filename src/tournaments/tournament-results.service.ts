import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CommunityMember } from '../communities/entities/community-member.entity.js';
import { EfootballProfile } from '../users/entities/efootball-profile.entity.js';
import { ClubRole, CommunityRole } from '../users/enums/user-attributes.enum.js';
import { TournamentGameSubmission } from './entities/tournament-game-submission.entity.js';
import { TournamentMatchGame } from './entities/tournament-match-game.entity.js';
import { TournamentMatch } from './entities/tournament-match.entity.js';
import { Tournament } from './entities/tournament.entity.js';
import { TournamentType } from './enums/tournament.enum.js';
import {
  type EvidenceFiles,
  evidenceUrl,
  MAX_SCREENSHOT_BYTES,
  removeEvidence,
} from './evidence-upload.js';
import { TournamentMatchesService } from './tournament-matches.service.js';
import { TournamentsService } from './tournaments.service.js';

/** Club roles allowed to submit results on behalf of their club's players. */
const CLUB_OFFICIAL_ROLES = [ClubRole.PRESIDENT, ClubRole.GENERAL_SECRETARY, ClubRole.MANAGER];
/** Community staff who review evidence (plus the tournament creator). */
const REVIEWER_ROLES = [CommunityRole.PRESIDENT, CommunityRole.VICE_PRESIDENT, CommunityRole.HEAD_OF_DISCIPLINE];

export interface ReviewGameView {
  gameId: string;
  matchId: string;
  stage: TournamentMatch['stage'];
  groupLabel: string | null;
  roundName: string;
  slot: number;
  isDecider: boolean;
  status: TournamentMatchGame['status'];
  entrantA: string;
  entrantB: string;
  playerA: { userId: string | null; name: string; dpUrl: string | null };
  playerB: { userId: string | null; name: string; dpUrl: string | null };
  goalsA: number | null;
  goalsB: number | null;
  reviewNote: string | null;
  submissions: SubmissionView[];
}

export interface ReviewDecision {
  action: 'approve' | 'reject';
  goalsA?: number;
  goalsB?: number;
  note?: string;
  /** Knockout fixtures that end level: who won the decider. */
  deciderWinner?: 'A' | 'B';
}

export interface SubmissionView {
  id: string;
  side: 'A' | 'B';
  goalsA: number;
  goalsB: number;
  screenshotUrls: string[];
  videoUrl: string | null;
  submittedAt: Date;
}

@Injectable()
export class TournamentResultsService {
  constructor(
    @InjectRepository(TournamentMatchGame)
    private readonly gamesRepository: Repository<TournamentMatchGame>,
    @InjectRepository(TournamentGameSubmission)
    private readonly submissionsRepository: Repository<TournamentGameSubmission>,
    @InjectRepository(TournamentMatch)
    private readonly matchesRepository: Repository<TournamentMatch>,
    @InjectRepository(EfootballProfile)
    private readonly profilesRepository: Repository<EfootballProfile>,
    @InjectRepository(CommunityMember)
    private readonly communityMembersRepository: Repository<CommunityMember>,
    private readonly tournamentsService: TournamentsService,
    private readonly matchesService: TournamentMatchesService,
  ) {}

  /** Games with evidence waiting for an official's decision. */
  async getReviewQueue(userId: string, tournamentId: string): Promise<ReviewGameView[]> {
    const tournament = await this.tournamentsService.findOne(tournamentId);
    await this.assertCanReview(userId, tournament);
    const games = await this.gamesRepository.find({
      where: { status: 'submitted', match: { tournamentId } },
      relations: { match: true, submissions: true },
      order: { updatedAt: 'ASC' },
    });
    return games.map((game) => this.toReviewView(tournament, game));
  }

  /** One game with both sides' evidence, for the review screen. */
  async getGameForReview(userId: string, tournamentId: string, gameId: string): Promise<ReviewGameView> {
    const tournament = await this.tournamentsService.findOne(tournamentId);
    await this.assertCanReview(userId, tournament);
    const game = await this.loadGame(tournamentId, gameId);
    return this.toReviewView(tournament, game);
  }

  /**
   * Approve (with the official final score) or reject (players must resubmit).
   * Approving without evidence is allowed, e.g. to record a no-show / forfeit.
   */
  async reviewGame(
    userId: string,
    tournamentId: string,
    gameId: string,
    decision: ReviewDecision,
  ): Promise<{ game: ReviewGameView; fixture: 'pending' | 'needs_decider' | 'completed' }> {
    const tournament = await this.tournamentsService.findOne(tournamentId);
    await this.assertCanReview(userId, tournament);
    const game = await this.loadGame(tournamentId, gameId);
    if (game.match!.status === 'completed' || game.match!.status === 'bye') {
      throw new BadRequestException('This fixture is already completed');
    }

    const link = `/dashboard/efootball/community/${tournament.communityId}/tournaments/${tournament.id}?tab=bracket&match=${game.matchId}`;
    const players = [game.playerAUserId, game.playerBUserId, ...(game.submissions ?? []).map((s) => s.submittedByUserId)];
    const playerIds = Array.from(new Set(players.filter((id): id is string => Boolean(id) && id !== userId)));

    if (decision.action === 'reject') {
      const note = decision.note?.trim() || null;
      await this.gamesRepository.update(
        { id: game.id },
        { status: 'rejected', reviewNote: note, reviewedByUserId: userId, reviewedAt: new Date() },
      );
      await this.tournamentsService.sendNotifications(playerIds, {
        title: 'Result rejected — please resubmit',
        message: `Officials rejected the result of ${game.playerAName} vs ${game.playerBName} in "${tournament.name}"${note ? `: ${note}` : '.'} Upload new evidence.`,
        link,
      });
      return { game: this.toReviewView(tournament, { ...game, status: 'rejected', reviewNote: note }), fixture: 'pending' };
    }

    const goalsA = decision.goalsA;
    const goalsB = decision.goalsB;
    const valid = (n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 99;
    if (!valid(goalsA) || !valid(goalsB)) {
      throw new BadRequestException('Enter the final score (whole numbers 0–99) to approve');
    }

    await this.gamesRepository.update(
      { id: game.id },
      { status: 'approved', goalsA, goalsB, reviewNote: null, reviewedByUserId: userId, reviewedAt: new Date() },
    );
    await this.tournamentsService.sendNotifications(playerIds, {
      title: 'Result confirmed',
      message: `Officials confirmed ${game.playerAName} ${goalsA}–${goalsB} ${game.playerBName} in "${tournament.name}".`,
      link,
    });

    const fixture = await this.matchesService.completeFixtureIfReady(game.matchId, decision.deciderWinner ?? null);
    return {
      game: this.toReviewView(tournament, { ...game, status: 'approved', goalsA: goalsA!, goalsB: goalsB!, reviewNote: null }),
      fixture,
    };
  }

  async assertCanReview(userId: string, tournament: Tournament): Promise<void> {
    if (!(await this.reviewerUserIds(tournament)).includes(userId)) {
      throw new ForbiddenException(
        'Only the tournament creator, community President / Vice President or Head of Discipline can review results',
      );
    }
  }

  private async loadGame(tournamentId: string, gameId: string): Promise<TournamentMatchGame> {
    const game = await this.gamesRepository.findOne({
      where: { id: gameId },
      relations: { match: true, submissions: true },
    });
    if (!game?.match || game.match.tournamentId !== tournamentId) {
      throw new NotFoundException('Game not found in this tournament');
    }
    return game;
  }

  private toReviewView(tournament: Tournament, game: TournamentMatchGame): ReviewGameView {
    const nameOf = (participantId: string | null | undefined) => {
      const p = tournament.participants?.find((x) => x.id === participantId);
      return p?.club?.name ?? p?.user?.name ?? 'TBD';
    };
    return {
      gameId: game.id,
      matchId: game.matchId,
      stage: game.match!.stage,
      groupLabel: game.match!.groupLabel,
      roundName: game.match!.roundName,
      slot: game.slot,
      isDecider: game.isDecider,
      status: game.status,
      entrantA: nameOf(game.match!.participantAId),
      entrantB: nameOf(game.match!.participantBId),
      playerA: { userId: game.playerAUserId, name: game.playerAName, dpUrl: game.playerADpUrl },
      playerB: { userId: game.playerBUserId, name: game.playerBName, dpUrl: game.playerBDpUrl },
      goalsA: game.goalsA,
      goalsB: game.goalsB,
      reviewNote: game.reviewNote,
      submissions: (game.submissions ?? []).map(toSubmissionView).sort((a, b) => a.side.localeCompare(b.side)),
    };
  }

  /**
   * A player (or their club's official) submits their side's score for a game
   * with evidence: 1–3 screenshots and a video. Resubmitting replaces that
   * side's previous submission until an official has approved the game.
   */
  async submitGameResult(
    userId: string,
    tournamentId: string,
    gameId: string,
    body: { goalsA?: unknown; goalsB?: unknown },
    files: EvidenceFiles,
  ): Promise<SubmissionView> {
    const screenshots = files.screenshots ?? [];
    const video = files.video?.[0];
    const uploaded = [...screenshots.map(evidenceUrl), ...(video ? [evidenceUrl(video)] : [])];

    try {
      const goalsA = parseGoals(body.goalsA);
      const goalsB = parseGoals(body.goalsB);

      const game = await this.gamesRepository.findOne({
        where: { id: gameId },
        relations: { match: true, submissions: true },
      });
      if (!game?.match || game.match.tournamentId !== tournamentId) {
        throw new NotFoundException('Game not found in this tournament');
      }
      if (game.status === 'approved' || game.match.status === 'completed') {
        throw new BadRequestException('This game has already been confirmed by the officials');
      }

      const tournament = await this.tournamentsService.findOne(tournamentId);
      const side = await this.sideFor(userId, tournament, game.match, game);
      if (!side) {
        throw new ForbiddenException('Only the players in this game (or their club officials) can submit its result');
      }

      const existing = game.submissions?.find((s) => s.side === side) ?? null;
      if (!screenshots.length && !existing?.screenshotPaths.length) {
        throw new BadRequestException('Upload at least one screenshot of the final score');
      }
      if (!video && !existing?.videoPath) {
        throw new BadRequestException('Upload a video of the match');
      }
      if (screenshots.some((file) => file.size > MAX_SCREENSHOT_BYTES)) {
        throw new BadRequestException('Each screenshot must be 10 MB or smaller');
      }

      const replaced = [
        ...(screenshots.length ? existing?.screenshotPaths ?? [] : []),
        ...(video ? [existing?.videoPath] : []),
      ];

      const submission = existing ?? this.submissionsRepository.create({ gameId, side });
      submission.submittedByUserId = userId;
      submission.goalsA = goalsA;
      submission.goalsB = goalsB;
      if (screenshots.length) submission.screenshotPaths = screenshots.map(evidenceUrl);
      if (video) submission.videoPath = evidenceUrl(video);
      const saved = await this.submissionsRepository.save(submission);

      game.status = 'submitted';
      game.reviewNote = null;
      await this.gamesRepository.save({ id: game.id, status: game.status, reviewNote: null });
      if (game.match.status === 'scheduled') {
        await this.matchesRepository.update({ id: game.match.id }, { status: 'in_review' });
      }

      await removeEvidence(replaced);
      await this.notifySubmission(tournament, game.match, game, side, userId);

      return toSubmissionView(saved);
    } catch (err) {
      await removeEvidence(uploaded);
      throw err;
    }
  }

  /**
   * Which side the caller submits for: the game's own player, or (CvC) a
   * President / General Secretary / Manager of that side's club.
   */
  private async sideFor(
    userId: string,
    tournament: Tournament,
    match: TournamentMatch,
    game: TournamentMatchGame,
  ): Promise<'A' | 'B' | null> {
    if (game.playerAUserId === userId) return 'A';
    if (game.playerBUserId === userId) return 'B';
    if (tournament.type !== TournamentType.CVC) return null;

    const profile = await this.profilesRepository.findOne({ where: { userId } });
    if (!profile?.clubId || !profile.clubRole || !CLUB_OFFICIAL_ROLES.includes(profile.clubRole)) return null;

    const clubOf = (participantId: string | null) =>
      tournament.participants?.find((p) => p.id === participantId)?.clubId ?? null;
    if (clubOf(match.participantAId) === profile.clubId) return 'A';
    if (clubOf(match.participantBId) === profile.clubId) return 'B';
    return null;
  }

  /** Tournament creator, community creator, and community President / VP / Head of Discipline. */
  async reviewerUserIds(tournament: Tournament): Promise<string[]> {
    const members = await this.communityMembersRepository.find({
      where: { communityId: tournament.communityId, role: In(REVIEWER_ROLES) },
      relations: { profile: true },
    });
    return Array.from(
      new Set(
        [tournament.creatorId, tournament.community?.creatorId, ...members.map((m) => m.profile?.userId)].filter(
          (id): id is string => Boolean(id),
        ),
      ),
    );
  }

  private async notifySubmission(
    tournament: Tournament,
    match: TournamentMatch,
    game: TournamentMatchGame,
    side: 'A' | 'B',
    actorUserId: string,
  ): Promise<void> {
    const link = `/dashboard/efootball/community/${tournament.communityId}/tournaments/${tournament.id}?tab=bracket&match=${match.id}`;
    const submitter = side === 'A' ? game.playerAName : game.playerBName;
    const opponentUserId = side === 'A' ? game.playerBUserId : game.playerAUserId;
    const fixture = `${game.playerAName} vs ${game.playerBName}`;

    const reviewers = (await this.reviewerUserIds(tournament)).filter((id) => id !== actorUserId);
    await this.tournamentsService.sendNotifications(reviewers, {
      title: 'Result submitted for review',
      message: `${submitter} submitted the result of ${fixture} in "${tournament.name}" with evidence.`,
      link,
    });

    const opponentSubmitted = game.submissions?.some((s) => s.side !== side);
    if (opponentUserId && opponentUserId !== actorUserId && !opponentSubmitted) {
      await this.tournamentsService.sendNotifications([opponentUserId], {
        title: 'Your opponent submitted a result',
        message: `${submitter} submitted the result of ${fixture} in "${tournament.name}". Upload your screenshots and video too.`,
        link,
      });
    }
  }
}

function parseGoals(value: unknown): number {
  const goals = Number(value);
  if (value === undefined || value === '' || !Number.isInteger(goals) || goals < 0 || goals > 99) {
    throw new BadRequestException('Scores must be whole numbers between 0 and 99');
  }
  return goals;
}

function toSubmissionView(s: TournamentGameSubmission): SubmissionView {
  return {
    id: s.id,
    side: s.side,
    goalsA: s.goalsA,
    goalsB: s.goalsB,
    screenshotUrls: s.screenshotPaths ?? [],
    videoUrl: s.videoPath,
    submittedAt: s.updatedAt ?? s.createdAt,
  };
}
