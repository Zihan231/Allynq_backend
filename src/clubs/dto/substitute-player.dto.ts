import { IsNotEmpty, IsUUID } from 'class-validator';

export class SubstitutePlayerDto {
  @IsUUID()
  @IsNotEmpty()
  outProfileId!: string;

  @IsUUID()
  @IsNotEmpty()
  inProfileId!: string;
}
