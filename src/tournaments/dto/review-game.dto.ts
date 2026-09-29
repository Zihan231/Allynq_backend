import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** An official's decision on a game's submitted result. */
export class ReviewGameDto {
  @IsIn(['approve', 'reject'])
  action!: 'approve' | 'reject';

  /** Official final score, required to approve. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(99)
  goalsA?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(99)
  goalsB?: number;

  /** Reason shown to the players when rejecting. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  /** Winner of the decider when a knockout fixture ends level. */
  @IsOptional()
  @IsIn(['A', 'B'])
  deciderWinner?: 'A' | 'B';
}
