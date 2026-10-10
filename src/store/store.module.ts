import { Module } from '@nestjs/common';
import { TransfersModule } from '../transfers/transfers.module.js';
import { StoreController } from './store.controller.js';
import { StoreService } from './store.service.js';

/** The cosmetics store: buy with the wallet, equip what you own. */
@Module({
  imports: [TransfersModule],
  controllers: [StoreController],
  providers: [StoreService],
})
export class StoreModule {}
