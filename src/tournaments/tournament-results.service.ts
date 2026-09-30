import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThanOrEqual, Repository } from 'typeorm';
import { CommunityMember } from '../communities/entities/community-member.entity.js';
import { EfootballProfile } from '../users/entities/efootball-profile.entity.js';
import { CommunityRole } from '../users/enums/user-attributes.enum.js';
import { TournamentGameSubmission } from './entities/tournament-game-submission.entity.js';
import { TournamentMatchGame } from './entities/tournament-match-game.entity.js';
import { TournamentMatch } from './entities/tournament-match.entity.js';
import { Tournament, tournamentLink } from './entities/tournament.entity.js';
import {
  type EvidenceFiles,
  evidenceUrl,
  MAX_SCREENSHOT_BYTES,
  removeEvidence,
} from './evidence-upload.js';
import { TournamentMatchesService } from './tournament-matches.service.js';
import {
  CLUB_LEADER_ROLES,
  CLUB_OFFICIAL_ROLES,
  MATCH_OFFICIAL_ROLES,
  TournamentsService,
} from './tournaments.service.js';

/** After a rejection both players get this long to upload new evidence. */
const RESUBMIT_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Goals credited to the side that uploaded evidence when the other did not. */
const WALKOVER_GOALS = 3;
/** Community staff who review evidence (plus the tournament creator). */
const REVIEWER_ROLES = [CommunityRole.PRESIDENT, CommunityRole.VICE_PRESIDENT];

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
    return games.filter((game) => reviewOpen(game)).map((game) => this.toReviewView(tournament, game));
  }

  /** One game with both sides' evidence, for the review screen. */
  async getGameForReview(userId: string, tournamentId: string, gameId: string): Promise<ReviewGameView> {
    const tournament = await this.tournamentsService.findOne(tournamentId);
    await this.assertCanReview(userId, tournament);
    const game = await this.loadGame(tournamentId, gameId);
    assertReviewOpen(game);
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
    assertReviewOpen(game);
    if (userId === game.playerAUserId || userId === game.playerBUserId) {
      throw new ForbiddenException("You can't review a game you played in");
    }

    const link = tournamentLink(tournament, `?tab=bracket&match=${game.matchId}`);
    const players = [game.playerAUserId, game.playerBUserId, ...(game.submissions ?? []).map((s) => s.submittedByUserId)];
    const playerIds = Array.from(new Set(players.filter((id): id is string => Boolean(id) && id !== userId)));

    if (decision.action === 'reject') {
      const note = decision.note?.trim() || null;
      const reopenedUntil = new Date(Date.now() + RESUBMIT_WINDOW_MS);
      // Both players must upload fresh evidence within the reopened window.
      await removeEvidence((game.submissions ?? []).flatMap((sub) => [...(sub.screenshotPaths ?? []), sub.videoPath]));
      await this.submissionsRepository.delete({ gameId: game.id });
      await this.gamesRepository.update(
        { id: game.id },
        {
          status: 'rejected',
          reviewNote: note,
          reviewedByUserId: userId,
          reviewedAt: new Date(),
          evidenceDeadline: reopenedUntil,
        },
      );
      await this.tournamentsService.sendNotifications(playerIds, {
        title: 'Result rejected — please resubmit',
        message: `Officials rejected the result of ${game.playerAName} vs ${game.playerBName} in "${tournament.name}"${note ? `: ${note}` : '.'} Both players must upload new evidence within 24 hours, or the game is decided automatically.`,
        link,
        code: note ? 'result.rejectedWithNote' : 'result.rejected',
        params: { playerA: game.playerAName, playerB: game.playerBName, tournament: tournament.name, note },
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
      {
        status: 'approved',
        resolution: (game.submissions ?? []).length ? 'reviewed' : 'official',
        goalsA,
        goalsB,
        reviewNote: null,
        reviewedByUserId: userId,
        reviewedAt: new Date(),
      },
    );
    await this.tournamentsService.sendNotifications(playerIds, {
      title: 'Result confirmed',
      message: `Officials confirmed ${game.playerAName} ${goalsA}–${goalsB} ${game.playerBName} in "${tournament.name}".`,
      link,
      code: 'result.confirmed',
      params: {
        playerA: game.playerAName,
        playerB: game.playerBName,
        goalsA: goalsA!,
        goalsB: goalsB!,
        tournament: tournament.name,
      },
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
        "Only the community President, Vice President or this tournament's match officials can review results",
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
      if (FINAL_STATUSES.includes(game.status) || game.match.status === 'completed') {
        throw new BadRequestException('This game already has its final result');
      }

      const side = game.playerAUserId === userId ? 'A' : game.playerBUserId === userId ? 'B' : null;
      if (!side) {
        throw new ForbiddenException('Only the two players of this game can upload its evidence');
      }
      const now = Date.now();
      if (game.scheduledStart && now < game.scheduledStart.getTime() && game.status !== 'rejected') {
        throw new BadRequestException('Evidence can be uploaded once your match time starts');
      }
      if (game.evidenceDeadline && now > game.evidenceDeadline.getTime()) {
        throw new BadRequestException('The evidence window for this game has closed');
      }

      const tournament = await this.tournamentsService.findOne(tournamentId);

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

      const otherSideIn = (game.submissions ?? []).some((sub) => sub.side !== side);
      game.status = otherSideIn ? 'submitted' : 'awaiting_opponent';
      game.reviewNote = null;
      await this.gamesRepository.save({ id: game.id, status: game.status, reviewNote: null });
      if (game.match.status === 'scheduled') {
        await this.matchesRepository.update({ id: game.match.id }, { status: 'in_review' });
      }

      await removeEvidence(replaced);
      await this.notifySubmission(tournament, game.match, game, side, userId, otherSideIn);

      return toSubmissionView(saved);
    } catch (err) {
      await removeEvidence(uploaded);
      throw err;
    }
  }

  /**
   * The host's leaders plus the tournament's match officials who still hold an
   * official role (a demoted official stops reviewing). Community tournaments:
   * the community President / Vice President. Club tournaments: the club
   * President / General Secretary.
   */
  async reviewerUserIds(tournament: Tournament): Promise<string[]> {
    const officialIds = tournament.matchOfficialIds ?? [];

    if (tournament.hostClubId) {
      const staff = await this.profilesRepository.find({
        where: { clubId: tournament.hostClubId, clubRole: In([...CLUB_LEADER_ROLES, ...CLUB_OFFICIAL_ROLES]) },
        select: { userId: true, clubRole: true },
      });
      return Array.from(
        new Set(
          staff
            .filter((p) => CLUB_LEADER_ROLES.includes(p.clubRole ?? '') || officialIds.includes(p.userId))
            .map((p) => p.userId),
        ),
      );
    }

    const members = await this.communityMembersRepository.find({
      where: { communityId: tournament.communityId!, role: In([...REVIEWER_ROLES, ...MATCH_OFFICIAL_ROLES]) },
      relations: { profile: true },
    });
    return Array.from(
      new Set(
        members
          .filter((m) => REVIEWER_ROLES.includes(m.role) || officialIds.includes(m.profile?.userId ?? ''))
          .map((m) => m.profile?.userId)
          .filter((id): id is string => Boolean(id)),
      ),
    );
  }

  private async notifySubmission(
    tournament: Tournament,
    match: TournamentMatch,
    game: TournamentMatchGame,
    side: 'A' | 'B',
    actorUserId: string,
    bothSidesIn: boolean,
  ): Promise<void> {
    const link = tournamentLink(tournament, `?tab=bracket&match=${match.id}`);
    const submitter = side === 'A' ? game.playerAName : game.playerBName;
    const opponentUserId = side === 'A' ? game.playerBUserId : game.playerAUserId;
    const fixture = `${game.playerAName} vs ${game.playerBName}`;

    // Reviewers are told once the evidence window closes (see resolveExpiredGames): players
    // may still replace their evidence until then, and reviews only open at that point.
    if (bothSidesIn) return;
    if (opponentUserId && opponentUserId !== actorUserId) {
      const deadline = game.evidenceDeadline ? ` before ${formatTime(game.evidenceDeadline)}` : '';
      await this.tournamentsService.sendNotifications([opponentUserId], {
        title: 'Your opponent uploaded evidence',
        message: `${submitter} uploaded the result of ${fixture} in "${tournament.name}". Upload your screenshots and video${deadline} (Bangladesh time) or you lose the game.`,
        link,
        code: game.evidenceDeadline ? 'result.opponentUploaded' : 'result.opponentUploadedNoDeadline',
        params: {
          submitter,
          fixture,
          tournament: tournament.name,
          deadlineAt: game.evidenceDeadline ? game.evidenceDeadline.toISOString() : null,
        },
      });
    }
  }

  /**
   * Called every minute by the deadline job. Games whose evidence window has
   * closed are decided: one side uploaded → that side wins by walkover; nobody
   * uploaded → both lose (double forfeit). Both uploaded → reviewers are told,
   * once, that the result is ready for review.
   */
  async resolveExpiredGames(now = new Date()): Promise<number> {
    const readyForReview = await this.gamesRepository.find({
      where: { status: 'submitted', evidenceDeadline: LessThanOrEqual(now), reviewReadyNotifiedAt: IsNull() },
      relations: { match: true },
    });
    for (const game of readyForReview) {
      await this.gamesRepository.update({ id: game.id }, { reviewReadyNotifiedAt: now });
      if (!game.match || game.match.status === 'completed') continue;
      const tournament = await this.tournamentsService.findOne(game.match.tournamentId);
      const reviewers = (await this.reviewerUserIds(tournament)).filter(
        (id) => id !== game.playerAUserId && id !== game.playerBUserId,
      );
      await this.tournamentsService.sendNotifications(reviewers, {
        title: 'Result ready for review',
        message: `Both players of ${game.playerAName} vs ${game.playerBName} in "${tournament.name}" uploaded their evidence and the upload window has closed.`,
        link: tournamentLink(tournament, `?tab=bracket&match=${game.matchId}`),
        code: 'result.readyForReview',
        params: { fixture: `${game.playerAName} vs ${game.playerBName}`, tournament: tournament.name },
      });
    }

    const expired = await this.gamesRepository.find({
      where: { status: In(['pending', 'awaiting_opponent', 'rejected']), evidenceDeadline: LessThanOrEqual(now) },
      relations: { match: true, submissions: true },
    });

    for (const game of expired) {
      if (!game.match || game.match.status === 'completed') continue;
      const tournament = await this.tournamentsService.findOne(game.match.tournamentId);
      const link = tournamentLink(tournament, `?tab=bracket&match=${game.matchId}`);
      const uploadedSides = (game.submissions ?? []).map((sub) => sub.side);
      const fixture = `${game.playerAName} vs ${game.playerBName}`;

      if (uploadedSides.length === 1) {
        const winner = uploadedSides[0];
        await this.gamesRepository.update(
          { id: game.id },
          {
            status: 'walkover',
            resolution: 'walkover',
            goalsA: winner === 'A' ? WALKOVER_GOALS : 0,
            goalsB: winner === 'B' ? WALKOVER_GOALS : 0,
          },
        );
        const [winnerId, loserId] = winner === 'A'
          ? [game.playerAUserId, game.playerBUserId]
          : [game.playerBUserId, game.playerAUserId];
        await this.tournamentsService.sendNotifications([winnerId].filter(Boolean) as string[], {
          title: 'You won by walkover',
          message: `Your opponent didn't upload evidence for ${fixture} in "${tournament.name}" in time. The game is yours.`,
          link,
          code: 'result.wonWalkover',
          params: { fixture, tournament: tournament.name },
        });
        await this.tournamentsService.sendNotifications([loserId].filter(Boolean) as string[], {
          title: 'Game lost — no evidence',
          message: `You didn't upload evidence for ${fixture} in "${tournament.name}" before the deadline, so your opponent wins the game.`,
          link,
          code: 'result.lostNoEvidence',
          params: { fixture, tournament: tournament.name },
        });
      } else {
        await this.gamesRepository.update(
          { id: game.id },
          { status: 'forfeited', resolution: 'double_forfeit', goalsA: 0, goalsB: 0 },
        );
        await this.tournamentsService.sendNotifications(
          [game.playerAUserId, game.playerBUserId].filter(Boolean) as string[],
          {
            title: 'Game forfeited',
            message: `Neither player uploaded evidence for ${fixture} in "${tournament.name}" before the deadline — it counts as a loss for both.`,
            link,
            code: 'result.doubleForfeit',
            params: { fixture, tournament: tournament.name },
          },
        );
      }

      const fixtureState = await this.matchesService.completeFixtureIfReady(game.matchId);
      if (fixtureState === 'needs_decider') {
        await this.tournamentsService.sendNotifications(await this.reviewerUserIds(tournament), {
          title: 'Knockout fixture needs a decision',
          message: `The knockout fixture with ${fixture} in "${tournament.name}" ended level. Open any game of it and approve with the decider winner.`,
          link,
          code: 'result.needsDecider',
          params: { fixture, tournament: tournament.name },
        });
      }
    }
    return expired.length + readyForReview.length;
  }
}

/** Officials may review only after the match range and 30-minute evidence window have ended. */
function reviewOpen(game: Pick<TournamentMatchGame, 'evidenceDeadline'>, now = Date.now()): boolean {
  return !game.evidenceDeadline || now > new Date(game.evidenceDeadline).getTime();
}

function assertReviewOpen(game: Pick<TournamentMatchGame, 'evidenceDeadline'>): void {
  if (!reviewOpen(game)) {
    throw new BadRequestException(
      `Review opens after the evidence window closes at ${formatTime(game.evidenceDeadline!)} (Bangladesh time)`,
    );
  }
}

/** Games that already have their final result. */
const FINAL_STATUSES: TournamentMatchGame['status'][] = ['approved', 'walkover', 'forfeited'];

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Dhaka', hour: 'numeric', minute: '2-digit' }).format(date);
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
