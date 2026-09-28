import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ClubRole, CommunityRole } from '../users/enums/user-attributes.enum.js';
import { TournamentsService } from './tournaments.service.js';
import { TournamentStatus, TournamentType } from './enums/tournament.enum.js';

describe('TournamentsService.join', () => {
  const communityId = 'community-id';
  const tournamentId = 'tournament-id';
  const userId = 'user-id';

  function createService(role: CommunityRole, type: TournamentType) {
    const tournament = {
      id: tournamentId,
      communityId,
      community: { creatorId: 'another-user-id' },
      status: TournamentStatus.REGISTRATION_OPEN,
      type,
      maxParticipants: 16,
      participants: [],
      registrationDeadline: new Date(Date.now() + 60_000),
    };
    const profile = {
      id: 'profile-id',
      userId,
      communityId,
      communityRole: role,
    };

    const tournamentsRepository = {
      findOne: vi.fn().mockResolvedValue(tournament),
    };
    const participantsRepository = {
      findOne: vi.fn(),
      create: vi.fn((participant) => participant),
      save: vi.fn((participant) => Promise.resolve(participant)),
    };
    const communityMembersRepository = {
      findOne: vi.fn().mockResolvedValue({
        communityId,
        profileId: profile.id,
        role,
      }),
    };
    const profilesRepository = {
      findOne: vi.fn().mockResolvedValue(profile),
    };

    const service = new TournamentsService(
      tournamentsRepository as never,
      participantsRepository as never,
      {} as never,
      communityMembersRepository as never,
      {} as never,
      profilesRepository as never,
      {} as never,
    );

    return { service, participantsRepository };
  }

  it.each([
    [CommunityRole.PRESIDENT, TournamentType.PVP],
    [CommunityRole.VICE_PRESIDENT, TournamentType.PVP],
    [CommunityRole.PRESIDENT, TournamentType.CVC],
    [CommunityRole.VICE_PRESIDENT, TournamentType.CVC],
  ])(
    'rejects a community %s joining its own %s tournament',
    async (role, type) => {
      const { service, participantsRepository } = createService(role, type);

      await expect(
        service.join(userId, tournamentId, { clubId: 'club-id' }),
      ).rejects.toThrow(ForbiddenException);
      expect(participantsRepository.save).not.toHaveBeenCalled();
    },
  );
});

