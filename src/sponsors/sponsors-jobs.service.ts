import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { JobMonitorService } from '../health/job-monitor.service.js';
import { SponsorsService } from './sponsors.service.js';

/** Every minute: expire unanswered sponsorship requests, finish ones whose time or tournament is over. */
@Injectable()
export class SponsorsJobsService {
  private readonly logger = new Logger(SponsorsJobsService.name);
  private running = false;

  constructor(
    private readonly sponsors: SponsorsService,
    private readonly monitor: JobMonitorService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const r = await this.monitor.run('sponsors.tick', () => this.sponsors.tick(), (x) => `${x.expired} expired, ${x.completed} completed`);
      if (r.expired || r.completed) this.logger.log(`Sponsorships: expired ${r.expired}, completed ${r.completed}`);
    } catch (err) {
      this.logger.error(`Sponsorship job failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
