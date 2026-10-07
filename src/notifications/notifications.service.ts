import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { filter, interval, map, merge, Observable, Subject } from 'rxjs';
import { In, LessThan, Repository } from 'typeorm';
import { CommunityMember } from '../communities/entities/community-member.entity.js';
import { Community } from '../communities/entities/community.entity.js';
import { EfootballProfile } from '../users/entities/efootball-profile.entity.js';
import { ClubRole, CommunityRole } from '../users/enums/user-attributes.enum.js';
import { Notification, NotificationParams, NotificationType } from './entities/notification.entity.js';

/** A message code + params the app renders in the viewer's language (see Notification.code). */
export interface NotificationI18n {
  code?: string;
  params?: NotificationParams;
}

export interface CreateNotificationDto extends NotificationI18n {
  /** English fallback title / message. */
  title: string;
  message: string;
  type?: NotificationType;
  link?: string | null;
}

export interface NotificationEvent {
  userId: string;
  notification: Notification;
}

@Injectable()
export class NotificationsService {
  static readonly HEARTBEAT_MS = 20_000;
  private readonly logger = new Logger(NotificationsService.name);
  private readonly notificationSubject$ = new Subject<NotificationEvent>();

  constructor(
    @InjectRepository(Notification)
    private readonly notificationsRepository: Repository<Notification>,
    @InjectRepository(EfootballProfile)
    private readonly efootballProfilesRepository: Repository<EfootballProfile>,
    @InjectRepository(CommunityMember)
    private readonly communityMembersRepository: Repository<CommunityMember>,
    @InjectRepository(Community)
    private readonly communitiesRepository: Repository<Community>,
  ) {}

  /**
   * Creates and persists a notification, then emits it in real-time.
   */
  async createNotification(userId: string, dto: CreateNotificationDto): Promise<Notification> {
    const notification = this.notificationsRepository.create({
      userId,
      title: dto.title,
      message: dto.message,
      type: dto.type ?? 'system',
      link: dto.link ?? null,
      code: dto.code ?? null,
      params: dto.params ?? null,
      read: false,
    });

    const saved = await this.notificationsRepository.save(notification);

    // Emit event to active SSE streams
    this.notificationSubject$.next({
      userId,
      notification: saved,
    });

    this.logger.log(`Notification sent to user ${userId}: ${dto.title}`);
    return saved;
  }

  /**
   * The same notification for many users at once (announcements): inserted in batches,
   * then pushed to anyone connected. Returns how many were created.
   */
  async createMany(userIds: string[], dto: CreateNotificationDto): Promise<number> {
    const unique = [...new Set(userIds)];
    for (let i = 0; i < unique.length; i += 500) {
      const rows = unique.slice(i, i + 500).map((userId) =>
        this.notificationsRepository.create({
          userId,
          title: dto.title,
          message: dto.message,
          type: dto.type ?? 'system',
          link: dto.link ?? null,
          code: dto.code ?? null,
          params: dto.params ?? null,
          read: false,
        }),
      );
      const saved = await this.notificationsRepository.save(rows, { chunk: 100 });
      for (const notification of saved) this.notificationSubject$.next({ userId: notification.userId, notification });
    }
    return unique.length;
  }

  /**
   * Observable stream of notifications for a specific user (Server-Sent Events).
   * A named `ping` event every 20s keeps idle proxies (e.g. the Next.js rewrite proxy, which drops
   * connections after 30s of silence) from closing the stream; EventSource.onmessage ignores it.
   */
  getStream(userId: string): Observable<{ data: Notification | string; type?: string }> {
    const notifications$ = this.notificationSubject$.asObservable().pipe(
      filter((event) => event.userId === userId),
      map((event) => ({ data: event.notification })),
    );
    const heartbeat$ = interval(NotificationsService.HEARTBEAT_MS).pipe(map(() => ({ type: 'ping', data: '' })));
    return merge(notifications$, heartbeat$);
  }

