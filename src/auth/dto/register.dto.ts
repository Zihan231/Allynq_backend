import { IsEmail, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  /** International (E.164) format, e.g. +8801712345678. */
  @IsString()
  @IsNotEmpty({ message: 'Phone number is required' })
  @Matches(/^\+[1-9]\d{6,14}$/, {
    message: 'Enter the phone number with its country code, e.g. +8801712345678',
  })
  @Matches(/^(?!\+880)|^\+8801[3-9]\d{8}$/, {
    message: 'Enter a valid Bangladeshi mobile number, e.g. +8801712345678',
  })
  phoneNumber!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  country?: string;

  @IsOptional()
  @IsString()
  bio?: string;
}
