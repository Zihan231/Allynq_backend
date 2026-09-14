import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { EfootballProfile } from '../users/entities/efootball-profile.entity.js';
import { User } from '../users/entities/user.entity.js';
import { serializeUser } from '../users/serializers/user.serializer.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(EfootballProfile)
    private readonly efootballProfilesRepository: Repository<EfootballProfile>,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
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
      phoneNumber: dto.phoneNumber ?? null,
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
    });

    return {
      accessToken,
      user: serializeUser(savedUser, true),
    };
  }

  async login(dto: LoginDto) {
    const user = await this.usersRepository
      .createQueryBuilder('user')
      .addSelect('user.password')
      .leftJoinAndSelect('user.efootballProfile', 'efootballProfile')
      .leftJoinAndSelect('efootballProfile.club', 'club')
      .leftJoinAndSelect('efootballProfile.team', 'team')
      .where('LOWER(user.email) = LOWER(:email)', { email: dto.email.trim() })
      .getOne();

    if (!user || !user.password) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const accessToken = this.jwtService.sign({
      sub: user.id,
      email: user.email,
    });

    return {
      accessToken,
      user: serializeUser(user, true),
    };
  }
}
