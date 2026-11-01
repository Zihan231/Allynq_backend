import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsIn } from 'class-validator';

/** What a user can be on Allynq. Player and organizer are the dashboard modes; the rest are new areas. */
export const USER_ROLES = ['player', 'organizer', 'coach', 'creative', 'sponsor', 'social'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export class SetRolesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(USER_ROLES.length)
  @ArrayUnique()
  @IsIn(USER_ROLES, { each: true })
  roles!: UserRole[];

  /** The role the dashboard opens in; one of `roles`. */
  @IsIn(USER_ROLES)
  primaryRole!: UserRole;
}
