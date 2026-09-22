import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { filter, map, Observable, Subject } from 'rxjs';
import { In, Repository } from 'typeorm';
import { CommunityMember } from '../communities/entities/community-member.entity.js';
import { Community } from '../communities/entities/community.entity.js';
import { EfootballProfile } from '../users/entities/efootball-profile.entity.js';
import { ClubRole, CommunityRole } from '../users/enums/user-attributes.enum.js';
import { Notification, NotificationType } from './entities/notification.entity.js';

export interface CreateNotificationDto {
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
   * Observable stream of notifications for a specific user (Server-Sent Events).
   */
  getStream(userId: string): Observable<{ data: Notification }> {
    return this.notificationSubject$.asObservable().pipe(
      filter((event) => event.userId === userId),
      map((event) => ({ data: event.notification })),
    );
  }

  /**
   * Notify all authority members of a club (President, General Secretary, Manager, Captain, Vice-Captain).
   */
  async notifyClubAuthorities(
    clubId: string,
    title: string,
    message: string,
    link?: string,
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

    const targetUserIds = Array.from(
      new Set(profiles.map((p) => p.userId).filter((id): id is string => Boolean(id))),
    );

    const sentNotifications = await Promise.all(
      targetUserIds.map((userId) =>
        this.createNotification(userId, {
          title,
          message,
          type: 'club_join_request',
          link,
        }),
      ),
    );

    return sentNotifications;
  }

  /**
   * Notify all authority members of a community (President, Vice President, Team Manager).
   */
  async notifyCommunityAuthorities(
    communityId: string,
    title: string,
    message: string,
    link?: string,
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

    const targetUserIds = Array.from(
      new Set(
        members
          .map((m) => m.profile?.userId)
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
        }),
      ),
    );

    return sentNotifications;
  }

  /**
   * Retrieve recent notifications for a user.
   */
  async getUserNotifications(userId: string, limit = 30): Promise<Notification[]> {
    return this.notificationsRepository.find({
      where: { userId },
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
