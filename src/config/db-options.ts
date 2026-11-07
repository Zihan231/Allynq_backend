import type { DataSourceOptions } from 'typeorm';
import { ALL_ENTITIES } from './entities.js';
import { installMysqlSession } from './mysql-session.js';

// Before any DataSource opens a pool: ANSI quoting and the PostgreSQL-to-MySQL query translation (see mysql-session.ts).
installMysqlSession();

export type MysqlOptions = Extract<DataSourceOptions, { type: 'mysql' | 'mariadb' }>;

/**
 * The one definition of how we connect to MySQL, shared by the app (`typeorm.config.ts`), the TypeORM CLI
 * (`data-source.ts`) and every seed script.
 *
 * - `timezone: 'Z'`: dates are stored and read as UTC (MySQL has no timestamptz).
 * - `supportBigNumbers` with `bigNumberStrings: false` and `decimalNumbers: true` (passed to mysql2 through `extra`):
 *   `COUNT(*)` and `SUM()` come back as numbers (they are BIGINT / DECIMAL in MySQL), as the code expects.
 * - `DATABASE_SSL=false` turns TLS off (a local MySQL); managed hosts normally need it on, which is the default.
 */
export function buildDbOptions(url: string | undefined, extra: Partial<MysqlOptions> = {}): MysqlOptions {
  if (!url) throw new Error('DATABASE_URL is not set (expected mysql://user:password@host:3306/dbname)');
  return {
    type: 'mysql',
    url,
    charset: 'utf8mb4',
    timezone: 'Z',
    supportBigNumbers: true,
    bigNumberStrings: false,
    ssl: process.env.DATABASE_SSL === 'false' ? undefined : { rejectUnauthorized: false },
    entities: ALL_ENTITIES,
    synchronize: false,
    ...extra,
    extra: { decimalNumbers: true, ...(extra.extra as object | undefined) },
  } as MysqlOptions;
}
