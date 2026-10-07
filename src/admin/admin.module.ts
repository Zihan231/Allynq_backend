import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { User } from '../users/entities/user.entity.js';
import { AdminContentService } from './admin-content.service.js';
import { AdminDashboardService } from './admin-dashboard.service.js';
import { AdminUsersService } from './admin-users.service.js';
import { AdminController } from './admin.controller.js';
import { AuditService } from './audit.service.js';
import { AdminAuditLog } from './entities/admin-audit-log.entity.js';
import { SystemRoleGuard } from './system-role.guard.js';

@Module({
  imports: [TypeOrmModule.forFeature([User, AdminAuditLog]), NotificationsModule],
  controllers: [AdminController],
  providers: [AdminDashboardService, AdminUsersService, AdminContentService, AuditService, SystemRoleGuard],
  exports: [AuditService],
})
export class AdminModule {}
