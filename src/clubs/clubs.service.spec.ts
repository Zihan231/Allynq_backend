import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ClubRole } from '../users/enums/user-attributes.enum.js';
import { ClubsService } from './clubs.service.js';

describe('ClubsService settings (positions and match-official nominees)', () => {
  const clubId = 'club-1';

  function setup() {
    // Club members by profile id; each has a user id and a club role.
    const profiles = new Map(
      [
        { id: 'p-pres', userId: 'pres', clubRole: ClubRole.PRESIDENT },
        { id: 'p-gs', userId: 'gs', clubRole: ClubRole.GENERAL_SECRETARY },
        { id: 'p-cap', userId: 'cap', clubRole: ClubRole.CAPTAIN },
        { id: 'p-a', userId: 'a', clubRole: ClubRole.PLAYER },
        { id: 'p-b', userId: 'b', clubRole: ClubRole.PLAYER },
      ].map((p) => [p.id, { ...p, clubId, user: { name: p.userId } }]),
    );
    const find = (where: Record<string, unknown>) =>
      [...profiles.values()].find((p) =>
        Object.entries(where).every(([key, value]) => (p as Record<string, unknown>)[key] === value),
      ) ?? null;

    const clubsRepository = {
      findOne: vi.fn().mockResolvedValue({ id: clubId, name: 'Test FC', members: [...profiles.values()] }),
      update: vi.fn().mockResolvedValue({}),
    };
    const profilesRepository = {
      findOne: vi.fn(({ where }: { where: Record<string, unknown> }) => Promise.resolve(find(where))),
      find: vi.fn(({ where }: { where: { userId: { _value: string[] } } }) =>
        Promise.resolve([...profiles.values()].filter((p) => where.userId._value.includes(p.userId))),
      ),
      save: vi.fn((p) => Promise.resolve(p)),
    };
    const notificationsService = { createNotification: vi.fn().mockResolvedValue({}) };
    const service = new ClubsService(
      clubsRepository as never,
      profilesRepository as never,
      {} as never,
      {} as never,
      {} as never,
      notificationsService as never,
    );
    return { service, profiles, clubsRepository, notificationsService };
  }

  it('moves a position to a new member and makes the previous holder a Player', async () => {
    const { service, profiles, notificationsService } = setup();

    await service.assignPosition(clubId, { id: 'gs' } as never, { profileId: 'p-a', role: ClubRole.CAPTAIN });

    expect(profiles.get('p-a')!.clubRole).toBe(ClubRole.CAPTAIN);
    expect(profiles.get('p-cap')!.clubRole).toBe(ClubRole.PLAYER);
    expect(notificationsService.createNotification).toHaveBeenCalledWith(
      'a',
      expect.objectContaining({ code: 'club.positionAssigned', params: { role: ClubRole.CAPTAIN, club: 'Test FC' } }),
    );
  });

  it('clears a position when set to Player', async () => {
    const { service, profiles } = setup();
    await service.assignPosition(clubId, { id: 'pres' } as never, { profileId: 'p-cap', role: ClubRole.PLAYER });
    expect(profiles.get('p-cap')!.clubRole).toBe(ClubRole.PLAYER);
  });

  it("refuses to change the President's position and anyone but the President / GS", async () => {
    const { service } = setup();
    await expect(
      service.assignPosition(clubId, { id: 'gs' } as never, { profileId: 'p-pres', role: ClubRole.PLAYER }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.assignPosition(clubId, { id: 'cap' } as never, { profileId: 'p-a', role: ClubRole.MANAGER }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('saves match-official nominees, members only', async () => {
    const { service, clubsRepository } = setup();

    await expect(service.setMatchOfficials(clubId, { id: 'pres' } as never, { userIds: ['a', 'outsider'] })).rejects.toThrow(
      BadRequestException,
    );
    const result = await service.setMatchOfficials(clubId, { id: 'pres' } as never, { userIds: ['a', 'b', 'a'] });

    expect(result.matchOfficialIds).toEqual(['a', 'b']);
    expect(clubsRepository.update).toHaveBeenCalledWith({ id: clubId }, { matchOfficialIds: ['a', 'b'] });
  });
});
