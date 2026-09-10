import { IsString, IsNotEmpty } from 'class-validator';

export class WorkExperienceEntryDto {
  @IsString()
  @IsNotEmpty()
  workplace!: string;

  @IsString()
  @IsNotEmpty()
  jobTitle!: string;
}
