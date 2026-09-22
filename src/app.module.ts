import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { ClubsModule } from './clubs/clubs.module.js';
import { FileStorageModule } from './common/file-storage.module.js';
import { CommunitiesModule } from './communities/communities.module.js';
import { buildTypeOrmOptions } from './config/typeorm.config.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { TournamentsModule } from './tournaments/tournaments.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: buildTypeOrmOptions,
    }),
    FileStorageModule,
    AuthModule,
    UsersModule,
    ClubsModule,
    CommunitiesModule,
    NotificationsModule,
    TournamentsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
