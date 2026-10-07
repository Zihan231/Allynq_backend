import { ForbiddenException } from '@nestjs/common';

type QueryRunnerLike = { query: (sql: string, params?: unknown[]) => Promise<unknown> };

/**
 * Throws when a club or community has been frozen by ALLYNQ staff. Accepts anything that
 * can run SQL (a DataSource, an EntityManager, or a repository — through its manager).
 * Unit-test repository mocks have no manager, so the check is skipped there.
 */
export async function assertNotFrozen(
  source: QueryRunnerLike | { manager?: QueryRunnerLike } | null | undefined,
  kind: 'club' | 'community',
  id: string | null | undefined,
): Promise<void> {
  if (!id || !source) return;
  const runner = typeof (source as QueryRunnerLike).query === 'function' ? (source as QueryRunnerLike) : (source as { manager?: QueryRunnerLike }).manager;
  if (typeof runner?.query !== 'function') return;
  const table = kind === 'club' ? 'clubs' : 'communities';
  const rows = (await runner.query(`SELECT name, "frozenAt", "frozenReason" FROM "${table}" WHERE id = $1`, [id])) as Array<{
    name: string;
    frozenAt: Date | null;
    frozenReason: string | null;
  }>;
  const row = rows[0];
  if (row?.frozenAt) {
    throw new ForbiddenException(
      `${row.name} is frozen by ALLYNQ staff${row.frozenReason ? `: ${row.frozenReason}` : ''}. This is paused until it is unfrozen.`,
    );
  }
}
