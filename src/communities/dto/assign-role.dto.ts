import { IsEnum, IsNotEmpty, IsOptional, IsUUID } from 'class-validator';
import { CommunityRole } from '../../users/enums/user-attributes.enum.js';

export class AssignRoleDto {
  @IsOptional()
  @IsUUID()
  targetUserId?: string;

  @IsOptional()
  @IsUUID()
  targetProfileId?: string;

  @IsEnum(CommunityRole)
  @IsNotEmpty()
  role!: CommunityRole;
}
