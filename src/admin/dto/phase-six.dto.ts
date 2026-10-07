import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsHexColor,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateSecurityBanDto {
  @IsIn(['ip', 'device'])
  kind!: 'ip' | 'device';

  /** Complete IP or x-device-id. It is hashed before storage. */
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  value!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

export class BanLoginDeviceDto {
  @IsIn(['ip', 'device'])
  kind!: 'ip' | 'device';

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

export class StaffNoteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body!: string;
}

export class AccountLabelDto {
  @IsString()
  @MinLength(1)
  @MaxLength(48)
  label!: string;

  @IsOptional()
  @IsHexColor()
  color?: string;
}

export class NotificationTemplateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  titleTemplate!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  messageTemplate!: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  titleTemplateBn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  messageTemplateBn?: string;
}

export class CreateSeasonDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsDateString()
  startsAt!: string;

  @IsDateString()
  endsAt!: string;

  @IsOptional()
  @IsObject()
  rules?: Record<string, unknown>;
}

export class UpdateSeasonDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsDateString() startsAt?: string;
  @IsOptional() @IsDateString() endsAt?: string;
  @IsOptional() @IsObject() rules?: Record<string, unknown>;
}

export class CloseSeasonDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class CreateStoreItemDto {
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9_-]{1,63}$/)
  sku!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsIn(['badge', 'title', 'frame', 'theme']) category!:
    'badge' | 'title' | 'frame' | 'theme';
  @Type(() => Number) @IsInt() @Min(0) @Max(1_000_000) priceTk!: number;
  @IsOptional() @IsString() @MaxLength(2000) assetUrl?: string;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-1_000_000)
  @Max(1_000_000)
  sortOrder?: number;
  @IsOptional() @IsObject() metadata?: Record<string, unknown>;
}

export class UpdateStoreItemDto {
  @IsOptional() @IsString() @Matches(/^[a-z0-9][a-z0-9_-]{1,63}$/) sku?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsIn(['badge', 'title', 'frame', 'theme']) category?:
    'badge' | 'title' | 'frame' | 'theme';
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  priceTk?: number;
  @IsOptional() @IsString() @MaxLength(2000) assetUrl?: string;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-1_000_000)
  @Max(1_000_000)
  sortOrder?: number;
  @IsOptional() @IsObject() metadata?: Record<string, unknown>;
}

export class StoreItemGrantDto {
  @IsUUID()
  itemId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class ViewAsUserDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  minutes?: number;
}
