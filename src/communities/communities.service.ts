import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Club } from '../clubs/entities/club.entity.js';
import { JoinPolicy } from '../clubs/enums/club.enum.js';
import { EfootballProfile } from '../users/entities/efootball-profile.entity.js';
import { User } from '../users/entities/user.entity.js';
import { ClubRole, CommunityRole } from '../users/enums/user-attributes.enum.js';
import { AssignRoleDto } from './dto/assign-role.dto.js';
import { CreateCommunityDto } from './dto/create-community.dto.js';
import { ReviewJoinRequestDto } from './dto/review-join-request.dto.js';
import { UpdateCommunityDto } from './dto/update-community.dto.js';
import { CommunityJoinRequest } from './entities/community-join-request.entity.js';
import { CommunityMember } from './entities/community-member.entity.js';
import { Community } from './entities/community.entity.js';
import {
  CommunityJoinRequestStatus,
  CommunityJoinRequestType,
  CommunityTier,
} from './enums/community.enum.js';
import { CommunityQueryDto } from './dto/community-query.dto.js';
import { CommunityMembersQueryDto } from './dto/community-members-query.dto.js';
import { createPaginatedResult } from '../common/interfaces/paginated-result.interface.js';
import { FileStorageService } from '../common/services/file-storage.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';

@Injectable()
export class CommunitiesService {
  constructor(
    @InjectRepository(Community)
    private readonly communitiesRepository: Repository<Community>,
    @InjectRepository(CommunityMember)
    private readonly communityMembersRepository: Repository<CommunityMember>,
    @InjectRepository(CommunityJoinRequest)
    private readonly joinRequestsRepository: Repository<CommunityJoinRequest>,
    @InjectRepository(Club)
    private readonly clubsRepository: Repository<Club>,
    @InjectRepository(EfootballProfile)
    private readonly efootballProfilesRepository: Repository<EfootballProfile>,
    private readonly fileStorageService: FileStorageService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private getInitials(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 1) {
      return parts[0].slice(0, 2).toUpperCase();
    }
    return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
  }

  async create(user: User, dto: CreateCommunityDto): Promise<Community> {
    let profile = await this.efootballProfilesRepository.findOne({
      where: { userId: user.id },
    });

    if (!profile) {
      profile = this.efootballProfilesRepository.create({
        userId: user.id,
        points: 0,
      });
      profile = await this.efootballProfilesRepository.save(profile);
    } else if (profile.communityId) {
      throw new BadRequestException(
        'You are already a member of a community. You cannot create a new community while belonging to an existing one. Please leave your current community first.',
      );
    }

    if (dto.dpUrl) {
      dto.dpUrl = await this.fileStorageService.saveBase64Image(dto.dpUrl, 'communities', 'dp');
    }
    if (dto.coverUrl) {
      dto.coverUrl = await this.fileStorageService.saveBase64Image(dto.coverUrl, 'communities', 'cover');
    }

    const rules = dto.rules || dto.description || 'Community rules to be announced.';
    const initials = dto.initials || this.getInitials(dto.name);
    const color = dto.color || '#4c8dff';

    const community = this.communitiesRepository.create({
      ...dto,
      rules,
      initials,
      color,
      points: 0,
      tier: dto.tier || CommunityTier.NEW,
      joinPolicy: dto.joinPolicy || JoinPolicy.INSTANT,
      creatorId: user.id,
    });

    const savedCommunity = await this.communitiesRepository.save(community);

    // Add creator as direct President in community_members
    const member = this.communityMembersRepository.create({
      communityId: savedCommunity.id,
      profileId: profile.id,
      role: CommunityRole.PRESIDENT,
      isDirectMember: true,
      sourceClubIds: [],
    });
    await this.communityMembersRepository.save(member);

    profile.communityId = savedCommunity.id;
    profile.communityRole = CommunityRole.PRESIDENT;
    await this.efootballProfilesRepository.save(profile);

    return this.findOne(savedCommunity.id);
  }

