import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CommunitiesService } from '../communities/communities.service.js';
import { FileStorageService } from '../common/services/file-storage.service.js';
import { RecycleBinService } from '../recycle-bin/recycle-bin.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { EfootballProfile } from '../users/entities/efootball-profile.entity.js';
import { User } from '../users/entities/user.entity.js';
import { ClubRole } from '../users/enums/user-attributes.enum.js';
import { AssignPositionDto } from './dto/assign-position.dto.js';
import { ChangeManagerDto } from './dto/change-manager.dto.js';
import { SetMatchOfficialsDto } from './dto/set-match-officials.dto.js';
import { TransferPresidentDto } from './dto/transfer-president.dto.js';
import { CreateClubDto } from './dto/create-club.dto.js';
import { UpdateClubDto } from './dto/update-club.dto.js';
import { ClubQueryDto } from './dto/club-query.dto.js';
import { ClubMembersQueryDto } from './dto/club-members-query.dto.js';
import { ReviewClubJoinRequestDto } from './dto/review-club-join-request.dto.js';
import { createPaginatedResult } from '../common/interfaces/paginated-result.interface.js';
import { Club } from './entities/club.entity.js';
import { ClubJoinRequest } from './entities/club-join-request.entity.js';
import { PlayerContract } from '../transfers/entities/player-contract.entity.js';

@Injectable()
export class ClubsService {
  private readonly logger = new Logger(ClubsService.name);

