import { createRequire } from 'node:module';
import { translatePgSql } from './pg-sql-translate.js';

/**
 * Makes every MySQL connection of this process behave the way our raw SQL expects:
 *
 *  1. `SET SESSION sql_mode = ... ANSI_QUOTES`: "userId" is an identifier (as in PostgreSQL), so the ~1,000 quoted column names in our raw
 *     queries work as written. TypeORM's own SQL uses backticks, which stay valid. (String literals must use single quotes, which they do.)
 *  2. Every string query goes through `translatePgSql` (placeholders, casts, ILIKE, ANY): see pg-sql-translate.ts.
 *
 * It wraps mysql2's `createPool`, so it must run before the first DataSource initializes; `db-options.ts` imports this file for that reason.
 * Seeds, the TypeORM CLI and the app all build their options with `buildDbOptions`, so they all get it.
 */
type Callback = (err: unknown, result?: unknown, fields?: unknown) => void;
interface PoolConnectionLike {
  query: (...args: any[]) => unknown;
}
interface PoolLike {
  on: (event: 'connection', listener: (connection: PoolConnectionLike) => void) => unknown;
}

const INSTALLED = Symbol.for('allynq.mysql-session');

export function installMysqlSession(): void {
  const mysql2 = createRequire(import.meta.url)('mysql2') as { createPool: (...args: any[]) => PoolLike } & Record<symbol, unknown>;
  if (mysql2[INSTALLED]) return;
  mysql2[INSTALLED] = true;

  const createPool = mysql2.createPool.bind(mysql2);
  mysql2.createPool = (...args: any[]) => {
    const pool = createPool(...args);
    pool.on('connection', (connection) => {
      const query = connection.query.bind(connection) as (...a: any[]) => unknown;
      // Issued first, so it is in force before the connection is handed to anyone.
      // time_zone: NOW() / CURRENT_DATE and the date maths in our queries are UTC whatever the server's own zone is.
      query("SET SESSION sql_mode = CONCAT(@@sql_mode, ',ANSI_QUOTES'), time_zone = '+00:00'");
      connection.query = (sql: unknown, values?: unknown, callback?: Callback) => {
        if (typeof sql !== 'string') return query(sql, values, callback);
        const cb = typeof values === 'function' ? (values as Callback) : callback;
        const params = Array.isArray(values) ? values : undefined;
        const translated = translatePgSql(sql, params ?? []);
        return cb ? query(translated.sql, translated.params, cb) : query(translated.sql, translated.params);
      };
    });
    return pool;
  };
}