  async findAll(query?: CommunityQueryDto): Promise<any> {
    const qb = this.communitiesRepository
      .createQueryBuilder('community')
      .leftJoinAndSelect('community.clubs', 'club')
      .leftJoinAndSelect('community.members', 'member')
      .leftJoinAndSelect('member.profile', 'profile')
      .leftJoinAndSelect('community.creator', 'creator')
      .orderBy('community.points', 'DESC')
      .addOrderBy('community.createdAt', 'DESC');

    if (query?.search) {
      qb.andWhere('LOWER(community.name) LIKE :search', {
        search: `%${query.search.toLowerCase()}%`,
      });
    }

    if (query?.tier) {
      qb.andWhere('community.tier = :tier', { tier: query.tier });
    }

    const isPaginated = Boolean(query?.page || query?.limit);
    const page = query?.page || 1;
    const limit = query?.limit || 20;

    let communities: Community[];
    let total = 0;

    if (isPaginated) {
      qb.skip((page - 1) * limit).take(limit);
      const [data, count] = await qb.getManyAndCount();
      communities = data;
      total = count;
    } else {
      communities = await qb.getMany();
      total = communities.length;
    }

    const mapped = communities.map((c) => {
      const clubs = c.clubs || [];
      const members = c.members || [];
      const memberClubIds = clubs.map((club) => club.id);
      const freeAgentCount = members.filter(
        (m) => (!m.sourceClubIds || m.sourceClubIds.length === 0) && (!m.profile || !m.profile.clubId),
      ).length;

      return {
        ...c,
        memberClubIds,
        freeAgentCount,
        memberCount: members.length,
        clubCount: clubs.length,
      };
    });

    if (isPaginated) {
      return createPaginatedResult(mapped, total, page, limit);
    }
    return mapped;
  }

  async findOne(id: string): Promise<any> {
    const community = await this.communitiesRepository.findOne({
      where: { id },
      relations: {
        clubs: {
          members: {
            user: true,
          },
        },
        members: {
          profile: {
            user: true,
          },
        },
        creator: true,
      },
    });

    if (!community) {
      throw new NotFoundException(`Community ${id} not found`);
    }

    const clubs = community.clubs || [];
    const members = community.members || [];
    const memberClubIds = clubs.map((club) => club.id);
    const freeAgentCount = members.filter(
      (m) => (!m.sourceClubIds || m.sourceClubIds.length === 0) && (!m.profile || !m.profile.clubId),
    ).length;

    return {
      ...community,
      memberClubIds,
      freeAgentCount,
      memberCount: members.length,
      clubCount: clubs.length,
    };
  }

  async update(id: string, user: User, dto: UpdateCommunityDto): Promise<Community> {
    const community = await this.communitiesRepository.findOne({ where: { id } });
    if (!community) {
      throw new NotFoundException(`Community ${id} not found`);
    }

    if (dto.dpUrl !== undefined && dto.dpUrl !== community.dpUrl) {
      if (community.dpUrl) {
        await this.fileStorageService.deleteFile(community.dpUrl);
      }
      if (dto.dpUrl) {
        dto.dpUrl = await this.fileStorageService.saveBase64Image(dto.dpUrl, 'communities', 'dp');
      }
    }

    if (dto.coverUrl !== undefined && dto.coverUrl !== community.coverUrl) {
      if (community.coverUrl) {
        await this.fileStorageService.deleteFile(community.coverUrl);
      }
      if (dto.coverUrl) {
        dto.coverUrl = await this.fileStorageService.saveBase64Image(dto.coverUrl, 'communities', 'cover');
      }
    }

    if (dto.description && !dto.rules) {
      dto.rules = dto.description;
    }

    Object.assign(community, dto);
    await this.communitiesRepository.save(community);
    return this.findOne(id);
  }

  async remove(id: string, user: User): Promise<void> {
    const community = await this.communitiesRepository.findOne({ where: { id } });
    if (!community) {
      throw new NotFoundException(`Community ${id} not found`);
    }

    if (community.dpUrl) {
      await this.fileStorageService.deleteFile(community.dpUrl);
    }
    if (community.coverUrl) {
      await this.fileStorageService.deleteFile(community.coverUrl);
    }

    // Reset community on any profile whose current community is this one
    await this.efootballProfilesRepository
      .createQueryBuilder()
      .update(EfootballProfile)
      .set({ communityId: null, communityRole: null })
      .where('communityId = :id', { id })
      .execute();

    await this.communitiesRepository.delete(id);
  }

