import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard.js';
import { CreateEfootballProfileDto } from './dto/create-efootball-profile.dto.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateEfootballProfileDto } from './dto/update-efootball-profile.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { User } from './entities/user.entity.js';
import { serializeUser, serializeUsers } from './serializers/user.serializer.js';
import { UsersService } from './users.service.js';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  async create(@Body() dto: CreateUserDto) {
    const user = await this.usersService.create(dto);
    return serializeUser(user, true);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  getMyProfile(@CurrentUser() user: User) {
    return serializeUser(user, true);
  }

  @Get()
  async findAll() {
    const users = await this.usersService.findAll();
    return serializeUsers(users);
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Get(':id')
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() caller?: User | null,
  ) {
    const user = await this.usersService.findOne(id);
    const isSelf = Boolean(caller && caller.id === user.id);
    return serializeUser(user, isSelf);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() caller: User,
  ) {
    if (caller.id !== id) {
      throw new ForbiddenException('You can only update your own profile');
    }
    const user = await this.usersService.update(id, dto);
    return serializeUser(user, true);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() caller: User,
  ) {
    if (caller.id !== id) {
      throw new ForbiddenException('You can only delete your own profile');
    }
    return this.usersService.remove(id);
  }

  @Get(':id/efootball-profile')
  getEfootballProfile(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.getEfootballProfile(id);
  }

  @UseGuards(JwtAuthGuard)
  @Put(':id/efootball-profile')
  upsertEfootballProfile(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateEfootballProfileDto | UpdateEfootballProfileDto,
    @CurrentUser() caller: User,
  ) {
    if (caller.id !== id) {
      throw new ForbiddenException('You can only update your own eFootball profile');
    }
    return this.usersService.upsertEfootballProfile(id, dto);
  }
}
