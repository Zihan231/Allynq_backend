import { IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';
import { LineupStatus } from '../../users/enums/user-attributes.enum.js';

export class AddTeamPlayerDto {
  @IsNotEmpty()
  @IsUUID('4', { message: 'profileId must be a valid UUID' })
  profileId!: string;

  @IsOptional()
  @IsEnum(LineupStatus)
  lineupStatus?: LineupStatus;

  @IsOptional()
  @IsString()
  gamePosition?: string;
}
