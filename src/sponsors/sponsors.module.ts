import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminModule } from '../admin/admin.module.js';
import { HealthModule } from '../health/health.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { TournamentsModule } from '../tournaments/tournaments.module.js';
import { TransfersModule } from '../transfers/transfers.module.js';
import { SponsorCall, SponsorImpression, SponsorProfile, Sponsorship } from './entities/sponsor.entities.js';
import { SponsorsJobsService } from './sponsors-jobs.service.js';
import { AdminSponsorsController, SponsorsController, SponsorshipsController } from './sponsors.controller.js';
import { SponsorsService } from './sponsors.service.js';

/** Sponsor mode: brand profiles and posts, sponsorships of tournaments and communities. */
@Module({
  imports: [
    TypeOrmModule.forFeature([SponsorProfile, Sponsorship, SponsorCall, SponsorImpression]),
    TransfersModule,
    TournamentsModule,
    NotificationsModule,
    AdminModule,
    HealthModule,
  ],
  controllers: [SponsorsController, SponsorshipsController, AdminSponsorsController],
  providers: [SponsorsService, SponsorsJobsService],
  exports: [SponsorsService],
})
export class SponsorsModule {}
