import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Club } from '../clubs/entities/club.entity.js';
import { Community } from '../communities/entities/community.entity.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { CommunityMember } from '../communities/entities/community-member.entity.js';
import { EfootballProfile } from '../users/entities/efootball-profile.entity.js';
import { User } from '../users/entities/user.entity.js';
import { Tournament } from './entities/tournament.entity.js';
import { TournamentGameSubmission } from './entities/tournament-game-submission.entity.js';
import { TournamentMatchGame } from './entities/tournament-match-game.entity.js';
import { TournamentMatch } from './entities/tournament-match.entity.js';
import { TournamentParticipant } from './entities/tournament-participant.entity.js';
import { TournamentMatchesService } from './tournament-matches.service.js';
import { TournamentResultsService } from './tournament-results.service.js';
import { TournamentsController } from './tournaments.controller.js';
import { TournamentsService } from './tournaments.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Tournament,
      TournamentParticipant,
      TournamentMatch,
      TournamentMatchGame,
      TournamentGameSubmission,
      Community,
      CommunityMember,
      Club,
      EfootballProfile,
      User,
    ]),
    NotificationsModule,
  ],
  controllers: [TournamentsController],
  providers: [TournamentsService, TournamentMatchesService, TournamentResultsService],
  exports: [TournamentsService],
})
export class TournamentsModule {}
