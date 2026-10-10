import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard.js';
import { User } from '../users/entities/user.entity.js';
import { ProfileRequirementsGuard, RequireCompleteProfile } from '../users/profile-requirements.guard.js';
import {
  BuyLoanDto,
  CounterLoanDto,
  CounterOfferDto,
  CreateLoanDto,
  CreateOfferDto,
  FreeAgentsQueryDto,
  RespondOfferDto,
  TopUpDto,
  TransferHistoryQueryDto,
  WalletHistoryQueryDto,
} from './dto/transfer.dto.js';
import { LoansService } from './loans.service.js';
import { TransfersService } from './transfers.service.js';

@Controller('transfers')
export class TransfersController {
  constructor(
    private readonly transfersService: TransfersService,
    private readonly loansService: LoansService,
  ) {}

  /** My contract, open offers, wallet and any tournament holding a transfer. */
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: User) {
    return this.transfersService.me(user);
  }

  /** A player proposes himself to a club, or a club leader makes an offer (paid upfront into a hold). */
  @UseGuards(JwtAuthGuard, ProfileRequirementsGuard)
  @RequireCompleteProfile()
  @Post('offers')
  createOffer(@CurrentUser() user: User, @Body() dto: CreateOfferDto) {
    return this.transfersService.createOffer(user, dto);
  }

  @UseGuards(JwtAuthGuard, ProfileRequirementsGuard)
  @RequireCompleteProfile()
  @Post('offers/:id/respond')
  respond(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RespondOfferDto) {
    return this.transfersService.respond(user, id, dto);
  }

  /** The side whose turn it is answers with a new amount; the turn passes to the other side. */
  @UseGuards(JwtAuthGuard)
  @Post('offers/:id/counter')
  counter(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CounterOfferDto) {
    return this.transfersService.counter(user, id, dto);
  }

  /** The negotiation so far: the opening amount and every counter-offer, oldest first. */
  @UseGuards(JwtAuthGuard)
  @Get('offers/:id/bids')
  bids(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.transfersService.bids(user, id);
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

  // ------------------------------------------------------------------ loans

  /** A club leader proposes a loan: borrow another club's player, or lend his own player out. */
  @UseGuards(JwtAuthGuard)
  @Post('loans')
  createLoan(@CurrentUser() user: User, @Body() dto: CreateLoanDto) {
    return this.loansService.create(user, dto);
  }

  /** The signed-in player's loans. */
  @UseGuards(JwtAuthGuard)
  @Get('loans/me')
  myLoans(@CurrentUser() user: User) {
    return this.loansService.mine(user);
  }

  /** A club's loans in and out (open proposals only for its President / GS). */
  @UseGuards(OptionalJwtAuthGuard)
  @Get('loans/clubs/:clubId')
  clubLoans(@CurrentUser() user: User | null, @Param('clubId', ParseUUIDPipe) clubId: string) {
    return this.loansService.forClub(user, clubId);
  }

  /** A loan with its negotiation (the player and both clubs' leaders). */
  @UseGuards(JwtAuthGuard)
  @Get('loans/:id')
  loan(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.loansService.get(user, id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('loans/:id/respond')
  respondLoan(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RespondOfferDto) {
    return this.loansService.respond(user, id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('loans/:id/counter')
  counterLoan(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CounterLoanDto) {
    return this.loansService.counter(user, id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('loans/:id/cancel')
  cancelLoan(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.loansService.cancel(user, id);
  }

  /** The borrowing club buys the player on loan at his current transfer fee. */
  @UseGuards(JwtAuthGuard)
  @Post('loans/:id/buy')
  buyLoan(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BuyLoanDto) {
    return this.loansService.buy(user, id, dto);
  }

  /** "Add demo funds" to my wallet, or to a club wallet I lead. */
  @UseGuards(JwtAuthGuard)
  @Post('wallets/top-up')
  topUp(@CurrentUser() user: User, @Body() dto: TopUpDto) {
    return this.transfersService.topUp(user, dto.clubId);
  }
}
