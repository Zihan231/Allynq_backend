import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EfootballProfile } from './entities/efootball-profile.entity.js';
import { User } from './entities/user.entity.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([User, EfootballProfile])],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