  constructor(
    @InjectRepository(Club)
    private readonly clubsRepository: Repository<Club>,
    @InjectRepository(EfootballProfile)
    private readonly efootballProfilesRepository: Repository<EfootballProfile>,
    @InjectRepository(ClubJoinRequest)
    private readonly clubJoinRequestsRepository: Repository<ClubJoinRequest>,
    @InjectRepository(PlayerContract)
    private readonly contractsRepository: Repository<PlayerContract>,
    private readonly communitiesService: CommunitiesService,
    private readonly fileStorageService: FileStorageService,
    private readonly notificationsService: NotificationsService,
    private readonly recycleBin: RecycleBinService,
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

    if (await this.communitiesService.isCommunityLeader(user.id)) {
      throw new ForbiddenException(
        'Community Presidents and Vice Presidents cannot create a club. Hand over your community role first.',
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

  /**
   * Lightweight list for browse pages: club columns plus a member count. Members are
   * fetched per club via GET /clubs/:id/members instead of being joined here.
   */
  async findAll(query?: ClubQueryDto): Promise<any> {
    const qb = this.clubsRepository.createQueryBuilder('club').select('club.id', 'id');
    for (const column of [
      'name', 'color', 'initials', 'dpUrl', 'coverUrl', 'description', 'points', 'joinPolicy',
      'minRoster', 'maxRoster', 'communityIds', 'stage', 'location', 'motto', 'facebookUrl',
      'createdAt', 'updatedAt',
    ]) {
      qb.addSelect(`club.${column}`, column);
    }
    qb.addSelect(`(SELECT COUNT(*) FROM efootball_profiles p WHERE p."clubId" = club.id)::int`, 'memberCount')
      .orderBy('club.points', 'DESC')
      .addOrderBy('club.createdAt', 'DESC');

    if (query?.id) qb.andWhere('club.id = :id', { id: query.id });
    if (query?.excludeId) qb.andWhere('club.id <> :excludeId', { excludeId: query.excludeId });
    if (query?.stage) qb.andWhere('club.stage = :stage', { stage: query.stage });
    if (query?.search) {
      qb.andWhere('(LOWER(club.name) LIKE :search OR LOWER(club.location) LIKE :search)', {
        search: `%${query.search.toLowerCase()}%`,
      });
    }

    const isPaginated = Boolean(query?.page || query?.limit);
    if (!isPaginated) {
      return qb.getRawMany();
    }

    const page = query?.page || 1;
    const limit = query?.limit || 20;
    const [data, total] = await Promise.all([
      qb.clone().offset((page - 1) * limit).limit(limit).getRawMany(),
      qb.getCount(),
    ]);
    return createPaginatedResult(data, total, page, limit);
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

  /**
   * Moves the club to the recycle bin: members are released (and remembered for a restore),
   * active contracts end. It is deleted for good after the retention period.
   */
  async remove(id: string, actorId: string | null = null): Promise<void> {
    const club = await this.clubsRepository.findOne({ where: { id } });
    if (!club) {
      throw new NotFoundException(`Club ${id} not found`);
    }
    await this.recycleBin.moveToBin('club', id, actorId, 'Deleted by the club President');
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

  /**
   * Club Settings: puts a member in a staff position (General Secretary,
   * Manager, Captain, Vice-Captain, Academy Captain) or clears theirs (`Player`).
   * Each position has one holder, so the previous holder becomes a Player.
   * The President changes only through the presidency transfer.
   */
  async assignPosition(clubId: string, caller: User, dto: AssignPositionDto) {
    const club = await this.findOne(clubId);
    await this.assertClubLeader(club.id, caller.id);

    const target = await this.efootballProfilesRepository.findOne({
      where: { id: dto.profileId, clubId: club.id },
      relations: { user: true },
    });
    if (!target) throw new BadRequestException('That player is not a member of this club');
    if (target.clubRole === ClubRole.PRESIDENT) {
      throw new BadRequestException("The President's position changes only through a presidency transfer");
    }
    if (target.clubRole === dto.role) return { success: true, changed: false };

    let previousHolder: { profileId: string; name: string } | null = null;
    if (dto.role !== ClubRole.PLAYER) {
      const holder = await this.efootballProfilesRepository.findOne({
        where: { clubId: club.id, clubRole: dto.role },
        relations: { user: true },
      });
      if (holder && holder.id !== target.id) {
        holder.clubRole = ClubRole.PLAYER;
        await this.efootballProfilesRepository.save(holder);
        previousHolder = { profileId: holder.id, name: holder.user?.name ?? 'Player' };
      }
    }

    target.clubRole = dto.role;
    await this.efootballProfilesRepository.save(target);

    if (dto.role !== ClubRole.PLAYER && target.userId !== caller.id) {
      void this.notificationsService
        .createNotification(target.userId, {
          title: 'New club position',
          message: `You are now ${dto.role} of ${club.name}.`,
          type: 'system',
          link: `/dashboard/efootball/clubs/${club.id}`,
          code: 'club.positionAssigned',
          params: { role: dto.role, club: club.name },
        })
        .catch((err) => this.logger.error(`Failed to notify new ${dto.role}: ${err.message}`));
    }

    return {
      success: true,
      changed: true,
      member: { profileId: target.id, name: target.user?.name ?? 'Player', role: dto.role },
      previousHolder,
    };
  }

  /** Club Settings: the members nominated as match officials for the club's tournaments. */
  async setMatchOfficials(clubId: string, caller: User, dto: SetMatchOfficialsDto): Promise<{ matchOfficialIds: string[] }> {
    const club = await this.findOne(clubId);
    await this.assertClubLeader(club.id, caller.id);

    const userIds = [...new Set(dto.userIds)];
    if (userIds.length) {
      const members = await this.efootballProfilesRepository.find({
        where: { clubId: club.id, userId: In(userIds) },
        select: { userId: true },
      });
      const memberIds = new Set(members.map((m) => m.userId));
      if (userIds.some((id) => !memberIds.has(id))) {
        throw new BadRequestException('Match officials must be members of the club');
      }
    }

    await this.clubsRepository.update({ id: club.id }, { matchOfficialIds: userIds });
    return { matchOfficialIds: userIds };
  }

  /** Club President or General Secretary of this club (the route guard checks roles too). */
  private async assertClubLeader(clubId: string, userId: string): Promise<void> {
    const profile = await this.efootballProfilesRepository.findOne({ where: { userId } });
    const leaders: (ClubRole | null)[] = [ClubRole.PRESIDENT, ClubRole.GENERAL_SECRETARY];
    if (!profile || profile.clubId !== clubId || !leaders.includes(profile.clubRole)) {
      throw new ForbiddenException('Only the Club President or General Secretary can change club settings');
    }
  }

  /**
   * Joining a club now goes through the transfer market: the player proposes to
   * the club (or the club makes him an offer), which creates his contract.
   */
  async join(clubId: string, _user: User): Promise<never> {
    await this.findOne(clubId);
    throw new BadRequestException(
      'Joining a club now works through transfer offers: open the club and use "Propose to join".',
    );
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

    // Joining now goes through transfer offers; old requests can only be rejected.
    if (dto.status === 'approved') {
      throw new BadRequestException(
        'Join requests are replaced by transfer offers. Reject this request; the player can propose to join instead.',
      );
    }

    request.status = dto.status;
    request.reviewedByUserId = user.id;
    await this.clubJoinRequestsRepository.save(request);

    await this.notificationsService.createNotification(request.requesterUserId, {
      title: 'Club Join Request Rejected',
      message: `Your request to join ${club.name} was declined.`,
      type: 'club_join_request',
      link: `/dashboard/efootball/clubs/${club.id}`,
      code: 'club.joinRejected',
      params: { club: club.name },
    });

    return {
      success: true,
      message: `Join request ${dto.status}`,
      requestId: request.id,
      status: request.status,
    };
  }

  /** Non-blocking "new member" notice to the club's officials (`approvedBy`: who accepted the request). */
  private notifyMemberJoined(
    club: Club,
    playerName: string,
    approvedBy: string | null = null,
    excludeUserIds: string[] = [],
  ): void {
    const message = approvedBy
      ? `${playerName} joined ${club.name} (approved by ${approvedBy})`
      : `${playerName} joined ${club.name}`;
    void this.notificationsService
      .notifyClubAuthorities(club.id, 'New Club Member', message, `/dashboard/efootball/clubs/${club.id}`, {
        type: 'club_member_joined',
        excludeUserIds,
        code: approvedBy ? 'club.memberJoinedApproved' : 'club.memberJoined',
        params: { player: playerName, club: club.name, approvedBy },
      })
      .catch((err) => {
        this.logger.error(`Failed to notify club authorities for club ${club.id}: ${err.message}`);
      });
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

    const contract = await this.contractsRepository.findOne({ where: { userId: user.id, status: 'active' } });
    if (contract && contract.clubId === clubId && contract.lockEndsAt.getTime() > Date.now()) {
      throw new BadRequestException(
        `You're under contract until ${contract.lockEndsAt.toISOString().slice(0, 10)} and can't leave before then. Another club can buy you out in the meantime.`,
      );
    }

    profile.clubId = null;
    profile.clubRole = null;
    profile.teamId = null;
    await this.efootballProfilesRepository.save(profile);

    if (contract) {
      await this.contractsRepository.update({ id: contract.id }, { status: 'ended', endedAt: new Date(), endReason: 'left' });
    }
    const club = await this.clubsRepository.findOne({ where: { id: clubId } });
    void this.notificationsService
      .notifyClubAuthorities(
        clubId,
        'Player left',
        `${user.name} left ${club?.name ?? 'the club'} after his contract lock ended.`,
        `/dashboard/efootball/clubs/${clubId}?tab=transfers`,
        { type: 'transfer', code: 'transfer.leftAfterLock', params: { player: user.name, club: club?.name ?? '' } },
      )
      .catch((err) => this.logger.error(`Failed to notify club ${clubId} of a departure: ${err.message}`));

    // Revoke inherited community memberships
    await this.communitiesService.onClubMemberRemoved(clubId, profile.id);

    return {
      success: true,
      message: 'Successfully left the club',
    };
  }
}