  async joinIndividual(communityId: string, user: User): Promise<any> {
    const community = await this.communitiesRepository.findOne({ where: { id: communityId } });
    if (!community) {
      throw new NotFoundException(`Community ${communityId} not found`);
    }

    let profile = await this.efootballProfilesRepository.findOne({
      where: { userId: user.id },
    });

    if (!profile) {
      profile = this.efootballProfilesRepository.create({
        userId: user.id,
        points: 0,
      });
      profile = await this.efootballProfilesRepository.save(profile);
    }

    // Check existing membership
    const existingMember = await this.communityMembersRepository.findOne({
      where: { communityId, profileId: profile.id },
    });

    if (existingMember?.isDirectMember) {
      throw new BadRequestException('You are already an individual member of this community');
    }

    if (community.joinPolicy === JoinPolicy.APPROVAL) {
      const existingReq = await this.joinRequestsRepository.findOne({
        where: {
          communityId,
          requesterUserId: user.id,
          targetType: CommunityJoinRequestType.PLAYER,
          status: CommunityJoinRequestStatus.PENDING,
        },
      });

      if (existingReq) {
        throw new BadRequestException('You already have a pending join request for this community');
      }

      const req = this.joinRequestsRepository.create({
        communityId,
        requesterUserId: user.id,
        targetType: CommunityJoinRequestType.PLAYER,
        status: CommunityJoinRequestStatus.PENDING,
      });

      await this.joinRequestsRepository.save(req);

      // Real-time notification to community authorities (President, Vice President, Team Manager)
      await this.notificationsService.notifyCommunityAuthorities(
        community.id,
        'Community Join Request',
        `${user.name} requested to join ${community.name}`,
        `/dashboard/efootball/community/${community.id}/requests`,
      );

      return {
        status: 'pending',
        message: 'Join request submitted for approval by community administrators',
      };
    }

    // Instant join
    if (existingMember) {
      existingMember.isDirectMember = true;
      await this.communityMembersRepository.save(existingMember);
    } else {
      const newMember = this.communityMembersRepository.create({
        communityId,
        profileId: profile.id,
        role: CommunityRole.MEMBER,
        isDirectMember: true,
        sourceClubIds: [],
      });
      await this.communityMembersRepository.save(newMember);
    }

    if (!profile.communityId) {
      profile.communityId = communityId;
      profile.communityRole = profile.communityRole || CommunityRole.MEMBER;
      await this.efootballProfilesRepository.save(profile);
    }

    return {
      status: 'joined',
      message: 'Successfully joined community',
    };
  }

  async leaveIndividual(communityId: string, user: User): Promise<any> {
    const profile = await this.efootballProfilesRepository.findOne({
      where: { userId: user.id },
    });

    if (!profile) {
      throw new NotFoundException('Profile not found');
    }

    const member = await this.communityMembersRepository.findOne({
      where: { communityId, profileId: profile.id },
    });

    if (!member) {
      throw new BadRequestException('You are not a member of this community');
    }

    const executiveRoles: (CommunityRole | string)[] = [
      CommunityRole.PRESIDENT,
      CommunityRole.VICE_PRESIDENT,
      'General Secretary',
    ];
    if (executiveRoles.includes(member.role)) {
      throw new BadRequestException(
        `Community ${member.role} cannot leave the community without transferring authority first.`,
      );
    }

    const isClubInCommunity = profile.clubId
      ? await this.communitiesRepository
          .createQueryBuilder('community')
          .innerJoin('community.clubs', 'club', 'club.id = :clubId', { clubId: profile.clubId })
          .where('community.id = :communityId', { communityId })
          .getExists()
      : false;

    if (isClubInCommunity || (member.sourceClubIds && member.sourceClubIds.length > 0)) {
      throw new BadRequestException(
        'You cannot leave this community individually because your club is a member. You must leave your club or your club must leave the community.',
      );
    }

    await this.communityMembersRepository.remove(member);
    if (profile.communityId === communityId) {
      profile.communityId = null;
      profile.communityRole = null;
      await this.efootballProfilesRepository.save(profile);
    }

    return { message: 'Successfully left community' };
  }

