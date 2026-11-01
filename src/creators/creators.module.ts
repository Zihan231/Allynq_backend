import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { AdminCreatorsController, CreatorsController } from './creators.controller.js';
import { CreatorsService } from './creators.service.js';

/** The creator marketplace: designs submitted by creators, reviewed by staff, sold in the store. */
@Module({
  imports: [NotificationsModule, AdminModule],
  controllers: [CreatorsController, AdminCreatorsController],
  providers: [CreatorsService],
  exports: [CreatorsService],
})
export class CreatorsModule {}
