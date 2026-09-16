import { IsOptional, IsUUID } from 'class-validator';

export class ChangeManagerDto {
  @IsOptional()
  @IsUUID('4', { message: 'targetUserId must be a valid UUID' })
  targetUserId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'targetProfileId must be a valid UUID' })
  targetProfileId?: string;
}