  async addClub(communityId: string, clubId: string, user: User): Promise<any> {
    const community = await this.communitiesRepository.findOne({
      where: { id: communityId },
      relations: { clubs: true },
    });
    if (!community) {
      throw new NotFoundException(`Community ${communityId} not found`);
    }

    const club = await this.clubsRepository.findOne({
      where: { id: clubId },
      relations: { members: true },
    });
    if (!club) {
      throw new NotFoundException(`Club ${clubId} not found`);
    }

    // Check if club is already in community
    const isAlreadyMember = (community.clubs || []).some((c) => c.id === club.id);
    if (isAlreadyMember) {
      throw new BadRequestException('Club is already a member of this community');
    }

    // Check permissions: Caller must be Community President OR Club President/General Secretary
    const userProfile = await this.efootballProfilesRepository.findOne({
      where: { userId: user.id },
    });

    const isCommunityPresident = community.creatorId === user.id;
    const isClubLeadership =
      userProfile &&
      userProfile.clubId === club.id &&
      (userProfile.clubRole === ClubRole.PRESIDENT ||
        userProfile.clubRole === ClubRole.GENERAL_SECRETARY);

    if (!isCommunityPresident && !isClubLeadership) {
      throw new ForbiddenException(
        'Only the Community President or Club President/General Secretary can enroll a club in a community',
      );
    }

    // If initiated from the club and community has APPROVAL policy (and not initiated by community president)
    if (!isCommunityPresident && community.joinPolicy === JoinPolicy.APPROVAL) {
      const existingReq = await this.joinRequestsRepository.findOne({
        where: {
          communityId,
          clubId,
          targetType: CommunityJoinRequestType.CLUB,
          status: CommunityJoinRequestStatus.PENDING,
        },
      });

      if (existingReq) {
        throw new BadRequestException('A join request for this club is already pending');
      }

      const req = this.joinRequestsRepository.create({
        communityId,
        clubId,
        requesterUserId: user.id,
        targetType: CommunityJoinRequestType.CLUB,
        status: CommunityJoinRequestStatus.PENDING,
      });

      await this.joinRequestsRepository.save(req);
      return {
        status: 'pending',
        message: 'Club join request submitted for approval by community administrators',
      };
    }

    // Perform the club join and member cascade
    await this.executeClubJoin(community, club);

    return {
      status: 'joined',
      message: `Club ${club.name} and all its members successfully joined the community`,
    };
  }

  private async executeClubJoin(community: Community, club: Club): Promise<void> {
    // Add club to community_clubs
    community.clubs = [...(community.clubs || []), club];
    await this.communitiesRepository.save(community);

    // Update club's communityIds JSON column for sync compatibility
    const existingIds = new Set(club.communityIds || []);
    existingIds.add(community.id);
    club.communityIds = Array.from(existingIds);
    await this.clubsRepository.save(club);

    // Fetch all members of this club
    const clubMembers = await this.efootballProfilesRepository.find({
      where: { clubId: club.id },
    });

    for (const player of clubMembers) {
      let member = await this.communityMembersRepository.findOne({
        where: { communityId: community.id, profileId: player.id },
      });

      if (member) {
        const sources = new Set(member.sourceClubIds || []);
        sources.add(club.id);
        member.sourceClubIds = Array.from(sources);
        await this.communityMembersRepository.save(member);
      } else {
        member = this.communityMembersRepository.create({
          communityId: community.id,
          profileId: player.id,
          role: CommunityRole.MEMBER,
          isDirectMember: false,
          sourceClubIds: [club.id],
        });
        await this.communityMembersRepository.save(member);
      }

      if (!player.communityId) {
        player.communityId = community.id;
        player.communityRole = CommunityRole.MEMBER;
        await this.efootballProfilesRepository.save(player);
      }
    }
  }

