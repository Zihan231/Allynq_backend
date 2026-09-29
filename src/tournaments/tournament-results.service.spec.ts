import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ClubRole } from '../users/enums/user-attributes.enum.js';
import { TournamentType } from './enums/tournament.enum.js';
import { TournamentResultsService } from './tournament-results.service.js';

const file = (name: string, size = 1024) => ({ filename: name, size }) as Express.Multer.File;

function setup(options: { type?: TournamentType; gameStatus?: string; existing?: object[]; callerProfile?: object | null } = {}) {
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
  };
  const tournament = {
    id: 't1',
    name: 'Cup',
    type: options.type ?? TournamentType.PVP,
    communityId: 'c1',
    creatorId: 'organizer',
    community: { creatorId: 'organizer' },
    participants: [
      { id: 'pa', clubId: 'club-a' },
      { id: 'pb', clubId: 'club-b' },
    ],
  };
  const gamesRepository = {
    findOne: vi.fn().mockResolvedValue(game),
    save: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
  };
  const submissionsRepository = {
    create: vi.fn((s) => ({ screenshotPaths: [], videoPath: null, ...s })),
    save: vi.fn(async (s) => ({ id: 's1', createdAt: new Date(), ...s })),
  };
  const matchesRepository = { update: vi.fn().mockResolvedValue({}) };
  const profilesRepository = { findOne: vi.fn().mockResolvedValue(options.callerProfile ?? null) };
  const communityMembersRepository = {
    find: vi.fn().mockResolvedValue([{ profile: { userId: 'discipline-head' } }]),
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
  it('stores a player’s result with evidence and puts the fixture in review', async () => {
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
    expect(gamesRepository.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'submitted' }));
    expect(matchesRepository.update).toHaveBeenCalledWith({ id: 'm1' }, { status: 'in_review' });
    const recipients = tournamentsService.sendNotifications.mock.calls.map(([ids]) => ids).flat();
    expect(recipients.sort()).toEqual(['discipline-head', 'organizer', 'user-b']);
  });

  it('lets a club official submit for their club’s side (CvC)', async () => {
    const { service } = setup({
      type: TournamentType.CVC,
      callerProfile: { clubId: 'club-b', clubRole: ClubRole.MANAGER },
    });

    const view = await service.submitGameResult('manager-b', 't1', 'g1', { goalsA: 0, goalsB: 2 }, evidence);

    expect(view.side).toBe('B');
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
  it.each([['the organizer', 'organizer'], ['the Head of Discipline', 'discipline-head']])(
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
      expect.objectContaining({ status: 'rejected', reviewNote: 'Score not visible' }),
    );
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

  it('forbids players from reviewing', async () => {
    const { service, gamesRepository } = setup({ gameStatus: 'submitted' });
    await expect(
      service.reviewGame('user-a', 't1', 'g1', { action: 'approve', goalsA: 9, goalsB: 0 }),
    ).rejects.toThrow(ForbiddenException);
    expect(gamesRepository.update).not.toHaveBeenCalled();
  });
});
