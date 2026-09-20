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
import { ClubRole } from '../users/enums/user-attributes.enum.js';
import { ClubsService } from './clubs.service.js';
import { RequireClubRoles } from './decorators/require-club-roles.decorator.js';
import { ChangeManagerDto } from './dto/change-manager.dto.js';
import { TransferPresidentDto } from './dto/transfer-president.dto.js';
import { CreateClubDto } from './dto/create-club.dto.js';
import { UpdateClubDto } from './dto/update-club.dto.js';
import { ClubQueryDto } from './dto/club-query.dto.js';
import { ClubMembersQueryDto } from './dto/club-members-query.dto.js';
import { ClubRoleGuard } from './guards/club-role.guard.js';

@Controller('clubs')
export class ClubsController {
  constructor(private readonly clubsService: ClubsService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@CurrentUser() user: User, @Body() dto: CreateClubDto) {
    return this.clubsService.create(user, dto);
  }

  @Get()
  findAll(@Query() query: ClubQueryDto) {
    return this.clubsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.clubsService.findOne(id);
  }

  @UseGuards(JwtAuthGuard, ClubRoleGuard)
  @RequireClubRoles(ClubRole.PRESIDENT, ClubRole.GENERAL_SECRETARY)
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateClubDto) {
    return this.clubsService.update(id, dto);
  }

  @UseGuards(JwtAuthGuard, ClubRoleGuard)
  @RequireClubRoles(ClubRole.PRESIDENT)
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.clubsService.remove(id);
  }

  @Get(':id/members')
  getMembers(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ClubMembersQueryDto,
  ) {
    return this.clubsService.getMembers(id, query);
  }

  @Get(':id/manager')
  getManager(@Param('id', ParseUUIDPipe) id: string) {
    return this.clubsService.getManager(id);
  }

  @UseGuards(JwtAuthGuard, ClubRoleGuard)
  @RequireClubRoles(ClubRole.PRESIDENT, ClubRole.GENERAL_SECRETARY)
  @Patch(':id/manager')
  changeManager(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
    @Body() dto: ChangeManagerDto,
  ) {
    return this.clubsService.changeManager(id, user, dto);
  }

  @UseGuards(JwtAuthGuard, ClubRoleGuard)
  @RequireClubRoles(ClubRole.PRESIDENT, ClubRole.GENERAL_SECRETARY)
  @Post(':id/manager/transfer')
  transferManager(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
    @Body() dto: ChangeManagerDto,
  ) {
    return this.clubsService.changeManager(id, user, dto);
  }

  @UseGuards(JwtAuthGuard, ClubRoleGuard)
  @RequireClubRoles(ClubRole.PRESIDENT, ClubRole.GENERAL_SECRETARY)
  @Post(':id/president/transfer')
  transferPresident(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
    @Body() dto: TransferPresidentDto,
  ) {
    return this.clubsService.transferPresidency(id, user, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/join')
  join(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.clubsService.join(id, user);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/leave')
  leave(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.clubsService.leave(id, user);
  }
}
