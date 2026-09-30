import { IsIn, IsUUID } from 'class-validator';
import { ClubRole } from '../../users/enums/user-attributes.enum.js';

/** Staff positions set from club Settings; `Player` clears a member's position. The President changes via transfer. */
export const ASSIGNABLE_CLUB_ROLES = [
  ClubRole.GENERAL_SECRETARY,
  ClubRole.MANAGER,
  ClubRole.CAPTAIN,
  ClubRole.VICE_CAPTAIN,
  ClubRole.ACADEMY_CAPTAIN,
  ClubRole.PLAYER,
] as const;

export class AssignPositionDto {
  @IsUUID('4', { message: 'profileId must be a valid UUID' })
  profileId!: string;

  @IsIn(ASSIGNABLE_CLUB_ROLES)
  role!: (typeof ASSIGNABLE_CLUB_ROLES)[number];
}
