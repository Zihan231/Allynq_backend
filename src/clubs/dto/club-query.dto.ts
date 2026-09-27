import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';
import { ClubStage } from '../enums/club.enum.js';

export class ClubQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(ClubStage)
  stage?: ClubStage;

  /** Return only this club (used for the "my club" card). */
  @IsOptional()
  @IsUUID()
  id?: string;

  /** Leave this club out of the results (the "my club" card is shown separately). */
  @IsOptional()
  @IsUUID()
  excludeId?: string;
}
