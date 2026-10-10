import 'dotenv/config';
import { DataSource } from 'typeorm';
import { ClubJoinRequest } from './src/clubs/entities/club-join-request.entity.js';
import { Club } from './src/clubs/entities/club.entity.js';
import { Team } from './src/clubs/entities/team.entity.js';
import { CommunityJoinRequest } from './src/communities/entities/community-join-request.entity.js';
import { CommunityMember } from './src/communities/entities/community-member.entity.js';
import { Community } from './src/communities/entities/community.entity.js';
import { Notification } from './src/notifications/entities/notification.entity.js';
import { TournamentGameTimeRequest } from './src/tournaments/entities/tournament-game-time-request.entity.js';
import { TournamentGameSubmission } from './src/tournaments/entities/tournament-game-submission.entity.js';
import { TournamentMatchGame } from './src/tournaments/entities/tournament-match-game.entity.js';
import { TournamentMatch } from './src/tournaments/entities/tournament-match.entity.js';
import { TournamentParticipant } from './src/tournaments/entities/tournament-participant.entity.js';
import { Tournament } from './src/tournaments/entities/tournament.entity.js';
import { EfootballProfile } from './src/users/entities/efootball-profile.entity.js';
import { User } from './src/users/entities/user.entity.js';
import { ActivityEvent } from './src/activity/entities/activity-event.entity.js';
import { LoginEvent } from './src/activity/entities/login-event.entity.js';
import { AccountLabel } from './src/admin/entities/account-label.entity.js';
import { AccountStaffNote } from './src/admin/entities/account-staff-note.entity.js';
import { AdminAuditLog } from './src/admin/entities/admin-audit-log.entity.js';
import { Announcement } from './src/admin/entities/announcement.entity.js';
import { PlatformBackup } from './src/admin/entities/platform-backup.entity.js';
import { Season } from './src/admin/entities/season.entity.js';
import { SeasonStanding } from './src/admin/entities/season-standing.entity.js';
import { StoreItem } from './src/admin/entities/store-item.entity.js';
import { NotificationTemplate } from './src/notifications/entities/notification-template.entity.js';
import { RecycleBinItem } from './src/recycle-bin/recycle-bin-item.entity.js';
import { Report } from './src/reports/entities/report.entity.js';
import { ReportMessage } from './src/reports/entities/report-message.entity.js';
import { SecurityBan } from './src/security/security-ban.entity.js';
import { AppSetting } from './src/settings/app-setting.entity.js';
import { PlayerContract } from './src/transfers/entities/player-contract.entity.js';
import { TransferOfferBid } from './src/transfers/entities/transfer-offer-bid.entity.js';
import { PlayerLoan } from './src/transfers/entities/player-loan.entity.js';
import { PlayerLoanBid } from './src/transfers/entities/player-loan-bid.entity.js';
import { TransferOffer } from './src/transfers/entities/transfer-offer.entity.js';
import { WalletTransaction } from './src/transfers/entities/wallet-transaction.entity.js';
import { Wallet } from './src/transfers/entities/wallet.entity.js';

export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
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
    ActivityEvent,
    LoginEvent,
    AdminAuditLog,
    Announcement,
    AccountLabel,
    AccountStaffNote,
    NotificationTemplate,
    PlatformBackup,
    Season,
    SeasonStanding,
    StoreItem,
    SecurityBan,
    RecycleBinItem,
    Report,
    ReportMessage,
    AppSetting,
    PlayerContract,
    TransferOffer,
    TransferOfferBid,
    PlayerLoan,
    PlayerLoanBid,
    Wallet,
    WalletTransaction,
  ],
  migrations: ['src/migrations/*.ts'],
  synchronize: false,
});
