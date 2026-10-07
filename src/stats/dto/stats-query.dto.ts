import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';
import { RANKING_PERIODS, type RankingPeriod } from '../stats.sql.js';

class StatsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(RANKING_PERIODS)
  period?: RankingPeriod;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class PlayerRankingsQueryDto extends StatsQueryDto {
  /** Only members of this club (all of them, including those with no games yet). */
  @IsOptional()
  @IsUUID()
  clubId?: string;

  /** Only members of this community (all of them, including those with no games yet). */
  @IsOptional()
  @IsUUID()
  communityId?: string;
}

export class ClubRankingsQueryDto extends StatsQueryDto {
  /** Only this community's member clubs (all of them, including those with no fixtures yet). */
  @IsOptional()
  @IsUUID()
  communityId?: string;
}