  /**
   * Notify all authority members of a club (President, General Secretary, Manager, Captain, Vice-Captain).
   */
  async notifyClubAuthorities(
    clubId: string,
    title: string,
    message: string,
    link?: string,
    options: { type?: NotificationType; excludeUserIds?: string[] } & NotificationI18n = {},
  ): Promise<Notification[]> {
    const authorityRoles: ClubRole[] = [
      ClubRole.PRESIDENT,
      ClubRole.GENERAL_SECRETARY,
      ClubRole.MANAGER,
      ClubRole.CAPTAIN,
      ClubRole.VICE_CAPTAIN,
    ];

    const profiles = await this.efootballProfilesRepository.find({
      where: {
        clubId,
        clubRole: In(authorityRoles),
      },
    });

    const excluded = new Set(options.excludeUserIds ?? []);
    const targetUserIds = Array.from(
      new Set(profiles.map((p) => p.userId).filter((id): id is string => Boolean(id) && !excluded.has(id))),
    );

    const sentNotifications = await Promise.all(
      targetUserIds.map((userId) =>
        this.createNotification(userId, {
          title,
          message,
          type: options.type ?? 'club_join_request',
          link,
          code: options.code,
          params: options.params,
        }),
      ),
    );

    return sentNotifications;
  }

  /**
   * Notify all authority members of a community (President, Vice President, Team Manager)
   * plus the community's creator.
   */
  async notifyCommunityAuthorities(
    communityId: string,
    title: string,
    message: string,
    link?: string,
    i18n: NotificationI18n = {},
  ): Promise<Notification[]> {
    const authorityRoles: CommunityRole[] = [
      CommunityRole.PRESIDENT,
      CommunityRole.VICE_PRESIDENT,
      CommunityRole.TEAM_MANAGER,
    ];

    const members = await this.communityMembersRepository.find({
      where: {
        communityId,
        role: In(authorityRoles),
      },
      relations: { profile: true },
    });

    const community = await this.communitiesRepository.findOne({
      where: { id: communityId },
      select: { id: true, creatorId: true },
    });

    const targetUserIds = Array.from(
      new Set(
        [...members.map((m) => m.profile?.userId), community?.creatorId]
          .filter((id): id is string => Boolean(id)),
      ),
    );

    const sentNotifications = await Promise.all(
      targetUserIds.map((userId) =>
        this.createNotification(userId, {
          title,
          message,
          type: 'community_join_request',
          link,
          code: i18n.code,
          params: i18n.params,
        }),
      ),
    );

    return sentNotifications;
  }

  /**
   * A user's notifications, newest first. `before` pages back through older
   * ones (pass the `createdAt` of the last one received); `unreadOnly` filters.
   */
  async getUserNotifications(
    userId: string,
    options: { limit?: number; before?: Date; unreadOnly?: boolean } = {},
  ): Promise<Notification[]> {
    const limit = Math.min(Math.max(options.limit ?? 30, 1), 100);
    return this.notificationsRepository.find({
      where: {
        userId,
        ...(options.before ? { createdAt: LessThan(options.before) } : {}),
        ...(options.unreadOnly ? { read: false } : {}),
      },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  /**
   * Get unread notifications count for a user.
   */
  async getUnreadCount(userId: string): Promise<number> {
    return this.notificationsRepository.count({
      where: { userId, read: false },
    });
  }

  /**
   * Mark a single notification as read.
   */
  async markAsRead(id: string, userId: string): Promise<Notification | null> {
    const notification = await this.notificationsRepository.findOne({
      where: { id, userId },
    });

    if (!notification) {
      return null;
    }

    notification.read = true;
    return this.notificationsRepository.save(notification);
  }

  /**
   * Mark all unread notifications for a user as read.
   */
  async markAllAsRead(userId: string): Promise<void> {
    await this.notificationsRepository.update(
      { userId, read: false },
      { read: true },
    );
  }
}
