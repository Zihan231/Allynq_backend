import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';

export const MY_GAME_STATES = ['to_play', 'waiting', 'review', 'finished'] as const;
export type MyGameState = (typeof MY_GAME_STATES)[number];

export class MyGamesQueryDto extends PaginationQueryDto {
  /** Only games of tournaments hosted by a club, a community, or an organizer (general tournaments). */
  @IsOptional()
  @IsIn(['club', 'community', 'general'])
  host?: 'club' | 'community' | 'general';

  /** One specific hosting club or community (use with `host`). */
  @IsOptional()
  @IsUUID()
  hostId?: string;

  @IsOptional()
  @IsIn(MY_GAME_STATES)
  state?: MyGameState;

  /** Matches the tournament, the opponent, the clubs in the fixture or the host. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
