import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Observable } from 'rxjs';
import type { User } from '../users/entities/user.entity.js';

/** "View as user" tokens may inspect the app but can never mutate it. */
@Injectable()
export class ViewOnlyInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request & { user?: User }>();
    if (
      req.user?.authContext?.viewOnly &&
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method)
    ) {
      throw new ForbiddenException('View-as-user sessions are read-only');
    }
    return next.handle();
  }
}