describe('TournamentsService.create roster presets', () => {
  const userId = 'user-id';
  const communityId = '6f1c1e0e-0000-4000-8000-000000000000';

  function createService() {
    const tournamentsRepository = {
      create: vi.fn((tournament) => tournament),
      save: vi.fn((tournament) => Promise.resolve(tournament)),
    };
    const communitiesRepository = {
      findOne: vi.fn().mockResolvedValue({ id: communityId, creatorId: userId }),
    };
    const communityMembersRepository = { findOne: vi.fn().mockResolvedValue(null) };
    const profilesRepository = {
      findOne: vi.fn().mockResolvedValue({ id: 'profile-id', userId }),
    };

    return new TournamentsService(
      tournamentsRepository as never,
      {} as never,
      communitiesRepository as never,
      communityMembersRepository as never,
      {} as never,
      profilesRepository as never,
      {} as never,
    );
  }

  const baseDto = {
    name: 'Cup',
    type: TournamentType.CVC,
    communityId,
    startAt: new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString(),
  };

  it.each([
    ['16v16', 16, 8],
    ['12v12', 12, 6],
    ['8v8', 8, 4],
    ['4v4', 4, 2],
  ])('uses the %s preset roster', async (preset, starters, subs) => {
    const tournament = await createService().create(userId, { ...baseDto, preset });

    expect(tournament).toMatchObject({ preset, startersCount: starters, subsCount: subs });
  });

  it('defaults CvC tournaments to 8v8', async () => {
    const tournament = await createService().create(userId, baseDto);

    expect(tournament).toMatchObject({ preset: '8v8', startersCount: 8, subsCount: 4 });
  });

  it('rejects the retired 11v11 preset', async () => {
    await expect(
      createService().create(userId, { ...baseDto, preset: '11v11' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepts a custom roster with even starters and odd substitutes', async () => {
    const tournament = await createService().create(userId, {
      ...baseDto,
      preset: 'custom',
      startersCount: 10,
      subsCount: 3,
    });

    expect(tournament).toMatchObject({ preset: 'custom', startersCount: 10, subsCount: 3 });
  });

  it.each([7, 0, 18])('rejects a custom roster with %i starters', async (startersCount) => {
    await expect(
      createService().create(userId, { ...baseDto, preset: 'custom', startersCount }),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('TournamentsService.update / remove', () => {
  const organizerId = 'organizer-id';
  const tournamentId = 'tournament-id';

  function setup(options: { callerRole?: CommunityRole; organizer?: boolean } = {}) {
    const tournament = {
      id: tournamentId,
      name: 'Winter Cup',
      description: null,
      communityId: 'community-id',
      community: { creatorId: 'someone-else' },
      creatorId: options.organizer === false ? 'someone-else' : organizerId,
      status: TournamentStatus.REGISTRATION_OPEN,
      type: TournamentType.CVC,
      maxParticipants: 16,
      entryFeeBdt: 0,
      prizePoolBdt: 0,
      startAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      endAt: null,
      participants: [
        { clubId: 'club-1', userId: null, registeredByUserId: 'registrar-1' },
        { clubId: null, userId: 'player-1', registeredByUserId: 'player-1' },
        { clubId: null, userId: organizerId, registeredByUserId: organizerId },
      ],
    };

    const tournamentsRepository = {
      findOne: vi.fn().mockImplementation(() => Promise.resolve({ ...tournament })),
      save: vi.fn((t) => Promise.resolve(t)),
      delete: vi.fn().mockResolvedValue({ affected: 1 }),
    };
    const communityMembersRepository = {
      findOne: vi.fn().mockResolvedValue(
        options.callerRole ? { role: options.callerRole } : null,
      ),
    };
    const profilesRepository = {
      findOne: vi.fn().mockResolvedValue({ id: 'caller-profile' }),
      find: vi.fn().mockResolvedValue([{ id: 'p', userId: 'president-1', clubRole: ClubRole.PRESIDENT }]),
    };
    const notificationsService = {
      createNotification: vi.fn().mockResolvedValue({}),
    };

    const service = new TournamentsService(
      tournamentsRepository as never,
      {} as never,
      {} as never,
      communityMembersRepository as never,
      {} as never,
      profilesRepository as never,
      notificationsService as never,
    );

    const notifiedUserIds = () =>
      notificationsService.createNotification.mock.calls.map(([userId]) => userId).sort();

    return { service, tournamentsRepository, notificationsService, notifiedUserIds };
  }

  it('saves edits and notifies enrolled players, registrars and club presidents', async () => {
    const { service, tournamentsRepository, notificationsService, notifiedUserIds } = setup();

    await service.update(organizerId, tournamentId, { prizePoolBdt: 5000 });

    expect(tournamentsRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ prizePoolBdt: 5000 }),
    );
    expect(notifiedUserIds()).toEqual(['player-1', 'president-1', 'registrar-1']);
    expect(notificationsService.createNotification).toHaveBeenCalledWith(
      'player-1',
      expect.objectContaining({
        type: 'tournament_update',
        message: expect.stringContaining('prize pool'),
      }),
    );
  });

  it('does not save or notify when nothing changed', async () => {
    const { service, tournamentsRepository, notificationsService } = setup();

    await service.update(organizerId, tournamentId, { name: 'Winter Cup', maxParticipants: 16 });

    expect(tournamentsRepository.save).not.toHaveBeenCalled();
    expect(notificationsService.createNotification).not.toHaveBeenCalled();
  });

  it('rejects a capacity lower than the enrolled participants', async () => {
    const { service } = setup();

    await expect(
      service.update(organizerId, tournamentId, { maxParticipants: 2 }),
    ).rejects.toThrow(BadRequestException);
  });

  it('lets a community Vice President edit', async () => {
    const { service, tournamentsRepository } = setup({
      organizer: false,
      callerRole: CommunityRole.VICE_PRESIDENT,
    });

    await service.update('vp-id', tournamentId, { name: 'Spring Cup' });

    expect(tournamentsRepository.save).toHaveBeenCalled();
  });

  it('deletes the tournament and notifies the same recipients', async () => {
    const { service, tournamentsRepository, notificationsService, notifiedUserIds } = setup();

    await service.remove(organizerId, tournamentId);

    expect(tournamentsRepository.delete).toHaveBeenCalledWith({ id: tournamentId });
    expect(notifiedUserIds()).toEqual(['player-1', 'president-1', 'registrar-1']);
    expect(notificationsService.createNotification).toHaveBeenCalledWith(
      'president-1',
      expect.objectContaining({ title: 'Tournament cancelled' }),
    );
  });

  it.each([
    ['edit', (s: TournamentsService) => s.update('member-id', tournamentId, { name: 'X' })],
    ['delete', (s: TournamentsService) => s.remove('member-id', tournamentId)],
  ])('forbids regular members to %s', async (_action, run) => {
    const { service, tournamentsRepository, notificationsService } = setup({
      organizer: false,
      callerRole: CommunityRole.MEMBER,
    });

    await expect(run(service)).rejects.toThrow(ForbiddenException);
    expect(tournamentsRepository.save).not.toHaveBeenCalled();
    expect(tournamentsRepository.delete).not.toHaveBeenCalled();
    expect(notificationsService.createNotification).not.toHaveBeenCalled();
  });
});

describe('TournamentsService.join (CvC team submission)', () => {
  const communityId = 'community-id';
  const presidentProfileId = 'president-profile';
  const player = (profileId: string) => ({ profileId, name: profileId });

  function setup() {
    const tournament = {
      id: 'tournament-id',
      communityId,
      community: { creatorId: 'someone-else' },
      status: TournamentStatus.REGISTRATION_OPEN,
      type: TournamentType.CVC,
      startersCount: 2,
      subsCount: 1,
      maxParticipants: 16,
      participants: [],
      registrationDeadline: new Date(Date.now() + 60_000),
    };
    const participantsRepository = {
      findOne: vi.fn().mockResolvedValue(null),
      create: vi.fn((p) => p),
      save: vi.fn((p) => Promise.resolve(p)),
    };
    const clubsRepository = {
      findOne: vi.fn().mockResolvedValue({
        id: 'club-id',
        communityIds: [communityId],
        members: [
          { id: presidentProfileId, clubRole: ClubRole.PRESIDENT },
          { id: 'p2', clubRole: ClubRole.PLAYER },
          { id: 'p3', clubRole: ClubRole.PLAYER },
        ],
      }),
    };
    const service = new TournamentsService(
      { findOne: vi.fn().mockResolvedValue(tournament) } as never,
      participantsRepository as never,
      {} as never,
      { findOne: vi.fn().mockResolvedValue(null) } as never,
      clubsRepository as never,
      { findOne: vi.fn().mockResolvedValue({ id: presidentProfileId, communityId, communityRole: CommunityRole.MEMBER }) } as never,
      {} as never,
    );
    return { service, participantsRepository };
  }

  it('registers the club together with a lineup that matches the preset', async () => {
    const { service, participantsRepository } = setup();

    const participant = await service.join('user-id', 'tournament-id', {
      clubId: 'club-id',
      lineup: { starters: [player(presidentProfileId), player('p2')], substitutes: [player('p3')] },
    });

    expect(participantsRepository.save).toHaveBeenCalled();
    expect(participant).toMatchObject({
      status: 'lineup_submitted',
      lineup: { starters: [{ profileId: presidentProfileId }, { profileId: 'p2' }], substitutes: [{ profileId: 'p3' }] },
    });
  });

  it.each([
    ['no lineup', undefined],
    ['too few starters', { starters: [player('p2')], substitutes: [player('p3')] }],
    ['too few substitutes', { starters: [player(presidentProfileId), player('p2')], substitutes: [] }],
    ['a duplicated player', { starters: [player('p2'), player('p2')], substitutes: [player('p3')] }],
    ['a non-member', { starters: [player('p2'), player('outsider')], substitutes: [player('p3')] }],
  ])('rejects registration with %s', async (_case, lineup) => {
    const { service, participantsRepository } = setup();

    await expect(
      service.join('user-id', 'tournament-id', { clubId: 'club-id', lineup }),
    ).rejects.toThrow(BadRequestException);
    expect(participantsRepository.save).not.toHaveBeenCalled();
  });
});

describe('TournamentsService lineup notifications', () => {
  const communityId = 'community-id';
  const tournament = {
    id: 'tournament-id',
    name: 'Winter Cup',
    communityId,
    community: { creatorId: 'someone-else' },
    status: TournamentStatus.REGISTRATION_OPEN,
    type: TournamentType.CVC,
    startersCount: 2,
    subsCount: 1,
    maxParticipants: 16,
    participants: [],
    registrationDeadline: new Date(Date.now() + 60 * 60 * 1000),
    teamSubmissionDeadline: new Date(Date.now() + 60 * 60 * 1000),
  };
  const members = [
    { id: 'manager', userId: 'manager-user', clubRole: ClubRole.PRESIDENT },
    { id: 'a', userId: 'user-a', clubRole: ClubRole.PLAYER },
    { id: 'b', userId: 'user-b', clubRole: ClubRole.PLAYER },
    { id: 'c', userId: 'user-c', clubRole: ClubRole.PLAYER },
    { id: 'd', userId: 'user-d', clubRole: ClubRole.PLAYER },
  ];
  const player = (profileId: string) => ({ profileId, name: profileId });

  function setup(previousLineup: unknown = null) {
    const createNotification = vi.fn().mockResolvedValue({});
    const participantsRepository = {
      findOne: vi.fn().mockImplementation(({ where }) =>
        Promise.resolve(
          where.id
            ? { id: 'participant-id', lineup: previousLineup, club: { name: 'Test FC', members } }
            : null,
        ),
      ),
      create: vi.fn((p) => p),
      save: vi.fn((p) => Promise.resolve(p)),
    };
    const service = new TournamentsService(
      { findOne: vi.fn().mockResolvedValue(tournament) } as never,
      participantsRepository as never,
      {} as never,
      { findOne: vi.fn().mockResolvedValue(null) } as never,
      { findOne: vi.fn().mockResolvedValue({ id: 'club-id', name: 'Test FC', communityIds: [communityId], members }) } as never,
      { findOne: vi.fn().mockResolvedValue({ id: 'manager', communityId, communityRole: CommunityRole.MEMBER }) } as never,
      { createNotification } as never,
    );
    const sent = () =>
      Object.fromEntries(
        createNotification.mock.calls.map(([userId, n]: [string, { title: string }]) => [userId, n.title]),
      );
    return { service, sent };
  }

  it('notifies every picked player (but not the submitter) when a club registers', async () => {
    const { service, sent } = setup();

    await service.join('manager-user', 'tournament-id', {
      clubId: 'club-id',
      lineup: { starters: [player('manager'), player('a')], substitutes: [player('b')] },
    });

    expect(sent()).toEqual({
      'user-a': 'Picked for a tournament',
      'user-b': 'Picked for a tournament',
    });
  });

  it('notifies added, removed and moved players when the lineup changes', async () => {
    const { service, sent } = setup({
      starters: [player('a'), player('b')],
      substitutes: [player('c')],
    });

    await service.submitLineup('manager-user', 'tournament-id', 'participant-id', {
      starters: [player('a'), player('c')],
      substitutes: [player('d')],
    });

    expect(sent()).toEqual({
      'user-b': 'Removed from tournament team',
      'user-c': 'Tournament role changed',
      'user-d': 'Picked for a tournament',
    });
  });
});
