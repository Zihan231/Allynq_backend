import { IsEnum, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';
import { ClubRole } from '../../users/enums/user-attributes.enum.js';

export class ClubMembersQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(ClubRole)
  role?: ClubRole;
}
