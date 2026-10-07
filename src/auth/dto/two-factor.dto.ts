import { IsString, Matches, MinLength } from 'class-validator';

export class StaffTwoFactorTokenDto {
  @IsString()
  @MinLength(20)
  token!: string;
}

export class VerifyStaffTwoFactorDto extends StaffTwoFactorTokenDto {
  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;
}
