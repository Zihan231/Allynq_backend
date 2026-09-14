import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EfootballProfile } from '../users/entities/efootball-profile.entity.js';
import { LineupStatus } from '../users/enums/user-attributes.enum.js';
import { CreateTeamDto } from './dto/create-team.dto.js';
import { SetLineupDto } from './dto/set-lineup.dto.js';
import { SubstitutePlayerDto } from './dto/substitute-player.dto.js';
import { UpdateTeamDto } from './dto/update-team.dto.js';
import { Team } from './entities/team.entity.js';

@Injectable()
export class TeamsService {
  constructor(
    @InjectRepository(Team)
    private readonly teamsRepository: Repository<Team>,
    @InjectRepository(EfootballProfile)
    private readonly efootballProfilesRepository: Repository<EfootballProfile>,
  ) {}

  async create(clubId: string, dto: CreateTeamDto): Promise<Team> {
    const count = await this.teamsRepository.count({ where: { clubId } });
    if (count >= 3) {
      throw new BadRequestException(
        'A club can have at most 3 teams (e.g., Team A, Team B, Team C)',
      );
    }

    const team = this.teamsRepository.create({
      clubId,
      name: dto.name,
    });
    return this.teamsRepository.save(team);
  }

  findAll(clubId: string): Promise<Team[]> {
    return this.teamsRepository.find({
      where: { clubId },
      relations: {
        captain: {
          user: true,
        },
        members: {
          user: true,
        },
      },
      order: {
        createdAt: 'ASC',
      },
    });
  }

  async findOne(clubId: string, teamId: string): Promise<Team> {
    const team = await this.teamsRepository.findOne({
      where: { id: teamId, clubId },
      relations: {
        captain: {
          user: true,
        },
        members: {
          user: true,
        },
      },
    });
    if (!team) {
      throw new NotFoundException(`Team ${teamId} not found in club ${clubId}`);
    }
    return team;
  }

  async update(clubId: string, teamId: string, dto: UpdateTeamDto): Promise<Team> {
    const team = await this.findOne(clubId, teamId);

    if (dto.name !== undefined) {
      team.name = dto.name;
    }

    if (dto.captainProfileId !== undefined) {
      if (dto.captainProfileId !== null) {
        const captainProfile = await this.efootballProfilesRepository.findOne({
          where: { id: dto.captainProfileId, clubId },
        });
        if (!captainProfile) {
          throw new BadRequestException(
            'The selected captain must be a registered member of this club',
          );
        }
      }
      team.captainProfileId = dto.captainProfileId;
    }

    return this.teamsRepository.save(team);
  }

  async remove(clubId: string, teamId: string): Promise<void> {
    const team = await this.findOne(clubId, teamId);
    await this.teamsRepository.remove(team);
  }

  async setLineup(clubId: string, teamId: string, dto: SetLineupDto): Promise<Team> {
    await this.findOne(clubId, teamId);

    const starters = dto.players.filter((p) => p.lineupStatus === LineupStatus.STARTER);
    const subs = dto.players.filter((p) => p.lineupStatus === LineupStatus.SUB);

    if (starters.length > 11) {
      throw new BadRequestException(
        `A team can have at most 11 starters. Provided: ${starters.length}`,
      );
    }
    if (subs.length > 5) {
      throw new BadRequestException(
        `A team can have at most 5 substitutes. Provided: ${subs.length}`,
      );
    }

    for (const item of dto.players) {
      const profile = await this.efootballProfilesRepository.findOne({
        where: { id: item.profileId, clubId },
      });
      if (!profile) {
        throw new BadRequestException(
          `Profile ${item.profileId} is not a member of this club`,
        );
      }

      profile.teamId = teamId;
      profile.lineupStatus = item.lineupStatus;
      if (item.gamePosition !== undefined) {
        profile.gamePosition = item.gamePosition;
      }
      await this.efootballProfilesRepository.save(profile);
    }

    return this.findOne(clubId, teamId);
  }

  async substitute(clubId: string, teamId: string, dto: SubstitutePlayerDto) {
    await this.findOne(clubId, teamId);

    const outProfile = await this.efootballProfilesRepository.findOne({
      where: { id: dto.outProfileId, teamId, clubId },
      relations: { user: true },
    });
    if (!outProfile) {
      throw new BadRequestException('Outgoing player not found on this team');
    }
    if (outProfile.lineupStatus !== LineupStatus.STARTER) {
      throw new BadRequestException(
        `Outgoing player ${outProfile.user?.name ?? outProfile.id} must be an active starter to be substituted`,
      );
    }
    if (!outProfile.gamePosition) {
      throw new BadRequestException(
        `Outgoing player ${outProfile.user?.name ?? outProfile.id} has no assigned position to transfer`,
      );
    }

    const inProfile = await this.efootballProfilesRepository.findOne({
      where: { id: dto.inProfileId, teamId, clubId },
      relations: { user: true },
    });
    if (!inProfile) {
      throw new BadRequestException('Incoming player not found on this team');
    }
    if (inProfile.lineupStatus !== LineupStatus.SUB) {
      throw new BadRequestException(
        `Incoming player ${inProfile.user?.name ?? inProfile.id} must be a substitute to enter the match`,
      );
    }

    // Transfer the position from starter to the incoming sub
    const transferredPosition = outProfile.gamePosition;
    inProfile.gamePosition = transferredPosition;
    inProfile.lineupStatus = LineupStatus.STARTER;

    // Outgoing starter becomes a substitute
    outProfile.lineupStatus = LineupStatus.SUB;

    await this.efootballProfilesRepository.save([inProfile, outProfile]);

    return {
      message: `Substitution complete: ${inProfile.user?.name ?? inProfile.id} came on as ${transferredPosition} replacing ${outProfile.user?.name ?? outProfile.id}.`,
      inPlayer: inProfile,
      outPlayer: outProfile,
    };
  }
}
