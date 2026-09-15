import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateEfootballProfileDto } from './dto/create-efootball-profile.dto.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateEfootballProfileDto } from './dto/update-efootball-profile.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { EfootballProfile } from './entities/efootball-profile.entity.js';
import { User } from './entities/user.entity.js';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(EfootballProfile)
    private readonly efootballProfilesRepository: Repository<EfootballProfile>,
  ) {}

  create(dto: CreateUserDto): Promise<User> {
    const user = this.usersRepository.create(dto);
    return this.usersRepository.save(user);
  }

  findAll(): Promise<User[]> {
    return this.usersRepository.find({
      relations: {
        efootballProfile: {
          club: true,
          team: true,
        },
      },
    });
  }

  async findOne(id: string): Promise<User> {
    const user = await this.usersRepository.findOne({
      where: { id },
      relations: {
        efootballProfile: {
          club: true,
          team: true,
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
