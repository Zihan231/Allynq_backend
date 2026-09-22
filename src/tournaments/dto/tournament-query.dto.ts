import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { TournamentType } from '../enums/tournament.enum.js';

export class TournamentQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(TournamentType)
  type?: TournamentType;

  @IsOptional()
  @IsUUID()
  communityId?: string;

  @IsOptional()
  @IsString()
  hasPrize?: string; // 'true' or 'false'

  @IsOptional()
  @IsString()
  isFree?: string; // 'true' or 'false'

  @IsOptional()
  @IsString()
  sortBy?: 'startAt' | 'prizePoolBdt' | 'createdAt';

  @IsOptional()
  @IsString()
  sortOrder?: 'ASC' | 'DESC';
}
