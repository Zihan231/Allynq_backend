import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { Observable, tap } from 'rxjs';
import type { User } from '../users/entities/user.entity.js';
import { ActivityService } from './activity.service.js';

interface ActivityRule {
  method: string;
  /** Express route pattern, as Nest registered it. */
  path: string;
  type: string;
  summary: string;
  /** Which route param holds the target id, and what kind of thing it is. */
  target?: { type: string; param: string };
  /** Pull the target id from the response instead (e.g. something just created). */
  targetFromResponse?: { type: string };
  /** Or from the body (e.g. what a report is about). */
  targetFromBody?: { typeField: string; idField: string };
  /** Body fields worth keeping. */
  meta?: string[];
}

/**
 * What players do, for the activity timeline. Only successful requests are recorded.
 * Staff actions are in the audit log and sign-ins in the login history, so neither is here.
 */
const RULES: ActivityRule[] = [
  { method: 'PATCH', path: '/users/me', type: 'profile.updated', summary: 'Updated their profile', meta: ['documentType'] },
  { method: 'PUT', path: '/users/me/efootball-profile', type: 'profile.game_updated', summary: 'Updated their eFootball profile' },
  { method: 'DELETE', path: '/users/:id', type: 'account.deleted', summary: 'Deleted their account' },
  { method: 'POST', path: '/clubs', type: 'club.created', summary: 'Created a club', targetFromResponse: { type: 'club' } },
  { method: 'PATCH', path: '/clubs/:id', type: 'club.updated', summary: 'Edited a club', target: { type: 'club', param: 'id' } },
  { method: 'DELETE', path: '/clubs/:id', type: 'club.deleted', summary: 'Deleted a club', target: { type: 'club', param: 'id' } },
  { method: 'POST', path: '/clubs/:id/leave', type: 'club.left', summary: 'Left a club', target: { type: 'club', param: 'id' } },
  { method: 'POST', path: '/clubs/:id/president/transfer', type: 'club.handover', summary: 'Handed over the club presidency', target: { type: 'club', param: 'id' } },
  { method: 'PUT', path: '/clubs/:id/match-officials', type: 'club.officials', summary: 'Changed club match officials', target: { type: 'club', param: 'id' } },
  { method: 'POST', path: '/communities', type: 'community.created', summary: 'Created a community', targetFromResponse: { type: 'community' } },
  { method: 'PATCH', path: '/communities/:id', type: 'community.updated', summary: 'Edited a community', target: { type: 'community', param: 'id' } },
  { method: 'DELETE', path: '/communities/:id', type: 'community.deleted', summary: 'Deleted a community', target: { type: 'community', param: 'id' } },
  { method: 'POST', path: '/communities/:id/join', type: 'community.joined', summary: 'Joined a community', target: { type: 'community', param: 'id' } },
  { method: 'POST', path: '/communities/:id/leave', type: 'community.left', summary: 'Left a community', target: { type: 'community', param: 'id' } },
  { method: 'POST', path: '/communities/:id/clubs/:clubId', type: 'community.club_joined', summary: 'Brought a club into a community', target: { type: 'community', param: 'id' } },
  { method: 'DELETE', path: '/communities/:id/clubs/:clubId', type: 'community.club_removed', summary: 'Removed a club from a community', target: { type: 'community', param: 'id' } },
  { method: 'PATCH', path: '/communities/:id/roles', type: 'community.roles', summary: 'Changed community roles', target: { type: 'community', param: 'id' } },
  { method: 'POST', path: '/communities/:id/president/transfer', type: 'community.handover', summary: 'Handed over the community presidency', target: { type: 'community', param: 'id' } },
  { method: 'POST', path: '/tournaments', type: 'tournament.created', summary: 'Created a tournament', targetFromResponse: { type: 'tournament' } },
  { method: 'PATCH', path: '/tournaments/:id', type: 'tournament.updated', summary: 'Edited a tournament', target: { type: 'tournament', param: 'id' } },
  { method: 'DELETE', path: '/tournaments/:id', type: 'tournament.deleted', summary: 'Deleted a tournament', target: { type: 'tournament', param: 'id' } },
  { method: 'POST', path: '/tournaments/:id/join', type: 'tournament.joined', summary: 'Registered for a tournament', target: { type: 'tournament', param: 'id' } },
  { method: 'POST', path: '/tournaments/:id/participants/:participantId/lineup', type: 'tournament.lineup', summary: 'Submitted a lineup', target: { type: 'tournament', param: 'id' } },
  { method: 'POST', path: '/tournaments/:id/generate-bracket', type: 'tournament.bracket', summary: 'Generated the fixtures', target: { type: 'tournament', param: 'id' } },
  { method: 'POST', path: '/tournaments/:id/games/:gameId/time-request', type: 'match.time_request', summary: 'Asked to move a match time', target: { type: 'tournament', param: 'id' } },
  { method: 'POST', path: '/tournaments/:id/games/:gameId/submission', type: 'match.evidence', summary: 'Uploaded match evidence', target: { type: 'tournament', param: 'id' } },
  { method: 'POST', path: '/tournaments/:id/games/:gameId/review', type: 'match.reviewed', summary: 'Decided a match result', target: { type: 'tournament', param: 'id' } },
  { method: 'POST', path: '/transfers/offers', type: 'transfer.offer', summary: 'Sent a transfer offer', meta: ['clubId', 'playerUserId', 'amountTk'] },
  { method: 'POST', path: '/transfers/offers/:id/respond', type: 'transfer.respond', summary: 'Answered a transfer offer', meta: ['accept'] },
  { method: 'POST', path: '/transfers/offers/:id/cancel', type: 'transfer.cancel', summary: 'Withdrew a transfer offer' },
  { method: 'POST', path: '/transfers/wallets/top-up', type: 'wallet.top_up', summary: 'Added demo funds' },
  { method: 'POST', path: '/reports', type: 'report.created', summary: 'Sent a report', targetFromBody: { typeField: 'targetType', idField: 'targetId' }, meta: ['reason'] },
  { method: 'POST', path: '/reports/:id/withdraw', type: 'report.withdrawn', summary: 'Withdrew a report' },
];

