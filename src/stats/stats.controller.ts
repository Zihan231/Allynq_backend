import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ClubRankingsQueryDto, PlayerRankingsQueryDto } from './dto/stats-query.dto.js';
import { StatsService } from './stats.service.js';

/** Public player and club statistics, computed from confirmed results. */
@Controller('stats')
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get('players')
  playerRankings(@Query() query: PlayerRankingsQueryDto) {
    return this.statsService.playerRankings(query);
  }

  @Get('players/:userId')
  playerProfile(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.statsService.playerProfile(userId);
  }

  @Get('clubs')
  clubRankings(@Query() query: ClubRankingsQueryDto) {
    return this.statsService.clubRankings(query);
  }

  @Get('clubs/:clubId')
  clubProfile(@Param('clubId', ParseUUIDPipe) clubId: string) {
    return this.statsService.clubProfile(clubId);
  }
}
