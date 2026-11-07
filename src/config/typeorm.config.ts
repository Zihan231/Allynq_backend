import { ConfigService } from '@nestjs/config';
import type { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { buildDbOptions } from './db-options.js';

export function buildTypeOrmOptions(
  configService: ConfigService,
): TypeOrmModuleOptions {
  return buildDbOptions(configService.getOrThrow<string>('DATABASE_URL'), {
    migrations: ['dist/migrations/*.js'],
    logging: ['error', 'warn'],
  });
}
