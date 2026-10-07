import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { ActivityService } from '../activity/activity.service.js';
import { EfootballProfile } from '../users/entities/efootball-profile.entity.js';
import { User } from '../users/entities/user.entity.js';
import { serializeUser } from '../users/serializers/user.serializer.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';

/** Where a sign-in came from, for the login history. */
export interface ClientInfo {
  ip?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(EfootballProfile)
    private readonly efootballProfilesRepository: Repository<EfootballProfile>,
    private readonly jwtService: JwtService,
    private readonly activity: ActivityService,
  ) {}

  /** Why this account may not sign in right now, or null. Also used to reject live sessions. */
  static blockedReason(user: Pick<User, 'deletedAt' | 'bannedAt' | 'banReason' | 'suspendedUntil' | 'suspendReason'>) {
    if (user.deletedAt) {
      return { code: 'deleted', message: 'This account was deleted. Contact Allync support to restore it.' };
    }
    if (user.bannedAt) {
      return { code: 'banned', message: `This account is banned${user.banReason ? `: ${user.banReason}` : '.'}` };
    }
    if (user.suspendedUntil && new Date(user.suspendedUntil).getTime() > Date.now()) {
      const until = new Date(user.suspendedUntil).toISOString().slice(0, 16).replace('T', ' ');
      return {
        code: 'suspended',
        message: `This account is suspended until ${until} UTC${user.suspendReason ? `: ${user.suspendReason}` : '.'}`,
      };
    }
    return null;
  }

  async register(dto: RegisterDto, client: ClientInfo = {}) {
    const existing = await this.usersRepository.findOne({
      where: { email: dto.email.toLowerCase().trim() },
    });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const user = this.usersRepository.create({
      name: dto.name,
      email: dto.email.toLowerCase().trim(),
      password: hashedPassword,
      phoneNumber: dto.phoneNumber,
      country: dto.country?.trim() || 'Bangladesh',
      bio: dto.bio ?? null,
    });
    const savedUser = await this.usersRepository.save(user);

    // Create default eFootball profile
    const profile = this.efootballProfilesRepository.create({
      userId: savedUser.id,
    });
    await this.efootballProfilesRepository.save(profile);
    savedUser.efootballProfile = profile;

    const accessToken = this.jwtService.sign({
      sub: savedUser.id,
      email: savedUser.email,
      tv: savedUser.tokenVersion ?? 0,
    });
    await this.usersRepository.update(savedUser.id, { lastLoginAt: new Date() });
    await this.activity.logLogin({ userId: savedUser.id, email: savedUser.email ?? dto.email, success: true, ...client });
    await this.activity.log(savedUser.id, { type: 'account.created', summary: 'Created an account', ip: client.ip });

    return {
      accessToken,
      user: serializeUser(savedUser, true),
    };
  }

  async login(dto: LoginDto, client: ClientInfo = {}) {
    const user = await this.usersRepository
      .createQueryBuilder('user')
      .addSelect('user.password')
      .leftJoinAndSelect('user.efootballProfile', 'efootballProfile')
      .leftJoinAndSelect('efootballProfile.club', 'club')
      .leftJoinAndSelect('efootballProfile.team', 'team')
      .where('LOWER(user.email) = LOWER(:email)', { email: dto.email.trim() })
      .getOne();

    const email = dto.email.trim();
    if (!user || !user.password) {
      await this.activity.logLogin({ userId: user?.id ?? null, email, success: false, failureReason: 'unknown_email', ...client });
      throw new UnauthorizedException('Invalid email or password');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.password);
    if (!isPasswordValid) {
      await this.activity.logLogin({ userId: user.id, email, success: false, failureReason: 'wrong_password', ...client });
      throw new UnauthorizedException('Invalid email or password');
    }

    // Checked after the password, so the reason is only shown to the account's owner.
    const blocked = AuthService.blockedReason(user);
    if (blocked) {
      await this.activity.logLogin({ userId: user.id, email, success: false, failureReason: blocked.code, ...client });
      throw new ForbiddenException(blocked.message);
    }

    const accessToken = this.jwtService.sign({
      sub: user.id,
      email: user.email,
      tv: user.tokenVersion ?? 0,
    });
    user.lastLoginAt = new Date();
    await this.usersRepository.update(user.id, { lastLoginAt: user.lastLoginAt });
    await this.activity.logLogin({ userId: user.id, email, success: true, ...client });

    return {
      accessToken,
      user: serializeUser(user, true),
    };
  }
}
