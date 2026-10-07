import { lastValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ActivityInterceptor } from './activity.interceptor.js';

function run(req: Record<string, unknown>, response: unknown = { id: 'new-id' }, fail = false) {
  const activity = { log: vi.fn(async () => undefined) };
  const interceptor = new ActivityInterceptor(activity as never);
  const context = { switchToHttp: () => ({ getRequest: () => req }) } as never;
  const handler = { handle: () => (fail ? throwError(() => new Error('nope')) : of(response)) };
  return { activity, result: lastValueFrom(interceptor.intercept(context, handler)) };
}

describe('ActivityInterceptor', () => {
  it('records a known action with its target from the route', async () => {
    const { activity, result } = run({
      method: 'POST',
      route: { path: '/tournaments/:id/join' },
      params: { id: 't1' },
      body: {},
      user: { id: 'u1' },
      ip: '1.1.1.1',
    });
    await result;
    expect(activity.log).toHaveBeenCalledWith('u1', expect.objectContaining({ type: 'tournament.joined', targetType: 'tournament', targetId: 't1', ip: '1.1.1.1' }));
  });

  it('takes a new item id from the response and keeps only the listed body fields', async () => {
    const { activity, result } = run({ method: 'POST', route: { path: '/clubs' }, params: {}, body: { name: 'X' }, user: { id: 'u1' } });
    await result;
    expect(activity.log).toHaveBeenCalledWith('u1', expect.objectContaining({ type: 'club.created', targetId: 'new-id', meta: null }));
  });

  it('ignores unknown routes, anonymous calls and failed requests', async () => {
    const unknown = run({ method: 'GET', route: { path: '/clubs' }, params: {}, user: { id: 'u1' } });
    await unknown.result;
    expect(unknown.activity.log).not.toHaveBeenCalled();

    const anonymous = run({ method: 'POST', route: { path: '/clubs' }, params: {}, body: {} });
    await anonymous.result;
    expect(anonymous.activity.log).not.toHaveBeenCalled();

    const failed = run({ method: 'POST', route: { path: '/clubs' }, params: {}, body: {}, user: { id: 'u1' } }, null, true);
    await expect(failed.result).rejects.toThrow('nope');
    expect(failed.activity.log).not.toHaveBeenCalled();
  });
});
