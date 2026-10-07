import {
  BadRequestException,
  Controller,
  Get,
  MessageEvent,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { User } from '../users/entities/user.entity.js';
import { NotificationsService } from './notifications.service.js';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  /** Newest first. `?limit=` (1–100, default 30), `?before=<ISO date>` for older pages, `?unread=true`. */
  @UseGuards(JwtAuthGuard)
  @Get()
  getNotifications(
    @CurrentUser() user: User,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
    @Query('unread') unread?: string,
  ) {
    const beforeDate = before ? new Date(before) : undefined;
    if (beforeDate && Number.isNaN(beforeDate.getTime())) {
      throw new BadRequestException('`before` must be a valid date');
    }
    return this.notificationsService.getUserNotifications(user.id, {
      limit: limit ? Number(limit) || undefined : undefined,
      before: beforeDate,
      unreadOnly: unread === 'true',
    });
  }

  /** Staff-edited wording for notification types; the app prefers it over its built-in text. */
  @UseGuards(JwtAuthGuard)
  @Get('templates')
  templates() {
    return this.notificationsService.activeTemplates();
  }

  @UseGuards(JwtAuthGuard)
  @Get('unread-count')
  async getUnreadCount(@CurrentUser() user: User) {
    const unreadCount = await this.notificationsService.getUnreadCount(user.id);
    return { unreadCount };
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/read')
  markAsRead(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.notificationsService.markAsRead(id, user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('read-all')
  async markAllAsRead(@CurrentUser() user: User) {
    await this.notificationsService.markAllAsRead(user.id);
    return { success: true };
  }

  @UseGuards(JwtAuthGuard)
  @Sse('stream')
  stream(@CurrentUser() user: User): Observable<MessageEvent> {
    return this.notificationsService.getStream(user.id) as Observable<MessageEvent>;
  }
}
