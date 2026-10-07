import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { User } from '../users/entities/user.entity.js';
import { SYSTEM_ROLE_RANK, SystemRole } from '../users/enums/user-attributes.enum.js';

export const SYSTEM_ROLE_KEY = 'systemRole';

/** The lowest staff role allowed; higher roles pass too (moderator < admin < super admin). */
export const RequireSystemRole = (role: SystemRole) => SetMetadata(SYSTEM_ROLE_KEY, role);

export function hasSystemRole(user: Pick<User, 'systemRole'> | null | undefined, role: SystemRole): boolean {
  return Boolean(user?.systemRole && SYSTEM_ROLE_RANK[user.systemRole] >= SYSTEM_ROLE_RANK[role]);
}

/** Use after JwtAuthGuard. Without a @RequireSystemRole, any staff role is enough. */
@Injectable()
export class SystemRoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required =
      this.reflector.getAllAndOverride<SystemRole | undefined>(SYSTEM_ROLE_KEY, [context.getHandler(), context.getClass()]) ??
      SystemRole.MODERATOR;
    const user: User | undefined = context.switchToHttp().getRequest().user;
    if (!user) throw new UnauthorizedException('Authentication required');
    if (!hasSystemRole(user, required)) {
      throw new ForbiddenException(`This needs the ${required.replace('_', ' ')} role`);
    }
    return true;
  }
}
