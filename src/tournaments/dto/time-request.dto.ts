import { IsBoolean, IsDateString } from 'class-validator';

export class RequestTimeChangeDto {
  /** New start (same local date as the current range). */
  @IsDateString()
  proposedStart!: string;
}

export class RespondTimeChangeDto {
  @IsBoolean()
  accept!: boolean;
}
