import { describe, expect, it, vi } from 'vitest';
import { MyGamesService } from './my-games.service.js';

const row = (overrides: object = {}) => ({
  id: 'g1',
  matchId: 'm1',
  state: 'finished',
  status: 'approved',
  resolution: 'reviewed',
  mySide: 'B',
  mySubmitted: true,
  goalsA: 1,
  goalsB: 3,
  reviewNote: null,
  stage: 'group',
  roundName: 'Matchday 1',
  groupLabel: 'A',
  isDecider: false,
  scheduledStart: new Date('2026-10-01T14:00:00Z'),
  scheduledEnd: null,
  evidenceDeadline: null,
  myName: 'Me',
  myDpUrl: null,
  opponentUserId: 'u2',
  opponentName: 'Them',
  opponentDpUrl: null,
  myClubName: null,
  opponentClubName: null,
  tournamentId: 't1',
  tournamentName: 'Cup',
  tournamentType: 'pvp',
  tournamentStatus: 'ongoing',
  communityId: 'c1',
  hostClubId: null,
  hostKind: 'community',
  hostId: 'c1',
  hostName: 'Comm',
  hostDpUrl: null,
  ...overrides,
});

function setup(rows: object[]) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('count(*)::int AS total')) return [{ total: rows.length }];
    if (sql.includes('GROUP BY state')) return [{ state: 'finished', count: 1 }];
    if (sql.includes('GROUP BY "hostKind"')) return [{ hostKind: 'community', hostId: 'c1', hostName: 'Comm', count: 1 }];
    return rows;
  });
  return { service: new MyGamesService({ query } as never), query };
}

describe('MyGamesService.getMyGames', () => {
  it('reports the score and outcome from the player’s own side', async () => {
    const { service } = setup([row()]);
    const result = await service.getMyGames('me', {});
    expect(result.data[0]).toMatchObject({ myGoals: 3, opponentGoals: 1, outcome: 'won' });
    expect(result.data[0].tournament.link).toBe('/dashboard/efootball/community/c1/tournaments/t1?tab=bracket&match=m1');
    expect(result.facets).toMatchObject({ states: { finished: 1, to_play: 0 }, hostKinds: { community: 1, club: 0 } });
  });

  it('hides scores until a game is finished', async () => {
    const { service } = setup([row({ state: 'review', status: 'submitted' })]);
    const [game] = (await service.getMyGames('me', {})).data;
    expect(game).toMatchObject({ myGoals: null, opponentGoals: null, outcome: null });
  });

  it('binds exactly the parameters each query uses, and leaves a facet’s own filter out', async () => {
    const { service, query } = setup([]);
    await service.getMyGames('me', { host: 'club', hostId: 'h1', state: 'review', search: '50%', page: 2, limit: 5 });

    for (const [sql, params] of query.mock.calls as unknown as [string, unknown[]][]) {
      const used = new Set([...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
      expect(used.size).toBe(params.length);
    }
    const [stateSql, stateParams] = query.mock.calls.find(([sql]) => String(sql).includes('GROUP BY state')) as unknown as [string, unknown[]];
    expect(stateSql).not.toContain('state = $');
    expect(stateParams).toContain('club');
    const [, listParams] = query.mock.calls[0] as unknown as [string, unknown[]];
    // "%" in the search is escaped so it matches literally.
    expect(listParams).toEqual(['me', 'club', 'h1', 'review', String.raw`%50\%%`, 5, 5]);
  });
});
