import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { LineupStatus } from '../../users/enums/user-attributes.enum.js';

export class LineupPlayerDto {
  @IsUUID()
  profileId!: string;

  @IsEnum(LineupStatus)
  lineupStatus!: LineupStatus;

  @IsOptional()
  @IsString()
  gamePosition?: string;
}

export class SetLineupDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LineupPlayerDto)
  players!: LineupPlayerDto[];
}
