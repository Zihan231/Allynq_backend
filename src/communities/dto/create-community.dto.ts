import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { JoinPolicy } from '../../clubs/enums/club.enum.js';
import { CommunityTier } from '../enums/community.enum.js';

export class CreateCommunityDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  rules?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  dpUrl?: string | null;

  @IsOptional()
  @IsString()
  coverUrl?: string | null;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsString()
  initials?: string;

  @IsOptional()
  @IsEnum(JoinPolicy)
  joinPolicy?: JoinPolicy;

  @IsOptional()
  @IsEnum(CommunityTier)
  tier?: CommunityTier;

  @IsOptional()
  @IsString()
  location?: string | null;

  @IsOptional()
  @IsString()
  motto?: string | null;

  @IsOptional()
  @IsString()
  facebookUrl?: string | null;
}
