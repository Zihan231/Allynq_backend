import { InternalServerErrorException, ServiceUnavailableException } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { JobMonitorService } from './job-monitor.service.js';
import { PlatformInterceptor } from './platform.interceptor.js';

function run(req: Record<string, unknown>, maintenance: { enabled: boolean; message: string }, fail?: Error) {
  const monitor = new JobMonitorService();
  const settings = { maintenance: async () => maintenance };
  const interceptor = new PlatformInterceptor(settings as never, monitor);
  const context = { getType: () => 'http', switchToHttp: () => ({ getRequest: () => req }) } as never;
  const handler = { handle: () => (fail ? throwError(() => fail) : of('ok')) };
  return { monitor, result: lastValueFrom(interceptor.intercept(context, handler)) };
}

const off = { enabled: false, message: '' };
const on = { enabled: true, message: 'Upgrading the servers' };

describe('PlatformInterceptor', () => {
  it('lets everything through when maintenance is off', async () => {
    await expect(run({ method: 'POST', path: '/clubs', user: { id: 'u' } }, off).result).resolves.toBe('ok');
  });

  it('during maintenance, refuses players’ changes with the staff message, but not reads', async () => {
    await expect(run({ method: 'POST', path: '/transfers/offers', user: { id: 'u' } }, on).result).rejects.toThrow(ServiceUnavailableException);
    await expect(run({ method: 'PATCH', path: '/users/me', user: { id: 'u' } }, on).result).rejects.toThrow('Upgrading the servers');
    await expect(run({ method: 'GET', path: '/clubs', user: { id: 'u' } }, on).result).resolves.toBe('ok');
  });

  it('during maintenance, staff, sign-in and the admin panel keep working', async () => {
    await expect(run({ method: 'POST', path: '/clubs', user: { id: 's', systemRole: 'admin' } }, on).result).resolves.toBe('ok');
    await expect(run({ method: 'POST', path: '/auth/login' }, on).result).resolves.toBe('ok');
    await expect(run({ method: 'POST', path: '/admin/users/x/warn', user: { id: 's' } }, on).result).resolves.toBe('ok');
  });

  it('records server errors for the health page, not client errors', async () => {
    const failed = run({ method: 'GET', path: '/stats', route: { path: '/stats' } }, off, new InternalServerErrorException('db down'));
    await expect(failed.result).rejects.toThrow('db down');
    expect(failed.monitor.snapshot()).toMatchObject({ errorCount: 1, errors: [{ path: '/stats', status: 500, message: 'db down' }] });
  });
});

describe('JobMonitorService', () => {
  it('records runs, results and failures of background jobs', async () => {
    const monitor = new JobMonitorService();
    await monitor.run('job', async () => 3, (n) => `${n} done`);
    await expect(monitor.run('job', async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(monitor.snapshot().jobs[0]).toMatchObject({ name: 'job', runs: 2, failures: 1, lastError: 'boom', lastResult: '3 done' });
  });
});
