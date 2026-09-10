import { IsNumber } from 'class-validator';

export class LatLngDto {
  @IsNumber()
  lat!: number;

  @IsNumber()
  lng!: number;
}
