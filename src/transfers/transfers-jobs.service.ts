import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { JobMonitorService } from '../health/job-monitor.service.js';
import { LoansService } from './loans.service.js';
import { TransfersService } from './transfers.service.js';

/**
 * Every minute: expire 3-day-old offers (refunding holds), finish scheduled transfers,
 * send lock reminders; and for loans: expire proposals, start waiting loans, bring players back.
 */
@Injectable()
export class TransfersJobsService {
  private readonly logger = new Logger(TransfersJobsService.name);
  private running = false;

  constructor(
    private readonly transfersService: TransfersService,
    private readonly loansService: LoansService,
    private readonly monitor: JobMonitorService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const { expired, completed, reminders } = await this.monitor.run('transfers.tick', () => this.transfersService.tick(), (r) =>
        `${r.expired} expired, ${r.completed} completed, ${r.reminders} reminders`,
      );
      if (expired || completed || reminders) {
        this.logger.log(`Expired ${expired} offer(s), completed ${completed} scheduled transfer(s), sent ${reminders} reminder(s)`);
      }
      const loans = await this.monitor.run('loans.tick', () => this.loansService.tick(), (r) =>
        `${r.expired} expired, ${r.started} started, ${r.returned} returned`,
      );
      if (loans.expired || loans.started || loans.returned) {
        this.logger.log(`Loans: expired ${loans.expired}, started ${loans.started}, returned ${loans.returned}`);
      }
    } catch (err) {
      this.logger.error(`Transfer job failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
