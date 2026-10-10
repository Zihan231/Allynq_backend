import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivityModule } from './activity/activity.module.js';
import { AdminModule } from './admin/admin.module.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { ClubsModule } from './clubs/clubs.module.js';
import { FileStorageModule } from './common/file-storage.module.js';
import { CommunitiesModule } from './communities/communities.module.js';
import { buildTypeOrmOptions } from './config/typeorm.config.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { RecycleBinModule } from './recycle-bin/recycle-bin.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { TournamentsModule } from './tournaments/tournaments.module.js';
import { StatsModule } from './stats/stats.module.js';
import { SettingsModule } from './settings/settings.module.js';
import { TransfersModule } from './transfers/transfers.module.js';
import { StoreModule } from './store/store.module.js';
import { UsersModule } from './users/users.module.js';
import { HealthModule } from './health/health.module.js';
import { SecurityModule } from './security/security.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: buildTypeOrmOptions,
    }),
    FileStorageModule,
    SecurityModule,
    ActivityModule,
    HealthModule,
    RecycleBinModule,
    AuthModule,
    UsersModule,
    ClubsModule,
    CommunitiesModule,
    NotificationsModule,
    TournamentsModule,
    StatsModule,
    SettingsModule,
    TransfersModule,
    StoreModule,
    AdminModule,
    ReportsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
