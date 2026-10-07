import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { DocumentType, SystemRole } from '../users/enums/user-attributes.enum.js';
import { AdminUsersService } from './admin-users.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function makeUser(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name: `User ${id}`,
    systemRole: null,
    warningsCount: 0,
    suspendedUntil: null,
    suspendReason: null,
    bannedAt: null,
    banReason: null,
    deletedAt: null,
    verificationStatus: 'pending',
    verificationLevel: 0,
    documentType: DocumentType.NATIONAL_ID,
    ...extra,
  };
}

function setup(users: Array<ReturnType<typeof makeUser>>) {
  const byId = new Map(users.map((u) => [u.id, u]));
  const usersRepo = {
    findOne: vi.fn(async ({ where }: { where: { id: string } }) => byId.get(where.id) ?? null),
    update: vi.fn(async (id: string, patch: Record<string, unknown>) => Object.assign(byId.get(id)!, patch)),
    increment: vi.fn(async () => undefined),
  };
  const dataSource = { query: vi.fn(async () => [{ total: 0 }]) };
  const audit = { record: vi.fn(async () => undefined) };
  const notifications = { createNotification: vi.fn(async () => ({})) };
  const activity = { log: vi.fn(async () => undefined) };
  const bin = { moveToBin: vi.fn(async () => ({})) };
  const settings = { admin: vi.fn(async () => ({ binRetentionDays: 30, moderatorMaxSuspendDays: 7 })) };
  const service = new AdminUsersService(
    usersRepo as never,
    dataSource as never,
    audit as never,
    notifications as never,
    activity as never,
    bin as never,
    settings as never,
  );
  return { service, usersRepo, audit, notifications, bin, byId };
}

const moderator = { id: 'mod', name: 'Mod', systemRole: SystemRole.MODERATOR };
const admin = { id: 'adm', name: 'Admin', systemRole: SystemRole.ADMIN };
const superAdmin = { id: 'sup', name: 'Super', systemRole: SystemRole.SUPER_ADMIN };

describe('AdminUsersService', () => {
  it('warns a user: counts it, notifies them and writes the audit log', async () => {
    const { service, byId, audit, notifications } = setup([makeUser('p1')]);
    await service.warn(moderator, 'p1', 'Abusive chat', { ip: '1.2.3.4' });
    expect(byId.get('p1')!.warningsCount).toBe(1);
    expect(notifications.createNotification).toHaveBeenCalledWith('p1', expect.objectContaining({ code: 'admin.warning' }));
    expect(audit.record).toHaveBeenCalledWith(
      moderator,
      expect.objectContaining({ action: 'user.warn', targetId: 'p1', reason: 'Abusive chat', ip: '1.2.3.4' }),
    );
  });

  it('only lets staff act on users ranked below them, never on themselves', async () => {
    const { service } = setup([makeUser('a2', { systemRole: SystemRole.ADMIN }), makeUser('m2', { systemRole: SystemRole.MODERATOR })]);
    await expect(service.warn(moderator, 'm2', 'test')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.ban(admin, 'a2', 'test')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.warn(moderator, 'mod', 'test')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.warn(admin, 'm2', 'test')).resolves.toBeDefined();
  });

  it('caps moderator suspensions at the setting; admins have no cap', async () => {
    const { service, usersRepo } = setup([makeUser('p1'), makeUser('p2')]);
    const tooLong = new Date(Date.now() + 10 * DAY_MS).toISOString();
    await expect(service.suspend(moderator, 'p1', tooLong, 'Spam')).rejects.toBeInstanceOf(ForbiddenException);
    await service.suspend(admin, 'p2', tooLong, 'Spam');
    expect(usersRepo.update).toHaveBeenCalledWith('p2', expect.objectContaining({ suspendReason: 'Spam' }));
    // Suspending signs them out everywhere.
    expect(usersRepo.increment).toHaveBeenCalledWith({ id: 'p2' }, 'tokenVersion', 1);
  });

  it('refuses a suspension that ends in the past', async () => {
    const { service } = setup([makeUser('p1')]);
    await expect(service.suspend(admin, 'p1', new Date(Date.now() - DAY_MS).toISOString(), 'Late')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('bans and revokes sessions, and records before / after', async () => {
    const { service, byId, usersRepo, audit } = setup([makeUser('p1')]);
    await service.ban(admin, 'p1', 'Cheating');
    expect(byId.get('p1')!.bannedAt).toBeInstanceOf(Date);
    expect(usersRepo.increment).toHaveBeenCalledWith({ id: 'p1' }, 'tokenVersion', 1);
    const entry = audit.record.mock.calls[0][1] as { before: { bannedAt: unknown }; after: { banReason: string } };
    expect(entry.before.bannedAt).toBeNull();
    expect(entry.after.banReason).toBe('Cheating');
    await expect(service.ban(admin, 'p1', 'Again')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('approving a document grants the level its type gives; rejecting clears it', async () => {
    const { service, byId, notifications } = setup([makeUser('p1'), makeUser('p2', { documentType: DocumentType.COLLEGE_DOCS, verificationLevel: 1 })]);
    await service.reviewVerification(moderator, 'p1', { approve: true });
    expect(byId.get('p1')).toMatchObject({ verificationStatus: 'approved', verificationLevel: 3, verificationReviewedById: 'mod' });
    await service.reviewVerification(moderator, 'p2', { approve: false, note: 'Blurry' });
    expect(byId.get('p2')).toMatchObject({ verificationStatus: 'rejected', verificationLevel: 0, verificationNote: 'Blurry' });
    expect(notifications.createNotification).toHaveBeenCalledWith('p2', expect.objectContaining({ code: 'verification.rejected' }));
  });

  it('role changes: never your own, and they sign the user out', async () => {
    const { service, byId, usersRepo } = setup([makeUser('p1')]);
    await expect(service.setRole(superAdmin, 'sup', { role: 'none' })).rejects.toBeInstanceOf(BadRequestException);
    await service.setRole(superAdmin, 'p1', { role: SystemRole.MODERATOR });
    expect(byId.get('p1')!.systemRole).toBe(SystemRole.MODERATOR);
    expect(usersRepo.increment).toHaveBeenCalledWith({ id: 'p1' }, 'tokenVersion', 1);
  });

  it('bulk actions report failures per user instead of stopping', async () => {
    const { service } = setup([makeUser('p1'), makeUser('a2', { systemRole: SystemRole.ADMIN })]);
    const result = await service.bulk(admin, { userIds: ['p1', 'a2', 'missing'], action: 'warn', reason: 'Spam wave' });
    expect(result.done).toBe(1);
    expect(result.failed.map((f) => f.id).sort()).toEqual(['a2', 'missing']);
  });

  it('bulk ban needs an admin', async () => {
    const { service } = setup([makeUser('p1')]);
    await expect(service.bulk(moderator, { userIds: ['p1'], action: 'ban', reason: 'Spam wave' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
