import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommunitiesModule } from '../communities/communities.module.js';
import { EfootballProfile } from '../users/entities/efootball-profile.entity.js';
import { ClubsController } from './clubs.controller.js';
import { ClubsService } from './clubs.service.js';
import { Club } from './entities/club.entity.js';
import { Team } from './entities/team.entity.js';
import { ClubRoleGuard } from './guards/club-role.guard.js';
import { TeamsController } from './teams.controller.js';
import { TeamsService } from './teams.service.js';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    TypeOrmModule.forFeature([Club, Team, EfootballProfile]),
    CommunitiesModule,
  ],
  controllers: [ClubsController, TeamsController],
  providers: [ClubsService, TeamsService, ClubRoleGuard],
  exports: [ClubsService, TeamsService],
})
export class ClubsModule {}
