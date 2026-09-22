import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Club } from '../clubs/entities/club.entity.js';
import { Community } from '../communities/entities/community.entity.js';
import { CommunityMember } from '../communities/entities/community-member.entity.js';
import { EfootballProfile } from '../users/entities/efootball-profile.entity.js';
import { User } from '../users/entities/user.entity.js';
import { Tournament } from './entities/tournament.entity.js';
import { TournamentParticipant } from './entities/tournament-participant.entity.js';
import { TournamentsController } from './tournaments.controller.js';
import { TournamentsService } from './tournaments.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Tournament,
      TournamentParticipant,
      Community,
      CommunityMember,
      Club,
      EfootballProfile,
      User,
    ]),
  ],
  controllers: [TournamentsController],
  providers: [TournamentsService],
  exports: [TournamentsService],
})
export class TournamentsModule {}