  async removeClub(communityId: string, clubId: string, user: User): Promise<any> {
    const community = await this.communitiesRepository.findOne({
      where: { id: communityId },
      relations: { clubs: true },
    });
    if (!community) {
      throw new NotFoundException(`Community ${communityId} not found`);
    }

    const club = await this.clubsRepository.findOne({
      where: { id: clubId },
    });
    if (!club) {
      throw new NotFoundException(`Club ${clubId} not found`);
    }

    const userProfile = await this.efootballProfilesRepository.findOne({
      where: { userId: user.id },
    });

    const isCommunityPresident = community.creatorId === user.id;
    const isClubLeadership =
      userProfile &&
      userProfile.clubId === club.id &&
      (userProfile.clubRole === ClubRole.PRESIDENT ||
        userProfile.clubRole === ClubRole.GENERAL_SECRETARY);

    if (!isCommunityPresident && !isClubLeadership) {
      throw new ForbiddenException(
        'Only the Community President or Club President/General Secretary can remove a club from a community',
      );
    }

    // Remove club from community.clubs
    community.clubs = (community.clubs || []).filter((c) => c.id !== club.id);
    await this.communitiesRepository.save(community);

    // Update club's communityIds JSON column
    club.communityIds = (club.communityIds || []).filter((id) => id !== community.id);
    await this.clubsRepository.save(club);

    // Cascade revoke inherited memberships
    const clubMembers = await this.efootballProfilesRepository.find({
      where: { clubId: club.id },
    });

    for (const player of clubMembers) {
      const member = await this.communityMembersRepository.findOne({
        where: { communityId: community.id, profileId: player.id },
      });

      if (member) {
        member.sourceClubIds = (member.sourceClubIds || []).filter((id) => id !== club.id);
        if (member.sourceClubIds.length === 0 && !member.isDirectMember) {
          await this.communityMembersRepository.remove(member);
          if (player.communityId === community.id) {
            player.communityId = null;
            player.communityRole = null;
            await this.efootballProfilesRepository.save(player);
          }
        } else {
          await this.communityMembersRepository.save(member);
        }
      }
    }

    return { message: `Club ${club.name} removed from community` };
  }

  /**
   * Called when a player joins a club: auto-joins them to all communities the club belongs to.
   */
  async onClubMemberAdded(clubId: string, profileId: string): Promise<void> {
    const club = await this.clubsRepository.findOne({
      where: { id: clubId },
      relations: { communities: true },
    });

    if (!club || !club.communities || club.communities.length === 0) {
      return;
    }

    const player = await this.efootballProfilesRepository.findOne({
      where: { id: profileId },
    });
    if (!player) return;

    for (const community of club.communities) {
      let member = await this.communityMembersRepository.findOne({
        where: { communityId: community.id, profileId },
      });

      if (member) {
        const sources = new Set(member.sourceClubIds || []);
        sources.add(club.id);
        member.sourceClubIds = Array.from(sources);
        await this.communityMembersRepository.save(member);
      } else {
        member = this.communityMembersRepository.create({
          communityId: community.id,
          profileId,
          role: CommunityRole.MEMBER,
          isDirectMember: false,
          sourceClubIds: [club.id],
        });
        await this.communityMembersRepository.save(member);
      }

      if (!player.communityId) {
        player.communityId = community.id;
        player.communityRole = CommunityRole.MEMBER;
        await this.efootballProfilesRepository.save(player);
      }
    }
  }

  /**
   * Called when a player leaves a club: removes inherited community memberships.
   */
  async onClubMemberRemoved(clubId: string, profileId: string): Promise<void> {
    const club = await this.clubsRepository.findOne({
      where: { id: clubId },
      relations: { communities: true },
    });

    if (!club || !club.communities || club.communities.length === 0) {
      return;
    }

    const player = await this.efootballProfilesRepository.findOne({
      where: { id: profileId },
    });

    for (const community of club.communities) {
      const member = await this.communityMembersRepository.findOne({
        where: { communityId: community.id, profileId },
      });

      if (member) {
        member.sourceClubIds = (member.sourceClubIds || []).filter((id) => id !== club.id);
        if (member.sourceClubIds.length === 0 && !member.isDirectMember) {
          await this.communityMembersRepository.remove(member);
          if (player && player.communityId === community.id) {
            player.communityId = null;
            player.communityRole = null;
            await this.efootballProfilesRepository.save(player);
          }
        } else {
          await this.communityMembersRepository.save(member);
        }
      }
    }
  }

