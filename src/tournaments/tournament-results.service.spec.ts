import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ClubRole } from '../users/enums/user-attributes.enum.js';
import { TournamentType } from './enums/tournament.enum.js';
import { TournamentGameSubmission } from './entities/tournament-game-submission.entity.js';
import { TournamentMatch } from './entities/tournament-match.entity.js';
import { TournamentResultsService } from './tournament-results.service.js';

const file = (name: string, size = 1024) => ({ filename: name, size }) as Express.Multer.File;

const HOUR = 60 * 60 * 1000;

function setup(
  options: {
    type?: TournamentType;
    gameStatus?: string;
    existing?: object[];
    callerProfile?: object | null;
    scheduledStart?: Date | null;
    evidenceDeadline?: Date | null;
    expired?: object[];
    /** Games returned by the "both uploaded, window closed" lookup of the deadline job. */
    readyForReview?: object[];
    /** Host the tournament in a club instead of a community. */
    clubHost?: boolean;
  } = {},
) {
  const match = { id: 'm1', tournamentId: 't1', status: 'scheduled', participantAId: 'pa', participantBId: 'pb' };
  const game = {
    id: 'g1',
    matchId: 'm1',
    match,
    status: options.gameStatus ?? 'pending',
    playerAUserId: 'user-a',
    playerAName: 'Alice',
    playerBUserId: 'user-b',
    playerBName: 'Bob',
    submissions: options.existing ?? [],
    scheduledStart: options.scheduledStart ?? null,
    evidenceDeadline: options.evidenceDeadline ?? null,
  };
  const tournament = {
    id: 't1',
    name: 'Cup',
    type: options.type ?? TournamentType.PVP,
    communityId: options.clubHost ? null : 'c1',
    hostClubId: options.clubHost ? 'host-club' : null,
    creatorId: 'organizer',
    community: options.clubHost ? null : { creatorId: 'organizer' },
    // user-a plays in g1 and is also an official: they still can't review their own game.
    // In the club host, 'demoted' was appointed but no longer holds a staff role.
    matchOfficialIds: options.clubHost ? ['captain', 'demoted'] : ['match-official', 'user-a'],
    participants: [
      { id: 'pa', clubId: 'club-a' },
      { id: 'pb', clubId: 'club-b' },
    ],
  };
  const gamesRepository = {
    findOne: vi.fn().mockResolvedValue(game),
    save: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    find: vi.fn().mockImplementation(({ where }: { where?: { status?: unknown } }) =>
      Promise.resolve(where?.status === 'submitted' ? (options.readyForReview ?? []) : (options.expired ?? [])),
    ),
  };
  const submissionsRepository = {
    create: vi.fn((s) => ({ screenshotPaths: [], videoPath: null, ...s })),
    save: vi.fn(async (s) => ({ id: 's1', createdAt: new Date(), ...s })),
    delete: vi.fn().mockResolvedValue({}),
  };
  const matchesRepository = { update: vi.fn().mockResolvedValue({}) };
  // Transactions run against the same mocks.
  const repositoryFor = (entity: unknown) =>
    entity === TournamentGameSubmission ? submissionsRepository : entity === TournamentMatch ? matchesRepository : gamesRepository;
  Object.assign(gamesRepository, {
    manager: { transaction: vi.fn(async (work: (em: unknown) => unknown) => work({ getRepository: repositoryFor })) },
  });
  const profilesRepository = {
    findOne: vi.fn().mockResolvedValue(options.callerProfile ?? null),
    // Hosting club's leaders and staff (the query filters by club role).
    find: vi.fn().mockResolvedValue([
      { userId: 'club-president', clubRole: ClubRole.PRESIDENT },
      { userId: 'club-gs', clubRole: ClubRole.GENERAL_SECRETARY },
      { userId: 'captain', clubRole: ClubRole.CAPTAIN },
      { userId: 'other-manager', clubRole: ClubRole.MANAGER },
    ]),
  };
  // Community members holding a reviewer or official role (the query filters by role).
  // 'discipline-head' holds an official role but isn't one of this tournament's officials.
  const communityMembersRepository = {
    find: vi.fn().mockResolvedValue([
      { role: 'President', profile: { userId: 'organizer' } },
      { role: 'Head of Discipline', profile: { userId: 'match-official' } },
      { role: 'Scout', profile: { userId: 'user-a' } },
      { role: 'Head of Discipline', profile: { userId: 'discipline-head' } },
    ]),
  };
  const tournamentsService = {
    findOne: vi.fn().mockResolvedValue(tournament),
    sendNotifications: vi.fn().mockResolvedValue(undefined),
  };
  const matchesService = { completeFixtureIfReady: vi.fn().mockResolvedValue('completed') };
  const service = new TournamentResultsService(
    gamesRepository as never,
    submissionsRepository as never,
    matchesRepository as never,
    profilesRepository as never,
    communityMembersRepository as never,
    tournamentsService as never,
    matchesService as never,
  );
  return { service, gamesRepository, submissionsRepository, matchesRepository, tournamentsService, matchesService };
}

