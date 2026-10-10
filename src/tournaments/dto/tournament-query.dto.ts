import { IsEnum, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { GamingPlatform } from '../../users/enums/user-attributes.enum.js';
import { TournamentType } from '../enums/tournament.enum.js';

export class TournamentQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(TournamentType)
  type?: TournamentType;

  @IsOptional()
  @IsEnum(GamingPlatform)
  platform?: GamingPlatform;

  @IsOptional()
  @IsUUID()
  communityId?: string;

  /** Only tournaments this club has entered. */
  @IsOptional()
  @IsUUID()
  clubId?: string;

  /** Only tournaments this club hosts. */
  @IsOptional()
  @IsUUID()
  hostClubId?: string;

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

  /** 'true' → only tournaments the current user (or their club) has entered. Requires auth. */
  @IsOptional()
  @IsString()
  joined?: string;

  /**
   * The current user's tournaments (requires auth): 'joined' (they or their club
   * entered), 'hosted' (their community hosts it as President / Vice President,
   * or they created it) or 'mine' (either).
   */
  @IsOptional()
  @IsIn(['joined', 'hosted', 'mine'])
  scope?: 'joined' | 'hosted' | 'mine';
}
