import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ClubRole, SystemRole } from '../users/enums/user-attributes.enum.js';
import { ReportsService } from './reports.service.js';

vi.mock('./report-upload.js', () => ({ removeReportFiles: vi.fn(async () => undefined) }));

type Row = Record<string, unknown> & { id: string };

function setup(options: { reportsToday?: number; target?: Record<string, unknown> | null; reportsOpen?: boolean } = {}) {
  const rows: Row[] = [];
  let seq = 0;
  const matches = (row: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
      const inValues = (v as { _type?: string; _value?: unknown[] })?._type === 'in' ? (v as { _value: unknown[] })._value : null;
      return inValues ? inValues.includes(row[k]) : row[k] === v;
    });
  const reports = {
    create: (data: Record<string, unknown>) => ({ ...data }),
    save: vi.fn(async (data: Record<string, unknown>) => {
      const row = { id: `r${++seq}`, createdAt: new Date(), ...data } as Row;
      rows.push(row);
      return row;
    }),
    findOne: vi.fn(async ({ where }: { where: Record<string, unknown> }) => rows.find((r) => matches(r, where)) ?? null),
    find: vi.fn(async ({ where }: { where: Record<string, unknown> }) => rows.filter((r) => matches(r, where))),
    update: vi.fn(async (id: string, patch: Record<string, unknown>) => Object.assign(rows.find((r) => r.id === id)!, patch)),
  };
  const messages = { create: (d: unknown) => d, save: vi.fn(async (d: unknown) => d), find: vi.fn(async () => []) };
  const users = { increment: vi.fn(async () => undefined), findOne: vi.fn(async () => null) };
  const dataSource = {
    query: vi.fn(async (sql: string) => {
      if (sql.includes(`"createdAt" > now() - interval '24 hours'`)) return [{ n: options.reportsToday ?? 0 }];
      if (sql.startsWith('SELECT u.id AS "userId"') || sql.includes('FROM clubs c WHERE c.id = $1 AND')) {
        return options.target === null ? [] : [options.target ?? { userId: 'target-user', name: 'Bad Player', clubId: 'club-x', communityId: 'comm-x' }];
      }
      return [{}];
    }),
  };
  const settings = {
    admin: vi.fn(async () => ({ reportDailyLimit: 10, reportStrikeLimit: 3 })),
    features: vi.fn(async () => ({ reportsOpen: options.reportsOpen ?? true })),
  };
  const notifications = { createNotification: vi.fn(async () => ({})) };
  const audit = { record: vi.fn(async () => undefined) };
  const adminUsers = { warn: vi.fn(async () => ({})), suspend: vi.fn(async () => ({})), ban: vi.fn(async () => ({})), moveToBin: vi.fn(async () => ({})) };
  const adminContent = { moveToBin: vi.fn(async () => ({})) };
  const service = new ReportsService(
    reports as never,
    messages as never,
    users as never,
    dataSource as never,
    settings as never,
    notifications as never,
    audit as never,
    adminUsers as never,
    adminContent as never,
  );
  // Detail reads aren't under test here.
  vi.spyOn(service, 'staffDetail').mockImplementation(async (id: string) => rows.find((r) => r.id === id) as never);
  return { service, rows, reports, users, notifications, adminUsers, adminContent, audit };
}

const player = (extra: Record<string, unknown> = {}) =>
  ({ id: 'me', name: 'Me', reportStrikes: 0, efootballProfile: { id: 'p-me', clubId: 'my-club', clubRole: ClubRole.PLAYER, communityId: null }, ...extra }) as never;
const moderator = { id: 'mod', name: 'Mod', systemRole: SystemRole.MODERATOR };
const admin = { id: 'adm', name: 'Admin', systemRole: SystemRole.ADMIN };
const base = { targetType: 'user' as const, targetId: '11111111-1111-1111-1111-111111111111', reason: 'cheating' as const, details: 'He used a modded client in the final.' };