const evidence = { screenshots: [file('shot.png')], video: [file('clip.mp4')] };

describe('TournamentResultsService.submitGameResult', () => {
  it('stores the first player’s evidence and asks the opponent to upload too', async () => {
    const { service, submissionsRepository, gamesRepository, matchesRepository, tournamentsService } = setup();

    const view = await service.submitGameResult('user-a', 't1', 'g1', { goalsA: '3', goalsB: '1' }, evidence);

    expect(view).toMatchObject({
      side: 'A',
      goalsA: 3,
      goalsB: 1,
      screenshotUrls: ['/uploads/evidence/shot.png'],
      videoUrl: '/uploads/evidence/clip.mp4',
    });
    expect(submissionsRepository.save).toHaveBeenCalled();
    expect(gamesRepository.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'awaiting_opponent' }));
    expect(matchesRepository.update).toHaveBeenCalledWith({ id: 'm1' }, { status: 'in_review' });
    expect(tournamentsService.sendNotifications).toHaveBeenCalledTimes(1);
    expect(tournamentsService.sendNotifications).toHaveBeenCalledWith(
      ['user-b'],
      expect.objectContaining({ title: 'Your opponent uploaded evidence' }),
    );
  });

  it('sends the game to review once both players have uploaded, without telling reviewers yet', async () => {
    const { service, gamesRepository, tournamentsService } = setup({
      existing: [{ side: 'B', screenshotPaths: ['/uploads/evidence/b.png'], videoPath: '/uploads/evidence/b.mp4' }],
    });

    await service.submitGameResult('user-a', 't1', 'g1', { goalsA: 1, goalsB: 0 }, evidence);

    expect(gamesRepository.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'submitted' }));
    // Reviewers hear about it once the evidence window closes (resolveExpiredGames).
    expect(tournamentsService.sendNotifications).not.toHaveBeenCalled();
  });

  it('does not let club officials upload for their players (CvC)', async () => {
    const { service } = setup({
      type: TournamentType.CVC,
      callerProfile: { clubId: 'club-b', clubRole: ClubRole.MANAGER },
    });
    await expect(service.submitGameResult('manager-b', 't1', 'g1', { goalsA: 0, goalsB: 2 }, evidence)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it.each([
    ['before the match starts', new Date(Date.now() + HOUR), new Date(Date.now() + 4 * HOUR)],
    ['after the evidence deadline', new Date(Date.now() - 4 * HOUR), new Date(Date.now() - 1000)],
  ])('refuses uploads %s', async (_case, scheduledStart, evidenceDeadline) => {
    const { service, submissionsRepository } = setup({ scheduledStart, evidenceDeadline });
    await expect(service.submitGameResult('user-a', 't1', 'g1', { goalsA: 1, goalsB: 0 }, evidence)).rejects.toThrow(
      BadRequestException,
    );
    expect(submissionsRepository.save).not.toHaveBeenCalled();
  });

  it('accepts uploads inside the window', async () => {
    const { service } = setup({ scheduledStart: new Date(Date.now() - HOUR), evidenceDeadline: new Date(Date.now() + HOUR) });
    await expect(service.submitGameResult('user-a', 't1', 'g1', { goalsA: 1, goalsB: 0 }, evidence)).resolves.toMatchObject({
      side: 'A',
    });
  });

  it('keeps earlier evidence when resubmitting only a new score', async () => {
    const { service } = setup({
      existing: [{ side: 'A', screenshotPaths: ['/uploads/evidence/old.png'], videoPath: '/uploads/evidence/old.mp4' }],
    });

    const view = await service.submitGameResult('user-a', 't1', 'g1', { goalsA: 2, goalsB: 2 }, {});

    expect(view).toMatchObject({ goalsA: 2, screenshotUrls: ['/uploads/evidence/old.png'], videoUrl: '/uploads/evidence/old.mp4' });
  });

  it.each([
    ['an outsider', 'stranger', {}, evidence, ForbiddenException],
    ['a missing video', 'user-a', {}, { screenshots: [file('s.png')] }, BadRequestException],
    ['a missing screenshot', 'user-a', {}, { video: [file('v.mp4')] }, BadRequestException],
    ['an oversized screenshot', 'user-a', {}, { screenshots: [file('big.png', 11 * 1024 * 1024)], video: [file('v.mp4')] }, BadRequestException],
    ['an approved game', 'user-a', { gameStatus: 'approved' }, evidence, BadRequestException],
  ])('rejects %s', async (_case, userId, options, files, error) => {
    const { service, submissionsRepository } = setup(options);

    await expect(service.submitGameResult(userId, 't1', 'g1', { goalsA: 1, goalsB: 0 }, files)).rejects.toThrow(error);
    expect(submissionsRepository.save).not.toHaveBeenCalled();
  });

  it.each([[{ goalsA: '-1', goalsB: 0 }], [{ goalsA: 'x', goalsB: 0 }], [{ goalsB: 1 }]])(
    'rejects invalid scores %j',
    async (body) => {
      const { service } = setup();
      await expect(service.submitGameResult('user-a', 't1', 'g1', body, evidence)).rejects.toThrow(BadRequestException);
    },
  );
});

describe('TournamentResultsService.reviewGame', () => {
  it.each([['the community President', 'organizer'], ['a match official', 'match-official']])(
    'lets %s approve with the official score and completes the fixture when ready',
    async (_who, reviewer) => {
      const { service, gamesRepository, matchesService, tournamentsService } = setup({ gameStatus: 'submitted' });

      const result = await service.reviewGame(reviewer, 't1', 'g1', { action: 'approve', goalsA: 2, goalsB: 1 });

      expect(gamesRepository.update).toHaveBeenCalledWith(
        { id: 'g1' },
        expect.objectContaining({ status: 'approved', goalsA: 2, goalsB: 1, reviewedByUserId: reviewer }),
      );
      expect(matchesService.completeFixtureIfReady).toHaveBeenCalledWith('m1', null);
      expect(result.fixture).toBe('completed');
      expect(tournamentsService.sendNotifications).toHaveBeenCalledWith(
        expect.arrayContaining(['user-a', 'user-b']),
        expect.objectContaining({ title: 'Result confirmed' }),
      );
    },
  );

  it('rejects with a note and asks the players to resubmit', async () => {
    const { service, gamesRepository, matchesService, tournamentsService } = setup({ gameStatus: 'submitted' });

    await service.reviewGame('organizer', 't1', 'g1', { action: 'reject', note: 'Score not visible' });

    expect(gamesRepository.update).toHaveBeenCalledWith(
      { id: 'g1' },
      // Clearing reviewReadyNotifiedAt re-alerts the officials once the resubmitted evidence is in.
      expect.objectContaining({
        status: 'rejected',
        reviewNote: 'Score not visible',
        evidenceDeadline: expect.any(Date),
        reviewReadyNotifiedAt: null,
      }),
    );
    const reopened = (gamesRepository.update.mock.calls[0][1] as { evidenceDeadline: Date }).evidenceDeadline;
    expect(reopened.getTime()).toBeGreaterThan(Date.now() + 23 * HOUR);
    expect(matchesService.completeFixtureIfReady).not.toHaveBeenCalled();
    expect(tournamentsService.sendNotifications).toHaveBeenCalledWith(
      expect.arrayContaining(['user-a', 'user-b']),
      expect.objectContaining({ title: 'Result rejected — please resubmit' }),
    );
  });

  it('requires a score to approve', async () => {
    const { service } = setup({ gameStatus: 'submitted' });
    await expect(service.reviewGame('organizer', 't1', 'g1', { action: 'approve' })).rejects.toThrow(BadRequestException);
  });

  it('blocks reviews until the evidence deadline has passed', async () => {
    const { service, gamesRepository } = setup({
      gameStatus: 'submitted',
      evidenceDeadline: new Date(Date.now() + HOUR),
    });

    await expect(
      service.reviewGame('organizer', 't1', 'g1', { action: 'approve', goalsA: 2, goalsB: 1 }),
    ).rejects.toThrow(BadRequestException);
    expect(gamesRepository.update).not.toHaveBeenCalled();
  });

  it('stops a match official who lost their official role from reviewing', async () => {
    const { service, gamesRepository, tournamentsService } = setup({ gameStatus: 'submitted' });
    const tournament = await tournamentsService.findOne('t1');
    tournamentsService.findOne.mockResolvedValue({ ...tournament, matchOfficialIds: ['demoted'] });

    await expect(
      service.reviewGame('demoted', 't1', 'g1', { action: 'approve', goalsA: 2, goalsB: 1 }),
    ).rejects.toThrow(ForbiddenException);
    expect(gamesRepository.update).not.toHaveBeenCalled();
  });

  it('forbids community officials who are not President, Vice President or a match official', async () => {
    const { service, gamesRepository } = setup({ gameStatus: 'submitted' });
    await expect(
      service.reviewGame('discipline-head', 't1', 'g1', { action: 'approve', goalsA: 2, goalsB: 1 }),
    ).rejects.toThrow(ForbiddenException);
    expect(gamesRepository.update).not.toHaveBeenCalled();
  });

  it('forbids players from reviewing, even a match official reviewing their own game', async () => {
    const { service, gamesRepository } = setup({ gameStatus: 'submitted' });
    await expect(
      service.reviewGame('user-a', 't1', 'g1', { action: 'approve', goalsA: 9, goalsB: 0 }),
    ).rejects.toThrow(ForbiddenException);
    expect(gamesRepository.update).not.toHaveBeenCalled();
  });
});

describe('TournamentResultsService review visibility', () => {
  it('hides games from the review queue until the evidence deadline has passed', async () => {
    const { service, gamesRepository } = setup({
      gameStatus: 'submitted',
      evidenceDeadline: new Date(Date.now() + HOUR),
      expired: [],
    });
    gamesRepository.find.mockResolvedValueOnce([await gamesRepository.findOne()]);

    await expect(service.getReviewQueue('organizer', 't1')).resolves.toEqual([]);
  });

  it('blocks the review detail endpoint until the evidence deadline has passed', async () => {
    const { service } = setup({
      gameStatus: 'submitted',
      evidenceDeadline: new Date(Date.now() + HOUR),
    });

    await expect(service.getGameForReview('organizer', 't1', 'g1')).rejects.toThrow(BadRequestException);
  });
});

describe('TournamentResultsService reviewers of a club tournament', () => {
  it('are the club President and General Secretary plus officials who still hold a staff role', async () => {
    const { service, tournamentsService } = setup({ clubHost: true });
    const tournament = await tournamentsService.findOne('t1');

    const reviewers = await service.reviewerUserIds(tournament as never);

    // 'demoted' was appointed but lost their staff role; 'other-manager' was never appointed.
    expect(reviewers.sort()).toEqual(['captain', 'club-gs', 'club-president']);
  });

  it('lets a club official review and stops everyone else', async () => {
    const { service, gamesRepository } = setup({ clubHost: true, gameStatus: 'submitted' });

    await expect(
      service.reviewGame('other-manager', 't1', 'g1', { action: 'approve', goalsA: 1, goalsB: 0 }),
    ).rejects.toThrow(ForbiddenException);
    await service.reviewGame('captain', 't1', 'g1', { action: 'approve', goalsA: 1, goalsB: 0 });
    expect(gamesRepository.update).toHaveBeenCalledWith(
      { id: 'g1' },
      expect.objectContaining({ status: 'approved', reviewedByUserId: 'captain' }),
    );
  });
});

describe('TournamentResultsService.resolveExpiredGames', () => {
  const expiredGame = (submissions: object[]) => ({
    id: 'g1',
    matchId: 'm1',
    match: { id: 'm1', tournamentId: 't1', status: 'in_review' },
    status: submissions.length ? 'awaiting_opponent' : 'pending',
    playerAUserId: 'user-a',
    playerAName: 'Alice',
    playerBUserId: 'user-b',
    playerBName: 'Bob',
    submissions,
  });

  it('gives the game to the only player who uploaded evidence', async () => {
    const { service, gamesRepository, matchesService, tournamentsService } = setup({
      expired: [expiredGame([{ side: 'B' }])],
    });

    expect(await service.resolveExpiredGames()).toBe(1);

    expect(gamesRepository.update).toHaveBeenCalledWith(
      { id: 'g1' },
      { status: 'walkover', resolution: 'walkover', goalsA: 0, goalsB: 3 },
    );
    expect(matchesService.completeFixtureIfReady).toHaveBeenCalledWith('m1');
    expect(tournamentsService.sendNotifications).toHaveBeenCalledWith(['user-b'], expect.objectContaining({ title: 'You won by walkover' }));
    expect(tournamentsService.sendNotifications).toHaveBeenCalledWith(['user-a'], expect.objectContaining({ title: 'Game lost — no evidence' }));
  });

  it('counts a game with no evidence as a loss for both', async () => {
    const { service, gamesRepository, tournamentsService } = setup({ expired: [expiredGame([])] });

    await service.resolveExpiredGames();

    expect(gamesRepository.update).toHaveBeenCalledWith(
      { id: 'g1' },
      { status: 'forfeited', resolution: 'double_forfeit', goalsA: 0, goalsB: 0 },
    );
    expect(tournamentsService.sendNotifications).toHaveBeenCalledWith(
      ['user-a', 'user-b'],
      expect.objectContaining({ title: 'Game forfeited' }),
    );
  });

  it('tells the match officials (not the leaders or players) once a both-sides game’s window has closed', async () => {
    const readyGame = { ...expiredGame([{ side: 'A' }, { side: 'B' }]), status: 'submitted' };
    const { service, gamesRepository, tournamentsService } = setup({ readyForReview: [readyGame] });

    expect(await service.resolveExpiredGames()).toBe(1);

    expect(gamesRepository.update).toHaveBeenCalledWith({ id: 'g1' }, { reviewReadyNotifiedAt: expect.any(Date) });
    // The lookup only returns games not yet announced, so each game is announced once.
    expect(gamesRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'submitted', reviewReadyNotifiedAt: expect.anything() }) }),
    );
    const call = tournamentsService.sendNotifications.mock.calls.find(([, n]) => n.title === 'Result ready for review');
    // 'organizer' (the President) can review but isn't alerted; 'user-a' plays in the game.
    expect(call?.[0]).toEqual(['match-official']);
  });

  it('falls back to alerting the leaders when the tournament has no officials', async () => {
    const readyGame = { ...expiredGame([{ side: 'A' }, { side: 'B' }]), status: 'submitted' };
    const { service, tournamentsService } = setup({ readyForReview: [readyGame] });
    const tournament = await tournamentsService.findOne('t1');
    tournamentsService.findOne.mockResolvedValue({ ...tournament, matchOfficialIds: [] });

    await service.resolveExpiredGames();

    const call = tournamentsService.sendNotifications.mock.calls.find(([, n]) => n.title === 'Result ready for review');
    expect(call?.[0]).toEqual(['organizer']);
  });

  it('alerts only club officials in a club tournament', async () => {
    const readyGame = { ...expiredGame([{ side: 'A' }, { side: 'B' }]), status: 'submitted' };
    const { service, tournamentsService } = setup({ clubHost: true, readyForReview: [readyGame] });

    await service.resolveExpiredGames();

    const call = tournamentsService.sendNotifications.mock.calls.find(([, n]) => n.title === 'Result ready for review');
    expect(call?.[0]).toEqual(['captain']);
  });

  it('asks officials for a decider when a knockout fixture ends level', async () => {
    const { service, matchesService, tournamentsService } = setup({ expired: [expiredGame([])] });
    matchesService.completeFixtureIfReady.mockResolvedValue('needs_decider');

    await service.resolveExpiredGames();

    expect(tournamentsService.sendNotifications).toHaveBeenCalledWith(
      ['match-official', 'user-a'],
      expect.objectContaining({ title: 'Knockout fixture needs a decision' }),
    );
  });
});
