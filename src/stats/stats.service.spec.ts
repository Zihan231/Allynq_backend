import { describe, expect, it, vi } from 'vitest';
import { StatsService } from './stats.service.js';

function setup(rows: object[] = []) {
  const query = vi.fn(async (sql: string) => (sql.includes('count(*)::int AS total') ? [{ total: rows.length }] : rows));
  return { service: new StatsService({ query } as never), query };
}

/** Every `$n` placeholder in the SQL has exactly one bound value, and no extra values are sent. */
function expectBindingsMatch(calls: unknown[][]) {
  for (const [sql, params] of calls as [string, unknown[]][]) {
    const used = new Set([...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
    expect(used.size).toBe(params.length);
  }
}

describe('StatsService rankings', () => {
  it('binds exactly the parameters each query uses', async () => {
    const { service, query } = setup();
    await service.playerRankings({ clubId: 'c1', search: '50%', period: 'this-week', page: 2, limit: 5 });
    await service.playerRankings({ communityId: 'k1' });
    await service.playerRankings({});
    await service.clubRankings({ communityId: 'k1', search: 'x', page: 3, limit: 10 });
    expectBindingsMatch(query.mock.calls);

    // "%" in the search is matched literally.
    const [, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(params).toEqual(['c1', String.raw`%50\%%`, 5, 5]);
  });

  it('turns a member with no games into a zero line without a rank', async () => {
    const { service } = setup([{ id: 'u1', name: 'New Player', dpUrl: null, clubName: 't4', rank: null }]);
    const { data } = await service.playerRankings({ clubId: 'c1' });
    expect(data[0]).toMatchObject({ rank: null, PL: 0, W: 0, GF: 0, PTS: 0, winPct: 0, streak: 0 });
  });

  it('derives goal difference and win rate for clubs', async () => {
    const { service } = setup([{ id: 'c1', name: 't4', rank: 1, M: 4, W: 3, D: 0, L: 1, GF: 10, GA: 4, CS: 1, PTS: 9 }]);
    const { data } = await service.clubRankings({});
    expect(data[0]).toMatchObject({ GD: 6, winPct: 75, PTS: 9 });
  });
});
