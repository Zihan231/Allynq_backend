import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { EfootballProfile } from '../users/entities/efootball-profile.entity.js';
import { LineupStatus } from '../users/enums/user-attributes.enum.js';
import {
  COMPATIBLE_POSITIONS,
  EfootballPosition,
  normalizePosition,
} from '../users/enums/efootball-position.enum.js';
import { CreateTeamDto } from './dto/create-team.dto.js';
import { SetLineupDto } from './dto/set-lineup.dto.js';
import { SubstitutePlayerDto } from './dto/substitute-player.dto.js';
import { UpdateTeamDto } from './dto/update-team.dto.js';
import { ShiftPositionDto } from './dto/shift-position.dto.js';
import { SwapPositionsDto } from './dto/swap-positions.dto.js';
import { AddTeamPlayerDto } from './dto/add-team-player.dto.js';
import { ApplyFormationDto, SupportedFormation } from './dto/apply-formation.dto.js';
import { Team } from './entities/team.entity.js';

export const FORMATION_SLOT_MAP: Record<SupportedFormation, EfootballPosition[]> = {
  '4-4-2': [
    EfootballPosition.GK,
    EfootballPosition.LB,
    EfootballPosition.CB,
    EfootballPosition.CB,
    EfootballPosition.RB,
    EfootballPosition.LMF,
    EfootballPosition.CMF,
    EfootballPosition.CMF,
    EfootballPosition.RMF,
    EfootballPosition.CF,
    EfootballPosition.CF,
  ],
  '4-3-3': [
    EfootballPosition.GK,
    EfootballPosition.LB,
    EfootballPosition.CB,
    EfootballPosition.CB,
    EfootballPosition.RB,
    EfootballPosition.DMF,
    EfootballPosition.CMF,
    EfootballPosition.CMF,
    EfootballPosition.LWF,
    EfootballPosition.CF,
    EfootballPosition.RWF,
  ],
  '4-3-2-1': [
    EfootballPosition.GK,
    EfootballPosition.LB,
    EfootballPosition.CB,
    EfootballPosition.CB,
    EfootballPosition.RB,
    EfootballPosition.DMF,
    EfootballPosition.CMF,
    EfootballPosition.CMF,
    EfootballPosition.AMF,
    EfootballPosition.AMF,
    EfootballPosition.CF,
  ],
  '4-3-1-2': [
    EfootballPosition.GK,
    EfootballPosition.LB,
    EfootballPosition.CB,
    EfootballPosition.CB,
    EfootballPosition.RB,
    EfootballPosition.DMF,
    EfootballPosition.CMF,
    EfootballPosition.CMF,
    EfootballPosition.AMF,
    EfootballPosition.CF,
    EfootballPosition.CF,
  ],
  '4-2-3-1': [
    EfootballPosition.GK,
    EfootballPosition.LB,
    EfootballPosition.CB,
    EfootballPosition.CB,
    EfootballPosition.RB,
    EfootballPosition.DMF,
    EfootballPosition.DMF,
    EfootballPosition.LMF,
    EfootballPosition.AMF,
    EfootballPosition.RMF,
    EfootballPosition.CF,
  ],
  '4-2-1-3': [
    EfootballPosition.GK,
    EfootballPosition.LB,
    EfootballPosition.CB,
    EfootballPosition.CB,
    EfootballPosition.RB,
    EfootballPosition.DMF,
    EfootballPosition.DMF,
    EfootballPosition.AMF,
    EfootballPosition.LWF,
    EfootballPosition.CF,
    EfootballPosition.RWF,
  ],
  '4-1-4-1': [
    EfootballPosition.GK,
    EfootballPosition.LB,
    EfootballPosition.CB,
    EfootballPosition.CB,
    EfootballPosition.RB,
    EfootballPosition.DMF,
    EfootballPosition.LMF,
    EfootballPosition.CMF,
    EfootballPosition.CMF,
    EfootballPosition.RMF,
    EfootballPosition.CF,
  ],
  '4-1-2-3': [
    EfootballPosition.GK,
    EfootballPosition.LB,
    EfootballPosition.CB,
    EfootballPosition.CB,
    EfootballPosition.RB,
    EfootballPosition.DMF,
    EfootballPosition.AMF,
    EfootballPosition.AMF,
    EfootballPosition.LWF,
    EfootballPosition.CF,
    EfootballPosition.RWF,
  ],
  '3-4-3': [
    EfootballPosition.GK,
    EfootballPosition.CB,
    EfootballPosition.CB,
    EfootballPosition.CB,
    EfootballPosition.LMF,
    EfootballPosition.CMF,
    EfootballPosition.CMF,
    EfootballPosition.RMF,
    EfootballPosition.LWF,
    EfootballPosition.CF,
    EfootballPosition.RWF,
  ],
  '3-2-4-1': [
    EfootballPosition.GK,
    EfootballPosition.CB,
    EfootballPosition.CB,
    EfootballPosition.CB,
    EfootballPosition.DMF,
    EfootballPosition.DMF,
    EfootballPosition.LMF,
    EfootballPosition.AMF,
    EfootballPosition.AMF,
    EfootballPosition.RMF,
    EfootballPosition.CF,
  ],
  '3-2-3-2': [
    EfootballPosition.GK,
    EfootballPosition.CB,
    EfootballPosition.CB,
    EfootballPosition.CB,
    EfootballPosition.DMF,
    EfootballPosition.DMF,
    EfootballPosition.LMF,
    EfootballPosition.AMF,
    EfootballPosition.RMF,
    EfootballPosition.CF,
    EfootballPosition.CF,
  ],
  '3-1-4-2': [
    EfootballPosition.GK,
    EfootballPosition.CB,
    EfootballPosition.CB,
    EfootballPosition.CB,
    EfootballPosition.DMF,
    EfootballPosition.LMF,
    EfootballPosition.CMF,
    EfootballPosition.CMF,
    EfootballPosition.RMF,
    EfootballPosition.CF,
    EfootballPosition.CF,
  ],
  '5-3-2': [
    EfootballPosition.GK,
    EfootballPosition.LB,
    EfootballPosition.CB,
    EfootballPosition.CB,
    EfootballPosition.CB,
    EfootballPosition.RB,
    EfootballPosition.DMF,
    EfootballPosition.CMF,
    EfootballPosition.CMF,
    EfootballPosition.CF,
    EfootballPosition.CF,
  ],
  '5-2-2-1': [
    EfootballPosition.GK,
    EfootballPosition.LB,
    EfootballPosition.CB,
    EfootballPosition.CB,
    EfootballPosition.CB,
    EfootballPosition.RB,
    EfootballPosition.DMF,
    EfootballPosition.CMF,
    EfootballPosition.AMF,
    EfootballPosition.AMF,
    EfootballPosition.CF,
  ],
  '5-2-1-2': [
    EfootballPosition.GK,
    EfootballPosition.LB,
    EfootballPosition.CB,
    EfootballPosition.CB,
    EfootballPosition.CB,
    EfootballPosition.RB,
    EfootballPosition.DMF,
    EfootballPosition.CMF,
    EfootballPosition.AMF,
    EfootballPosition.CF,
    EfootballPosition.CF,
  ],
};

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
      throw new NotFoundException('Team not found in this club');
    }

    return team;
  }

  async update(clubId: string, teamId: string, dto: UpdateTeamDto): Promise<Team> {
    const team = await this.findOne(clubId, teamId);

    if (dto.name !== undefined) {
      team.name = dto.name;
    }

    if (dto.captainProfileId !== undefined) {
      if (dto.captainProfileId === null) {
        team.captainProfileId = null;
      } else {
        const profile = await this.efootballProfilesRepository.findOne({
          where: { id: dto.captainProfileId, teamId, clubId },
        });
        if (!profile) {
          throw new BadRequestException(
            'The designated captain must be an active member of this team',
          );
        }
        team.captainProfileId = profile.id;
      }
    }

    await this.teamsRepository.save(team);
    return this.findOne(clubId, teamId);
  }

  async remove(clubId: string, teamId: string): Promise<void> {
    const team = await this.findOne(clubId, teamId);
    // Free all players on this team before removing
    await this.efootballProfilesRepository.update(
      { teamId },
      { teamId: null, lineupStatus: LineupStatus.NONE, gamePosition: null },
    );
    await this.teamsRepository.remove(team);
  }

  async getFreeClubPlayers(clubId: string) {
    return this.efootballProfilesRepository.find({
      where: {
        clubId,
        teamId: IsNull(),
      },
      relations: { user: true },
      order: { points: 'DESC' },
    });
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

    // Outgoing starter becomes a substitute (positionless on bench, ready to sub anywhere)
    outProfile.lineupStatus = LineupStatus.SUB;
    outProfile.gamePosition = null;

    await this.efootballProfilesRepository.save([inProfile, outProfile]);

    return {
      message: `Substitution complete: ${inProfile.user?.name ?? inProfile.id} came on as ${transferredPosition} replacing ${outProfile.user?.name ?? outProfile.id}.`,
      inPlayer: inProfile,
      outPlayer: outProfile,
    };
  }

  async shiftPlayerPosition(
    clubId: string,
    teamId: string,
    profileId: string,
    dto: ShiftPositionDto,
  ) {
    await this.findOne(clubId, teamId);

    const profile = await this.efootballProfilesRepository.findOne({
      where: { id: profileId, teamId, clubId },
      relations: { user: true },
    });

    if (!profile) {
      throw new BadRequestException('Player not found on this team');
    }

    const currentPos = normalizePosition(profile.gamePosition);
    const targetPos = dto.gamePosition;

    if (currentPos && COMPATIBLE_POSITIONS[currentPos]) {
      const allowed = COMPATIBLE_POSITIONS[currentPos];
      if (!allowed.includes(targetPos)) {
        throw new BadRequestException(
          `Incompatible tactical position: Cannot shift ${profile.user?.name ?? 'Player'} from ${currentPos} to ${targetPos}. Compatible options: ${allowed.join(', ')}`,
        );
      }
    }

    profile.gamePosition = targetPos;
    await this.efootballProfilesRepository.save(profile);

    return this.findOne(clubId, teamId);
  }

  async swapPlayerPositions(
    clubId: string,
    teamId: string,
    dto: SwapPositionsDto,
  ) {
    await this.findOne(clubId, teamId);

    const [p1, p2] = await Promise.all([
      this.efootballProfilesRepository.findOne({
        where: { id: dto.profileId1, teamId, clubId },
        relations: { user: true },
      }),
      this.efootballProfilesRepository.findOne({
        where: { id: dto.profileId2, teamId, clubId },
        relations: { user: true },
      }),
    ]);

    if (!p1 || !p2) {
      throw new BadRequestException('Both players must be members of this team');
    }

    if (p1.lineupStatus !== LineupStatus.STARTER || p2.lineupStatus !== LineupStatus.STARTER) {
      throw new BadRequestException(
        'Both players must be active starters to swap tactical positions on the pitch',
      );
    }

    const tempPos = p1.gamePosition;
    p1.gamePosition = p2.gamePosition;
    p2.gamePosition = tempPos;

    await this.efootballProfilesRepository.save([p1, p2]);

    return this.findOne(clubId, teamId);
  }

  async addTeamPlayer(
    clubId: string,
    teamId: string,
    dto: AddTeamPlayerDto,
  ) {
    const team = await this.findOne(clubId, teamId);

    if ((team.members || []).length >= 16) {
      throw new BadRequestException(
        'Team roster is full (maximum 16 players: 11 starters + 5 substitutes). You must remove a player before adding a new one.',
      );
    }

    const profile = await this.efootballProfilesRepository.findOne({
      where: { id: dto.profileId, clubId },
      relations: { user: true },
    });

    if (!profile) {
      throw new BadRequestException('Player does not belong to this club');
    }

    if (profile.teamId && profile.teamId !== teamId) {
      throw new BadRequestException(
        `Player ${profile.user?.name ?? profile.id} is already assigned to another team in this club. Free players only can be added.`,
      );
    }

    profile.teamId = teamId;
    profile.lineupStatus = dto.lineupStatus ?? LineupStatus.SUB;
    profile.gamePosition = dto.gamePosition ?? null;

    await this.efootballProfilesRepository.save(profile);

    return this.findOne(clubId, teamId);
  }

  async removeTeamPlayer(
    clubId: string,
    teamId: string,
    profileId: string,
  ) {
    await this.findOne(clubId, teamId);

    const profile = await this.efootballProfilesRepository.findOne({
      where: { id: profileId, teamId, clubId },
      relations: { user: true },
    });

    if (!profile) {
      throw new BadRequestException('Player not found on this team');
    }

    profile.teamId = null;
    profile.lineupStatus = LineupStatus.NONE;
    profile.gamePosition = null;

    await this.efootballProfilesRepository.save(profile);

    return this.findOne(clubId, teamId);
  }

  async applyFormation(
    clubId: string,
    teamId: string,
    dto: ApplyFormationDto,
  ) {
    const team = await this.findOne(clubId, teamId);
    const starters = (team.members || []).filter((m) => m.lineupStatus === LineupStatus.STARTER);

    if (starters.length < 11) {
      throw new BadRequestException(
        `Cannot apply tactical formation: Team has only ${starters.length} starters. Exactly 11 starters are required.`,
      );
    }

    const templatePositions = FORMATION_SLOT_MAP[dto.formation];
    if (!templatePositions) {
      throw new BadRequestException(`Unsupported formation: ${dto.formation}`);
    }

    // Map the 11 starters to the 11 tactical formation positions
    const remainingStarters = [...starters];
    const assigned: EfootballProfile[] = [];

    // First, place GK
    const gkIdx = remainingStarters.findIndex(
      (p) => normalizePosition(p.gamePosition) === EfootballPosition.GK,
    );
    if (gkIdx !== -1) {
      const [gk] = remainingStarters.splice(gkIdx, 1);
      gk.gamePosition = EfootballPosition.GK;
      assigned.push(gk);
    } else {
      const gk = remainingStarters.shift()!;
      gk.gamePosition = EfootballPosition.GK;
      assigned.push(gk);
    }

    // Now assign the 10 outfield positions from template
    const outfieldSlots = templatePositions.slice(1);
    for (const slotPos of outfieldSlots) {
      const matchIdx = remainingStarters.findIndex((p) => {
        const pNorm = normalizePosition(p.gamePosition);
        if (!pNorm) return false;
        return (
          pNorm === slotPos ||
          (COMPATIBLE_POSITIONS[pNorm] && COMPATIBLE_POSITIONS[pNorm].includes(slotPos))
        );
      });

      if (matchIdx !== -1) {
        const [p] = remainingStarters.splice(matchIdx, 1);
        p.gamePosition = slotPos;
        assigned.push(p);
      } else {
        const p = remainingStarters.shift()!;
        p.gamePosition = slotPos;
        assigned.push(p);
      }
    }

    await this.efootballProfilesRepository.save(assigned);

    team.formation = dto.formation;
    await this.teamsRepository.save(team);

    return this.findOne(clubId, teamId);
  }
}
