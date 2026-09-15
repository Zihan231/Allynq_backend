import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { User } from '../users/entities/user.entity.js';
import { ClubRole } from '../users/enums/user-attributes.enum.js';
import { ClubsService } from './clubs.service.js';
import { RequireClubRoles } from './decorators/require-club-roles.decorator.js';
import { CreateClubDto } from './dto/create-club.dto.js';
import { UpdateClubDto } from './dto/update-club.dto.js';
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
  findAll() {
    return this.clubsService.findAll();
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
  @RequireClubRoles(ClubRole.PRESIDENT, ClubRole.GENERAL_SECRETARY)
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.clubsService.remove(id);
  }

  @Get(':id/members')
  getMembers(@Param('id', ParseUUIDPipe) id: string) {
    return this.clubsService.getMembers(id);
  }
}
