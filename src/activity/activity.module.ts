import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivityService } from './activity.service.js';
import { ActivityEvent } from './entities/activity-event.entity.js';
import { LoginEvent } from './entities/login-event.entity.js';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([ActivityEvent, LoginEvent])],
  providers: [ActivityService],
  exports: [ActivityService],
})
export class ActivityModule {}
