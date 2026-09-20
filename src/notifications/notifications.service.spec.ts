import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { firstValueFrom, take, toArray } from 'rxjs';
import { CommunityMember } from '../communities/entities/community-member.entity.js';
import { Community } from '../communities/entities/community.entity.js';
import { EfootballProfile } from '../users/entities/efootball-profile.entity.js';
import { User } from '../users/entities/user.entity.js';
import { ClubRole, CommunityRole } from '../users/enums/user-attributes.enum.js';
import { Notification } from './entities/notification.entity.js';
import { NotificationsService } from './notifications.service.js';

describe('NotificationsService', () => {
  let service: NotificationsService;

  const mockNotificationRepo = {
    create: vi.fn().mockImplementation((dto) => ({ id: 'notif-1', ...dto, createdAt: new Date(), updatedAt: new Date() })),
    save: vi.fn().mockImplementation((n) => Promise.resolve(n)),
    find: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(2),
    findOne: vi.fn().mockResolvedValue({ id: 'notif-1', userId: 'user-1', read: false }),
    update: vi.fn().mockResolvedValue({ affected: 1 }),
  };

  const mockProfileRepo = {
    find: vi.fn().mockResolvedValue([
      { userId: 'president-1', clubRole: ClubRole.PRESIDENT },
      { userId: 'manager-1', clubRole: ClubRole.MANAGER },
      { userId: 'captain-1', clubRole: ClubRole.CAPTAIN },
    ]),
  };

  const mockCommunityMemberRepo = {
    find: vi.fn().mockResolvedValue([
      { profile: { userId: 'comm-pres-1' }, role: CommunityRole.PRESIDENT },
      { profile: { userId: 'comm-vp-1' }, role: CommunityRole.VICE_PRESIDENT },
    ]),
  };

  const mockCommunityRepo = {
    findOne: vi.fn().mockResolvedValue({ id: 'comm-1', creatorId: 'comm-creator-1' }),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: getRepositoryToken(Notification), useValue: mockNotificationRepo },
        { provide: getRepositoryToken(EfootballProfile), useValue: mockProfileRepo },
        { provide: getRepositoryToken(CommunityMember), useValue: mockCommunityMemberRepo },
        { provide: getRepositoryToken(Community), useValue: mockCommunityRepo },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should create and emit notification via SSE stream', async () => {
    const streamPromise = firstValueFrom(service.getStream('user-1'));

    const created = await service.createNotification('user-1', {
      title: 'Test Notification',
      message: 'Hello World',
      link: '/test',
    });

    const emitted = await streamPromise;
    expect(emitted).toEqual({ data: created });
    expect(created.userId).toBe('user-1');
    expect(created.title).toBe('Test Notification');
  });

  it('should notify club authorities (President, GS, Manager, Captain, Vice-Captain)', async () => {
    const sent = await service.notifyClubAuthorities(
      'club-1',
      'Club Join Request',
      'User requested to join club',
      '/clubs/requests',
    );

    expect(sent.length).toBe(3);
    const notifiedUserIds = sent.map((s) => s.userId);
    expect(notifiedUserIds).toContain('president-1');
    expect(notifiedUserIds).toContain('manager-1');
    expect(notifiedUserIds).toContain('captain-1');
  });

  it('should notify community authorities (President, VP, Manager, Creator)', async () => {
    const sent = await service.notifyCommunityAuthorities(
      'comm-1',
      'Community Join Request',
      'User requested to join community',
      '/community/requests',
    );

    expect(sent.length).toBe(3);
    const notifiedUserIds = sent.map((s) => s.userId);
    expect(notifiedUserIds).toContain('comm-pres-1');
    expect(notifiedUserIds).toContain('comm-vp-1');
    expect(notifiedUserIds).toContain('comm-creator-1');
  });

  it('should mark notification as read', async () => {
    const res = await service.markAsRead('notif-1', 'user-1');
    expect(res).toBeDefined();
    expect(res?.read).toBe(true);
  });

  it('should mark all notifications as read for user', async () => {
    await service.markAllAsRead('user-1');
    expect(mockNotificationRepo.update).toHaveBeenCalledWith(
      { userId: 'user-1', read: false },
      { read: true },
    );
  });

  it('should get unread count', async () => {
    const count = await service.getUnreadCount('user-1');
    expect(count).toBe(2);
  });
});
