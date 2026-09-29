import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsDivisibleBy,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  IsUUID,
  Min,
  ValidateIf,
} from 'class-validator';
import { MAX_MATCH_OFFICIALS } from './create-tournament.dto.js';

/**
 * Editable tournament details. Format, roster preset and roster size are fixed
 * at creation (clubs may already have built lineups around them).
 */
export class UpdateTournamentDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(4)
  @IsDivisibleBy(4, { message: 'maxParticipants must be a multiple of 4' })
  maxParticipants?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  entryFeeBdt?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  prizePoolBdt?: number;

  /** Daily play hours, minutes after midnight (Dhaka time). End may be before start (runs past midnight). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1439)
  playHoursStart?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1439)
  playHoursEnd?: number;

  /** Community members who review match evidence alongside the President and Vice President. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_MATCH_OFFICIALS)
  @IsUUID('all', { each: true })
  matchOfficialIds?: string[];

  @IsOptional()
  @IsDateString()
  startAt?: string;

  /** `null` clears the estimated end time. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsDateString()
  endAt?: string | null;
}
