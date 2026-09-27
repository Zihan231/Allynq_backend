import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';
import { JoinPolicy } from '../../clubs/enums/club.enum.js';
import { CommunityTier } from '../enums/community.enum.js';

export const COMMUNITY_SORTS = ['rating', 'clubs', 'name'] as const;
export type CommunitySort = (typeof COMMUNITY_SORTS)[number];

export class CommunityQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(CommunityTier)
  tier?: CommunityTier;

  @IsOptional()
  @IsEnum(JoinPolicy)
  joinPolicy?: JoinPolicy;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minPoints?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minClubs?: number;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  hasFreeAgents?: boolean;

  @IsOptional()
  @IsIn(COMMUNITY_SORTS)
  sort?: CommunitySort;

  /** Return only this community (used for the "my community" card). */
  @IsOptional()
  @IsUUID()
  id?: string;

  /** Leave this community out of the results (the "my community" card is shown separately). */
  @IsOptional()
  @IsUUID()
  excludeId?: string;
}
