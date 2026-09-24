import { ForbiddenException } from '@nestjs/common';
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
