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
