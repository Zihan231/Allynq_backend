import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable, catchError, from, switchMap, throwError } from 'rxjs';
import { SettingsService } from '../settings/settings.service.js';
import type { User } from '../users/entities/user.entity.js';
import { JobMonitorService } from './job-monitor.service.js';

const READ_METHODS = ['GET', 'HEAD', 'OPTIONS'];
/** Still allowed during maintenance: signing in / out, and the staff panel. */
const ALWAYS_OPEN = ['/auth/', '/admin/', '/settings/public'];

/**
 * Two platform-wide rules:
 * - maintenance mode: players can browse but every change is refused (staff are not affected);
 * - failed requests (5xx) are recorded for the system health page.
 */
@Injectable()
export class PlatformInterceptor implements NestInterceptor {
  constructor(
    private readonly settings: SettingsService,
    private readonly monitor: JobMonitorService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<Request & { user?: User }>();
    const path = req.path ?? req.url ?? '';

    const guarded = !READ_METHODS.includes(req.method) && !ALWAYS_OPEN.some((p) => path.startsWith(p)) && !req.user?.systemRole;
    const gate = guarded
      ? from(this.settings.maintenance()).pipe(
          switchMap((m) => {
            if (m.enabled) {
              return throwError(
                () => new ServiceUnavailableException(m.message?.trim() || 'ALLYNQ is under maintenance. Changes are paused for a short while.'),
              );
            }
            return next.handle();
          }),
        )
      : next.handle();

    return gate.pipe(
      catchError((error: unknown) => {
        const status = error instanceof HttpException ? error.getStatus() : 500;
        if (status >= 500 && status !== 503) {
          this.monitor.recordError({
            method: req.method,
            path: req.route?.path ?? path,
            status,
            message: (error as Error)?.message?.slice(0, 300) ?? 'Unknown error',
          });
        }
        return throwError(() => error);
      }),
    );
  }
}
