import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
  StreamableFile,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { createReadStream } from 'node:fs';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import {
  BIN_ENTITY_TYPES,
  type BinEntityType,
} from '../recycle-bin/recycle-bin-item.entity.js';
import { User } from '../users/entities/user.entity.js';
import { SystemRole } from '../users/enums/user-attributes.enum.js';
import {
  ActivityFeedQueryDto,
  LoginFeedQueryDto,
} from '../reports/dto/report.dto.js';
import { AdminActivityService } from './admin-activity.service.js';
import { AdminContentService } from './admin-content.service.js';
import { AdminDashboardService } from './admin-dashboard.service.js';
import { AdminDisputesService } from './admin-disputes.service.js';
import { AdminManageService } from './admin-manage.service.js';
import {
  ClubCommunityDto,
  DecideGameDto,
  DisputeQueryDto,
  EditClubDto,
  EditCommunityDto,
  FreezeDto,
  RemoveParticipantDto,
  SetLeaderDto,
  TournamentOfficialsDto,
  TournamentStatusDto,
  TournamentTimesDto,
} from './dto/manage.dto.js';
import { AdminUsersService } from './admin-users.service.js';
import { AuditService } from './audit.service.js';
import {
  ActivityQueryDto,
  AdminUsersQueryDto,
  AuditQueryDto,
  BinQueryDto,
  BulkUsersDto,
  DashboardQueryDto,
  EditUserDto,
  EntityListQueryDto,
  OptionalReasonDto,
  ReasonDto,
  ResetPasswordDto,
  SetRoleDto,
  SuspendDto,
  VerificationQueryDto,
  VerificationReviewDto,
} from './dto/admin.dto.js';
import { RequireSystemRole, SystemRoleGuard } from './system-role.guard.js';
import { AdminPlatformService } from './admin-platform.service.js';
import {
  AdminOffersQueryDto,
  AdminSettingsDto,
  AnnouncementsQueryDto,
  CreateAnnouncementDto,
  EndLockDto,
  FeaturesDto,
  LedgerQueryDto,
  MaintenanceDto,
  TransferSettingsDto,
  WalletAdjustDto,
} from './dto/platform.dto.js';
import { cookieOptions, STAFF_COOKIE_NAME } from '../auth/auth-cookies.js';
import { JWT_COOKIE_NAME } from '../auth/auth.constants.js';
import {
  AccountLabelDto,
  BanLoginDeviceDto,
  CloseSeasonDto,
  CreateSeasonDto,
  CreateSecurityBanDto,
  CreateStoreItemDto,
  NotificationTemplateDto,
  StaffNoteDto,
  StoreItemGrantDto,
  UpdateSeasonDto,
  UpdateStoreItemDto,
  ViewAsUserDto,
} from './dto/phase-six.dto.js';
import { AdminPhaseSixService } from './admin-phase-six.service.js';
import { AdminBackupsService } from './admin-backups.service.js';

const ctx = (req: Request) => {
  const device = req.headers['x-device-id'];
  return {
    ip: req.ip ?? null,
    deviceId:
      (Array.isArray(device) ? device[0] : device)?.slice(0, 255) ?? null,
  };
};
const CONTENT_TYPES = ['club', 'community', 'tournament'] as const;
type ContentType = (typeof CONTENT_TYPES)[number];

function contentType(value: string): ContentType {
  if (!(CONTENT_TYPES as readonly string[]).includes(value))
    throw new BadRequestException('Unknown type');
  return value as ContentType;
}
function freezable(value: string): 'club' | 'community' {
  if (value !== 'club' && value !== 'community')
    throw new BadRequestException('Only clubs and communities can be frozen');
  return value;
}
function binType(value: string): BinEntityType {
  if (!(BIN_ENTITY_TYPES as string[]).includes(value))
    throw new BadRequestException('Unknown type');
  return value as BinEntityType;
}

/**
 * Allync staff panel. Every route needs a staff role: moderator at least, with
 * stronger actions marked admin or super admin.
 */
