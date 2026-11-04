import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { TournamentsModule } from '../tournaments/tournaments.module.js';
import { TransfersModule } from '../transfers/transfers.module.js';
import { StoreController } from './store.controller.js';
import { StoreService } from './store.service.js';

/** The cosmetics store: buy with the wallet, equip what you own. */
@Module({
  // Tournaments: who may put a banner on a tournament.
  imports: [TransfersModule, TournamentsModule, NotificationsModule],
  controllers: [StoreController],
  providers: [StoreService],
  exports: [StoreService],
})
export class StoreModule {}