  async getMembers(communityId: string, query?: CommunityMembersQueryDto): Promise<any> {
    await this.findOne(communityId);

    const qb = this.communityMembersRepository
      .createQueryBuilder('cm')
      .leftJoinAndSelect('cm.profile', 'profile')
      .leftJoinAndSelect('profile.user', 'user')
      .leftJoinAndSelect('profile.club', 'club')
      .where('cm.communityId = :communityId', { communityId })
      .orderBy('cm.role', 'ASC')
      .addOrderBy('cm.joinedAt', 'ASC');

    if (query?.search) {
      qb.andWhere(
        '(LOWER(user.name) LIKE :search OR LOWER(profile.inGameId) LIKE :search)',
        { search: `%${query.search.toLowerCase()}%` },
      );
    }

    if (query?.role) {
      qb.andWhere('cm.role = :role', { role: query.role });
    }

    const isPaginated = Boolean(query?.page || query?.limit);
    const page = query?.page || 1;
    const limit = query?.limit || 20;

    let members: CommunityMember[];
    let total = 0;

    if (isPaginated) {
      qb.skip((page - 1) * limit).take(limit);
      const [data, count] = await qb.getManyAndCount();
      members = data;
      total = count;
    } else {
      members = await qb.getMany();
      total = members.length;
    }

    const mapped = members.map((m) => {
      const p = m.profile;
      const u = p?.user;
      return {
        id: u?.id || m.id,
        profileId: p?.id,
        name: u?.name || 'Unknown',
        dpUrl: u?.dpUrl || null,
        coverUrl: u?.coverUrl || null,
        clubId: p?.clubId || null,
        clubName: p?.club?.name || null,
        clubRole: p?.clubRole || null,
        communityId: m.communityId,
        communityRole: m.role,
        isDirectMember: m.isDirectMember,
        sourceClubIds: m.sourceClubIds,
        joinedAt: m.joinedAt,
        points: p?.points || 0,
      };
    });

    if (isPaginated) {
      return createPaginatedResult(mapped, total, page, limit);
    }
    return mapped;
  }

  async getRequests(communityId: string, user: User): Promise<any[]> {
    await this.findOne(communityId);

    return this.joinRequestsRepository.find({
      where: {
        communityId,
        status: CommunityJoinRequestStatus.PENDING,
      },
      relations: {
        requesterUser: {
          efootballProfile: true,
        },
        club: {
          members: true,
        },
      },
      order: {
        createdAt: 'DESC',
      },
    });
  }

