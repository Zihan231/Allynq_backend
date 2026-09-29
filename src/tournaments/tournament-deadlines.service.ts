import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TournamentResultsService } from './tournament-results.service.js';
import { TournamentScheduleService } from './tournament-schedule.service.js';

/**
 * Runs every minute: lapses unanswered time-change requests once a match
 * starts, and decides games whose evidence window closed (walkover / double
 * forfeit). Each step is idempotent, and overlapping runs are skipped.
 */
@Injectable()
export class TournamentDeadlinesService {
  private readonly logger = new Logger(TournamentDeadlinesService.name);
  private running = false;

  constructor(
    private readonly scheduleService: TournamentScheduleService,
    private readonly resultsService: TournamentResultsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = new Date();
      const expiredRequests = await this.scheduleService.expireStaleRequests(now);
      const resolvedGames = await this.resultsService.resolveExpiredGames(now);
      if (expiredRequests || resolvedGames) {
        this.logger.log(`Expired ${expiredRequests} time request(s), resolved ${resolvedGames} game(s)`);
      }
    } catch (err) {
      this.logger.error('Tournament deadline job failed', err instanceof Error ? err.stack : err);
    } finally {
      this.running = false;
    }
  }
}
