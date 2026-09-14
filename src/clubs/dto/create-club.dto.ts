import {
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { ClubStage, JoinPolicy } from '../enums/club.enum.js';

export class CreateClubDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  color!: string;

  @IsString()
  @IsNotEmpty()
  initials!: string;

  @IsOptional()
  @IsString()
  dpUrl?: string;

  @IsOptional()
  @IsString()
  coverUrl?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  points?: number;

  @IsOptional()
  @IsEnum(JoinPolicy)
  joinPolicy?: JoinPolicy;

  @IsOptional()
  @IsInt()
  @Min(1)
  minRoster?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxRoster?: number;

  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  communityIds?: string[];

  @IsOptional()
  @IsEnum(ClubStage)
  stage?: ClubStage;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  motto?: string;

  @IsOptional()
  @IsString()
  facebookUrl?: string;
}
