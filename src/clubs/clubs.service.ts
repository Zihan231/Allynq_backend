import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EfootballProfile } from '../users/entities/efootball-profile.entity.js';
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

  create(dto: CreateClubDto): Promise<Club> {
    const club = this.clubsRepository.create(dto);
    return this.clubsRepository.save(club);
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
