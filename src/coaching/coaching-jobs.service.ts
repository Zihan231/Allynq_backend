import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { JobMonitorService } from '../health/job-monitor.service.js';
import { CoachingService } from './coaching.service.js';

/** Every minute: expire unanswered coaching deals, finish ones that ran their days, start lined-up ones. */
@Injectable()
export class CoachingJobsService {
  private readonly logger = new Logger(CoachingJobsService.name);
  private running = false;

  constructor(
    private readonly coaching: CoachingService,
    private readonly monitor: JobMonitorService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const r = await this.monitor.run('coaching.tick', () => this.coaching.tick(), (x) =>
        `${x.expired} expired, ${x.completed} completed, ${x.started} started`,
      );
      if (r.expired || r.completed || r.started) {
        this.logger.log(`Coaching: expired ${r.expired}, completed ${r.completed}, started ${r.started}`);
      }
    } catch (err) {
      this.logger.error(`Coaching job failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
