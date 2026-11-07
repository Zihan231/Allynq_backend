import { describe, expect, it } from 'vitest';
import { translatePgSql } from './pg-sql-translate.js';

describe('translatePgSql', () => {
  it('leaves MySQL-ready SQL (and TypeORM-generated SQL) untouched', () => {
    const sql = 'SELECT `User`.`id` FROM `users` `User` WHERE `User`.`id` = ? AND x = \'a::b $1\'';
    expect(translatePgSql(sql, ['u1'])).toEqual({ sql, params: ['u1'] });
  });

  it('turns $n into ? and orders the parameters to match, repeating reused ones', () => {
    const r = translatePgSql('UPDATE t SET a = $2 WHERE b = $1 AND c = $2 AND d = $3', ['B', 'A', 'D']);
    expect(r.sql).toBe('UPDATE t SET a = ? WHERE b = ? AND c = ? AND d = ?');
    expect(r.params).toEqual(['A', 'B', 'A', 'D']);
  });

  it('drops casts, including to arrays and with a precision', () => {
    const r = translatePgSql(`SELECT count(*)::int AS n, $1::uuid AS id, x::numeric(10, 2), $2::text[] FROM t`, ['u', ['a']]);
    expect(r.sql).toBe('SELECT count(*) AS n, ? AS id, x, ? FROM t');
    expect(r.params).toEqual(['u', ['a']]);
  });

  it('turns = ANY($n) into IN (?) and keeps an empty list valid', () => {
    const r = translatePgSql('SELECT 1 FROM t WHERE id = ANY($1::uuid[]) AND k = ANY($2)', [[], ['a', 'b']]);
    expect(r.sql).toBe('SELECT 1 FROM t WHERE id IN (?) AND k IN (?)');
    expect(r.params).toEqual([[null], ['a', 'b']]);
  });

  it('turns ILIKE into LIKE', () => {
    expect(translatePgSql(`SELECT 1 FROM t WHERE name ILIKE $1`, ['%x%']).sql).toBe('SELECT 1 FROM t WHERE name LIKE ?');
  });

  it("never changes text inside '...' literals, \"...\" identifiers or comments", () => {
    const sql = `SELECT '$1 ::int ILIKE', "weird::col", 'it''s $2' FROM t -- $1::int
      WHERE x = $1 /* ::text $2 */ AND y::int = 1`;
    const r = translatePgSql(sql, ['p']);
    expect(r.sql).toBe(`SELECT '$1 ::int ILIKE', "weird::col", 'it''s $2' FROM t -- $1::int
      WHERE x = ? /* ::text $2 */ AND y = 1`);
    expect(r.params).toEqual(['p']);
  });

  it('handles JSON text in literals next to casts', () => {
    const r = translatePgSql(`INSERT INTO s (k, v) VALUES ($1, '{"a":"b"}'::jsonb)`, ['x']);
    expect(r.sql).toBe(`INSERT INTO s (k, v) VALUES (?, '{"a":"b"}')`);
  });
});
