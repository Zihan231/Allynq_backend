import { IsOptional, IsUUID } from 'class-validator';

export class JoinTournamentDto {
  @IsOptional()
  @IsUUID()
  clubId?: string;
}
