import { IsOptional, IsString, IsUUID } from 'class-validator';

export class UpdateTeamDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsUUID()
  captainProfileId?: string | null;
}
