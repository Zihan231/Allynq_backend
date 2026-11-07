/**
 * Turns the PostgreSQL flavour our raw queries were written in into MySQL, for the purely mechanical differences:
 *
 *   $1, $2 ...        ->  ?            (params re-ordered / repeated to match; MySQL placeholders are positional)
 *   x::int, ::uuid... ->  x            (casts dropped; mysql2 returns numbers for COUNT/SUM, see db-options.ts)
 *   ILIKE             ->  LIKE         (the default utf8mb4 collation is case-insensitive)
 *   = ANY($1)         ->  IN (?)       (mysql2 expands an array parameter; an empty array becomes NULL so the SQL stays valid)
 *   = ANY($1::int[])  ->  IN (?)
 *
 * Quoted identifiers ("userId") are NOT touched here: the session runs with ANSI_QUOTES (see mysql-session.ts).
 * Anything that has no MySQL equivalent (RETURNING, ON CONFLICT, jsonb operators, FILTER, date_trunc ...) is rewritten by hand in
 * the code that uses it; this only removes the busywork. Text inside '...' literals, comments and "..." identifiers is never changed.
 */
export interface TranslatedSql {
  sql: string;
  params: unknown[];
}

const NEEDS_TRANSLATION = /\$\d|::|\bILIKE\b/i;

export function translatePgSql(sql: string, params: unknown[] = []): TranslatedSql {
  if (!NEEDS_TRANSLATION.test(sql)) return { sql, params };

  const out: string[] = [];
  const outParams: unknown[] = [];
  let i = 0;
  let normal = '';

  const flushNormal = () => {
    if (normal) out.push(convertNormal(normal, params, outParams));
    normal = '';
  };

  while (i < sql.length) {
    const c = sql[i];
    const next = sql[i + 1];
    if (c === "'" || c === '"') {
      // A quoted literal or identifier: copied as it is (a doubled quote is an escaped quote).
      flushNormal();
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === c) {
          if (sql[j + 1] === c) j += 2;
          else break;
        } else j++;
      }
      out.push(sql.slice(i, j + 1));
      i = j + 1;
    } else if (c === '-' && next === '-') {
      flushNormal();
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? sql.length : end;
      out.push(sql.slice(i, stop));
      i = stop;
    } else if (c === '/' && next === '*') {
      flushNormal();
      const end = sql.indexOf('*/', i + 2);
      const stop = end === -1 ? sql.length : end + 2;
      out.push(sql.slice(i, stop));
      i = stop;
    } else {
      normal += c;
      i++;
    }
  }
  flushNormal();
  // No $n placeholder at all (e.g. a `?` query that only looked like PostgreSQL inside a literal): the parameters are already right.
  return { sql: out.join(''), params: outParams.length > 0 ? outParams : params };
}

/** Converts a stretch of SQL that is outside any quote or comment; appends the parameters it uses, in order. */
function convertNormal(text: string, params: unknown[], outParams: unknown[]): string {
  // `ANY($1)` / `ANY($1::uuid[])` -> `IN ($1)` (the preceding `=` goes away)
  let converted = text.replace(/=\s*ANY\s*\(\s*(\$\d+)\s*(?:::\s*\w+(?:\s*\[\s*\])?)?\s*\)/gi, 'IN ($1)');
  converted = converted
    .replace(/::\s*[a-z_][a-z0-9_]*(?:\s*\[\s*\])?(?:\(\s*\d+(?:\s*,\s*\d+)?\s*\))?/gi, '')
    .replace(/\bILIKE\b/gi, 'LIKE');
  return converted.replace(/\$(\d+)/g, (_match, n: string) => {
    const value = params[Number(n) - 1];
    // An empty list would make `IN ()` invalid SQL; `IN (NULL)` matches nothing, like ANY of an empty array.
    outParams.push(Array.isArray(value) && value.length === 0 ? [null] : value);
    return '?';
  });
}
