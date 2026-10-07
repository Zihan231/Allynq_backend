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
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { BIN_ENTITY_TYPES, type BinEntityType } from '../recycle-bin/recycle-bin-item.entity.js';
import { User } from '../users/entities/user.entity.js';
import { SystemRole } from '../users/enums/user-attributes.enum.js';
import { ActivityFeedQueryDto, LoginFeedQueryDto } from '../reports/dto/report.dto.js';
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

const ctx = (req: Request) => ({ ip: req.ip ?? null });
const CONTENT_TYPES = ['club', 'community', 'tournament'] as const;
type ContentType = (typeof CONTENT_TYPES)[number];

function contentType(value: string): ContentType {
  if (!(CONTENT_TYPES as readonly string[]).includes(value)) throw new BadRequestException('Unknown type');
  return value as ContentType;
}
function freezable(value: string): 'club' | 'community' {
  if (value !== 'club' && value !== 'community') throw new BadRequestException('Only clubs and communities can be frozen');
  return value;
}
function binType(value: string): BinEntityType {
  if (!(BIN_ENTITY_TYPES as string[]).includes(value)) throw new BadRequestException('Unknown type');
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
  ) {}

  // ---------------------------------------------------------- dispute centre

  @Get('disputes')
  disputeList(@Query() query: DisputeQueryDto) {
    return this.disputes.list(query);
  }

  @Get('disputes/:gameId')
  disputeDetail(@CurrentUser() actor: User, @Param('gameId', ParseUUIDPipe) gameId: string) {
    return this.disputes.detail(actor, gameId);
  }

  @Post('disputes/:gameId/decide')
  decide(@CurrentUser() actor: User, @Param('gameId', ParseUUIDPipe) gameId: string, @Body() dto: DecideGameDto, @Req() req: Request) {
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
  editClub(@CurrentUser() actor: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EditClubDto, @Req() req: Request) {
    return this.manage.editClub(actor, id, dto, ctx(req));
  }

  @RequireSystemRole(SystemRole.ADMIN)
  @Post('manage/club/:id/leader')
  clubLeader(@CurrentUser() actor: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetLeaderDto, @Req() req: Request) {
    return this.manage.setClubLeader(actor, id, dto, ctx(req));
  }

  @RequireSystemRole(SystemRole.ADMIN)
  @Post('manage/club/:id/community')
  clubCommunity(@CurrentUser() actor: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ClubCommunityDto, @Req() req: Request) {
    return this.manage.setClubCommunity(actor, id, dto, ctx(req));
  }

  @RequireSystemRole(SystemRole.ADMIN)
  @Get('manage/community/:id')
  communityDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.manage.communityDetail(id);
  }

  @RequireSystemRole(SystemRole.ADMIN)
  @Get('manage/community/:id/members')
  communityMembers(@Param('id', ParseUUIDPipe) id: string, @Query('search') search?: string) {
    return this.manage.communityMembers(id, search ?? '');
  }

  @RequireSystemRole(SystemRole.ADMIN)
  @Patch('manage/community/:id')
  editCommunity(@CurrentUser() actor: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EditCommunityDto, @Req() req: Request) {
    return this.manage.editCommunity(actor, id, dto, ctx(req));
  }

  @RequireSystemRole(SystemRole.ADMIN)
  @Post('manage/community/:id/leader')
  communityLeader(@CurrentUser() actor: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetLeaderDto, @Req() req: Request) {
    return this.manage.setCommunityLeader(actor, id, dto, ctx(req));
  }

  @RequireSystemRole(SystemRole.ADMIN)
  @Post('manage/:kind/:id/freeze')
  freeze(@CurrentUser() actor: User, @Param('kind') kind: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: FreezeDto, @Req() req: Request) {
    return this.manage.setFrozen(actor, freezable(kind), id, true, dto.reason, ctx(req));
  }

  @RequireSystemRole(SystemRole.ADMIN)
  @Post('manage/:kind/:id/unfreeze')
  unfreeze(@CurrentUser() actor: User, @Param('kind') kind: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: OptionalReasonDto, @Req() req: Request) {
    return this.manage.setFrozen(actor, freezable(kind), id, false, dto.reason, ctx(req));
  }

  @Get('manage/tournament/:id')
  tournamentDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.manage.tournamentDetail(id);
  }

  @RequireSystemRole(SystemRole.ADMIN)
  @Patch('manage/tournament/:id/times')
  tournamentTimes(@CurrentUser() actor: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TournamentTimesDto, @Req() req: Request) {
    return this.manage.setTournamentTimes(actor, id, dto, ctx(req));
  }

  @RequireSystemRole(SystemRole.ADMIN)
  @Post('manage/tournament/:id/status')
  tournamentStatus(@CurrentUser() actor: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TournamentStatusDto, @Req() req: Request) {
    return this.manage.setTournamentStatus(actor, id, dto, ctx(req));
  }

  /** Moderators can fix officials too, so stuck reviews get unstuck. */
  @Put('manage/tournament/:id/officials')
  tournamentOfficials(@CurrentUser() actor: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TournamentOfficialsDto, @Req() req: Request) {
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
    return this.manage.removeParticipant(actor, id, participantId, dto.reason, ctx(req));
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
  userActivity(@Param('id', ParseUUIDPipe) id: string, @Query() query: ActivityQueryDto) {
    return this.users.activityOf(id, query);
  }

  @Get('users/:id/document')
  userDocument(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.document(id);
  }

  @Post('users/:id/warn')
  warn(@CurrentUser() actor: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto, @Req() req: Request) {
    return this.users.warn(actor, id, dto.reason, ctx(req));
  }

  @Post('users/:id/suspend')
  suspend(@CurrentUser() actor: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SuspendDto, @Req() req: Request) {
    return this.users.suspend(actor, id, dto.until, dto.reason, ctx(req));
  }

  @RequireSystemRole(SystemRole.ADMIN)
  @Post('users/:id/unsuspend')
  unsuspend(@CurrentUser() actor: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: OptionalReasonDto, @Req() req: Request) {
    return this.users.unsuspend(actor, id, dto.reason, ctx(req));
  }

  @RequireSystemRole(SystemRole.ADMIN)
  @Post('users/:id/ban')
  ban(@CurrentUser() actor: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto, @Req() req: Request) {
    return this.users.ban(actor, id, dto.reason, ctx(req));
  }

  @RequireSystemRole(SystemRole.ADMIN)
  @Post('users/:id/unban')
  unban(@CurrentUser() actor: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: OptionalReasonDto, @Req() req: Request) {
    return this.users.unban(actor, id, dto.reason, ctx(req));
  }

  @RequireSystemRole(SystemRole.ADMIN)
  @Post('users/:id/force-logout')
  forceLogout(@CurrentUser() actor: User, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.users.forceLogout(actor, id, undefined, ctx(req));
  }

  @RequireSystemRole(SystemRole.ADMIN)
  @Post('users/:id/reset-password')
  resetPassword(@CurrentUser() actor: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ResetPasswordDto, @Req() req: Request) {
    return this.users.resetPassword(actor, id, dto.password, ctx(req));
  }

  @RequireSystemRole(SystemRole.ADMIN)
  @Patch('users/:id')
  editUser(@CurrentUser() actor: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EditUserDto, @Req() req: Request) {
    return this.users.edit(actor, id, dto, ctx(req));
  }

  @RequireSystemRole(SystemRole.SUPER_ADMIN)
  @Post('users/:id/role')
  setRole(@CurrentUser() actor: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetRoleDto, @Req() req: Request) {
    return this.users.setRole(actor, id, dto, ctx(req));
  }

  @RequireSystemRole(SystemRole.ADMIN)
  @Post('users/:id/bin')
  binUser(@CurrentUser() actor: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto, @Req() req: Request) {
    return this.users.moveToBin(actor, id, dto.reason, ctx(req));
  }

  /** Warn / suspend need moderator; the other bulk actions are checked for admin in the service. */
  @Post('users/bulk')
  bulk(@CurrentUser() actor: User, @Body() dto: BulkUsersDto, @Req() req: Request) {
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
    return this.content.moveToBin(actor, contentType(type), id, dto.reason, ctx(req));
  }

  // ------------------------------------------------------- recycle bin

  @RequireSystemRole(SystemRole.ADMIN)
  @Get('bin')
  binList(@Query() query: BinQueryDto) {
    return this.content.binList(query);
  }

  @RequireSystemRole(SystemRole.ADMIN)
  @Post('bin/:type/:id/restore')
  restore(@CurrentUser() actor: User, @Param('type') type: string, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.content.restore(actor, binType(type), id, ctx(req));
  }

  @RequireSystemRole(SystemRole.SUPER_ADMIN)
  @Delete('bin/:type/:id')
  purge(@CurrentUser() actor: User, @Param('type') type: string, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.content.purge(actor, binType(type), id, ctx(req));
  }

  // --------------------------------------------------------- audit log

  @RequireSystemRole(SystemRole.SUPER_ADMIN)
  @Get('audit')
  auditLog(@Query() query: AuditQueryDto) {
    return this.audit.list(query);
  }
}
