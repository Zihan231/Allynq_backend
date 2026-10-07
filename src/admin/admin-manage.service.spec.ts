import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { assertNotFrozen } from '../common/frozen.js';
import { SystemRole } from '../users/enums/user-attributes.enum.js';
import { AdminManageService } from './admin-manage.service.js';

const actor = { id: 'adm', name: 'Admin', systemRole: SystemRole.ADMIN } as never;

/** A data source that answers the detail queries from fixtures and records every write. */
function setup(fixture: { club?: Record<string, unknown>; members?: unknown[]; tournament?: Record<string, unknown>; participants?: unknown[] } = {}) {
  const writes: Array<{ sql: string; params: unknown[] }> = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (/^\s*(UPDATE|DELETE|INSERT)/.test(sql)) {
      writes.push({ sql, params });
      return [];
    }
    if (sql.includes('FROM clubs c LEFT JOIN users fz')) return fixture.club ? [fixture.club] : [];
    if (sql.includes('FROM efootball_profiles ep JOIN users u ON u.id = ep."userId"\n          WHERE ep."clubId"')) return fixture.members ?? [];
    if (sql.includes('FROM tournaments t\n')) return fixture.tournament ? [fixture.tournament] : [];
    if (sql.includes('FROM tournament_participants p')) return fixture.participants ?? [];
    if (sql.includes('AS "hostedTournaments"') || sql.includes('AS "matchesDone"')) return [{}];
    if (sql.includes(`"clubRole" IN ('President', 'General Secretary')`)) return [{ userId: 'club-pres' }];
    return [];
  });
  const dataSource = { query, transaction: async (fn: (em: unknown) => Promise<unknown>) => fn({ query }) };
  const audit = { record: vi.fn(async () => undefined) };
  const notifications = {
    createNotification: vi.fn(async () => ({})),
    notifyClubAuthorities: vi.fn(async () => []),
    notifyCommunityAuthorities: vi.fn(async () => []),
  };
  const service = new AdminManageService(dataSource as never, audit as never, notifications as never, {} as never, {} as never);
  return { service, writes, audit, notifications };
}

const club = { id: 'c1', name: 'Padma', minRoster: 4, maxRoster: 8, frozenAt: null };
const members = [
  { profileId: 'p1', userId: 'old-pres', name: 'Old', role: 'President' },
  { profileId: 'p2', userId: 'new-pres', name: 'New', role: 'Player' },
];

describe('AdminManageService', () => {
  it('hands the presidency to a member and demotes the old President, telling both', async () => {
    const { service, writes, notifications, audit } = setup({ club, members });
    await service.setClubLeader(actor, 'c1', { userId: 'new-pres', role: 'President', reason: 'Old president inactive' });
    expect(writes[0].sql).toContain(`SET "clubRole" = 'Player'`);
    expect(writes[1].params).toEqual(['c1', 'President', 'new-pres']);
    expect(notifications.createNotification).toHaveBeenCalledTimes(2);
    expect(audit.record).toHaveBeenCalledWith(actor, expect.objectContaining({ action: 'club.leader', after: { President: 'New' } }));
  });

  it("won't move the President into another role (the club would have none)", async () => {
    const { service } = setup({ club, members });
    await expect(service.setClubLeader(actor, 'c1', { userId: 'old-pres', role: 'General Secretary', reason: 'xxx' })).rejects.toThrow('without a President');
  });

  it('only a club member can be made leader, and clubs have no Vice President', async () => {
    const { service } = setup({ club, members });
    await expect(service.setClubLeader(actor, 'c1', { userId: 'stranger', role: 'President', reason: 'xxx' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.setClubLeader(actor, 'c1', { userId: 'new-pres', role: 'Vice President', reason: 'xxx' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('freezes a club and tells its leaders; freezing twice is refused', async () => {
    const { service, writes, notifications } = setup({ club, members });
    await service.setFrozen(actor, 'club', 'c1', true, 'Match fixing investigation');
    expect(writes[0].params.slice(2)).toEqual(['Match fixing investigation', 'adm']);
    expect(notifications.notifyClubAuthorities).toHaveBeenCalledWith('c1', 'Club frozen', expect.any(String), expect.any(String), expect.objectContaining({ code: 'admin.frozen' }));
    const frozen = setup({ club: { ...club, frozenAt: new Date() }, members });
    await expect(frozen.service.setFrozen(actor, 'club', 'c1', true, 'again')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('keeps the squad limits consistent', async () => {
    const { service } = setup({ club, members });
    await expect(service.editClub(actor, 'c1', { minRoster: 10 })).rejects.toThrow('minimum squad size');
  });

  it('removes a tournament entry only before the fixtures exist', async () => {
    const participants = [{ id: 'e1', name: 'Padma', clubId: 'c1', userId: null }];
    const open = setup({ tournament: { id: 't1', name: 'Cup', format: null, matchOfficialIds: [] }, participants });
    await open.service.removeParticipant(actor, 't1', 'e1', 'Registered by mistake');
    expect(open.writes[0].sql).toContain('DELETE FROM tournament_participants');
    expect(open.notifications.createNotification).toHaveBeenCalledWith('club-pres', expect.objectContaining({ code: 'admin.participant_removed' }));

    const started = setup({ tournament: { id: 't1', name: 'Cup', format: 'knockout', matchOfficialIds: [] }, participants });
    await expect(started.service.removeParticipant(actor, 't1', 'e1', 'Too late')).rejects.toThrow('fixtures are already made');
  });
});

describe('assertNotFrozen', () => {
  it('blocks a frozen club with the staff reason, and lets others through', async () => {
    const frozen = { query: vi.fn(async () => [{ name: 'Padma', frozenAt: new Date(), frozenReason: 'Under review' }]) };
    await expect(assertNotFrozen(frozen, 'club', 'c1')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(assertNotFrozen(frozen, 'club', 'c1')).rejects.toThrow('Under review');
    const fine = { query: vi.fn(async () => [{ name: 'Padma', frozenAt: null, frozenReason: null }]) };
    await expect(assertNotFrozen(fine, 'club', 'c1')).resolves.toBeUndefined();
    await expect(assertNotFrozen({ manager: fine }, 'community', 'x')).resolves.toBeUndefined();
    await expect(assertNotFrozen(fine, 'club', null)).resolves.toBeUndefined();
  });
});
