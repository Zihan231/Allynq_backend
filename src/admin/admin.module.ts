import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommunitiesModule } from '../communities/communities.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { TournamentsModule } from '../tournaments/tournaments.module.js';
import { User } from '../users/entities/user.entity.js';
import { AdminActivityService } from './admin-activity.service.js';
import { AdminContentService } from './admin-content.service.js';
import { AdminDashboardService } from './admin-dashboard.service.js';
import { AdminDisputesService } from './admin-disputes.service.js';
import { AdminManageService } from './admin-manage.service.js';
import { AdminUsersService } from './admin-users.service.js';
import { AdminController } from './admin.controller.js';
import { AuditService } from './audit.service.js';
import { AdminAuditLog } from './entities/admin-audit-log.entity.js';
import { SystemRoleGuard } from './system-role.guard.js';
import { TransfersModule } from '../transfers/transfers.module.js';
import { AdminPlatformService } from './admin-platform.service.js';
import { Announcement } from './entities/announcement.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([User, AdminAuditLog, Announcement]), NotificationsModule, TournamentsModule, CommunitiesModule, TransfersModule],
  controllers: [AdminController],
  providers: [AdminActivityService, AdminDashboardService, AdminDisputesService, AdminManageService, AdminPlatformService, AdminUsersService, AdminContentService, AuditService, SystemRoleGuard],
  exports: [AuditService, AdminUsersService, AdminContentService],
})
export class AdminModule {}
