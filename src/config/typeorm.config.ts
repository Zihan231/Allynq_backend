import { ConfigService } from '@nestjs/config';
import type { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { EfootballProfile } from '../users/entities/efootball-profile.entity.js';
import { User } from '../users/entities/user.entity.js';

export function buildTypeOrmOptions(configService: ConfigService): TypeOrmModuleOptions {
  return {
    type: 'postgres',
    url: configService.getOrThrow<string>('DATABASE_URL'),
    ssl: { rejectUnauthorized: false },
    entities: [User, EfootballProfile],
    migrations: ['dist/migrations/*.js'],
    synchronize: false,
    logging: ['error', 'warn'],
  };
}
