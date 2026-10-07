import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Repository } from 'typeorm';
import { User } from '../../users/entities/user.entity.js';
import { JWT_COOKIE_NAME } from '../auth.constants.js';
import { AuthService } from '../auth.service.js';
import { SecurityService } from '../../security/security.service.js';

export interface JwtPayload {
  sub: string;
  email: string;
  /** The user's tokenVersion when signed; bumping it (force logout, ban…) invalidates older tokens. */
  tv?: number;
  /** Staff actor for a short-lived, read-only impersonation token. */
  act?: string;
  viewOnly?: boolean;
  purpose?: 'access' | 'staff-2fa';
}

function cookieExtractor(req: Request): string | null {
  return req?.cookies?.[JWT_COOKIE_NAME] ?? null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly security: SecurityService,
  ) {
    super({
      passReqToCallback: true,
      jwtFromRequest: ExtractJwt.fromExtractors([
        cookieExtractor,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        ExtractJwt.fromUrlQueryParameter('token'),
      ]),
      ignoreExpiration: false,
      secretOrKey:
        configService.get<string>('JWT_SECRET') ?? 'allync_jwt_secret_key_2026',
    });
  }

  async validate(req: Request, payload: JwtPayload): Promise<User> {
    // A staff 2FA challenge is signed, but it is never an authenticated session.
    // `undefined` keeps pre-Phase-6 access tokens valid until their normal expiry.
    if (payload.purpose && payload.purpose !== 'access') {
      throw new UnauthorizedException('This token cannot be used as a session');
    }
    const user = await this.usersRepository.findOne({
      where: { id: payload.sub },
      relations: {
        efootballProfile: {
          club: true,
          team: true,
          community: true,
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found or session expired');
    }
    if ((payload.tv ?? 0) !== (user.tokenVersion ?? 0)) {
      throw new UnauthorizedException(
        'Your session has ended. Please sign in again.',
      );
    }
    const blocked = AuthService.blockedReason(user);
    if (blocked) {
      throw new UnauthorizedException(blocked.message);
    }
    // Network / device bans; staff (and staff viewing as a user) are exempt.
    const deviceHeader = req.headers['x-device-id'];
    await this.security.assertAllowed(
      {
        ip: req.ip ?? null,
        deviceId: (Array.isArray(deviceHeader) ? deviceHeader[0] : deviceHeader)?.slice(0, 255) ?? null,
      },
      { staff: Boolean(user.systemRole || payload.viewOnly) },
    );

    if (payload.viewOnly) {
      if (!payload.act)
        throw new UnauthorizedException('Invalid view-as-user session');
      const actor = await this.usersRepository.findOne({
        where: { id: payload.act },
      });
      if (!actor?.systemRole)
        throw new UnauthorizedException('The view-as-user session has ended');
      user.authContext = { viewOnly: true, actorId: actor.id };
    }

    return user;
  }
}
