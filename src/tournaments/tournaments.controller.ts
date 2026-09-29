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
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard.js';
import { User } from '../users/entities/user.entity.js';
import { CreateTournamentDto } from './dto/create-tournament.dto.js';
import { JoinTournamentDto } from './dto/join-tournament.dto.js';
import { SubmitLineupDto } from './dto/submit-lineup.dto.js';
import { TournamentQueryDto } from './dto/tournament-query.dto.js';
import { ReviewGameDto } from './dto/review-game.dto.js';
import { RequestTimeChangeDto, RespondTimeChangeDto } from './dto/time-request.dto.js';
import { TournamentScheduleService } from './tournament-schedule.service.js';
import { UpdateTournamentDto } from './dto/update-tournament.dto.js';
import { type EvidenceFiles, evidenceUploadOptions, MAX_SCREENSHOTS } from './evidence-upload.js';
import { type ReviewDecision, TournamentResultsService } from './tournament-results.service.js';
import { TournamentMatchesService } from './tournament-matches.service.js';
import { TournamentsService } from './tournaments.service.js';

@Controller('tournaments')
export class TournamentsController {
  constructor(
    private readonly tournamentsService: TournamentsService,
    private readonly matchesService: TournamentMatchesService,
    private readonly resultsService: TournamentResultsService,
    private readonly scheduleService: TournamentScheduleService,
  ) {}

  /** A player proposes a new start time (same date) for their game. */
  @UseGuards(JwtAuthGuard)
  @Post(':id/games/:gameId/time-request')
  requestTimeChange(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('gameId', ParseUUIDPipe) gameId: string,
    @Body() dto: RequestTimeChangeDto,
  ) {
    return this.scheduleService.requestTimeChange(user.id, id, gameId, dto.proposedStart);
  }

  /** The opponent accepts or declines a proposed time. */
  @UseGuards(JwtAuthGuard)
  @Post(':id/time-requests/:requestId/respond')
  respondTimeChange(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() dto: RespondTimeChangeDto,
  ) {
    return this.scheduleService.respondToTimeChange(user.id, id, requestId, dto.accept);
  }

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

  /** Multipart: goalsA, goalsB + screenshots (1–3 images) + video (1 file). */
  @UseGuards(JwtAuthGuard)
  @Post(':id/games/:gameId/submission')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'screenshots', maxCount: MAX_SCREENSHOTS },
        { name: 'video', maxCount: 1 },
      ],
      evidenceUploadOptions,
    ),
  )
  submitGameResult(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('gameId', ParseUUIDPipe) gameId: string,
    // Validated inside the service so rejected uploads are removed from disk.
    @Body() body: Record<string, unknown>,
    @UploadedFiles() files: EvidenceFiles,
  ) {
    return this.resultsService.submitGameResult(user.id, id, gameId, body, files ?? {});
  }

  /** Officials: games with evidence waiting for review. */
  @UseGuards(JwtAuthGuard)
  @Get(':id/review-queue')
  getReviewQueue(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.resultsService.getReviewQueue(user.id, id);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/games/:gameId/review')
  getGameForReview(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('gameId', ParseUUIDPipe) gameId: string,
  ) {
    return this.resultsService.getGameForReview(user.id, id, gameId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/games/:gameId/review')
  reviewGame(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('gameId', ParseUUIDPipe) gameId: string,
    @Body() decision: ReviewGameDto,
  ) {
    return this.resultsService.reviewGame(user.id, id, gameId, decision as ReviewDecision);
  }
}
