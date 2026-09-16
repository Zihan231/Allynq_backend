import { IsNotEmpty, IsUUID } from 'class-validator';

export class SwapPositionsDto {
  @IsNotEmpty()
  @IsUUID('4', { message: 'profileId1 must be a valid UUID' })
  profileId1!: string;

  @IsNotEmpty()
  @IsUUID('4', { message: 'profileId2 must be a valid UUID' })
  profileId2!: string;
}
