import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Club } from '../clubs/entities/club.entity.js';
import { JoinPolicy } from '../clubs/enums/club.enum.js';
import { EfootballProfile } from '../users/entities/efootball-profile.entity.js';
import { User } from '../users/entities/user.entity.js';
import { ClubRole, CommunityRole } from '../users/enums/user-attributes.enum.js';
import { CommunitiesService } from './communities.service.js';
import { CommunityJoinRequest } from './entities/community-join-request.entity.js';
import { CommunityMember } from './entities/community-member.entity.js';
import { Community } from './entities/community.entity.js';
import { CommunityJoinRequestStatus, CommunityJoinRequestType, CommunityTier } from './enums/community.enum.js';

describe('CommunitiesService', () => {
  let service: CommunitiesService;
  let communitiesRepo: any;
  let communityMembersRepo: any;
  let joinRequestsRepo: any;
  let clubsRepo: any;
  let profilesRepo: any;

  beforeEach(() => {
    communitiesRepo = {
      create: vi.fn((data) => ({ id: 'comm-1', ...data })),
      save: vi.fn(async (comm) => ({ id: 'comm-1', ...comm })),
      findOne: vi.fn(),
      delete: vi.fn(),
      createQueryBuilder: vi.fn(),
    };

    communityMembersRepo = {
      create: vi.fn((data) => ({ id: 'member-1', ...data })),
      save: vi.fn(async (m) => m),
      findOne: vi.fn(),
      find: vi.fn(),
      remove: vi.fn(),
    };

    joinRequestsRepo = {
      create: vi.fn((data) => ({ id: 'req-1', ...data })),
      save: vi.fn(async (r) => r),
      findOne: vi.fn(),
      find: vi.fn(),
    };

    clubsRepo = {
      findOne: vi.fn(),
      save: vi.fn(async (c) => c),
    };

    profilesRepo = {
      findOne: vi.fn(),
      find: vi.fn(),
      save: vi.fn(async (p) => p),
      create: vi.fn((data) => ({ id: 'profile-new', ...data })),
      createQueryBuilder: vi.fn(() => ({
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        execute: vi.fn().mockResolvedValue({}),
      })),
    };

    const fileStorageService = {
      saveBase64Image: vi.fn(async (url) => url),
      deleteFile: vi.fn(async () => true),
    } as any;

    const notificationsService = {
      notifyCommunityAuthorities: vi.fn().mockResolvedValue([]),
      createNotification: vi.fn().mockResolvedValue({}),
    } as any;

    service = new CommunitiesService(
      communitiesRepo,
      communityMembersRepo,
      joinRequestsRepo,
      clubsRepo,
      profilesRepo,
      fileStorageService,
      notificationsService,
    );
  });

  describe('create', () => {
    it('creates community and sets creator as President', async () => {
      const user = { id: 'user-1', name: 'Zihan' } as User;
      const profile = { id: 'prof-1', userId: 'user-1', points: 0 } as EfootballProfile;
      profilesRepo.findOne.mockResolvedValue(profile);
      communitiesRepo.findOne.mockResolvedValue({
        id: 'comm-1',
        name: 'Dhaka Elite',
        creatorId: 'user-1',
        clubs: [],
        members: [],
      });

      const res = await service.create(user, {
        name: 'Dhaka Elite',
        rules: 'Play fair',
      });

      expect(communitiesRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Dhaka Elite',
          creatorId: 'user-1',
          initials: 'DE',
          tier: CommunityTier.NEW,
          joinPolicy: JoinPolicy.INSTANT,
        }),
      );

      expect(communityMembersRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          communityId: 'comm-1',
          profileId: 'prof-1',
          role: CommunityRole.PRESIDENT,
          isDirectMember: true,
        }),
      );

      expect(profile.communityId).toBe('comm-1');
      expect(profile.communityRole).toBe(CommunityRole.PRESIDENT);
    });
  });

  describe('joinIndividual', () => {
    it('instantly joins when joinPolicy is INSTANT', async () => {
      const user = { id: 'user-2' } as User;
      const profile = { id: 'prof-2', userId: 'user-2' } as EfootballProfile;
      profilesRepo.findOne.mockResolvedValue(profile);
      communitiesRepo.findOne.mockResolvedValue({
        id: 'comm-1',
        joinPolicy: JoinPolicy.INSTANT,
      });
      communityMembersRepo.findOne.mockResolvedValue(null);

      const res = await service.joinIndividual('comm-1', user);

      expect(res.status).toBe('joined');
      expect(communityMembersRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          communityId: 'comm-1',
          profileId: 'prof-2',
          role: CommunityRole.MEMBER,
          isDirectMember: true,
        }),
      );
    });

    it('creates a pending request when joinPolicy is APPROVAL', async () => {
      const user = { id: 'user-2' } as User;
      const profile = { id: 'prof-2', userId: 'user-2' } as EfootballProfile;
      profilesRepo.findOne.mockResolvedValue(profile);
      communitiesRepo.findOne.mockResolvedValue({
        id: 'comm-1',
        joinPolicy: JoinPolicy.APPROVAL,
      });
      communityMembersRepo.findOne.mockResolvedValue(null);
      joinRequestsRepo.findOne.mockResolvedValue(null);

      const res = await service.joinIndividual('comm-1', user);

      expect(res.status).toBe('pending');
      expect(joinRequestsRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          communityId: 'comm-1',
          requesterUserId: 'user-2',
          targetType: CommunityJoinRequestType.PLAYER,
          status: CommunityJoinRequestStatus.PENDING,
        }),
      );
    });
  });

  describe('addClub and member cascading', () => {
    it('adds club and auto-joins all club members into community', async () => {
      const user = { id: 'user-leader' } as User;
      const leaderProfile = {
        id: 'prof-leader',
        userId: 'user-leader',
        clubId: 'club-1',
        clubRole: ClubRole.PRESIDENT,
      } as EfootballProfile;
      profilesRepo.findOne.mockResolvedValue(leaderProfile);

      const community = {
        id: 'comm-1',
        name: 'Chittagong Arena',
        joinPolicy: JoinPolicy.INSTANT,
        creatorId: 'user-admin',
        clubs: [],
      } as any;
      communitiesRepo.findOne.mockResolvedValue(community);

      const club = {
        id: 'club-1',
        name: 'Red Falcons',
        communityIds: [],
      } as Club;
      clubsRepo.findOne.mockResolvedValue(club);

      const player1 = { id: 'player-1', clubId: 'club-1', communityId: null } as EfootballProfile;
      const player2 = { id: 'player-2', clubId: 'club-1', communityId: null } as EfootballProfile;
      profilesRepo.find.mockResolvedValue([player1, player2]);
      communityMembersRepo.findOne.mockResolvedValue(null);

      const res = await service.addClub('comm-1', 'club-1', user);

      expect(res.status).toBe('joined');
      expect(community.clubs).toContain(club);
      expect(club.communityIds).toContain('comm-1');
      expect(communityMembersRepo.create).toHaveBeenCalledTimes(2);
      expect(player1.communityId).toBe('comm-1');
      expect(player2.communityId).toBe('comm-1');
    });
  });

  describe('onClubMemberRemoved (player leaves club)', () => {
    it('revokes inherited community membership if not direct', async () => {
      const club = {
        id: 'club-1',
        communities: [{ id: 'comm-1' }],
      } as any;
      clubsRepo.findOne.mockResolvedValue(club);

      const player = {
        id: 'prof-1',
        communityId: 'comm-1',
        communityRole: CommunityRole.MEMBER,
      } as EfootballProfile;
      profilesRepo.findOne.mockResolvedValue(player);

      const membership = {
        id: 'cm-1',
        communityId: 'comm-1',
        profileId: 'prof-1',
        isDirectMember: false,
        sourceClubIds: ['club-1'],
      } as CommunityMember;
      communityMembersRepo.findOne.mockResolvedValue(membership);

      await service.onClubMemberRemoved('club-1', 'prof-1');

      expect(communityMembersRepo.remove).toHaveBeenCalledWith(membership);
      expect(player.communityId).toBeNull();
    });

    it('keeps community membership if direct member even when leaving club', async () => {
      const club = {
        id: 'club-1',
        communities: [{ id: 'comm-1' }],
      } as any;
      clubsRepo.findOne.mockResolvedValue(club);

      const player = {
        id: 'prof-1',
        communityId: 'comm-1',
        communityRole: CommunityRole.HEAD_OF_DISCIPLINE,
      } as EfootballProfile;
      profilesRepo.findOne.mockResolvedValue(player);

      const membership = {
        id: 'cm-1',
        communityId: 'comm-1',
        profileId: 'prof-1',
        isDirectMember: true,
        sourceClubIds: ['club-1'],
      } as CommunityMember;
      communityMembersRepo.findOne.mockResolvedValue(membership);

      await service.onClubMemberRemoved('club-1', 'prof-1');

      expect(communityMembersRepo.remove).not.toHaveBeenCalled();
      expect(membership.sourceClubIds).toEqual([]);
      expect(communityMembersRepo.save).toHaveBeenCalledWith(membership);
      expect(player.communityId).toBe('comm-1');
    });
  });
});
