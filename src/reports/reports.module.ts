import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminModule } from '../admin/admin.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { User } from '../users/entities/user.entity.js';
import { ReportMessage } from './entities/report-message.entity.js';
import { Report } from './entities/report.entity.js';
import { AdminReportsController, ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Report, ReportMessage, User]), NotificationsModule, AdminModule],
  controllers: [ReportsController, AdminReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
