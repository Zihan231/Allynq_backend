import { IsEnum, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';
import { CommunityTier } from '../enums/community.enum.js';

export class CommunityQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(CommunityTier)
  tier?: CommunityTier;
}
