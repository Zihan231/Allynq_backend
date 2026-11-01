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
import { CoachFollow, CoachPostComment, CoachPostLike, CoachPostSave, CoachPostView } from './entities/feed.entities.js';
import { FeedController } from './feed.controller.js';
import { FeedService } from './feed.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([CoachProfile, CoachPost, CoachingDeal, CoachPostLike, CoachPostSave, CoachPostView, CoachFollow, CoachPostComment]), TransfersModule, NotificationsModule, AdminModule, HealthModule],
  controllers: [CoachingController, AdminCoachingController, FeedController],
  providers: [CoachingService, CoachingJobsService, FeedService],
  exports: [CoachingService],
})
export class CoachingModule {}
