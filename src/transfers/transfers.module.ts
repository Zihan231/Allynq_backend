import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommunitiesModule } from '../communities/communities.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { PlayerContract } from './entities/player-contract.entity.js';
import { PlayerLoanBid } from './entities/player-loan-bid.entity.js';
import { PlayerLoan } from './entities/player-loan.entity.js';
import { TransferOfferBid } from './entities/transfer-offer-bid.entity.js';
import { TransferOffer } from './entities/transfer-offer.entity.js';
import { WalletTransaction } from './entities/wallet-transaction.entity.js';
import { Wallet } from './entities/wallet.entity.js';
import { LoansService } from './loans.service.js';
import { TransfersJobsService } from './transfers-jobs.service.js';
import { TransfersController } from './transfers.controller.js';
import { TransfersService } from './transfers.service.js';
import { WalletsService } from './wallets.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([TransferOffer, TransferOfferBid, PlayerContract, PlayerLoan, PlayerLoanBid, Wallet, WalletTransaction]),
    CommunitiesModule,
    NotificationsModule,
  ],
  controllers: [TransfersController],
  providers: [TransfersService, WalletsService, LoansService, TransfersJobsService],
  exports: [TransfersService, WalletsService, LoansService],
})
export class TransfersModule {}
