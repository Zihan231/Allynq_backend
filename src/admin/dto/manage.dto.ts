import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
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
  @Max(200)
  limit?: number;
}

export const DISPUTE_STATES = ['review', 'ready', 'stale', 'rejected', 'all'] as const;

export class DisputeQueryDto extends PageDto {
  /** review: waiting for a decision · ready: evidence window closed · stale: untouched 48h+ · rejected: waiting for new evidence. */
  @IsOptional()
  @IsIn(DISPUTE_STATES)
  state?: (typeof DISPUTE_STATES)[number];

  @IsOptional()
  @IsUUID()
  tournamentId?: string;

  @IsOptional()
  @IsUUID()
  communityId?: string;

  @IsOptional()
  @IsUUID()
  clubId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

export class DecideGameDto {
  @IsIn(['approve', 'reject'])
  action!: 'approve' | 'reject';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(99)
  goalsA?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(99)
  goalsB?: number;

  /** Shown to the players (reject) and kept in the audit log. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsOptional()
  @IsIn(['A', 'B'])
  deciderWinner?: 'A' | 'B';
}

export class EditClubDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  motto?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  location?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  minRoster?: number;

  /** Member limit override. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  maxRoster?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class EditCommunityDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  motto?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  location?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class SetLeaderDto {
  @IsUUID()
  userId!: string;

  /** Club: President / General Secretary. Community: President / Vice President. */
  @IsIn(['President', 'General Secretary', 'Vice President'])
  role!: 'President' | 'General Secretary' | 'Vice President';

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class FreezeDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class ClubCommunityDto {
  @IsUUID()
  communityId!: string;

  @IsIn(['add', 'remove'])
  action!: 'add' | 'remove';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class TournamentTimesDto {
  @IsOptional()
  @IsDateString()
  startAt?: string;

  /** Empty string clears it ("until it finishes"). */
  @IsOptional()
  @IsString()
  endAt?: string;

  @IsOptional()
  @IsString()
  registrationDeadline?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class TournamentStatusDto {
  @IsIn(['registration_open', 'ongoing', 'completed', 'cancelled'])
  status!: 'registration_open' | 'ongoing' | 'completed' | 'cancelled';

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class TournamentOfficialsDto {
  @IsArray()
  @ArrayMaxSize(30)
  @IsUUID('all', { each: true })
  userIds!: string[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class RemoveParticipantDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
