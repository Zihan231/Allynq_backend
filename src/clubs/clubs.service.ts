import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CommunitiesService } from '../communities/communities.service.js';
import { FileStorageService } from '../common/services/file-storage.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { EfootballProfile } from '../users/entities/efootball-profile.entity.js';
import { User } from '../users/entities/user.entity.js';
import { ClubRole } from '../users/enums/user-attributes.enum.js';
import { ChangeManagerDto } from './dto/change-manager.dto.js';
import { TransferPresidentDto } from './dto/transfer-president.dto.js';
import { CreateClubDto } from './dto/create-club.dto.js';
import { UpdateClubDto } from './dto/update-club.dto.js';
import { ClubQueryDto } from './dto/club-query.dto.js';
import { ClubMembersQueryDto } from './dto/club-members-query.dto.js';
import { ReviewClubJoinRequestDto } from './dto/review-club-join-request.dto.js';
import { createPaginatedResult } from '../common/interfaces/paginated-result.interface.js';
import { Club } from './entities/club.entity.js';
import { ClubJoinRequest } from './entities/club-join-request.entity.js';
import { JoinPolicy } from './enums/club.enum.js';

@Injectable()
export class ClubsService {
  constructor(
    @InjectRepository(Club)
    private readonly clubsRepository: Repository<Club>,
    @InjectRepository(EfootballProfile)
    private readonly efootballProfilesRepository: Repository<EfootballProfile>,
    @InjectRepository(ClubJoinRequest)
    private readonly clubJoinRequestsRepository: Repository<ClubJoinRequest>,
    private readonly communitiesService: CommunitiesService,
    private readonly fileStorageService: FileStorageService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async create(user: User, dto: CreateClubDto): Promise<Club> {
    const profile = await this.efootballProfilesRepository.findOne({
      where: { userId: user.id },
    });

    if (profile?.clubId) {
      throw new BadRequestException(
        'You are already a member of a club. You cannot create a new club while belonging to an existing one. Please leave your current club first.',
      );
    }

    if (dto.dpUrl) {
      dto.dpUrl = await this.fileStorageService.saveBase64Image(dto.dpUrl, 'clubs', 'dp');
    }
    if (dto.coverUrl) {
      dto.coverUrl = await this.fileStorageService.saveBase64Image(dto.coverUrl, 'clubs', 'cover');
    }

    const club = this.clubsRepository.create(dto);
    const savedClub = await this.clubsRepository.save(club);

    if (profile) {
      profile.clubId = savedClub.id;
      profile.clubRole = ClubRole.PRESIDENT;
      await this.efootballProfilesRepository.save(profile);
    }

    return savedClub;
  }

  async findAll(query?: ClubQueryDto): Promise<any> {
    const qb = this.clubsRepository
      .createQueryBuilder('club')
      .leftJoinAndSelect('club.members', 'member')
      .leftJoinAndSelect('member.user', 'user')
      .orderBy('club.points', 'DESC')
      .addOrderBy('club.createdAt', 'DESC');

    if (query?.search) {
      qb.andWhere('(LOWER(club.name) LIKE :search OR LOWER(club.location) LIKE :search)', {
        search: `%${query.search.toLowerCase()}%`,
      });
    }

    const isPaginated = Boolean(query?.page || query?.limit);
    const page = query?.page || 1;
    const limit = query?.limit || 20;

    if (isPaginated) {
      qb.skip((page - 1) * limit).take(limit);
      const [data, total] = await qb.getManyAndCount();
      return createPaginatedResult(data, total, page, limit);
    }

    return qb.getMany();
  }

  async findOne(id: string): Promise<Club> {
    const club = await this.clubsRepository.findOne({
      where: { id },
      relations: {
        members: {
          user: true,
        },
      },
    });
    if (!club) {
      throw new NotFoundException(`Club ${id} not found`);
    }
    return club;
  }

  async update(id: string, dto: UpdateClubDto): Promise<Club> {
    const club = await this.findOne(id);

    if (dto.dpUrl !== undefined && dto.dpUrl !== club.dpUrl) {
      if (club.dpUrl) {
        await this.fileStorageService.deleteFile(club.dpUrl);
      }
      if (dto.dpUrl) {
        dto.dpUrl = await this.fileStorageService.saveBase64Image(dto.dpUrl, 'clubs', 'dp');
      }
    }

    if (dto.coverUrl !== undefined && dto.coverUrl !== club.coverUrl) {
      if (club.coverUrl) {
        await this.fileStorageService.deleteFile(club.coverUrl);
      }
      if (dto.coverUrl) {
        dto.coverUrl = await this.fileStorageService.saveBase64Image(dto.coverUrl, 'clubs', 'cover');
      }
    }

    Object.assign(club, dto);
    return this.clubsRepository.save(club);
  }

  async remove(id: string): Promise<void> {
    const club = await this.clubsRepository.findOne({ where: { id } });
    if (!club) {
      throw new NotFoundException(`Club ${id} not found`);
    }

    if (club.dpUrl) {
      await this.fileStorageService.deleteFile(club.dpUrl);
    }
    if (club.coverUrl) {
      await this.fileStorageService.deleteFile(club.coverUrl);
    }

    const result = await this.clubsRepository.delete(id);
    if (result.affected === 0) {
      throw new NotFoundException(`Club ${id} not found`);
    }
  }

  async getMembers(id: string, query?: ClubMembersQueryDto): Promise<any> {
    await this.findOne(id);

    const qb = this.efootballProfilesRepository
      .createQueryBuilder('profile')
      .leftJoinAndSelect('profile.user', 'user')
      .where('profile.clubId = :clubId', { clubId: id })
      .orderBy('profile.points', 'DESC');

    if (query?.search) {
      qb.andWhere(
        '(LOWER(user.name) LIKE :search OR LOWER(user.inGameId) LIKE :search)',
        { search: `%${query.search.toLowerCase()}%` },
      );
    }

    if (query?.role) {
      qb.andWhere('profile.clubRole = :role', { role: query.role });
    }

    const isPaginated = Boolean(query?.page || query?.limit);
    const page = query?.page || 1;
    const limit = query?.limit || 20;

    if (isPaginated) {
      qb.skip((page - 1) * limit).take(limit);
      const [data, total] = await qb.getManyAndCount();
      return createPaginatedResult(data, total, page, limit);
    }

    return qb.getMany();
  }

  async getManager(clubId: string): Promise<EfootballProfile | null> {
    await this.findOne(clubId);
    return this.efootballProfilesRepository.findOne({
      where: {
        clubId,
        clubRole: ClubRole.MANAGER,
      },
      relations: {
        user: true,
      },
    });
  }

  async changeManager(
    clubId: string,
    caller: User,
    dto: ChangeManagerDto,
  ) {
    if (!dto.targetUserId && !dto.targetProfileId) {
      throw new BadRequestException('Either targetUserId or targetProfileId must be provided');
    }

    const club = await this.findOne(clubId);

    // Verify caller's membership and permissions in this club
    const callerProfile = await this.efootballProfilesRepository.findOne({
      where: { userId: caller.id },
      relations: { user: true },
    });

    if (!callerProfile || callerProfile.clubId !== club.id) {
      throw new ForbiddenException('You are not a member of this club');
    }

    const allowedRoles: (ClubRole | null)[] = [
      ClubRole.PRESIDENT,
      ClubRole.GENERAL_SECRETARY,
    ];

    if (!callerProfile.clubRole || !allowedRoles.includes(callerProfile.clubRole)) {
      throw new ForbiddenException(
        'Only the Club President or General Secretary can change the club manager',
      );
    }

    // Find target member in this club
    const targetQuery: any = { clubId: club.id };
    if (dto.targetProfileId) {
      targetQuery.id = dto.targetProfileId;
    } else if (dto.targetUserId) {
      targetQuery.userId = dto.targetUserId;
    }

    const targetProfile = await this.efootballProfilesRepository.findOne({
      where: targetQuery,
      relations: { user: true },
    });

    if (!targetProfile) {
      throw new BadRequestException('Target member is not a member of this club');
    }

    if (targetProfile.clubRole === ClubRole.MANAGER) {
      throw new BadRequestException('The target member is already the manager of this club');
    }

    if (targetProfile.clubRole === ClubRole.PRESIDENT) {
      throw new BadRequestException('Cannot reassign the Club President as Manager');
    }

    // Find current manager of the club (if any)
    const currentManager = await this.efootballProfilesRepository.findOne({
      where: {
        clubId: club.id,
        clubRole: ClubRole.MANAGER,
      },
      relations: { user: true },
    });

    let previousManagerData: { id: string; userId: string; name: string; role: ClubRole } | null = null;

    // If an existing manager exists, demote them to Player
    if (currentManager) {
      currentManager.clubRole = ClubRole.PLAYER;
      await this.efootballProfilesRepository.save(currentManager);
      previousManagerData = {
        id: currentManager.id,
        userId: currentManager.userId,
        name: currentManager.user?.name ?? 'Previous Manager',
        role: ClubRole.PLAYER,
      };
    }

    // Promote the target member to Manager
    targetProfile.clubRole = ClubRole.MANAGER;
    const savedTarget = await this.efootballProfilesRepository.save(targetProfile);

    const isSelfTransfer =
      callerProfile.clubRole === ClubRole.MANAGER ||
      (currentManager && currentManager.id === callerProfile.id);

    return {
      success: true,
      message: isSelfTransfer
        ? `Manager role successfully handed over to ${savedTarget.user?.name ?? 'new manager'}. You are now a normal Player.`
        : `Manager for ${club.name} successfully changed to ${savedTarget.user?.name ?? 'new manager'}.`,
      clubId: club.id,
      clubName: club.name,
      previousManager: previousManagerData,
      newManager: {
        id: savedTarget.id,
        userId: savedTarget.userId,
        name: savedTarget.user?.name ?? 'New Manager',
        role: ClubRole.MANAGER,
      },
    };
  }

  async join(clubId: string, user: User) {
    const club = await this.findOne(clubId);

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

    if (profile.clubId) {
      throw new BadRequestException('You are already a member of a club. Please leave your current club first.');
    }

    // Handle approval-based join policy
    if (club.joinPolicy === JoinPolicy.APPROVAL) {
      const existingReq = await this.clubJoinRequestsRepository.findOne({
        where: {
          clubId,
          requesterUserId: user.id,
          status: 'pending',
        },
      });

      if (existingReq) {
        throw new BadRequestException('You already have a pending join request for this club');
      }

      const req = this.clubJoinRequestsRepository.create({
        clubId,
        requesterUserId: user.id,
        status: 'pending',
      });
      await this.clubJoinRequestsRepository.save(req);

      // Real-time notification to club authorities (President, GS, Manager, Captain, Vice-Captain)
      await this.notificationsService.notifyClubAuthorities(
        club.id,
        'Club Join Request',
        `${user.name} requested to join ${club.name}`,
        `/dashboard/efootball/clubs/${club.id}/requests`,
      );

      return {
        status: 'pending',
        message: 'Join request submitted for approval by club leadership',
        clubId: club.id,
      };
    }

    profile.clubId = club.id;
    profile.clubRole = ClubRole.PLAYER;
    await this.efootballProfilesRepository.save(profile);

    // Auto-join to all communities the club belongs to
    await this.communitiesService.onClubMemberAdded(club.id, profile.id);

    return {
      status: 'joined',
      success: true,
      message: `Successfully joined ${club.name}`,
      clubId: club.id,
    };
  }

  async getMyRequest(clubId: string, user: User) {
    const request = await this.clubJoinRequestsRepository.findOne({
      where: {
        clubId,
        requesterUserId: user.id,
        status: 'pending',
      },
    });

    return {
      hasPendingRequest: Boolean(request),
      request: request ?? null,
    };
  }

  async getRequests(clubId: string, user: User) {
    await this.findOne(clubId);
    await this.verifyClubAuthority(clubId, user.id);

    return this.clubJoinRequestsRepository.find({
      where: { clubId, status: 'pending' },
      relations: { requesterUser: true },
      order: { createdAt: 'DESC' },
    });
  }

  async reviewRequest(
    clubId: string,
    requestId: string,
    user: User,
    dto: ReviewClubJoinRequestDto,
  ) {
    const club = await this.findOne(clubId);
    await this.verifyClubAuthority(clubId, user.id);

    const request = await this.clubJoinRequestsRepository.findOne({
      where: { id: requestId, clubId },
      relations: { requesterUser: true },
    });

    if (!request) {
      throw new NotFoundException(`Join request ${requestId} not found for this club`);
    }

    if (request.status !== 'pending') {
      throw new BadRequestException(`Request is already ${request.status}`);
    }

    request.status = dto.status;
    request.reviewedByUserId = user.id;
    await this.clubJoinRequestsRepository.save(request);

    if (dto.status === 'approved') {
      let profile = await this.efootballProfilesRepository.findOne({
        where: { userId: request.requesterUserId },
      });

      if (!profile) {
        profile = this.efootballProfilesRepository.create({
          userId: request.requesterUserId,
          points: 0,
        });
      }

      profile.clubId = club.id;
      profile.clubRole = ClubRole.PLAYER;
      await this.efootballProfilesRepository.save(profile);
      await this.communitiesService.onClubMemberAdded(club.id, profile.id);

      await this.notificationsService.createNotification(request.requesterUserId, {
        title: 'Club Join Request Approved',
        message: `Your request to join ${club.name} has been approved! Welcome to the club.`,
        type: 'club_join_request',
        link: `/dashboard/efootball/clubs/${club.id}`,
      });
    } else {
      await this.notificationsService.createNotification(request.requesterUserId, {
        title: 'Club Join Request Rejected',
        message: `Your request to join ${club.name} was declined.`,
        type: 'club_join_request',
        link: `/dashboard/efootball/clubs/${club.id}`,
      });
    }

    return {
      success: true,
      message: `Join request ${dto.status}`,
      requestId: request.id,
      status: request.status,
    };
  }

  private async verifyClubAuthority(clubId: string, userId: string) {
    let profile = await this.efootballProfilesRepository.findOne({
      where: { userId, clubId },
    });

    if (!profile) {
      profile = await this.efootballProfilesRepository.findOne({
        where: { userId },
      });
      if (profile?.clubId !== clubId) {
        profile = null;
      }
    }

    const authorityRoles = [
      ClubRole.PRESIDENT,
      ClubRole.GENERAL_SECRETARY,
      ClubRole.MANAGER,
      ClubRole.CAPTAIN,
      ClubRole.VICE_CAPTAIN,
    ];

    const isAuthority =
      profile?.clubRole &&
      authorityRoles.some(
        (r) => r.toLowerCase() === profile!.clubRole!.toLowerCase(),
      );

    if (!profile || !isAuthority) {
      throw new ForbiddenException('Only club authorities can view or review join requests');
    }

    return profile;
  }

  async transferPresidency(clubId: string, caller: User, dto: TransferPresidentDto) {
    if (!dto.targetUserId && !dto.targetProfileId) {
      throw new BadRequestException('Either targetUserId or targetProfileId must be provided');
    }

    const club = await this.findOne(clubId);

    const callerProfile = await this.efootballProfilesRepository.findOne({
      where: { userId: caller.id },
      relations: { user: true },
    });

    if (!callerProfile || callerProfile.clubId !== club.id) {
      throw new ForbiddenException('You are not a member of this club');
    }

    const eligibleRoles = [ClubRole.PRESIDENT, ClubRole.GENERAL_SECRETARY];
    if (!callerProfile.clubRole || !eligibleRoles.includes(callerProfile.clubRole)) {
      throw new ForbiddenException('Authority handover is only for President and General Secretary');
    }

    const targetQuery: any = { clubId: club.id };
    if (dto.targetProfileId) {
      targetQuery.id = dto.targetProfileId;
    } else if (dto.targetUserId) {
      targetQuery.userId = dto.targetUserId;
    }

    const targetProfile = await this.efootballProfilesRepository.findOne({
      where: targetQuery,
      relations: { user: true },
    });

    if (!targetProfile) {
      throw new BadRequestException('Target member is not a member of this club');
    }

    if (targetProfile.id === callerProfile.id) {
      throw new BadRequestException('You cannot handover authority to yourself');
    }

    const roleToHandover = callerProfile.clubRole;

    // Demote caller to Player
    callerProfile.clubRole = ClubRole.PLAYER;
    await this.efootballProfilesRepository.save(callerProfile);

    // Promote target member to the executive role
    targetProfile.clubRole = roleToHandover;
    const savedTarget = await this.efootballProfilesRepository.save(targetProfile);

    return {
      success: true,
      message: `${roleToHandover} authority successfully handed over to ${savedTarget.user?.name ?? 'member'}. You are now a Club Player.`,
      clubId: club.id,
      handoverRole: roleToHandover,
      newPresidentId: savedTarget.id,
      newPresidentUserId: savedTarget.userId,
    };
  }

  async leave(clubId: string, user: User) {
    const profile = await this.efootballProfilesRepository.findOne({
      where: { userId: user.id },
    });

    if (!profile || profile.clubId !== clubId) {
      throw new BadRequestException('You are not a member of this club');
    }

    if (profile.clubRole === ClubRole.PRESIDENT || profile.clubRole === ClubRole.GENERAL_SECRETARY) {
      throw new BadRequestException(
        `Club ${profile.clubRole} cannot leave the club without transferring authority first.`,
      );
    }

    profile.clubId = null;
    profile.clubRole = null;
    profile.teamId = null;
    await this.efootballProfilesRepository.save(profile);

    // Revoke inherited community memberships
    await this.communitiesService.onClubMemberRemoved(clubId, profile.id);

    return {
      success: true,
      message: 'Successfully left the club',
    };
  }
}
