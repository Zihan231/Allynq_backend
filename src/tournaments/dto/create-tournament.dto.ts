import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsDivisibleBy,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { TournamentPreset, TournamentType } from '../enums/tournament.enum.js';

export const MAX_MATCH_OFFICIALS = 10;

export class CreateTournamentDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(TournamentType)
  type!: TournamentType;

  @IsUUID()
  communityId!: string;

  @IsOptional()
  @IsString()
  preset?: string;

  @IsOptional()
  @IsBoolean()
  isPaid?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  startersCount?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  subsCount?: number;

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
  registrationDeadline?: string;

  @IsDateString()
  startAt!: string;

  @IsOptional()
  @IsDateString()
  endAt?: string;
}
