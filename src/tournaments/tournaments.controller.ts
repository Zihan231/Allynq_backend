import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard.js';
import { User } from '../users/entities/user.entity.js';
import { CreateTournamentDto } from './dto/create-tournament.dto.js';
import { JoinTournamentDto } from './dto/join-tournament.dto.js';
import { SubmitLineupDto } from './dto/submit-lineup.dto.js';
import { TournamentQueryDto } from './dto/tournament-query.dto.js';
import { UpdateTournamentDto } from './dto/update-tournament.dto.js';
import { TournamentMatchesService } from './tournament-matches.service.js';
import { TournamentsService } from './tournaments.service.js';

@Controller('tournaments')
export class TournamentsController {
  constructor(
    private readonly tournamentsService: TournamentsService,
    private readonly matchesService: TournamentMatchesService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@CurrentUser() user: User, @Body() dto: CreateTournamentDto) {
    return this.tournamentsService.create(user.id, dto);
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Get()
  findAll(@Query() query: TournamentQueryDto, @CurrentUser() user: User | null) {
    return this.tournamentsService.findAll(query, user?.id ?? null);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.tournamentsService.findOne(id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  update(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTournamentDto,
  ) {
    return this.tournamentsService.update(user.id, id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  remove(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.tournamentsService.remove(user.id, id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/join')
  join(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: JoinTournamentDto,
  ) {
    return this.tournamentsService.join(user.id, id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/participants/:participantId/lineup')
  submitLineup(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('participantId', ParseUUIDPipe) participantId: string,
    @Body() dto: SubmitLineupDto,
  ) {
    return this.tournamentsService.submitLineup(user.id, id, participantId, dto);
  }

  /** Creates the fixtures: knockout (≤ 8 entrants) or groups + knockout. */
  @UseGuards(JwtAuthGuard)
  @Post(':id/generate-bracket')
  generateBracket(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.matchesService.generateStructure(user.id, id);
  }

  @Get(':id/structure')
  getStructure(@Param('id', ParseUUIDPipe) id: string) {
    return this.matchesService.getStructure(id);
  }
}
