import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { CreateEfootballProfileDto } from './dto/create-efootball-profile.dto.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateEfootballProfileDto } from './dto/update-efootball-profile.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { UsersService } from './users.service.js';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.remove(id);
  }

  @Get(':id/efootball-profile')
  getEfootballProfile(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.getEfootballProfile(id);
  }

  @Put(':id/efootball-profile')
  upsertEfootballProfile(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateEfootballProfileDto | UpdateEfootballProfileDto,
  ) {
    return this.usersService.upsertEfootballProfile(id, dto);
  }
}
