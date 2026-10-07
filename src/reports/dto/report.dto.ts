import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { REPORT_REASONS, REPORT_STATUSES, REPORT_TARGETS } from '../entities/report.entity.js';

const toBool = ({ value }: { value: unknown }) => value === true || value === 'true' || value === '1';

/** Sent as multipart form fields (with up to 3 "images"). */
export class CreateReportDto {
  @IsIn(REPORT_TARGETS)
  targetType!: (typeof REPORT_TARGETS)[number];

  @IsUUID()
  targetId!: string;

  @IsIn(REPORT_REASONS)
  reason!: (typeof REPORT_REASONS)[number];

  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  details!: string;

  @IsOptional()
  @IsIn(['self', 'club', 'community'])
  reportedAs?: 'self' | 'club' | 'community';
}

export class ReportMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body!: string;
}

export class StaffNoteDto extends ReportMessageDto {
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  internal?: boolean;
}

class PageDto {
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

export class MyReportsQueryDto extends PageDto {}

export class AdminReportsQueryDto extends PageDto {
  /** "active" = open + in review (the default). */
  @IsOptional()
  @IsIn(['active', 'all', ...REPORT_STATUSES])
  status?: string;

  @IsOptional()
  @IsIn(REPORT_TARGETS)
  targetType?: string;

  @IsOptional()
  @IsIn(REPORT_REASONS)
  reason?: string;

  /** "me", "unassigned" or a staff user id. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  assignee?: string;

  @IsOptional()
  @IsIn(['self', 'club', 'community', 'leaders'])
  reportedAs?: string;

  @IsOptional()
  @IsUUID()
  targetId?: string;

  @IsOptional()
  @IsUUID()
  clubId?: string;

  @IsOptional()
  @IsUUID()
  communityId?: string;

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

  @IsOptional()
  @IsIn(['priority', 'newest', 'oldest'])
  sort?: 'priority' | 'newest' | 'oldest';
}

export class AssignReportDto {
  /** A staff user id, or null to unassign. */
  @IsOptional()
  @IsUUID()
  assigneeId?: string | null;
}

export const REPORT_ACTIONS = ['none', 'warn', 'suspend', 'ban', 'bin'] as const;

export class ResolveReportDto {
  @IsIn(['action_taken', 'rejected'])
  outcome!: 'action_taken' | 'rejected';

  /** Shown to the reporter. */
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  resolution!: string;

  /** What to do to the target (users: warn / suspend / ban / bin; clubs, communities, tournaments: bin). */
  @IsOptional()
  @IsIn(REPORT_ACTIONS)
  action?: (typeof REPORT_ACTIONS)[number];

  /** Reason shown to the target for warn / suspend / ban; defaults to the resolution. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  actionReason?: string;

  @IsOptional()
  @IsDateString()
  until?: string;

  /** Rejected as made up or abusive: the reporter gets a strike. */
  @IsOptional()
  @IsBoolean()
  falseReport?: boolean;

  /** Also close the other open reports on the same target the same way. */
  @IsOptional()
  @IsBoolean()
  closeSimilar?: boolean;
}

export class ActivityFeedQueryDto extends PageDto {
  @IsOptional()
  @IsUUID()
  userId?: string;

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

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

export class LoginFeedQueryDto extends PageDto {
  @IsOptional()
  @IsIn(['success', 'failed'])
  result?: 'success' | 'failed';

  @IsOptional()
  @IsString()
  @MaxLength(64)
  ip?: string;

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
