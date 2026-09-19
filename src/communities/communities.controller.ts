import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { User } from '../users/entities/user.entity.js';
import { CommunityRole } from '../users/enums/user-attributes.enum.js';
import { CommunitiesService } from './communities.service.js';
import { RequireCommunityRoles } from './decorators/require-community-roles.decorator.js';
import { AssignRoleDto } from './dto/assign-role.dto.js';
import { CreateCommunityDto } from './dto/create-community.dto.js';
import { ReviewJoinRequestDto } from './dto/review-join-request.dto.js';
import { UpdateCommunityDto } from './dto/update-community.dto.js';
import { CommunityQueryDto } from './dto/community-query.dto.js';
import { CommunityMembersQueryDto } from './dto/community-members-query.dto.js';
import { CommunityTier } from './enums/community.enum.js';
import { CommunityRoleGuard } from './guards/community-role.guard.js';

@Controller('communities')
export class CommunitiesController {
  constructor(private readonly communitiesService: CommunitiesService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@CurrentUser() user: User, @Body() dto: CreateCommunityDto) {
    return this.communitiesService.create(user, dto);
  }

  @Get()
  findAll(@Query() query: CommunityQueryDto) {
    return this.communitiesService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.communitiesService.findOne(id);
  }

  @UseGuards(JwtAuthGuard, CommunityRoleGuard)
  @RequireCommunityRoles(CommunityRole.PRESIDENT)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
    @Body() dto: UpdateCommunityDto,
  ) {
    return this.communitiesService.update(id, user, dto);
  }

  @UseGuards(JwtAuthGuard, CommunityRoleGuard)
  @RequireCommunityRoles(CommunityRole.PRESIDENT)
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.communitiesService.remove(id, user);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/join')
  joinIndividual(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ) {
    return this.communitiesService.joinIndividual(id, user);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/leave')
  leaveIndividual(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ) {
    return this.communitiesService.leaveIndividual(id, user);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/clubs/:clubId')
  addClub(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('clubId', ParseUUIDPipe) clubId: string,
    @CurrentUser() user: User,
  ) {
    return this.communitiesService.addClub(id, clubId, user);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id/clubs/:clubId')
  removeClub(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('clubId', ParseUUIDPipe) clubId: string,
    @CurrentUser() user: User,
  ) {
    return this.communitiesService.removeClub(id, clubId, user);
  }

  @Get(':id/members')
  getMembers(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: CommunityMembersQueryDto,
  ) {
    return this.communitiesService.getMembers(id, query);
  }

  @UseGuards(JwtAuthGuard, CommunityRoleGuard)
  @RequireCommunityRoles(
    CommunityRole.PRESIDENT,
    CommunityRole.VICE_PRESIDENT,
    CommunityRole.TEAM_MANAGER,
  )
  @Get(':id/requests')
  getRequests(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ) {
    return this.communitiesService.getRequests(id, user);
  }

  @UseGuards(JwtAuthGuard, CommunityRoleGuard)
  @RequireCommunityRoles(
    CommunityRole.PRESIDENT,
    CommunityRole.VICE_PRESIDENT,
    CommunityRole.TEAM_MANAGER,
  )
  @Post(':id/requests/:requestId/review')
  reviewRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @CurrentUser() user: User,
    @Body() dto: ReviewJoinRequestDto,
  ) {
    return this.communitiesService.reviewRequest(id, requestId, user, dto);
  }

  @UseGuards(JwtAuthGuard, CommunityRoleGuard)
  @RequireCommunityRoles(CommunityRole.PRESIDENT)
  @Patch(':id/roles')
  assignRole(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
    @Body() dto: AssignRoleDto,
  ) {
    return this.communitiesService.assignRole(id, user, dto);
  }
}