@Controller('admin')
@UseGuards(JwtAuthGuard, SystemRoleGuard)
@RequireSystemRole(SystemRole.MODERATOR)
export class AdminController {
  constructor(
    private readonly dashboard: AdminDashboardService,
    private readonly users: AdminUsersService,
    private readonly content: AdminContentService,
    private readonly audit: AuditService,
    private readonly activity: AdminActivityService,
    private readonly disputes: AdminDisputesService,
    private readonly manage: AdminManageService,
    private readonly platform: AdminPlatformService,
    private readonly phaseSix: AdminPhaseSixService,
    private readonly backups: AdminBackupsService,
  ) {}

  // ------------------------------------------------ transfers and wallets

  @RequireSystemRole(SystemRole.ADMIN)
  @Get('transfers/offers')
  transferOffers(@Query() query: AdminOffersQueryDto) {
    return this.platform.offers(query);
  }

  @RequireSystemRole(SystemRole.ADMIN)
  @Post('transfers/offers/:id/cancel')
  cancelTransfer(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
    @Req() req: Request,
  ) {
    return this.platform.cancelOffer(actor, id, dto.reason, ctx(req));
  }

  @RequireSystemRole(SystemRole.SUPER_ADMIN)
  @Post('transfers/offers/:id/reverse')
  reverseTransfer(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
    @Req() req: Request,
  ) {
    return this.platform.reverseOffer(actor, id, dto.reason, ctx(req));
  }

  @RequireSystemRole(SystemRole.ADMIN)
  @Post('transfers/end-lock')
  endLock(
    @CurrentUser() actor: User,
    @Body() dto: EndLockDto,
    @Req() req: Request,
  ) {
    return this.platform.endLock(actor, dto.userId, dto.reason, ctx(req));
  }

  @RequireSystemRole(SystemRole.ADMIN)
  @Post('transfers/loans/:id/end')
  endLoan(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
    @Req() req: Request,
  ) {
    return this.platform.endLoan(actor, id, dto.reason, ctx(req));
  }

  @RequireSystemRole(SystemRole.ADMIN)
  @Get('wallets/ledger')
  ledger(@Query() query: LedgerQueryDto) {
    return this.platform.ledger(query);
  }

  @RequireSystemRole(SystemRole.ADMIN)
  @Get('wallets/:ownerType/:ownerId')
  wallet(
    @Param('ownerType') ownerType: string,
    @Param('ownerId', ParseUUIDPipe) ownerId: string,
  ) {
    if (ownerType !== 'user' && ownerType !== 'club')
      throw new BadRequestException('Unknown wallet type');
    return this.platform.walletOf(ownerType, ownerId);
  }

  @RequireSystemRole(SystemRole.SUPER_ADMIN)
  @Post('wallets/adjust')
  adjustWallet(
    @CurrentUser() actor: User,
    @Body() dto: WalletAdjustDto,
    @Req() req: Request,
  ) {
    return this.platform.adjustWallet(actor, dto, ctx(req));
  }

  // -------------------------------------------------------------- settings

  @RequireSystemRole(SystemRole.SUPER_ADMIN)
  @Get('settings')
  settings() {
    return this.platform.allSettings();
  }

  @RequireSystemRole(SystemRole.SUPER_ADMIN)
  @Patch('settings/transfers')
  transferSettings(
    @CurrentUser() actor: User,
    @Body() dto: TransferSettingsDto,
    @Req() req: Request,
  ) {
    return this.platform.updateSettings(
      actor,
      'transfers',
      { ...dto },
      ctx(req),
    );
  }

  @RequireSystemRole(SystemRole.SUPER_ADMIN)
  @Patch('settings/admin')
  adminSettings(
    @CurrentUser() actor: User,
    @Body() dto: AdminSettingsDto,
    @Req() req: Request,
  ) {
    return this.platform.updateSettings(actor, 'admin', { ...dto }, ctx(req));
  }

  @RequireSystemRole(SystemRole.SUPER_ADMIN)
  @Patch('settings/features')
  featureSettings(
    @CurrentUser() actor: User,
    @Body() dto: FeaturesDto,
    @Req() req: Request,
  ) {
    return this.platform.updateSettings(
      actor,
      'features',
      { ...dto },
      ctx(req),
    );
  }