const byKey = new Map(RULES.map((r) => [`${r.method} ${r.path}`, r]));

@Injectable()
export class ActivityInterceptor implements NestInterceptor {
  constructor(private readonly activity: ActivityService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request & { user?: User }>();
    const routePath: string | undefined = req.route?.path;
    const rule = routePath ? byKey.get(`${req.method} ${routePath}`) : undefined;
    if (!rule) return next.handle();

    return next.handle().pipe(
      tap((response: unknown) => {
        const user = req.user;
        if (!user?.id) return;
        const body = (req.body ?? {}) as Record<string, unknown>;
        const meta = rule.meta ? Object.fromEntries(rule.meta.filter((k) => body[k] !== undefined).map((k) => [k, body[k]])) : null;
        const responseId = (response as { id?: unknown } | null)?.id;
        const param = rule.target ? req.params[rule.target.param] : undefined;
        const bodyType = rule.targetFromBody ? body[rule.targetFromBody.typeField] : undefined;
        const bodyId = rule.targetFromBody ? body[rule.targetFromBody.idField] : undefined;
        const targetId = rule.target
          ? (typeof param === 'string' ? param : null)
          : rule.targetFromResponse && typeof responseId === 'string'
            ? responseId
            : typeof bodyId === 'string'
              ? bodyId
              : null;
        void this.activity.log(user.id, {
          type: rule.type,
          summary: rule.summary,
          targetType: rule.target?.type ?? rule.targetFromResponse?.type ?? (typeof bodyType === 'string' ? bodyType : null),
          targetId: targetId ?? null,
          meta: meta && Object.keys(meta).length ? meta : null,
          ip: req.ip ?? null,
        });
      }),
    );
  }
}
