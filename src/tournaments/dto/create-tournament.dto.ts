import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { TournamentPreset, TournamentType } from '../enums/tournament.enum.js';

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
  subsCount?: number;

  @IsOptional()
  @IsInt()
  @Min(2)
  maxParticipants?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  entryFeeBdt?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  prizePoolBdt?: number;

  @IsOptional()
  @IsDateString()
  registrationDeadline?: string;

  @IsDateString()
  startAt!: string;

  @IsOptional()
  @IsDateString()
  endAt?: string;
}
