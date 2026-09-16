import { IsEnum, IsNotEmpty } from 'class-validator';
import { EfootballPosition } from '../../users/enums/efootball-position.enum.js';

export class ShiftPositionDto {
  @IsNotEmpty()
  @IsEnum(EfootballPosition, {
    message: `gamePosition must be a valid eFootball position (${Object.values(EfootballPosition).join(', ')})`,
  })
  gamePosition!: EfootballPosition;
}
