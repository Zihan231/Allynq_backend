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

export interface JwtPayload {
  sub: string;
  email: string;
  /** The user's tokenVersion when signed; bumping it (force logout, ban…) invalidates older tokens. */
  tv?: number;
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
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        cookieExtractor,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        ExtractJwt.fromUrlQueryParameter('token'),
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET') ?? 'allync_jwt_secret_key_2026',
    });
  }

  async validate(payload: JwtPayload): Promise<User> {
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
      throw new UnauthorizedException('Your session has ended. Please sign in again.');
    }
    const blocked = AuthService.blockedReason(user);
    if (blocked) {
      throw new UnauthorizedException(blocked.message);
    }

    return user;
  }
}
