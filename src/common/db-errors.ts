/**
 * Recognises MySQL / TiDB errors by code or number (TypeORM wraps the driver's error: the fields can be on the error itself or on
 * `driverError`). Replaces the PostgreSQL SQLSTATE checks ('23503', '23505') the code used to make.
 */
interface DbErrorLike {
  code?: string;
  errno?: number;
  driverError?: { code?: string; errno?: number };
}

function matches(error: unknown, codes: string[], errnos: number[]): boolean {
  const e = (error ?? {}) as DbErrorLike;
  return [e.code, e.driverError?.code].some((c) => c !== undefined && codes.includes(c)) || [e.errno, e.driverError?.errno].some((n) => n !== undefined && errnos.includes(n));
}

/** A foreign key stops the change: the row is still referenced (1451, 1217) or points at a row that doesn't exist (1452). */
export const isForeignKeyViolation = (error: unknown) =>
  matches(error, ['ER_ROW_IS_REFERENCED_2', 'ER_ROW_IS_REFERENCED', 'ER_NO_REFERENCED_ROW_2'], [1451, 1217, 1452]);

/** A unique key stops the change: the value already exists (1062). */
export const isUniqueViolation = (error: unknown) => matches(error, ['ER_DUP_ENTRY'], [1062]);
