import { SetMetadata } from '@nestjs/common';
import { CommunityRole } from '../../users/enums/user-attributes.enum.js';

export const COMMUNITY_ROLES_KEY = 'communityRoles';
export const RequireCommunityRoles = (...roles: CommunityRole[]) =>
  SetMetadata(COMMUNITY_ROLES_KEY, roles);
