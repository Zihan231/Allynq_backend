import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateEfootballProfileDto } from './dto/create-efootball-profile.dto.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateEfootballProfileDto } from './dto/update-efootball-profile.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { UserQueryDto } from './dto/user-query.dto.js';
import { EfootballProfile } from './entities/efootball-profile.entity.js';
import { User } from './entities/user.entity.js';
import { FileStorageService } from '../common/services/file-storage.service.js';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(EfootballProfile)
    private readonly efootballProfilesRepository: Repository<EfootballProfile>,
    private readonly fileStorageService: FileStorageService,
  ) {}

  async create(dto: CreateUserDto): Promise<User> {
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
    const qb = this.usersRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.efootballProfile', 'efootballProfile')
      .leftJoinAndSelect('efootballProfile.club', 'club')
      .leftJoinAndSelect('efootballProfile.team', 'team')
      .leftJoinAndSelect('efootballProfile.community', 'community')
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
    if (dto.dpUrl) {
      dto.dpUrl = await this.fileStorageService.saveBase64Image(dto.dpUrl, 'users', 'dp');
    }
    if (dto.coverUrl) {
      dto.coverUrl = await this.fileStorageService.saveBase64Image(dto.coverUrl, 'users', 'cover');
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

  async remove(id: string): Promise<void> {
    const result = await this.usersRepository.delete(id);
    if (result.affected === 0) {
      throw new NotFoundException(`User ${id} not found`);
    }
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
