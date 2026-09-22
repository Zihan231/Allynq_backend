import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { BloodGroup, DocumentType, VerificationLevel } from '../enums/user-attributes.enum.js';
import { EducationEntryDto } from './education-entry.dto.js';
import { LatLngDto } from './lat-lng.dto.js';
import { WorkExperienceEntryDto } from './work-experience.dto.js';

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  password?: string;

  @IsOptional()
  @IsString()
  dpUrl?: string;

  @IsOptional()
  @IsString()
  coverUrl?: string;

  @IsOptional()
  @IsString()
  bio?: string;

  @IsOptional()
  @IsString()
  facebookUrl?: string;

  @IsOptional()
  @IsString()
  facebookProfileName?: string;

  @IsOptional()
  @IsString()
  instagramUrl?: string;

  @IsOptional()
  @IsString()
  discordUrl?: string;

  @IsOptional()
  @IsString()
  inGameId?: string;

  @IsOptional()
  @IsString()
  deviceName?: string;

  @IsOptional()
  @IsString()
  deviceModel?: string;

  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @IsOptional()
  @IsDateString()
  birthday?: string;

  @IsOptional()
  @IsEnum(BloodGroup)
  bloodGroup?: BloodGroup;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  division?: string;

  @IsOptional()
  @IsString()
  district?: string;

  @IsOptional()
  @IsString()
  permanentAddress?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => LatLngDto)
  currentLocation?: LatLngDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkExperienceEntryDto)
  workExperience?: WorkExperienceEntryDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EducationEntryDto)
  education?: EducationEntryDto[];

  @IsOptional()
  @IsEnum(DocumentType)
  documentType?: DocumentType;

  @IsOptional()
  @IsString()
  documentDataUrl?: string;

  @IsOptional()
  @IsEnum(VerificationLevel)
  verificationLevel?: VerificationLevel;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  ownedCosmeticIds?: string[];

  @IsOptional()
  @IsString()
  equippedBadgeId?: string;

  @IsOptional()
  @IsString()
  equippedTitleId?: string;

  @IsOptional()
  @IsString()
  equippedFrameId?: string;

  @IsOptional()
  @IsString()
  equippedThemeId?: string;
}
