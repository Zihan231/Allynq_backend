import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { CreateEfootballProfileDto } from './dto/create-efootball-profile.dto.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateEfootballProfileDto } from './dto/update-efootball-profile.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { UserQueryDto } from './dto/user-query.dto.js';
import { EfootballProfile } from './entities/efootball-profile.entity.js';
import { User } from './entities/user.entity.js';
import { FileStorageService } from '../common/services/file-storage.service.js';
import { RecycleBinService } from '../recycle-bin/recycle-bin.service.js';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(EfootballProfile)
    private readonly efootballProfilesRepository: Repository<EfootballProfile>,
    private readonly fileStorageService: FileStorageService,
    private readonly recycleBin: RecycleBinService,
  ) {}

  async create(dto: CreateUserDto): Promise<User> {
    // Verification is granted by staff after reviewing the document, never self-assigned.
    delete dto.verificationLevel;
    if (dto.dpUrl) {
      dto.dpUrl = await this.fileStorageService.saveBase64Image(dto.dpUrl, 'users', 'dp');
    }
    if (dto.coverUrl) {
      dto.coverUrl = await this.fileStorageService.saveBase64Image(dto.coverUrl, 'users', 'cover');
    }
    const user = this.usersRepository.create(dto);
    return this.usersRepository.save(user);
  }

  async findAll(query?: UserQueryDto): Promise<{
    users: User[];
    total: number;
    page: number;
    limit: number;
    isPaginated: boolean;
  }> {
    // Public directory listing: only the columns other players can see, and profile ids instead of
    // nested club/team/community objects (those made the full list ~4 MB). Private contact,
    // location and verification-document columns are never loaded here; see GET /users/me.
    const qb = this.usersRepository
      .createQueryBuilder('user')
      .select(
        [
          'id', 'name', 'dpUrl', 'coverUrl', 'bio', 'facebookUrl', 'facebookProfileName', 'instagramUrl',
          'discordUrl', 'inGameId', 'deviceName', 'deviceModel', 'birthday', 'bloodGroup', 'country',
          'division', 'district', 'education', 'verificationLevel', 'ownedCosmeticIds', 'equippedBadgeId',
          'equippedTitleId', 'equippedFrameId', 'equippedThemeId', 'createdAt', 'updatedAt',
        ].map((column) => `user.${column}`),
      )
      .leftJoin('user.efootballProfile', 'efootballProfile')
      .addSelect(
        [
          'id', 'userId', 'konamiUid', 'gamePosition', 'squadTeam', 'shirtNumber', 'points', 'clubId',
          'teamId', 'lineupStatus', 'clubRole', 'communityId', 'communityRole',
        ].map((column) => `efootballProfile.${column}`),
      )
      // Accounts in the recycle bin are hidden from the directory.
      .where('user.deletedAt IS NULL')
      .orderBy('user.createdAt', 'DESC');

    if (query?.search) {
      qb.andWhere(
        '(LOWER(user.name) LIKE :search OR LOWER(user.email) LIKE :search OR LOWER(user.inGameId) LIKE :search)',
        { search: `%${query.search.toLowerCase()}%` },
      );
    }

    if (query?.district) {
      qb.andWhere('LOWER(user.district) = LOWER(:district)', {
        district: query.district,
      });
    }

    if (query?.clubId) {
      qb.andWhere('efootballProfile.clubId = :clubId', {
        clubId: query.clubId,
      });
    }

    const isPaginated = Boolean(query?.page || query?.limit);
    const page = query?.page || 1;
    const limit = query?.limit || 20;

    if (isPaginated) {
      qb.skip((page - 1) * limit).take(limit);
      const [users, total] = await qb.getManyAndCount();
      return {
        users,
        total,
        page,
        limit,
        isPaginated: true,
      };
    }

    const users = await qb.getMany();
    return {
      users,
      total: users.length,
      page: 1,
      limit: users.length,
      isPaginated: false,
    };
  }

  async findOne(id: string): Promise<User> {
    const user = await this.usersRepository.findOne({
      where: { id },
      relations: {
        efootballProfile: {
          club: true,
          team: true,
          community: true,
        },
      },
    });
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }
    return user;
  }

  async update(id: string, dto: UpdateUserDto): Promise<User> {
    const user = await this.findOne(id);

    if (dto.dpUrl !== undefined && dto.dpUrl !== user.dpUrl) {
      if (user.dpUrl) {
        await this.fileStorageService.deleteFile(user.dpUrl);
      }
      if (dto.dpUrl) {
        dto.dpUrl = await this.fileStorageService.saveBase64Image(dto.dpUrl, 'users', 'dp');
      }
    }

    if (dto.coverUrl !== undefined && dto.coverUrl !== user.coverUrl) {
      if (user.coverUrl) {
        await this.fileStorageService.deleteFile(user.coverUrl);
      }
      if (dto.coverUrl) {
        dto.coverUrl = await this.fileStorageService.saveBase64Image(dto.coverUrl, 'users', 'cover');
      }
    }

    if (dto.password && dto.password.trim()) {
      user.password = await bcrypt.hash(dto.password.trim(), 10);
      delete dto.password;
    }

    // Verification is granted by staff after reviewing the document, never self-assigned.
    // A new or changed document goes back into the review queue; removing it clears the level.
    delete dto.verificationLevel;
    const documentChanged =
      (dto.documentDataUrl !== undefined && dto.documentDataUrl !== user.documentDataUrl) ||
      (dto.documentType !== undefined && dto.documentType !== user.documentType);
    if (documentChanged) {
      const hasDocument = Boolean(dto.documentDataUrl ?? user.documentDataUrl) && Boolean(dto.documentType ?? user.documentType);
      user.verificationStatus = hasDocument ? 'pending' : 'none';
      user.verificationNote = null;
      if (!hasDocument) user.verificationLevel = 0;
    }

    Object.assign(user, dto);
    await this.usersRepository.save(user);

    if (dto.inGameId && user.efootballProfile) {
      await this.efootballProfilesRepository.update(user.efootballProfile.id, {
        konamiUid: dto.inGameId,
      });
    }

    return this.findOne(id);
  }

  /** Deleting your account moves it to the recycle bin; it is deleted for good after the retention period. */
  async remove(id: string): Promise<void> {
    await this.recycleBin.moveToBin('user', id, id, 'Deleted by the user');
  }

  async getEfootballProfile(userId: string): Promise<EfootballProfile> {
    await this.findOne(userId);
    const profile = await this.efootballProfilesRepository.findOne({ where: { userId } });
    if (!profile) {
      throw new NotFoundException(`eFootball profile for user ${userId} not found`);
    }
    return profile;
  }

  async upsertEfootballProfile(
    userId: string,
    dto: CreateEfootballProfileDto | UpdateEfootballProfileDto,
  ): Promise<EfootballProfile> {
    await this.findOne(userId);
    let profile = await this.efootballProfilesRepository.findOne({ where: { userId } });
    if (!profile) {
      profile = this.efootballProfilesRepository.create({ userId, ...dto });
    } else {
      Object.assign(profile, dto);
    }
    return this.efootballProfilesRepository.save(profile);
  }
}
