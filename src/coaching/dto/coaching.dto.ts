import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PAYMENT_METHODS } from '../../transfers/dto/transfer.dto.js';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';

export class UpdateCoachProfileDto {
  @IsOptional() @IsString() @MaxLength(120) headline?: string;
  @IsOptional() @IsString() @MaxLength(2000) bio?: string | null;
  @IsOptional() @IsUrl({ require_protocol: true }) @MaxLength(500) youtubeChannelUrl?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(8) @IsString({ each: true }) @MaxLength(40, { each: true }) specialities?: string[];
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10_000_000) askingFeeTk?: number | null;
  @IsOptional() @IsBoolean() available?: boolean;
}

/** Multipart text fields of a new post; files come as `media`. */
export class CreateCoachPostDto {
  @IsOptional() @IsString() @MaxLength(5000) body?: string;
  /** One link per line, or a JSON array. */
  @IsOptional() @IsString() @MaxLength(5000) links?: string;
}

export class CoachesQueryDto extends PaginationQueryDto {
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsIn(['true', 'false']) available?: 'true' | 'false';
}

/**
 * A coaching deal. Without `coachUserId` the caller is the coach asking to coach `clubId`;
 * with it, the caller leads `clubId` and offers that coach a deal (the club pays at once).
 */
export class CreateCoachingDealDto {
  @IsUUID() clubId!: string;
  @IsOptional() @IsUUID() coachUserId?: string;
  @Type(() => Number) @IsInt() @Min(0) @Max(10_000_000) feeTk!: number;
  @Type(() => Number) @IsInt() @Min(1) @Max(365) days!: number;
  @IsOptional() @IsString() @MaxLength(500) message?: string;
  @IsOptional() @IsIn(PAYMENT_METHODS) paymentMethod?: (typeof PAYMENT_METHODS)[number];
}

export class RespondCoachingDealDto {
  @IsBoolean() accept!: boolean;
  @IsOptional() @IsIn(PAYMENT_METHODS) paymentMethod?: (typeof PAYMENT_METHODS)[number];
}

export class CounterCoachingDealDto {
  @Type(() => Number) @IsInt() @Min(0) @Max(10_000_000) feeTk!: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365) days?: number;
  @IsOptional() @IsString() @MaxLength(500) message?: string;
  @IsOptional() @IsIn(PAYMENT_METHODS) paymentMethod?: (typeof PAYMENT_METHODS)[number];
}

export class ReviewCoachPostDto {
  @IsBoolean() approve!: boolean;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class AdminCoachPostsQueryDto extends PaginationQueryDto {
  @IsOptional() @IsIn(['pending', 'approved', 'rejected']) status?: 'pending' | 'approved' | 'rejected';
  /** Coach posts or sponsor posts (all when not set). */
  @IsOptional() @IsIn(['coach', 'sponsor']) author?: 'coach' | 'sponsor';
}
