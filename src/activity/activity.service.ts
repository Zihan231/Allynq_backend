import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ActivityEvent } from './entities/activity-event.entity.js';
import { LoginEvent } from './entities/login-event.entity.js';

export interface ActivityInput {
  type: string;
  summary: string;
  targetType?: string | null;
  targetId?: string | null;
  meta?: Record<string, unknown> | null;
  ip?: string | null;
}

export interface LoginInput {
  userId: string | null;
  email: string;
  success: boolean;
  failureReason?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  deviceHash?: string | null;
  deviceHint?: string | null;
}

/**
 * Writes the activity timeline and login history. Logging never fails the action that
 * triggered it: errors are only written to the server log.
 */
@Injectable()
export class ActivityService {
  private readonly logger = new Logger(ActivityService.name);

  constructor(
    @InjectRepository(ActivityEvent)
    private readonly events: Repository<ActivityEvent>,
    @InjectRepository(LoginEvent)
    private readonly logins: Repository<LoginEvent>,
  ) {}

  async log(userId: string | null, input: ActivityInput): Promise<void> {
    try {
      await this.events.save(
        this.events.create({
          userId,
          type: input.type,
          summary: input.summary,
          targetType: input.targetType ?? null,
          targetId: input.targetId ?? null,
          meta: input.meta ?? null,
          ip: input.ip ?? null,
        }),
      );
    } catch (error) {
      this.logger.warn(
        `Activity not logged (${input.type}): ${(error as Error).message}`,
      );
    }
  }

  async logLogin(input: LoginInput): Promise<void> {
    try {
      await this.logins.insert({
        userId: input.userId,
        email: input.email.slice(0, 255),
        success: input.success,
        failureReason: input.failureReason ?? null,
        ip: input.ip?.slice(0, 64) ?? null,
        userAgent: input.userAgent ?? null,
        deviceHash: input.deviceHash ?? null,
        deviceHint: input.deviceHint?.slice(0, 128) ?? null,
      });
    } catch (error) {
      this.logger.warn(`Login not logged: ${(error as Error).message}`);
    }
  }
}
