import { describe, expect, it } from 'vitest';
import { isForeignKeyViolation, isUniqueViolation } from './db-errors.js';

describe('db-errors', () => {
  it('recognises a duplicate key by code, number, or the driver error TypeORM wraps', () => {
    expect(isUniqueViolation({ code: 'ER_DUP_ENTRY' })).toBe(true);
    expect(isUniqueViolation({ errno: 1062 })).toBe(true);
    expect(isUniqueViolation({ driverError: { code: 'ER_DUP_ENTRY', errno: 1062 } })).toBe(true);
    expect(isUniqueViolation({ code: 'ER_ROW_IS_REFERENCED_2' })).toBe(false);
  });

  it('recognises a foreign key violation in either direction', () => {
    expect(isForeignKeyViolation({ code: 'ER_ROW_IS_REFERENCED_2' })).toBe(true);
    expect(isForeignKeyViolation({ driverError: { errno: 1451 } })).toBe(true);
    expect(isForeignKeyViolation({ errno: 1452 })).toBe(true);
    expect(isForeignKeyViolation({ code: 'ER_DUP_ENTRY' })).toBe(false);
  });

  it('ignores anything else, including nothing at all', () => {
    for (const e of [undefined, null, new Error('boom'), { code: '23503' }]) {
      expect(isForeignKeyViolation(e)).toBe(false);
      expect(isUniqueViolation(e)).toBe(false);
    }
  });
});
