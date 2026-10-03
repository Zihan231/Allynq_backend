import { ConfigService } from '@nestjs/config';
import type { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { ClubJoinRequest } from '../clubs/entities/club-join-request.entity.js';
import { Club } from '../clubs/entities/club.entity.js';
import { Team } from '../clubs/entities/team.entity.js';
import { CommunityJoinRequest } from '../communities/entities/community-join-request.entity.js';
import { CommunityMember } from '../communities/entities/community-member.entity.js';
import { Community } from '../communities/entities/community.entity.js';
import { Notification } from '../notifications/entities/notification.entity.js';
import { TournamentGameTimeRequest } from '../tournaments/entities/tournament-game-time-request.entity.js';
import { TournamentGameSubmission } from '../tournaments/entities/tournament-game-submission.entity.js';
import { TournamentMatchGame } from '../tournaments/entities/tournament-match-game.entity.js';
import { TournamentMatch } from '../tournaments/entities/tournament-match.entity.js';
import { TournamentParticipant } from '../tournaments/entities/tournament-participant.entity.js';
import { Tournament } from '../tournaments/entities/tournament.entity.js';
import { EfootballProfile } from '../users/entities/efootball-profile.entity.js';
import { User } from '../users/entities/user.entity.js';
import { AppSetting } from '../settings/app-setting.entity.js';
import { PlayerContract } from '../transfers/entities/player-contract.entity.js';
import { TransferOffer } from '../transfers/entities/transfer-offer.entity.js';
import { WalletTransaction } from '../transfers/entities/wallet-transaction.entity.js';
import { Wallet } from '../transfers/entities/wallet.entity.js';

export function buildTypeOrmOptions(configService: ConfigService): TypeOrmModuleOptions {
  return {
    type: 'postgres',
    url: configService.getOrThrow<string>('DATABASE_URL'),
    ssl: { rejectUnauthorized: false },
    entities: [
      User,
      EfootballProfile,
      Club,
      Team,
      ClubJoinRequest,
      Community,
      CommunityMember,
      CommunityJoinRequest,
      Notification,
      Tournament,
      TournamentParticipant,
      TournamentMatch,
      TournamentMatchGame,
      TournamentGameSubmission,
      TournamentGameTimeRequest,
      AppSetting,
      TransferOffer,
      PlayerContract,
      Wallet,
      WalletTransaction,
    ],
    migrations: ['dist/migrations/*.js'],
    synchronize: false,
    logging: ['error', 'warn'],
  };
}
