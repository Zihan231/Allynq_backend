import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClubRole } from '../../users/enums/user-attributes.enum.js';
import { User } from '../../users/entities/user.entity.js';
import { CLUB_ROLES_KEY } from '../decorators/require-club-roles.decorator.js';

@Injectable()
export class ClubRoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<ClubRole[]>(
      CLUB_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user: User | undefined = request.user;

    if (!user) {
      throw new UnauthorizedException('Authentication required for this action');
    }

    const clubId = request.params.id || request.params.clubId;
    if (!clubId) {
      return true;
    }

    const profile = user.efootballProfile;
    if (!profile || profile.clubId !== clubId) {
      throw new ForbiddenException('You are not a member of this club');
    }

    if (!profile.clubRole || !requiredRoles.includes(profile.clubRole)) {
      throw new ForbiddenException(
        `Your club role (${profile.clubRole ?? 'None'}) does not have permission for this action. Required: ${requiredRoles.join(', ')}`,
      );
    }

    return true;
  }
}
