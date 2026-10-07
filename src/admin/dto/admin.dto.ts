import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { BIN_ENTITY_TYPES, type BinEntityType } from '../../recycle-bin/recycle-bin-item.entity.js';
import { SystemRole } from '../../users/enums/user-attributes.enum.js';

const toBool = ({ value }: { value: unknown }) => value === true || value === 'true' || value === '1';

/** Admin lists allow big pages so the CSV export can take every filtered row (up to 5,000). */
class AdminPageDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5000)
  limit?: number;
}

export const USER_STATUSES = ['active', 'suspended', 'banned', 'deleted', 'warned'] as const;
export const USER_SORTS = ['newest', 'oldest', 'name', 'last_login', 'warnings'] as const;
export const VERIFICATION_STATUSES = ['none', 'pending', 'approved', 'rejected'] as const;

export class AdminUsersQueryDto extends AdminPageDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  division?: string;

  @IsOptional()
  @IsIn(USER_STATUSES)
  status?: (typeof USER_STATUSES)[number];

  @IsOptional()
  @IsIn(VERIFICATION_STATUSES)
  verificationStatus?: (typeof VERIFICATION_STATUSES)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3)
  verificationLevel?: number;

  @IsOptional()
  @IsIn(['none', 'staff', ...Object.values(SystemRole)])
  systemRole?: string;

  @IsOptional()
  @IsUUID()
  clubId?: string;

  @IsOptional()
  @IsUUID()
  communityId?: string;

  @IsOptional()
  @IsDateString()
  joinedFrom?: string;

  @IsOptional()
  @IsDateString()
  joinedTo?: string;

  @IsOptional()
  @IsIn(USER_SORTS)
  sort?: (typeof USER_SORTS)[number];
}

export class ReasonDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class OptionalReasonDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class SuspendDto extends ReasonDto {
  @IsDateString()
  until!: string;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(6)
  @MaxLength(72)
  password!: string;
}

export class EditUserDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phoneNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  division?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  district?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  bio?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class SetRoleDto {
  @IsIn(['none', ...Object.values(SystemRole)])
  role!: 'none' | SystemRole;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export const BULK_ACTIONS = ['warn', 'suspend', 'unsuspend', 'ban', 'unban', 'force_logout', 'bin', 'notify'] as const;
export type BulkAction = (typeof BULK_ACTIONS)[number];

export class BulkUsersDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  userIds!: string[];

  @IsIn(BULK_ACTIONS)
  action!: BulkAction;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsOptional()
  @IsDateString()
  until?: string;

  /** For "notify": the message to send. */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string;
}

export class VerificationQueryDto extends AdminPageDto {
  @IsOptional()
  @IsIn(VERIFICATION_STATUSES)
  status?: (typeof VERIFICATION_STATUSES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

export class VerificationReviewDto {
  @IsBoolean()
  approve!: boolean;

  /** Level to grant when approving (defaults to what the document type gives). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3)
  level?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export const GROUP_BYS = ['day', 'week', 'month'] as const;

export class DashboardQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  division?: string;

  @IsOptional()
  @IsUUID()
  communityId?: string;

  @IsOptional()
  @IsUUID()
  clubId?: string;

  @IsOptional()
  @IsIn(['pvp', 'cvc', 'club'])
  tournamentType?: 'pvp' | 'cvc' | 'club';

  @IsOptional()
  @IsIn(GROUP_BYS)
  groupBy?: (typeof GROUP_BYS)[number];

  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  compare?: boolean;
}

export class BinQueryDto extends AdminPageDto {
  @IsOptional()
  @IsIn(BIN_ENTITY_TYPES)
  type?: BinEntityType;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

export class AuditQueryDto extends AdminPageDto {
  @IsOptional()
  @IsUUID()
  actorId?: string;

  @IsOptional()
  @IsUUID()
  targetId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(24)
  targetType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(48)
  action?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

export class ActivityQueryDto extends AdminPageDto {
  @IsOptional()
  @IsString()
  @MaxLength(48)
  type?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

export class EntityListQueryDto extends AdminPageDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}
