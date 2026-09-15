import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EfootballProfile } from '../users/entities/efootball-profile.entity.js';
import { User } from '../users/entities/user.entity.js';
import { ClubRole } from '../users/enums/user-attributes.enum.js';
import { CreateClubDto } from './dto/create-club.dto.js';
import { UpdateClubDto } from './dto/update-club.dto.js';
import { Club } from './entities/club.entity.js';

@Injectable()
export class ClubsService {
  constructor(
    @InjectRepository(Club)
    private readonly clubsRepository: Repository<Club>,
    @InjectRepository(EfootballProfile)
    private readonly efootballProfilesRepository: Repository<EfootballProfile>,
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

  findAll(): Promise<Club[]> {
    return this.clubsRepository.find({
      relations: {
        members: {
          user: true,
        },
      },
      order: {
        points: 'DESC',
        createdAt: 'DESC',
      },
    });
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

  async getMembers(id: string): Promise<EfootballProfile[]> {
    await this.findOne(id);
    return this.efootballProfilesRepository.find({
      where: { clubId: id },
      relations: {
        user: true,
      },
      order: {
        points: 'DESC',
      },
    });
  }
}
