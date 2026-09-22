import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { User } from '../users/entities/user.entity.js';
import { CreateTournamentDto } from './dto/create-tournament.dto.js';
import { JoinTournamentDto } from './dto/join-tournament.dto.js';
import { SubmitLineupDto } from './dto/submit-lineup.dto.js';
import { TournamentQueryDto } from './dto/tournament-query.dto.js';
import { TournamentsService } from './tournaments.service.js';

@Controller('tournaments')
export class TournamentsController {
  constructor(private readonly tournamentsService: TournamentsService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@CurrentUser() user: User, @Body() dto: CreateTournamentDto) {
    return this.tournamentsService.create(user.id, dto);
  }

  @Get()
  findAll(@Query() query: TournamentQueryDto) {
    return this.tournamentsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.tournamentsService.findOne(id);
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

  @UseGuards(JwtAuthGuard)
  @Post(':id/generate-bracket')
  generateBracket(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tournamentsService.generateBracket(user.id, id);
  }
}
