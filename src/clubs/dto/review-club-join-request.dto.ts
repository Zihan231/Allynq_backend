import { IsIn, IsNotEmpty } from 'class-validator';

export class ReviewClubJoinRequestDto {
  @IsIn(['approved', 'rejected'], {
    message: 'status must be either approved or rejected',
  })
  @IsNotEmpty()
  status!: 'approved' | 'rejected';
}
