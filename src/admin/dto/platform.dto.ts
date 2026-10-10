import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  NotEquals,
  ValidateIf,
} from 'class-validator';

class PageDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5000)
  limit?: number;
}

export const OFFER_STATUSES = ['pending', 'scheduled', 'completed', 'declined', 'cancelled', 'expired', 'reversed'] as const;
export const OFFER_KINDS = ['player_proposal', 'club_offer', 'renewal', 'buyout'] as const;
export const LEDGER_KINDS = ['top_up', 'hold', 'refund', 'payout_sent', 'received', 'adjustment', 'reversal'] as const;

export class AdminOffersQueryDto extends PageDto {
  @IsOptional()
  @IsIn(['open', ...OFFER_STATUSES])
  status?: string;

  @IsOptional()
  @IsIn(OFFER_KINDS)
  kind?: string;

  @IsOptional()
  @IsUUID()
  clubId?: string;

  @IsOptional()
  @IsUUID()
  playerUserId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

export class LedgerQueryDto extends PageDto {
  @IsOptional()
  @IsIn(['user', 'club'])
  ownerType?: 'user' | 'club';

  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @IsOptional()
  @IsIn(LEDGER_KINDS)
  kind?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

export class WalletAdjustDto {
  @IsIn(['user', 'club'])
  ownerType!: 'user' | 'club';

  @IsUUID()
  ownerId!: string;

  /** Positive adds money, negative removes it. */
  @Type(() => Number)
  @IsInt()
  @Min(-1_000_000)
  @Max(1_000_000)
  @NotEquals(0)
  amountTk!: number;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class EndLockDto {
  @IsUUID()
  userId!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

// ------------------------------------------------------------------ settings

export class TransferSettingsDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100000) baseFeeTk?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365) lockDays?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(30) offerExpiryDays?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1000000) clubStartingBalanceTk?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1000000) playerStartingBalanceTk?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1000000) demoTopUpTk?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(50) maxLoansPerClub?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) maxLoanMatches?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(7) @Max(365) maxLoanDays?: number;
}

export class AdminSettingsDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365) binRetentionDays?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(90) moderatorMaxSuspendDays?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) reportDailyLimit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(20) reportStrikeLimit?: number;
}

export class FeaturesDto {
  @IsOptional() @IsBoolean() signupsOpen?: boolean;
  @IsOptional() @IsBoolean() transfersOpen?: boolean;
  @IsOptional() @IsBoolean() reportsOpen?: boolean;
}

export class MaintenanceDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsString() @MaxLength(300) message?: string;
}

// ------------------------------------------------------------- announcements

export const AUDIENCES = ['all', 'staff', 'leaders', 'country', 'community', 'club'] as const;

export class CreateAnnouncementDto {
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  title!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  message!: string;

  /** An in-app link (e.g. /dashboard/efootball/tournaments/…). */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  link?: string;

  @IsIn(AUDIENCES)
  audience!: (typeof AUDIENCES)[number];

  @ValidateIf((o: CreateAnnouncementDto) => o.audience === 'country')
  @IsString()
  @MinLength(2)
  country?: string;

  @ValidateIf((o: CreateAnnouncementDto) => o.audience === 'community' || o.audience === 'club')
  @IsUUID()
  targetId?: string;

  /** Leave empty to send now. */
  @IsOptional()
  @IsDateString()
  scheduledFor?: string;
}

export class AnnouncementsQueryDto extends PageDto {}
