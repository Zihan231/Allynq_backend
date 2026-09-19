import { IsEnum, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';
import { CommunityRole } from '../../users/enums/user-attributes.enum.js';

export class CommunityMembersQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(CommunityRole)
  role?: CommunityRole;
}
