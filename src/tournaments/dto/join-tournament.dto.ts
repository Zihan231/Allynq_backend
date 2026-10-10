import { Type } from 'class-transformer';
import { IsIn, IsOptional, IsUUID, ValidateNested } from 'class-validator';
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

  /** General tournaments with an entry fee: how the entrant pays (held until fixtures are out). */
  @IsOptional()
  @IsIn(['bkash', 'nagad', 'card'])
  paymentMethod?: 'bkash' | 'nagad' | 'card';
}
