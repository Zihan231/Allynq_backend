import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { CommunityRole } from '../users/enums/user-attributes.enum.js';
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
