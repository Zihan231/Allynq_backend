import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard.js';
import { User } from '../users/entities/user.entity.js';
import {
  CreateOfferDto,
  FreeAgentsQueryDto,
  RespondOfferDto,
  TopUpDto,
  TransferHistoryQueryDto,
  WalletHistoryQueryDto,
} from './dto/transfer.dto.js';
import { TransfersService } from './transfers.service.js';

@Controller('transfers')
export class TransfersController {
  constructor(private readonly transfersService: TransfersService) {}

  /** My contract, open offers, wallet and any tournament holding a transfer. */
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: User) {
    return this.transfersService.me(user);
  }

  /** A player proposes himself to a club, or a club leader makes an offer (paid upfront into a hold). */
  @UseGuards(JwtAuthGuard)
  @Post('offers')
  createOffer(@CurrentUser() user: User, @Body() dto: CreateOfferDto) {
    return this.transfersService.createOffer(user, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('offers/:id/respond')
  respond(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RespondOfferDto) {
    return this.transfersService.respond(user, id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('offers/:id/cancel')
  cancel(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.transfersService.cancel(user, id);
  }

  /** The contract document for an offer (preview before signing, or the signed contract). */
  @UseGuards(JwtAuthGuard)
  @Get('offers/:id/contract')
  contract(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.transfersService.contractDocument(user, id);
  }

  /** A club's squad contracts (everyone); offers and wallet (its President / GS). */
  @UseGuards(OptionalJwtAuthGuard)
  @Get('clubs/:id')
  club(@CurrentUser() user: User | null, @Param('id', ParseUUIDPipe) id: string) {
    return this.transfersService.club(user, id);
  }

  @Get('players/:userId')
  playerStatus(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.transfersService.playerStatus(userId);
  }

  @Get('free-agents')
  freeAgents(@Query() query: FreeAgentsQueryDto) {
    return this.transfersService.freeAgents(query);
  }

  @Get('history')
  history(@Query() query: TransferHistoryQueryDto) {
    return this.transfersService.history(query);
  }

  /** Wallet balance, totals and paginated transaction history (mine, or a club's I lead). */
  @UseGuards(JwtAuthGuard)
  @Get('wallets/transactions')
  walletHistory(@CurrentUser() user: User, @Query() query: WalletHistoryQueryDto) {
    return this.transfersService.walletHistory(user, query);
  }

  /** "Add demo funds" to my wallet, or to a club wallet I lead. */
  @UseGuards(JwtAuthGuard)
  @Post('wallets/top-up')
  topUp(@CurrentUser() user: User, @Body() dto: TopUpDto) {
    return this.transfersService.topUp(user, dto.clubId);
  }
}
