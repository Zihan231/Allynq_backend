import { IsIn, IsNotEmpty, IsString } from 'class-validator';

const INSTITUTE_TYPES = ['University', 'College', 'School', 'Other'] as const;

export class EducationEntryDto {
  @IsString()
  @IsNotEmpty()
  instituteName!: string;

  @IsString()
  @IsNotEmpty()
  fieldOfStudy!: string;

  @IsIn(INSTITUTE_TYPES)
  instituteType!: (typeof INSTITUTE_TYPES)[number];
}
