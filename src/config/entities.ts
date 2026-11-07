import { ActivityEvent } from '../activity/entities/activity-event.entity.js';
import { LoginEvent } from '../activity/entities/login-event.entity.js';
import { AccountLabel } from '../admin/entities/account-label.entity.js';
import { AccountStaffNote } from '../admin/entities/account-staff-note.entity.js';
import { AdminAuditLog } from '../admin/entities/admin-audit-log.entity.js';
import { Announcement } from '../admin/entities/announcement.entity.js';
import { PlatformBackup } from '../admin/entities/platform-backup.entity.js';
import { SeasonStanding } from '../admin/entities/season-standing.entity.js';
import { Season } from '../admin/entities/season.entity.js';
import { StoreItem } from '../admin/entities/store-item.entity.js';
import { ClubJoinRequest } from '../clubs/entities/club-join-request.entity.js';
import { Club } from '../clubs/entities/club.entity.js';
import { Team } from '../clubs/entities/team.entity.js';
import { CoachPost } from '../coaching/entities/coach-post.entity.js';
import { CoachProfile } from '../coaching/entities/coach-profile.entity.js';
import { CoachingDeal } from '../coaching/entities/coaching-deal.entity.js';
import { CoachFollow, CoachPostComment, CoachPostLike, CoachPostSave, CoachPostView } from '../coaching/entities/feed.entities.js';
import { CommunityJoinRequest } from '../communities/entities/community-join-request.entity.js';
import { CommunityMember } from '../communities/entities/community-member.entity.js';
import { Community } from '../communities/entities/community.entity.js';
import { NotificationTemplate } from '../notifications/entities/notification-template.entity.js';
import { Notification } from '../notifications/entities/notification.entity.js';
import { RecycleBinItem } from '../recycle-bin/recycle-bin-item.entity.js';
import { ReportMessage } from '../reports/entities/report-message.entity.js';
import { Report } from '../reports/entities/report.entity.js';
import { SecurityBan } from '../security/security-ban.entity.js';
import { AppSetting } from '../settings/app-setting.entity.js';
import { SponsorCall, SponsorImpression, SponsorProfile, Sponsorship } from '../sponsors/entities/sponsor.entities.js';
import { TournamentGameSubmission } from '../tournaments/entities/tournament-game-submission.entity.js';
import { TournamentGameTimeRequest } from '../tournaments/entities/tournament-game-time-request.entity.js';
import { TournamentMatchGame } from '../tournaments/entities/tournament-match-game.entity.js';
import { TournamentMatch } from '../tournaments/entities/tournament-match.entity.js';
import { TournamentParticipant } from '../tournaments/entities/tournament-participant.entity.js';
import { Tournament } from '../tournaments/entities/tournament.entity.js';
import { ContractCounter } from '../transfers/entities/contract-counter.entity.js';
import { PlayerContract } from '../transfers/entities/player-contract.entity.js';
import { PlayerLoanBid } from '../transfers/entities/player-loan-bid.entity.js';
import { PlayerLoan } from '../transfers/entities/player-loan.entity.js';
import { TransferOfferBid } from '../transfers/entities/transfer-offer-bid.entity.js';
import { TransferOffer } from '../transfers/entities/transfer-offer.entity.js';
import { WalletTransaction } from '../transfers/entities/wallet-transaction.entity.js';
import { Wallet } from '../transfers/entities/wallet.entity.js';
import { EfootballProfile } from '../users/entities/efootball-profile.entity.js';
import { User } from '../users/entities/user.entity.js';

/**
 * Every entity the database knows about. The app, the TypeORM CLI (migrations) and the seed scripts all use this
 * one list, so they can't drift apart (the CLI used to lack the coaching, sponsor and feed entities).
 */
export const ALL_ENTITIES = [
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
  TransferOfferBid,
  PlayerLoan,
  PlayerLoanBid,
  PlayerContract,
  ContractCounter,
  Wallet,
  WalletTransaction,
  ActivityEvent,
  LoginEvent,
  AdminAuditLog,
  RecycleBinItem,
  Report,
  ReportMessage,
  Announcement,
  SeasonStanding,
  AccountLabel,
  AccountStaffNote,
  NotificationTemplate,
  PlatformBackup,
  Season,
  StoreItem,
  SecurityBan,
  CoachProfile,
  CoachPost,
  CoachingDeal,
  CoachPostLike,
  CoachPostSave,
  CoachPostView,
  CoachFollow,
  CoachPostComment,
  SponsorProfile,
  Sponsorship,
  SponsorCall,
  SponsorImpression,
];
