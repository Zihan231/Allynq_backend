import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { SecurityService } from '../security/security.service.js';
import { SystemRole } from '../users/enums/user-attributes.enum.js';
import { AdminPhaseSixService } from './admin-phase-six.service.js';

const actor = { id: 'adm', name: 'Admin', systemRole: SystemRole.ADMIN };

function setup() {
  const user = { id: 'u1', name: 'Player', ownedCosmeticIds: ['old-item'] as string[] };
  const season = { id: 's1', name: 'Season 1', status: 'active', startsAt: new Date(), endsAt: new Date() };
  const standings: unknown[] = [];
  const repo = (extra: Record<string, unknown> = {}) => ({
    findOne: vi.fn(async () => null),
    find: vi.fn(async () => []),
    save: vi.fn(async (r: unknown) => r),
    create: (r: unknown) => r,
    delete: vi.fn(async () => undefined),
    ...extra,
  });
  const storeItems = repo({ findOne: vi.fn(async () => ({ id: 'uuid-1', sku: 'badge-gold', name: 'Gold' })) });
  const seasons = repo({ findOne: vi.fn(async () => season), save: vi.fn(async (r: unknown) => r) });
  const standingsRepo = repo({ save: vi.fn(async (rows: unknown[]) => standings.push(...rows)) });
  const dataSource = {
    transaction: async (fn: (m: unknown) => Promise<unknown>) =>
      fn({ getRepository: () => ({ findOne: async () => user, save: async (u: unknown) => u }) }),
    query: vi.fn(async () => []),
  };
  const security = new SecurityService({} as never, {} as never, { get: () => 'k' } as never);
  const stats = {
    playerRankings: vi.fn(async () => ({ data: [{ id: 'p1', name: 'Ace', rank: 1 }, { id: 'p2', name: 'NoGames', rank: null }] })),
    clubRankings: vi.fn(async () => ({ data: [{ id: 'c1', name: 'Padma', rank: 1 }] })),
  };
  const audit = { record: vi.fn(async () => undefined) };
  const service = new AdminPhaseSixService(
    repo() as never, // users
    repo() as never, // notes
    repo() as never, // labels
    repo() as never, // templates
    seasons as never,
    storeItems as never,
    standingsRepo as never,
    dataSource as never,
    {} as never, // notifications
    security,
    audit as never,
    {} as never, // jwt
    stats as never,
  );
  return { service, user, season, standings, stats, audit, security };
}

describe('AdminPhaseSixService', () => {
  it('grants and revokes store items by their code, the id profiles and the store use', async () => {
    const { service, user } = setup();
    await service.grantStoreItem(actor, 'u1', 'uuid-1', false, 'Tournament prize', {});
    expect(user.ownedCosmeticIds).toEqual(['old-item', 'badge-gold']);
    await service.grantStoreItem(actor, 'u1', 'uuid-1', true, undefined, {});
    expect(user.ownedCosmeticIds).toEqual(['old-item']);
  });

  it('closing the active season saves its final standings (ranked entries only)', async () => {
    const { service, season, standings, stats, audit } = setup();
    await service.closeSeason(actor, 's1', 'Season over', {});
    expect(stats.playerRankings).toHaveBeenCalledWith(expect.objectContaining({ period: 'this-season' }));
    expect(standings).toEqual([
      expect.objectContaining({ seasonId: 's1', kind: 'player', rank: 1, entityId: 'p1', name: 'Ace' }),
      expect.objectContaining({ seasonId: 's1', kind: 'club', rank: 1, entityId: 'c1', name: 'Padma' }),
    ]);
    expect(season.status).toBe('closed');
    expect(audit.record).toHaveBeenCalledWith(actor, expect.objectContaining({ after: expect.objectContaining({ archivedPlayers: 1, archivedClubs: 1 }) }));
  });

  it("refuses to ban the network you're using right now", async () => {
    const { service } = setup();
    await expect(
      service.createSecurityBan(actor, { kind: 'ip', value: '10.9.9.9', reason: 'test ban' }, { ip: '10.9.9.9' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
