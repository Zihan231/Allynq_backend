import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsIn } from 'class-validator';

/**
 * What a user can be on Allynq. Player and organizer are the dashboard modes; the rest are new areas.
 * Coach, creative and social are the sub-roles of an esports professional.
 */
export const USER_ROLES = ['player', 'organizer', 'sponsor', 'esports_professional', 'coach', 'creative', 'social'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const ESPORTS_PRO_ROLE: UserRole = 'esports_professional';
export const ESPORTS_PRO_SUBROLES: UserRole[] = ['coach', 'creative', 'social'];

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
