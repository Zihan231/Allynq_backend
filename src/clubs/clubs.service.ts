import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CommunitiesService } from '../communities/communities.service.js';
import { EfootballProfile } from '../users/entities/efootball-profile.entity.js';
import { User } from '../users/entities/user.entity.js';
import { ClubRole } from '../users/enums/user-attributes.enum.js';
import { ChangeManagerDto } from './dto/change-manager.dto.js';
import { CreateClubDto } from './dto/create-club.dto.js';
import { UpdateClubDto } from './dto/update-club.dto.js';
import { ClubQueryDto } from './dto/club-query.dto.js';
import { ClubMembersQueryDto } from './dto/club-members-query.dto.js';
import { createPaginatedResult } from '../common/interfaces/paginated-result.interface.js';
import { Club } from './entities/club.entity.js';

@Injectable()
export class ClubsService {
  constructor(
    @InjectRepository(Club)
    private readonly clubsRepository: Repository<Club>,
    @InjectRepository(EfootballProfile)
    private readonly efootballProfilesRepository: Repository<EfootballProfile>,
    private readonly communitiesService: CommunitiesService,
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
    Object.assign(club, dto);
    return this.clubsRepository.save(club);
  }

  async remove(id: string): Promise<void> {
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
      ClubRole.MANAGER,
    ];

    if (!callerProfile.clubRole || !allowedRoles.includes(callerProfile.clubRole)) {
      throw new ForbiddenException(
        'Only the Club President, General Secretary, or current Manager can change the club manager',
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

    profile.clubId = club.id;
    profile.clubRole = ClubRole.PLAYER;
    await this.efootballProfilesRepository.save(profile);

    // Auto-join to all communities the club belongs to
    await this.communitiesService.onClubMemberAdded(club.id, profile.id);

    return {
      success: true,
      message: `Successfully joined ${club.name}`,
      clubId: club.id,
    };
  }

  async leave(clubId: string, user: User) {
    const profile = await this.efootballProfilesRepository.findOne({
      where: { userId: user.id },
    });

    if (!profile || profile.clubId !== clubId) {
      throw new BadRequestException('You are not a member of this club');
    }

    if (profile.clubRole === ClubRole.PRESIDENT) {
      throw new BadRequestException(
        'Club President cannot leave the club without transferring presidency or deleting the club',
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
