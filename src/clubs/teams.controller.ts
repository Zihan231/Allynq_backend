import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { ClubRole } from '../users/enums/user-attributes.enum.js';
import { RequireClubRoles } from './decorators/require-club-roles.decorator.js';
import { CreateTeamDto } from './dto/create-team.dto.js';
import { SetLineupDto } from './dto/set-lineup.dto.js';
import { SubstitutePlayerDto } from './dto/substitute-player.dto.js';
import { UpdateTeamDto } from './dto/update-team.dto.js';
import { ShiftPositionDto } from './dto/shift-position.dto.js';
import { SwapPositionsDto } from './dto/swap-positions.dto.js';
import { AddTeamPlayerDto } from './dto/add-team-player.dto.js';
import { ApplyFormationDto } from './dto/apply-formation.dto.js';
import { ClubRoleGuard } from './guards/club-role.guard.js';
import { TeamsService } from './teams.service.js';

@Controller('clubs/:id/teams')
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @UseGuards(JwtAuthGuard, ClubRoleGuard)
  @RequireClubRoles(ClubRole.MANAGER, ClubRole.PRESIDENT)
  @Post()
  create(
    @Param('id', ParseUUIDPipe) clubId: string,
    @Body() dto: CreateTeamDto,
  ) {
    return this.teamsService.create(clubId, dto);
  }

  @Get('free-players')
  getFreeClubPlayers(@Param('id', ParseUUIDPipe) clubId: string) {
    return this.teamsService.getFreeClubPlayers(clubId);
  }

  @Get()
  findAll(@Param('id', ParseUUIDPipe) clubId: string) {
    return this.teamsService.findAll(clubId);
  }

  @Get(':teamId')
  findOne(
    @Param('id', ParseUUIDPipe) clubId: string,
    @Param('teamId', ParseUUIDPipe) teamId: string,
  ) {
    return this.teamsService.findOne(clubId, teamId);
  }

  @UseGuards(JwtAuthGuard, ClubRoleGuard)
  @RequireClubRoles(ClubRole.MANAGER, ClubRole.PRESIDENT)
  @Patch(':teamId')
  update(
    @Param('id', ParseUUIDPipe) clubId: string,
    @Param('teamId', ParseUUIDPipe) teamId: string,
    @Body() dto: UpdateTeamDto,
  ) {
    return this.teamsService.update(clubId, teamId, dto);
  }

  @UseGuards(JwtAuthGuard, ClubRoleGuard)
  @RequireClubRoles(ClubRole.MANAGER, ClubRole.PRESIDENT)
  @Delete(':teamId')
  remove(
    @Param('id', ParseUUIDPipe) clubId: string,
    @Param('teamId', ParseUUIDPipe) teamId: string,
  ) {
    return this.teamsService.remove(clubId, teamId);
  }

  @UseGuards(JwtAuthGuard, ClubRoleGuard)
  @RequireClubRoles(ClubRole.MANAGER, ClubRole.PRESIDENT)
  @Put(':teamId/lineup')
  setLineup(
    @Param('id', ParseUUIDPipe) clubId: string,
    @Param('teamId', ParseUUIDPipe) teamId: string,
    @Body() dto: SetLineupDto,
  ) {
    return this.teamsService.setLineup(clubId, teamId, dto);
  }

  @UseGuards(JwtAuthGuard, ClubRoleGuard)
  @RequireClubRoles(ClubRole.MANAGER, ClubRole.PRESIDENT)
  @Post(':teamId/substitute')
  substitute(
    @Param('id', ParseUUIDPipe) clubId: string,
    @Param('teamId', ParseUUIDPipe) teamId: string,
    @Body() dto: SubstitutePlayerDto,
  ) {
    return this.teamsService.substitute(clubId, teamId, dto);
  }

  @UseGuards(JwtAuthGuard, ClubRoleGuard)
  @RequireClubRoles(ClubRole.MANAGER, ClubRole.PRESIDENT)
  @Patch(':teamId/players/:profileId/position')
  shiftPosition(
    @Param('id', ParseUUIDPipe) clubId: string,
    @Param('teamId', ParseUUIDPipe) teamId: string,
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @Body() dto: ShiftPositionDto,
  ) {
    return this.teamsService.shiftPlayerPosition(clubId, teamId, profileId, dto);
  }

  @UseGuards(JwtAuthGuard, ClubRoleGuard)
  @RequireClubRoles(ClubRole.MANAGER, ClubRole.PRESIDENT)
  @Post(':teamId/swap-positions')
  swapPositions(
    @Param('id', ParseUUIDPipe) clubId: string,
    @Param('teamId', ParseUUIDPipe) teamId: string,
    @Body() dto: SwapPositionsDto,
  ) {
    return this.teamsService.swapPlayerPositions(clubId, teamId, dto);
  }

  @UseGuards(JwtAuthGuard, ClubRoleGuard)
  @RequireClubRoles(ClubRole.MANAGER, ClubRole.PRESIDENT)
  @Post(':teamId/players')
  addTeamPlayer(
    @Param('id', ParseUUIDPipe) clubId: string,
    @Param('teamId', ParseUUIDPipe) teamId: string,
    @Body() dto: AddTeamPlayerDto,
  ) {
    return this.teamsService.addTeamPlayer(clubId, teamId, dto);
  }

  @UseGuards(JwtAuthGuard, ClubRoleGuard)
  @RequireClubRoles(ClubRole.MANAGER, ClubRole.PRESIDENT)
  @Delete(':teamId/players/:profileId')
  removeTeamPlayer(
    @Param('id', ParseUUIDPipe) clubId: string,
    @Param('teamId', ParseUUIDPipe) teamId: string,
    @Param('profileId', ParseUUIDPipe) profileId: string,
  ) {
    return this.teamsService.removeTeamPlayer(clubId, teamId, profileId);
  }

  @UseGuards(JwtAuthGuard, ClubRoleGuard)
  @RequireClubRoles(ClubRole.MANAGER, ClubRole.PRESIDENT)
  @Post(':teamId/formation')
  applyFormation(
    @Param('id', ParseUUIDPipe) clubId: string,
    @Param('teamId', ParseUUIDPipe) teamId: string,
    @Body() dto: ApplyFormationDto,
  ) {
    return this.teamsService.applyFormation(clubId, teamId, dto);
  }
}
