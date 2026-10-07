import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivityInterceptor } from './activity.interceptor.js';
import { ActivityService } from './activity.service.js';
import { ActivityEvent } from './entities/activity-event.entity.js';
import { LoginEvent } from './entities/login-event.entity.js';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([ActivityEvent, LoginEvent])],
  providers: [ActivityService, { provide: APP_INTERCEPTOR, useClass: ActivityInterceptor }],
  exports: [ActivityService],
})
export class ActivityModule {}
