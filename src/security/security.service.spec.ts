import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { SecurityService } from './security.service.js';

function setup() {
  const rows: Array<Record<string, unknown>> = [];
  const bans = {
    find: vi.fn(async () => rows.filter((r) => !r.revokedAt)),
    findOne: vi.fn(async ({ where }: { where: Record<string, unknown> }) => rows.find((r) => r.id === where.id || (r.valueHash === where.valueHash && !r.revokedAt)) ?? null),
    create: (d: Record<string, unknown>) => d,
    save: vi.fn(async (d: Record<string, unknown>) => {
      if (!d.id) {
        d.id = `ban-${rows.length + 1}`;
        rows.push(d);
      }
      return d;
    }),
  };
  const service = new SecurityService(bans as never, {} as never, { get: () => 'k' } as never);
  return { service, bans };
}

describe('SecurityService', () => {
  it('blocks a banned IP, but never a staff account', async () => {
    const { service } = setup();
    await service.create({ kind: 'ip', value: '10.0.0.7', reason: 'abuse' });
    await expect(service.assertAllowed({ ip: '10.0.0.7' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.assertAllowed({ ip: '10.0.0.7' }, { staff: true })).resolves.toBeUndefined();
    await expect(service.assertAllowed({ ip: '10.0.0.8' })).resolves.toBeUndefined();
  });

  it('reads bans from a short cache, refreshed when a ban is added or revoked', async () => {
    const { service, bans } = setup();
    await service.assertAllowed({ ip: '1.1.1.1' });
    await service.assertAllowed({ ip: '1.1.1.1' });
    expect(bans.find).toHaveBeenCalledTimes(1);
    const ban = await service.create({ kind: 'device', value: 'device-abc', reason: 'multi accounts' });
    await expect(service.assertAllowed({ deviceId: 'device-abc' })).rejects.toBeInstanceOf(ForbiddenException);
    await service.revoke(ban.id, 'staff');
    await expect(service.assertAllowed({ deviceId: 'device-abc' })).resolves.toBeUndefined();
  });

  it('recognises the caller’s own network and device', () => {
    const { service } = setup();
    expect(service.matchesClient('ip', service.hash('ip', '::ffff:10.1.1.1'), { ip: '10.1.1.1' })).toBe(true);
    expect(service.matchesClient('device', service.hash('device', 'd1'), { deviceId: 'd2' })).toBe(false);
  });
});