  async reviewRequest(
    communityId: string,
    requestId: string,
    reviewer: User,
    dto: ReviewJoinRequestDto,
  ): Promise<any> {
    const request = await this.joinRequestsRepository.findOne({
      where: { id: requestId, communityId },
      relations: { requesterUser: true, club: true },
    });

    if (!request) {
      throw new NotFoundException(`Join request ${requestId} not found`);
    }

    if (request.status !== CommunityJoinRequestStatus.PENDING) {
      throw new BadRequestException(`Request is already ${request.status}`);
    }

    request.status = dto.status;
    request.reviewedByUserId = reviewer.id;
    await this.joinRequestsRepository.save(request);

    if (dto.status === CommunityJoinRequestStatus.APPROVED) {
      const community = await this.communitiesRepository.findOne({
        where: { id: communityId },
        relations: { clubs: true },
      });

      if (!community) {
        throw new NotFoundException(`Community ${communityId} not found`);
      }

      if (request.targetType === CommunityJoinRequestType.PLAYER) {
        let profile = await this.efootballProfilesRepository.findOne({
          where: { userId: request.requesterUserId },
        });

        if (!profile) {
          profile = this.efootballProfilesRepository.create({
            userId: request.requesterUserId,
            points: 0,
            communityId,
            communityRole: CommunityRole.MEMBER,
          });
          await this.efootballProfilesRepository.save(profile);
        } else {
          profile.communityId = communityId;
          profile.communityRole = CommunityRole.MEMBER;
          await this.efootballProfilesRepository.save(profile);
        }

        let member = await this.communityMembersRepository.findOne({
          where: { communityId, profileId: profile.id },
        });

        if (member) {
          member.isDirectMember = true;
          member.role = CommunityRole.MEMBER;
          await this.communityMembersRepository.save(member);
        } else {
          member = this.communityMembersRepository.create({
            communityId,
            profileId: profile.id,
            role: CommunityRole.MEMBER,
            isDirectMember: true,
            sourceClubIds: [],
          });
          await this.communityMembersRepository.save(member);
        }
      } else if (request.targetType === CommunityJoinRequestType.CLUB && request.clubId) {
        const club = await this.clubsRepository.findOne({
          where: { id: request.clubId },
          relations: { members: true },
        });

        if (club) {
          await this.executeClubJoin(community, club);
        }
      }
      await this.notificationsService.createNotification(request.requesterUserId, {
        title: 'Community Join Request Approved',
        message: `Your request to join ${community.name} has been approved!`,
        type: 'community_join_request',
        link: `/dashboard/efootball/community/${community.id}`,
      });
    } else {
      const community = await this.communitiesRepository.findOne({ where: { id: communityId } });
      await this.notificationsService.createNotification(request.requesterUserId, {
        title: 'Community Join Request Rejected',
        message: `Your request to join ${community?.name ?? 'the community'} was declined.`,
        type: 'community_join_request',
        link: `/dashboard/efootball/community/${communityId}`,
      });
    }

    return {
      success: true,
      message: `Request ${dto.status} successfully`,
      request,
    };
  }

  async getMyRequest(communityId: string, user: User) {
    const profile = await this.efootballProfilesRepository.findOne({
      where: { userId: user.id },
    });

    let clubRequest: CommunityJoinRequest | null = null;
    if (profile?.clubId) {
      clubRequest = await this.joinRequestsRepository.findOne({
        where: {
          communityId,
          clubId: profile.clubId,
          targetType: CommunityJoinRequestType.CLUB,
          status: CommunityJoinRequestStatus.PENDING,
        },
      });
    }

    const playerRequest = await this.joinRequestsRepository.findOne({
      where: {
        communityId,
        requesterUserId: user.id,
        targetType: CommunityJoinRequestType.PLAYER,
        status: CommunityJoinRequestStatus.PENDING,
      },
    });

    const activeReq = clubRequest || playerRequest;

    return {
      hasPendingRequest: Boolean(activeReq),
      isClubRequest: Boolean(clubRequest),
      request: activeReq ?? null,
      clubRequest: clubRequest ?? null,
      playerRequest: playerRequest ?? null,
    };
  }

  async assignRole(communityId: string, presidentUser: User, dto: AssignRoleDto): Promise<any> {
    const community = await this.communitiesRepository.findOne({ where: { id: communityId } });
    if (!community) {
      throw new NotFoundException(`Community ${communityId} not found`);
    }

    let targetProfile: EfootballProfile | null = null;
    if (dto.targetProfileId) {
      targetProfile = await this.efootballProfilesRepository.findOne({
        where: { id: dto.targetProfileId },
        relations: { user: true },
      });
    } else if (dto.targetUserId) {
      targetProfile = await this.efootballProfilesRepository.findOne({
        where: { userId: dto.targetUserId },
        relations: { user: true },
      });
    }

    if (!targetProfile) {
      throw new NotFoundException('Target player profile not found');
    }

    let member = await this.communityMembersRepository.findOne({
      where: { communityId, profileId: targetProfile.id },
    });

    if (!member) {
      throw new BadRequestException('Target player is not a member of this community');
    }

    // Handle President transfer
    if (dto.role === CommunityRole.PRESIDENT) {
      const currentPresidentProfile = await this.efootballProfilesRepository.findOne({
        where: { userId: presidentUser.id },
      });

      if (currentPresidentProfile) {
        const currentPresidentMember = await this.communityMembersRepository.findOne({
          where: { communityId, profileId: currentPresidentProfile.id },
        });
        if (currentPresidentMember) {
          currentPresidentMember.role = CommunityRole.MEMBER;
          await this.communityMembersRepository.save(currentPresidentMember);
        }
        currentPresidentProfile.communityRole = CommunityRole.MEMBER;
        await this.efootballProfilesRepository.save(currentPresidentProfile);
      }

      community.creatorId = targetProfile.userId;
      await this.communitiesRepository.save(community);
    }

    member.role = dto.role;
    await this.communityMembersRepository.save(member);

    if (targetProfile.communityId === communityId) {
      targetProfile.communityRole = dto.role;
      await this.efootballProfilesRepository.save(targetProfile);
    }

    return {
      success: true,
      message: `Assigned role ${dto.role} to ${targetProfile.user?.name ?? 'member'}`,
      member,
    };
  }

