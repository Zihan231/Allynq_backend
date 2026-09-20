import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommunitiesModule } from '../communities/communities.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { EfootballProfile } from '../users/entities/efootball-profile.entity.js';
import { ClubsController } from './clubs.controller.js';
import { ClubsService } from './clubs.service.js';
import { ClubJoinRequest } from './entities/club-join-request.entity.js';
import { Club } from './entities/club.entity.js';
import { Team } from './entities/team.entity.js';
import { ClubRoleGuard } from './guards/club-role.guard.js';
import { TeamsController } from './teams.controller.js';
import { TeamsService } from './teams.service.js';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    TypeOrmModule.forFeature([Club, Team, EfootballProfile, ClubJoinRequest]),
    CommunitiesModule,
    NotificationsModule,
  ],
  controllers: [ClubsController, TeamsController],
  providers: [ClubsService, TeamsService, ClubRoleGuard],
  exports: [ClubsService, TeamsService],
})
export class ClubsModule {}
