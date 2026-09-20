import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Club } from '../clubs/entities/club.entity.js';
import { EfootballProfile } from '../users/entities/efootball-profile.entity.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { CommunitiesController } from './communities.controller.js';
import { CommunitiesService } from './communities.service.js';
import { CommunityJoinRequest } from './entities/community-join-request.entity.js';
import { CommunityMember } from './entities/community-member.entity.js';
import { Community } from './entities/community.entity.js';
import { CommunityRoleGuard } from './guards/community-role.guard.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Community,
      CommunityMember,
      CommunityJoinRequest,
      Club,
      EfootballProfile,
    ]),
    NotificationsModule,
  ],
  controllers: [CommunitiesController],
  providers: [CommunitiesService, CommunityRoleGuard],
  exports: [CommunitiesService],
})
export class CommunitiesModule {}