  @RequireSystemRole(SystemRole.SUPER_ADMIN)
  @Patch('settings/maintenance')
  maintenanceSettings(
    @CurrentUser() actor: User,
    @Body() dto: MaintenanceDto,
    @Req() req: Request,
  ) {
    return this.platform.updateSettings(
      actor,
      'maintenance',
      { ...dto },
      ctx(req),
    );
  }

  // --------------------------------------------------------- announcements

  @RequireSystemRole(SystemRole.ADMIN)
  @Get('announcements')
  announcements(@Query() query: AnnouncementsQueryDto) {
    return this.platform.listAnnouncements(query);
  }

  @RequireSystemRole(SystemRole.ADMIN)
  @Post('announcements/preview')
  previewAnnouncement(@Body() dto: CreateAnnouncementDto) {
    return this.platform.audienceSize(dto);
  }

  @RequireSystemRole(SystemRole.ADMIN)
  @Post('announcements')
  createAnnouncement(
    @CurrentUser() actor: User,
    @Body() dto: CreateAnnouncementDto,
    @Req() req: Request,
  ) {
    return this.platform.createAnnouncement(actor, dto, ctx(req));
  }

  @RequireSystemRole(SystemRole.ADMIN)
  @Post('announcements/:id/cancel')
  cancelAnnouncement(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.platform.cancelAnnouncement(actor, id, ctx(req));
  }

  // ---------------------------------------------------------------- health

  @RequireSystemRole(SystemRole.ADMIN)
  @Get('health')
  health() {
    return this.platform.health();
  }

  // ---------------------------------------------------------- dispute centre

  @Get('disputes')
  disputeList(@Query() query: DisputeQueryDto) {
    return this.disputes.list(query);
  }

  @Get('disputes/:gameId')
  disputeDetail(
    @CurrentUser() actor: User,
    @Param('gameId', ParseUUIDPipe) gameId: string,
  ) {
    return this.disputes.detail(actor, gameId);
  }

  @Post('disputes/:gameId/decide')
  decide(
    @CurrentUser() actor: User,
    @Param('gameId', ParseUUIDPipe) gameId: string,
    @Body() dto: DecideGameDto,
    @Req() req: Request,
  ) {
    return this.disputes.decide(actor, gameId, dto, ctx(req));
  }

  // ------------------------------------------- clubs, communities, tournaments

