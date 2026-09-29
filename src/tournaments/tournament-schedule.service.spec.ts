import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { DAY_MS, HOUR_MS, localDayStart } from './bracket/schedule.js';
import { TournamentScheduleService } from './tournament-schedule.service.js';

// Tomorrow 17:00–20:00 Dhaka time.
const tomorrow = localDayStart(Date.now()) + DAY_MS;
const start = new Date(tomorrow + 17 * HOUR_MS);
const sameDay = (hour: number) => new Date(tomorrow + hour * HOUR_MS).toISOString();

function setup(options: { pending?: object | null; gameStatus?: string } = {}) {
  const game = {
    id: 'g1',
    matchId: 'm1',
    match: { tournamentId: 't1' },
    status: options.gameStatus ?? 'pending',
    playerAUserId: 'alice',
    playerAName: 'Alice',
    playerBUserId: 'bob',
    playerBName: 'Bob',
    scheduledStart: start,
    scheduledEnd: new Date(start.getTime() + 3 * HOUR_MS),
  };
  const gamesRepository = {
    findOne: vi.fn().mockResolvedValue(game),
    update: vi.fn().mockResolvedValue({}),
  };
  const requestsRepository = {
    findOne: vi.fn(async ({ where }: { where: { id?: string } }) =>
      where.id ? options.pending ?? null : options.pending ?? null),
    create: vi.fn((r) => r),
    save: vi.fn(async (r) => ({ id: 'r1', ...r })),
    update: vi.fn().mockResolvedValue({}),
    find: vi.fn().mockResolvedValue([]),
  };
  const tournamentsService = {
    findOne: vi.fn().mockResolvedValue({ id: 't1', name: 'Cup', communityId: 'c1' }),
    sendNotifications: vi.fn().mockResolvedValue(undefined),
  };
  const service = new TournamentScheduleService(
    gamesRepository as never,
    requestsRepository as never,
    tournamentsService as never,
  );
  return { service, gamesRepository, requestsRepository, tournamentsService };
}

describe('TournamentScheduleService.requestTimeChange', () => {
  it('stores the proposal and asks the opponent, linking to the timing panel', async () => {
    const { service, tournamentsService } = setup();

    const view = await service.requestTimeChange('alice', 't1', 'g1', sameDay(20));

    expect(view).toMatchObject({ requestedByUserId: 'alice', status: 'pending' });
    expect(tournamentsService.sendNotifications).toHaveBeenCalledWith(
      ['bob'],
      expect.objectContaining({ title: 'Time change requested', link: expect.stringContaining('game=g1&panel=time') }),
    );
  });

  it.each([
    ['an outsider', 'carol', sameDay(20), ForbiddenException],
    ['another date', 'alice', new Date(start.getTime() + DAY_MS).toISOString(), BadRequestException],
    ['the current time', 'alice', start.toISOString(), BadRequestException],
    ['a time in the past', 'alice', new Date(Date.now() - HOUR_MS).toISOString(), BadRequestException],
  ])('rejects %s', async (_case, user, proposed, error) => {
    const { service, requestsRepository } = setup();
    await expect(service.requestTimeChange(user, 't1', 'g1', proposed)).rejects.toThrow(error);
    expect(requestsRepository.save).not.toHaveBeenCalled();
  });

  it('blocks a new proposal while the opponent’s is pending', async () => {
    const { service } = setup({ pending: { id: 'r0', requestedByUserId: 'bob', status: 'pending' } });
    await expect(service.requestTimeChange('alice', 't1', 'g1', sameDay(20))).rejects.toThrow(BadRequestException);
  });

  it('refuses once evidence is being submitted', async () => {
    const { service } = setup({ gameStatus: 'awaiting_opponent' });
    await expect(service.requestTimeChange('alice', 't1', 'g1', sameDay(20))).rejects.toThrow(BadRequestException);
  });
});

describe('TournamentScheduleService.respondToTimeChange', () => {
  const pending = () => ({ id: 'r1', gameId: 'g1', requestedByUserId: 'alice', status: 'pending', proposedStart: new Date(tomorrow + 20 * HOUR_MS) });

  it('moves the game when the opponent accepts and tells both players', async () => {
    const { service, gamesRepository, tournamentsService } = setup({ pending: pending() });

    await service.respondToTimeChange('bob', 't1', 'r1', true);

    expect(gamesRepository.update).toHaveBeenCalledWith(
      { id: 'g1' },
      expect.objectContaining({
        scheduledStart: new Date(tomorrow + 20 * HOUR_MS),
        evidenceDeadline: new Date(tomorrow + 23.5 * HOUR_MS),
      }),
    );
    expect(tournamentsService.sendNotifications).toHaveBeenCalledWith(
      ['alice', 'bob'],
      expect.objectContaining({ title: 'Match time changed' }),
    );
  });

  it('keeps the system time when declined and tells the requester', async () => {
    const { service, gamesRepository, tournamentsService } = setup({ pending: pending() });

    await service.respondToTimeChange('bob', 't1', 'r1', false);

    expect(gamesRepository.update).not.toHaveBeenCalled();
    expect(tournamentsService.sendNotifications).toHaveBeenCalledWith(
      ['alice'],
      expect.objectContaining({ title: 'Time change declined', link: expect.stringContaining('panel=time') }),
    );
  });

  it('only lets the opponent answer', async () => {
    const { service } = setup({ pending: pending() });
    await expect(service.respondToTimeChange('alice', 't1', 'r1', true)).rejects.toThrow(ForbiddenException);
  });
});
