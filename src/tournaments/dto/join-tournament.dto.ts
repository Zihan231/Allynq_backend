import { Type } from 'class-transformer';
import { IsOptional, IsUUID, ValidateNested } from 'class-validator';
import { SubmitLineupDto } from './submit-lineup.dto.js';

export class JoinTournamentDto {
  @IsOptional()
  @IsUUID()
  clubId?: string;

  /** Required for CvC: clubs register together with their team for the tournament preset. */
  @IsOptional()
  @ValidateNested()
  @Type(() => SubmitLineupDto)
  lineup?: SubmitLineupDto;
}