  @RequireSystemRole(SystemRole.ADMIN)
  @Get('manage/club/:id')
  clubDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.manage.clubDetail(id);
  }

  @RequireSystemRole(SystemRole.ADMIN)
  @Patch('manage/club/:id')
  editClub(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditClubDto,
    @Req() req: Request,
  ) {
    return this.manage.editClub(actor, id, dto, ctx(req));
  }

  @RequireSystemRole(SystemRole.ADMIN)
  @Post('manage/club/:id/leader')
  clubLeader(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetLeaderDto,
    @Req() req: Request,
  ) {
    return this.manage.setClubLeader(actor, id, dto, ctx(req));
  }

  @RequireSystemRole(SystemRole.ADMIN)
  @Post('manage/club/:id/community')
  clubCommunity(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ClubCommunityDto,
    @Req() req: Request,
  ) {
    return this.manage.setClubCommunity(actor, id, dto, ctx(req));
  }

  @RequireSystemRole(SystemRole.ADMIN)
  @Get('manage/community/:id')
  communityDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.manage.communityDetail(id);
  }

  @RequireSystemRole(SystemRole.ADMIN)
  @Get('manage/community/:id/members')
  communityMembers(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('search') search?: string,
  ) {
    return this.manage.communityMembers(id, search ?? '');
  }

  @RequireSystemRole(SystemRole.ADMIN)
  @Patch('manage/community/:id')
  editCommunity(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditCommunityDto,
    @Req() req: Request,
  ) {
    return this.manage.editCommunity(actor, id, dto, ctx(req));
  }

  @RequireSystemRole(SystemRole.ADMIN)
  @Post('manage/community/:id/leader')
  communityLeader(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetLeaderDto,
    @Req() req: Request,
  ) {
    return this.manage.setCommunityLeader(actor, id, dto, ctx(req));
  }

  @RequireSystemRole(SystemRole.ADMIN)
  @Post('manage/:kind/:id/freeze')
  freeze(
    @CurrentUser() actor: User,
    @Param('kind') kind: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FreezeDto,
    @Req() req: Request,
  ) {
    return this.manage.setFrozen(
      actor,
      freezable(kind),
      id,
      true,
      dto.reason,
      ctx(req),
    );
  }

  @RequireSystemRole(SystemRole.ADMIN)
  @Post('manage/:kind/:id/unfreeze')
  unfreeze(
    @CurrentUser() actor: User,
    @Param('kind') kind: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OptionalReasonDto,
    @Req() req: Request,
  ) {
    return this.manage.setFrozen(
      actor,
      freezable(kind),
      id,
      false,
      dto.reason,
      ctx(req),
    );
  }

  @Get('manage/tournament/:id')
  tournamentDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.manage.tournamentDetail(id);
  }

  @RequireSystemRole(SystemRole.ADMIN)
  @Patch('manage/tournament/:id/times')
  tournamentTimes(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TournamentTimesDto,
    @Req() req: Request,
  ) {
    return this.manage.setTournamentTimes(actor, id, dto, ctx(req));
  }

  @RequireSystemRole(SystemRole.ADMIN)
  @Post('manage/tournament/:id/status')
  tournamentStatus(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TournamentStatusDto,
    @Req() req: Request,
  ) {
    return this.manage.setTournamentStatus(actor, id, dto, ctx(req));
  }

  /** Moderators can fix officials too, so stuck reviews get unstuck. */
  @Put('manage/tournament/:id/officials')
  tournamentOfficials(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TournamentOfficialsDto,
    @Req() req: Request,
  ) {
    return this.manage.setTournamentOfficials(actor, id, dto, ctx(req));
  }

  @RequireSystemRole(SystemRole.ADMIN)
  @Delete('manage/tournament/:id/participants/:participantId')
  removeEntry(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('participantId', ParseUUIDPipe) participantId: string,
    @Body() dto: RemoveParticipantDto,
    @Req() req: Request,
  ) {
    return this.manage.removeParticipant(
      actor,
      id,
      participantId,
      dto.reason,
      ctx(req),
    );
  }

  // ------------------------------------------------- activity and sign-ins

  @Get('activity')
  activityFeed(@Query() query: ActivityFeedQueryDto) {
    return this.activity.feed(query);
  }

  @Get('logins')
  loginFeed(@Query() query: LoginFeedQueryDto) {
    return this.activity.logins(query);
  }

  @Get('dashboard')
  overview(@Query() query: DashboardQueryDto) {
    return this.dashboard.overview(query);
  }

  // ------------------------------------------------------------- users

  @Get('users')
  listUsers(@Query() query: AdminUsersQueryDto) {
    return this.users.list(query);
  }

  @Get('users/:id')
  userDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.detail(id);
  }

  @Get('users/:id/activity')
  userActivity(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ActivityQueryDto,
  ) {
    return this.users.activityOf(id, query);
  }

  @Get('users/:id/document')
  userDocument(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.document(id);
  }

  @Post('users/:id/warn')
  warn(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
    @Req() req: Request,
  ) {
    return this.users.warn(actor, id, dto.reason, ctx(req));
  }

  @Post('users/:id/suspend')
  suspend(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SuspendDto,
    @Req() req: Request,
  ) {
    return this.users.suspend(actor, id, dto.until, dto.reason, ctx(req));
  }

  @RequireSystemRole(SystemRole.ADMIN)
  @Post('users/:id/unsuspend')
  unsuspend(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OptionalReasonDto,
    @Req() req: Request,
  ) {
    return this.users.unsuspend(actor, id, dto.reason, ctx(req));
  }

  @RequireSystemRole(SystemRole.ADMIN)
  @Post('users/:id/ban')
  ban(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
    @Req() req: Request,
  ) {
    return this.users.ban(actor, id, dto.reason, ctx(req));
  }

  @RequireSystemRole(SystemRole.ADMIN)
  @Post('users/:id/unban')
  unban(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OptionalReasonDto,
    @Req() req: Request,
  ) {
    return this.users.unban(actor, id, dto.reason, ctx(req));
  }

  @RequireSystemRole(SystemRole.ADMIN)
  @Post('users/:id/force-logout')
  forceLogout(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.users.forceLogout(actor, id, undefined, ctx(req));
  }

  @RequireSystemRole(SystemRole.ADMIN)
  @Post('users/:id/reset-password')
  resetPassword(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResetPasswordDto,
    @Req() req: Request,
  ) {
    return this.users.resetPassword(actor, id, dto.password, ctx(req));
  }

  @RequireSystemRole(SystemRole.ADMIN)
  @Patch('users/:id')
  editUser(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditUserDto,
    @Req() req: Request,
  ) {
    return this.users.edit(actor, id, dto, ctx(req));
  }

  @RequireSystemRole(SystemRole.SUPER_ADMIN)
  @Post('users/:id/role')
  setRole(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetRoleDto,
    @Req() req: Request,
  ) {
    return this.users.setRole(actor, id, dto, ctx(req));
  }

  @RequireSystemRole(SystemRole.ADMIN)
  @Post('users/:id/bin')
  binUser(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
    @Req() req: Request,
  ) {
    return this.users.moveToBin(actor, id, dto.reason, ctx(req));
  }

  /** Warn / suspend need moderator; the other bulk actions are checked for admin in the service. */
  @Post('users/bulk')
  bulk(
    @CurrentUser() actor: User,
    @Body() dto: BulkUsersDto,
    @Req() req: Request,
  ) {
    return this.users.bulk(actor, dto, ctx(req));
  }

  // ------------------------------------------------------ verification

  @Get('verifications')
  verifications(@Query() query: VerificationQueryDto) {
    return this.users.verificationQueue(query);
  }

  @Post('verifications/:id')
  reviewVerification(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VerificationReviewDto,
    @Req() req: Request,
  ) {
    return this.users.reviewVerification(actor, id, dto, ctx(req));
  }

  // ------------------------------------------ Phase 6: account intelligence

  @Get('users/:id/notes')
  accountNotes(@Param('id', ParseUUIDPipe) id: string) {
    return this.phaseSix.accountNotes(id);
  }

  @Post('users/:id/notes')
  addAccountNote(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StaffNoteDto,
    @Req() req: Request,
  ) {
    return this.phaseSix.addAccountNote(actor, id, dto, ctx(req));
  }

  @Patch('users/:id/notes/:noteId')
  updateAccountNote(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Body() dto: StaffNoteDto,
    @Req() req: Request,
  ) {
    return this.phaseSix.updateAccountNote(actor, id, noteId, dto, ctx(req));
  }

  @RequireSystemRole(SystemRole.ADMIN)
  @Delete('users/:id/notes/:noteId')
  deleteAccountNote(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Req() req: Request,
  ) {
    return this.phaseSix.deleteAccountNote(actor, id, noteId, ctx(req));
  }

  @Get('users/:id/labels')
  accountLabels(@Param('id', ParseUUIDPipe) id: string) {
    return this.phaseSix.accountLabels(id);
  }

  @Post('users/:id/labels')
  addAccountLabel(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AccountLabelDto,
    @Req() req: Request,
  ) {
    return this.phaseSix.addAccountLabel(actor, id, dto, ctx(req));
  }

  @Delete('users/:id/labels/:labelId')
  removeAccountLabel(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('labelId', ParseUUIDPipe) labelId: string,
    @Req() req: Request,
  ) {
    return this.phaseSix.removeAccountLabel(actor, id, labelId, ctx(req));
  }

  @RequireSystemRole(SystemRole.ADMIN)
  @Get('users/:id/export')
  exportUser(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.phaseSix.exportUser(actor, id, ctx(req));
  }

  @RequireSystemRole(SystemRole.ADMIN)
  @Post('users/:id/view-as')
  async viewAsUser(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ViewAsUserDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.phaseSix.viewAsUser(actor, id, dto, ctx(req));
    // The staff session is kept aside and comes back with POST /auth/view-as/exit.
    const authorization = req.headers.authorization;
    const bearer = authorization?.startsWith('Bearer ')
      ? authorization.slice(7).trim()
      : undefined;
    const staffToken: string | undefined =
      req.cookies?.[JWT_COOKIE_NAME] ?? bearer;
    if (staffToken)
      res.cookie(STAFF_COOKIE_NAME, staffToken, {
        ...cookieOptions(req),
        maxAge: 60 * 60 * 1000,
      });
    res.cookie(JWT_COOKIE_NAME, result.accessToken, {
      ...cookieOptions(req),
      maxAge: new Date(result.expiresAt).getTime() - Date.now(),
    });
    // The token itself stays server-side (in the cookie).
    return { viewOnly: true, expiresAt: result.expiresAt, user: result.user };
  }

  // ----------------------------------------------- Phase 6: IP/device bans

  @RequireSystemRole(SystemRole.ADMIN)
  @Get('security/bans')
  securityBans(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.phaseSix.securityBans(
      page ? Number(page) : undefined,
      limit ? Number(limit) : undefined,
    );
  }

  @RequireSystemRole(SystemRole.ADMIN)
  @Post('security/bans')
  createSecurityBan(
    @CurrentUser() actor: User,
    @Body() dto: CreateSecurityBanDto,
    @Req() req: Request,
  ) {
    return this.phaseSix.createSecurityBan(actor, dto, ctx(req));
  }

  @RequireSystemRole(SystemRole.ADMIN)
  @Post('security/bans/from-login/:loginId')
  createSecurityBanFromLogin(
    @CurrentUser() actor: User,
    @Param('loginId', ParseUUIDPipe) loginId: string,
    @Body() dto: BanLoginDeviceDto,
    @Req() req: Request,
  ) {
    return this.phaseSix.createSecurityBanFromLogin(
      actor,
      loginId,
      dto,
      ctx(req),
    );
  }

  @RequireSystemRole(SystemRole.ADMIN)
  @Post('security/bans/:id/revoke')
  revokeSecurityBan(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.phaseSix.revokeSecurityBan(actor, id, ctx(req));
  }

  // ------------------------------------ Phase 6: notification text editor

  @RequireSystemRole(SystemRole.ADMIN)
  @Get('notification-templates')
  notificationTemplates() {
    return this.phaseSix.notificationTemplates();
  }

  @RequireSystemRole(SystemRole.ADMIN)
  @Put('notification-templates/:code')
  updateNotificationTemplate(
    @CurrentUser() actor: User,
    @Param('code') code: string,
    @Body() dto: NotificationTemplateDto,
    @Req() req: Request,
  ) {
    return this.phaseSix.updateNotificationTemplate(actor, code, dto, ctx(req));
  }

  @RequireSystemRole(SystemRole.ADMIN)
  @Delete('notification-templates/:code')
  resetNotificationTemplate(
    @CurrentUser() actor: User,
    @Param('code') code: string,
    @Req() req: Request,
  ) {
    return this.phaseSix.resetNotificationTemplate(actor, code, ctx(req));
  }

  // ------------------------------------------ Phase 6: season control

  @RequireSystemRole(SystemRole.ADMIN)
  @Get('seasons')
  seasons() {
    return this.phaseSix.listSeasons();
  }

  @RequireSystemRole(SystemRole.SUPER_ADMIN)
  @Post('seasons')
  createSeason(
    @CurrentUser() actor: User,
    @Body() dto: CreateSeasonDto,
    @Req() req: Request,
  ) {
    return this.phaseSix.createSeason(actor, dto, ctx(req));
  }

  @RequireSystemRole(SystemRole.SUPER_ADMIN)
  @Patch('seasons/:id')
  updateSeason(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSeasonDto,
    @Req() req: Request,
  ) {
    return this.phaseSix.updateSeason(actor, id, dto, ctx(req));
  }

  @RequireSystemRole(SystemRole.SUPER_ADMIN)
  @Post('seasons/:id/activate')
  activateSeason(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.phaseSix.activateSeason(actor, id, ctx(req));
  }

  @RequireSystemRole(SystemRole.SUPER_ADMIN)
  @Post('seasons/:id/close')
  closeSeason(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CloseSeasonDto,
    @Req() req: Request,
  ) {
    return this.phaseSix.closeSeason(actor, id, dto.reason, ctx(req));
  }

  // -------------------------------------------- Phase 6: store manager

  @RequireSystemRole(SystemRole.ADMIN)
  @Get('store/items')
  storeItems() {
    return this.phaseSix.adminStoreCatalog();
  }

  @RequireSystemRole(SystemRole.ADMIN)
  @Post('store/items')
  createStoreItem(
    @CurrentUser() actor: User,
    @Body() dto: CreateStoreItemDto,
    @Req() req: Request,
  ) {
    return this.phaseSix.createStoreItem(actor, dto, ctx(req));
  }

  @RequireSystemRole(SystemRole.ADMIN)
  @Patch('store/items/:id')
  updateStoreItem(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStoreItemDto,
    @Req() req: Request,
  ) {
    return this.phaseSix.updateStoreItem(actor, id, dto, ctx(req));
  }

  @RequireSystemRole(SystemRole.ADMIN)
  @Post('users/:id/store-items')
  grantStoreItem(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StoreItemGrantDto,
    @Req() req: Request,
  ) {
    return this.phaseSix.grantStoreItem(
      actor,
      id,
      dto.itemId,
      false,
      dto.reason,
      ctx(req),
    );
  }

  @RequireSystemRole(SystemRole.ADMIN)
  @Delete('users/:id/store-items/:itemId')
  revokeStoreItem(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: OptionalReasonDto,
    @Req() req: Request,
  ) {
    return this.phaseSix.grantStoreItem(
      actor,
      id,
      itemId,
      true,
      dto.reason,
      ctx(req),
    );
  }

  // ----------------------------------------- Phase 6: encrypted backups

  @RequireSystemRole(SystemRole.SUPER_ADMIN)
  @Get('backups')
  backupList() {
    return this.backups.list();
  }

  @RequireSystemRole(SystemRole.SUPER_ADMIN)
  @Post('backups')
  createBackup(@CurrentUser() actor: User, @Req() req: Request) {
    return this.backups.create(actor, req.ip ?? null);
  }

  @RequireSystemRole(SystemRole.SUPER_ADMIN)
  @Get('backups/:id/download')
  async downloadBackup(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const file = await this.backups.file(id, actor, req.ip ?? null);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', String(file.size));
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.fileName}"`,
    );
    return new StreamableFile(createReadStream(file.path));
  }

  @RequireSystemRole(SystemRole.SUPER_ADMIN)
  @Delete('backups/:id')
  deleteBackup(
    @CurrentUser() actor: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.backups.remove(actor, id, req.ip ?? null);
  }

  // ---------------------------------------- clubs, communities, tournaments

  @Get('content/:type')
  listContent(@Param('type') type: string, @Query() query: EntityListQueryDto) {
    return this.content.list(contentType(type), query);
  }

  @RequireSystemRole(SystemRole.ADMIN)
  @Post('content/:type/:id/bin')
  binContent(
    @CurrentUser() actor: User,
    @Param('type') type: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
    @Req() req: Request,
  ) {
    return this.content.moveToBin(
      actor,
      contentType(type),
      id,
      dto.reason,
      ctx(req),
    );
  }

  // ------------------------------------------------------- recycle bin

  @RequireSystemRole(SystemRole.ADMIN)
  @Get('bin')
  binList(@Query() query: BinQueryDto) {
    return this.content.binList(query);
  }

  @RequireSystemRole(SystemRole.ADMIN)
  @Post('bin/:type/:id/restore')
  restore(
    @CurrentUser() actor: User,
    @Param('type') type: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.content.restore(actor, binType(type), id, ctx(req));
  }

  @RequireSystemRole(SystemRole.SUPER_ADMIN)
  @Delete('bin/:type/:id')
  purge(
    @CurrentUser() actor: User,
    @Param('type') type: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ) {
    return this.content.purge(actor, binType(type), id, ctx(req));
  }

  // --------------------------------------------------------- audit log

  @RequireSystemRole(SystemRole.SUPER_ADMIN)
  @Get('audit')
  auditLog(@Query() query: AuditQueryDto) {
    return this.audit.list(query);
  }
}
