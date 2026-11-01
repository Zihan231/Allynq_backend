import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminModule } from '../admin/admin.module.js';
import { HealthModule } from '../health/health.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { TransfersModule } from '../transfers/transfers.module.js';
import { CoachingJobsService } from './coaching-jobs.service.js';
import { AdminCoachingController, CoachingController } from './coaching.controller.js';
import { CoachingService } from './coaching.service.js';
import { CoachPost } from './entities/coach-post.entity.js';
import { CoachProfile } from './entities/coach-profile.entity.js';
import { CoachingDeal } from './entities/coaching-deal.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([CoachProfile, CoachPost, CoachingDeal]), TransfersModule, NotificationsModule, AdminModule, HealthModule],
  controllers: [CoachingController, AdminCoachingController],
  providers: [CoachingService, CoachingJobsService],
  exports: [CoachingService],
})
export class CoachingModule {}
