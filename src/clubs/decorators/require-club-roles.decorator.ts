import { SetMetadata } from '@nestjs/common';
import { ClubRole } from '../../users/enums/user-attributes.enum.js';

export const CLUB_ROLES_KEY = 'clubRoles';
export const RequireClubRoles = (...roles: ClubRole[]) => SetMetadata(CLUB_ROLES_KEY, roles);
