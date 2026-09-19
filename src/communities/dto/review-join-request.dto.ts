import { IsEnum, IsNotEmpty } from 'class-validator';
import { CommunityJoinRequestStatus } from '../enums/community.enum.js';

export class ReviewJoinRequestDto {
  @IsEnum([CommunityJoinRequestStatus.APPROVED, CommunityJoinRequestStatus.REJECTED], {
    message: 'status must be either approved or rejected',
  })
  @IsNotEmpty()
  status!: CommunityJoinRequestStatus.APPROVED | CommunityJoinRequestStatus.REJECTED;
}
