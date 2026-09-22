import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class RosterPlayerDto {
  @IsUUID()
  profileId!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  inGameId?: string | null;

  @IsOptional()
  @IsString()
  position?: string | null;

  @IsOptional()
  @IsInt()
  shirtNumber?: number | null;
}

export class SubmitLineupDto {
  @IsOptional()
  @IsUUID()
  teamId?: string;

  @IsOptional()
  @IsString()
  teamName?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RosterPlayerDto)
  starters!: RosterPlayerDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RosterPlayerDto)
  substitutes!: RosterPlayerDto[];
}