describe('ReportsService.create', () => {
  it('files a report with the target name and context, and keeps the proof', async () => {
    const { service, rows } = setup();
    const report = await service.create(player(), base, ['/uploads/reports/a.png']);
    expect(report).toMatchObject({ targetName: 'Bad Player', contextClubId: 'club-x', contextCommunityId: 'comm-x', status: 'open', reportedAs: 'self' });
    expect(rows[0].attachments).toEqual(['/uploads/reports/a.png']);
  });

  it('refuses reporting yourself, a missing target, a duplicate open report, and over the daily limit', async () => {
    await expect(setup({ target: { userId: 'me', name: 'Me' } }).service.create(player(), base, [])).rejects.toBeInstanceOf(BadRequestException);
    await expect(setup({ target: null }).service.create(player(), base, [])).rejects.toThrow("doesn't exist");
    await expect(setup({ reportsToday: 10 }).service.create(player(), base, [])).rejects.toThrow('up to 10 reports a day');
    const { service } = setup();
    await service.create(player(), base, []);
    await expect(service.create(player(), base, [])).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses new reports while staff have paused reporting', async () => {
    await expect(setup({ reportsOpen: false }).service.create(player(), base, [])).rejects.toThrow('Reporting is paused');
  });

  it('blocks reporters with too many false-report strikes', async () => {
    await expect(setup().service.create(player({ reportStrikes: 3 }), base, [])).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('only club leaders can report on behalf of their club', async () => {
    await expect(setup().service.create(player(), { ...base, reportedAs: 'club' }, [])).rejects.toBeInstanceOf(ForbiddenException);
    const president = player({ efootballProfile: { id: 'p', clubId: 'my-club', clubRole: ClubRole.PRESIDENT, communityId: null } });
    const report = await setup().service.create(president, { ...base, reportedAs: 'club' }, []);
    expect(report).toMatchObject({ reportedAs: 'club', reporterClubId: 'my-club' });
  });
});

describe('ReportsService.resolve', () => {
  it('warns the reported user and tells the reporter', async () => {
    const { service, rows, adminUsers, notifications } = setup();
    await service.create(player(), base, []);
    await service.resolve(moderator, rows[0].id, { outcome: 'action_taken', resolution: 'Warned for cheating', action: 'warn' });
    expect(adminUsers.warn).toHaveBeenCalledWith(moderator, base.targetId, 'Warned for cheating', {});
    expect(rows[0]).toMatchObject({ status: 'action_taken', resolutionAction: 'warn', resolvedById: 'mod' });
    expect(notifications.createNotification).toHaveBeenCalledWith('me', expect.objectContaining({ code: 'report.resolved' }));
  });

  it('a moderator cannot ban from a report, and nothing is closed when the action is refused', async () => {
    const { service, rows, adminUsers } = setup();
    await service.create(player(), base, []);
    await expect(service.resolve(moderator, rows[0].id, { outcome: 'action_taken', resolution: 'Ban', action: 'ban' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(adminUsers.ban).not.toHaveBeenCalled();
    expect(rows[0].status).toBe('open');
  });

  it('rejecting as a false report gives the reporter a strike', async () => {
    const { service, rows, users, notifications } = setup();
    await service.create(player(), base, []);
    await service.resolve(admin, rows[0].id, { outcome: 'rejected', resolution: 'No evidence of this', falseReport: true });
    expect(rows[0]).toMatchObject({ status: 'rejected', falseReport: true });
    expect(users.increment).toHaveBeenCalledWith({ id: 'me' }, 'reportStrikes', 1);
    expect(notifications.createNotification).toHaveBeenCalledWith('me', expect.objectContaining({ code: 'report.rejected' }));
  });

  it('can close every open report on the same target at once', async () => {
    const { service, rows, adminContent } = setup({ target: { name: 'Toxic FC', clubId: 'c1', communityId: null } });
    const clubReport = { ...base, targetType: 'club' as const };
    await service.create(player(), clubReport, []);
    await service.create(player({ id: 'other' }), clubReport, []);
    await service.resolve(admin, rows[0].id, { outcome: 'action_taken', resolution: 'Club removed', action: 'bin', closeSimilar: true });
    expect(adminContent.moveToBin).toHaveBeenCalledTimes(1);
    expect(rows.map((r) => r.status)).toEqual(['action_taken', 'action_taken']);
  });

  it("refuses actions that don't fit the target", async () => {
    const { service, rows } = setup({ target: { name: 'Final', clubId: null, communityId: null } });
    await service.create(player(), { ...base, targetType: 'club' }, []);
    await expect(service.resolve(admin, rows[0].id, { outcome: 'action_taken', resolution: 'x x x', action: 'warn' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
