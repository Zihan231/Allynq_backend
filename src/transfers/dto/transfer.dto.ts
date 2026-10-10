import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';

export const PAYMENT_METHODS = ['bkash', 'nagad', 'card'] as const;

/**
 * Either a player proposing himself to a club (`clubId`, no `playerUserId`), or a
 * club (`clubId` = the club you lead) offering a player (`playerUserId`). For club
 * offers the server decides the kind: renewal (his own player), buyout (locked at
 * another club; amount = his current fee) or club offer (free player).
 */
export class CreateOfferDto {
  @IsUUID()
  clubId!: string;

  @IsOptional()
  @IsUUID()
  playerUserId?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  amountTk!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;

  /** Required when a club sends an offer with money: the club pays (into a hold) right away. */
  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  paymentMethod?: (typeof PAYMENT_METHODS)[number];
}

export class RespondOfferDto {
  @IsBoolean()
  accept!: boolean;

  /** Required when a club accepts a player's proposal with money. */
  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  paymentMethod?: (typeof PAYMENT_METHODS)[number];
}

/** A counter-offer: the side whose turn it is answers with a new amount. */
export class CounterOfferDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  amountTk!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;

  /** Required when the club counters with more money than it already holds for the offer. */
  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  paymentMethod?: (typeof PAYMENT_METHODS)[number];
}

/**
 * A loan proposal from a club you lead (`clubId`): a borrow request for another club's
 * player, or (`otherClubId` set, player in your club) lending your player out.
 * The borrowing club pays the fee; matches / days are capped by the transfer settings.
 */
export class CreateLoanDto {
  @IsUUID()
  clubId!: string;

  @IsUUID()
  playerUserId!: string;

  /** Lending out: the club that would borrow him. */
  @IsOptional()
  @IsUUID()
  otherClubId?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  feeTk!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  matches!: number;

  @Type(() => Number)
  @IsInt()
  @Min(7)
  @Max(365)
  maxDays!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;

  /** Required when the borrowing club proposes a fee: it's held from its wallet at once. */
  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  paymentMethod?: (typeof PAYMENT_METHODS)[number];
}

/** A counter-offer on a loan: a new fee from the club whose turn it is. */
export class CounterLoanDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  feeTk!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;

  /** Required when the borrowing club counters with more than it already holds. */
  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  paymentMethod?: (typeof PAYMENT_METHODS)[number];
}

/** The borrowing club buys the player on loan at his current transfer fee. */
export class BuyLoanDto {
  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  paymentMethod?: (typeof PAYMENT_METHODS)[number];
}

export class FreeAgentsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class TransferHistoryQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsUUID()
  clubId?: string;

  @IsOptional()
  @IsUUID()
  userId?: string;
}

export class TopUpDto {
  /** Top up a club wallet you lead; omit for your own wallet. */
  @IsOptional()
  @IsUUID()
  clubId?: string;
}

export const WALLET_TX_KINDS = ['top_up', 'hold', 'refund', 'payout_sent', 'received', 'purchase'] as const;

export class WalletHistoryQueryDto extends PaginationQueryDto {
  /** A club wallet you lead; omit for your own wallet. */
  @IsOptional()
  @IsUUID()
  clubId?: string;

  @IsOptional()
  @IsIn(WALLET_TX_KINDS)
  kind?: (typeof WALLET_TX_KINDS)[number];
}