  async handoverAuthority(
    communityId: string,
    caller: User,
    dto: { targetUserId?: string; targetProfileId?: string },
  ) {
    if (!dto.targetUserId && !dto.targetProfileId) {
      throw new BadRequestException('Either targetUserId or targetProfileId must be provided');
    }

    const community = await this.communitiesRepository.findOne({ where: { id: communityId } });
    if (!community) {
      throw new NotFoundException(`Community ${communityId} not found`);
    }

    const callerProfile = await this.efootballProfilesRepository.findOne({
      where: { userId: caller.id },
      relations: { user: true },
    });

    if (!callerProfile) {
      throw new ForbiddenException('User profile not found');
    }

    const callerMember = await this.communityMembersRepository.findOne({
      where: { communityId, profileId: callerProfile.id },
    });

    if (!callerMember) {
      throw new ForbiddenException('You are not a member of this community');
    }

    const allowedRoles: (CommunityRole | string)[] = [
      CommunityRole.PRESIDENT,
      CommunityRole.VICE_PRESIDENT,
      'General Secretary',
    ];
    if (!allowedRoles.includes(callerMember.role)) {
      throw new ForbiddenException('Authority handover is only for President and General Secretary');
    }

    let targetProfile: EfootballProfile | null = null;
    if (dto.targetProfileId) {
      targetProfile = await this.efootballProfilesRepository.findOne({
        where: { id: dto.targetProfileId },
        relations: { user: true },
      });
    } else if (dto.targetUserId) {
      targetProfile = await this.efootballProfilesRepository.findOne({
        where: { userId: dto.targetUserId },
        relations: { user: true },
      });
    }

    if (!targetProfile) {
      throw new NotFoundException('Target player profile not found');
    }

    if (targetProfile.id === callerProfile.id) {
      throw new BadRequestException('You cannot handover authority to yourself');
    }

    const targetMember = await this.communityMembersRepository.findOne({
      where: { communityId, profileId: targetProfile.id },
    });

    if (!targetMember) {
      throw new BadRequestException('Target player is not a member of this community');
    }

    const handoverRole = callerMember.role;

    if (handoverRole === CommunityRole.PRESIDENT) {
      callerMember.role = CommunityRole.MEMBER;
      await this.communityMembersRepository.save(callerMember);
      callerProfile.communityRole = CommunityRole.MEMBER;
      await this.efootballProfilesRepository.save(callerProfile);

      community.creatorId = targetProfile.userId;
      await this.communitiesRepository.save(community);
    } else {
      callerMember.role = CommunityRole.MEMBER;
      await this.communityMembersRepository.save(callerMember);
      if (callerProfile.communityId === communityId) {
        callerProfile.communityRole = CommunityRole.MEMBER;
        await this.efootballProfilesRepository.save(callerProfile);
      }
    }

    targetMember.role = handoverRole;
    await this.communityMembersRepository.save(targetMember);

    if (targetProfile.communityId === communityId) {
      targetProfile.communityRole = handoverRole;
      await this.efootballProfilesRepository.save(targetProfile);
    }

    return {
      success: true,
      message: `${handoverRole} authority successfully handed over to ${targetProfile.user?.name ?? 'member'}. You are now a regular member.`,
      handoverRole,
      newHolderId: targetProfile.id,
    };
  }
}
