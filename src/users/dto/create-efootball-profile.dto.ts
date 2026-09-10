import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { ClubRole, CommunityRole, SquadTeam } from '../enums/user-attributes.enum.js';

export class CreateEfootballProfileDto {
  @IsOptional()
  @IsString()
  konamiUid?: string;

  @IsOptional()
  @IsString()
  gamePosition?: string;

  @IsOptional()
  @IsEnum(SquadTeam)
  squadTeam?: SquadTeam;

  @IsOptional()
  @IsInt()
  @Min(1)
  shirtNumber?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  points?: number;

  @IsOptional()
  @IsUUID()
  clubId?: string;

  @IsOptional()
  @IsEnum(ClubRole)
  clubRole?: ClubRole;

  @IsOptional()
  @IsUUID()
  communityId?: string;

  @IsOptional()
  @IsEnum(CommunityRole)
  communityRole?: CommunityRole;
}
