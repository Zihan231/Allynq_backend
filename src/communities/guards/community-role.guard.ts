import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../users/entities/user.entity.js';
import { CommunityRole } from '../../users/enums/user-attributes.enum.js';
import { COMMUNITY_ROLES_KEY } from '../decorators/require-community-roles.decorator.js';
import { CommunityMember } from '../entities/community-member.entity.js';

@Injectable()
export class CommunityRoleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectRepository(CommunityMember)
    private readonly communityMembersRepository: Repository<CommunityMember>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<CommunityRole[]>(
      COMMUNITY_ROLES_KEY,
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

    const communityId = request.params.id || request.params.communityId;
    if (!communityId) {
      return true;
    }

    const membership = await this.communityMembersRepository.findOne({
      where: {
        communityId,
        profile: { userId: user.id },
      },
      relations: { profile: true },
    });

    if (!membership) {
      throw new ForbiddenException('You are not a member of this community');
    }

    if (!membership.role || !requiredRoles.includes(membership.role)) {
      throw new ForbiddenException(
        `Your community role (${membership.role}) does not have permission for this action. Required: ${requiredRoles.join(', ')}`,
      );
    }

    return true;
  }
}
