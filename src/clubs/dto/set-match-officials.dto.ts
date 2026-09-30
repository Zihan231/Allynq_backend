import { ArrayMaxSize, IsArray, IsUUID } from 'class-validator';

export const MAX_CLUB_MATCH_OFFICIALS = 20;

/** The club's match-official nominees (user ids of members). */
export class SetMatchOfficialsDto {
  @IsArray()
  @ArrayMaxSize(MAX_CLUB_MATCH_OFFICIALS)
  @IsUUID('all', { each: true })
  userIds!: string[];
}
