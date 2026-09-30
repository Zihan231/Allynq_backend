import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { TournamentMatchGame } from './entities/tournament-match-game.entity.js';
import { TournamentMatch } from './entities/tournament-match.entity.js';
import { TournamentType } from './enums/tournament.enum.js';
import { TournamentMatchesService } from './tournament-matches.service.js';

function participants(count: number, type: TournamentType, starters = 4) {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${i + 1}`,
    createdAt: new Date(2026, 0, 1, 0, i),
    userId: type === TournamentType.PVP ? `user${i + 1}` : null,
    user: type === TournamentType.PVP ? { name: `Player ${i + 1}`, dpUrl: null } : null,
    club: type === TournamentType.CVC ? { name: `Club ${i + 1}` } : null,
    lineup:
      type === TournamentType.CVC
        ? {
            starters: Array.from({ length: starters }, (_, s) => ({ profileId: `c${i + 1}s${s + 1}`, name: `C${i + 1} S${s + 1}` })),
            substitutes: [],
          }
        : null,
  }));
}

function setup(entrants: ReturnType<typeof participants>, type: TournamentType, existing = 0) {
  const saved: { matches: TournamentMatch[]; games: TournamentMatchGame[]; update: unknown } = {
    matches: [],
    games: [],
    update: null,
  };
  const tournament = { id: 't1', type, startersCount: 4, participants: entrants, format: null };
  const tournamentsService = {
    findOne: vi.fn().mockResolvedValue(tournament),
    assertCanManage: vi.fn().mockResolvedValue(undefined),
    notifyParticipants: vi.fn().mockResolvedValue(undefined),
    sendNotifications: vi.fn().mockResolvedValue(undefined),
  };
  const matchesRepository = {
    count: vi.fn().mockResolvedValue(existing),
    create: vi.fn((m) => Object.assign(new TournamentMatch(), m)),
    find: vi.fn().mockResolvedValue([]),
  };
  const profilesRepository = { find: vi.fn().mockResolvedValue([]) };
  const dataSource = {
    transaction: vi.fn(async (work: (manager: unknown) => Promise<void>) =>
      work({
        save: vi.fn(async (entity: unknown, rows: unknown[]) => {
          if (entity === TournamentMatch) saved.matches = rows as TournamentMatch[];
          else saved.games = rows as TournamentMatchGame[];
        }),
        update: vi.fn(async (_entity: unknown, _where: unknown, values: unknown) => {
          saved.update = values;
        }),
      }),
    ),
  };
  const service = new TournamentMatchesService(
    matchesRepository as never,
    profilesRepository as never,
    dataSource as never,
    tournamentsService as never,
  );
  return { service, saved, tournamentsService, profilesRepository };
}

describe('TournamentMatchesService.generateStructure', () => {
  it('builds a knockout for 4 CvC clubs with one game per starter pairing', async () => {
    const { service, saved, tournamentsService } = setup(participants(4, TournamentType.CVC), TournamentType.CVC);

    await service.generateStructure('organizer', 't1');

    expect(tournamentsService.assertCanManage).toHaveBeenCalled();
    expect(tournamentsService.notifyParticipants).toHaveBeenCalledWith(
      expect.anything(),
      'organizer',
      expect.objectContaining({ title: 'Fixtures are out' }),
    );
    expect(saved.update).toMatchObject({ format: 'knockout' });
    expect(saved.matches.map((m) => m.roundName).sort()).toEqual(['Final', 'Semi-final', 'Semi-final']);
    // 2 semi-finals × 4 starter pairings; the final waits for its entrants.
    expect(saved.games).toHaveLength(8);
    // Equal points → random seeding, so p1 may be either side of its semi-final.
    const p1Semi = saved.matches.find((m) => m.participantAId === 'p1' || m.participantBId === 'p1')!;
    const p1Side = p1Semi.participantAId === 'p1' ? 'playerAProfileId' : 'playerBProfileId';
    const semiGames = saved.games.filter((g) => g.matchId === p1Semi.id);
    expect(semiGames.map((g) => [g.slot, g[p1Side]])).toEqual([
      [1, 'c1s1'], [2, 'c1s2'], [3, 'c1s3'], [4, 'c1s4'],
    ]);
    // Saved deepest rounds first so nextMatchId references exist.
    expect(saved.matches[0].roundName).toBe('Final');
  });

  it('gives every game a 3h range at least 3h after the start, one matchday per day', async () => {
    const { service, saved, tournamentsService } = setup(participants(12, TournamentType.PVP), TournamentType.PVP);
    const before = Date.now();

    await service.generateStructure('organizer', 't1');

    const earliest = before + 3 * 60 * 60 * 1000;
    for (const game of saved.games) {
      expect(game.scheduledStart!.getTime()).toBeGreaterThanOrEqual(earliest - 1000);
      expect(game.scheduledEnd!.getTime() - game.scheduledStart!.getTime()).toBe(3 * 60 * 60 * 1000);
      expect(game.evidenceDeadline!.getTime() - game.scheduledEnd!.getTime()).toBe(30 * 60 * 1000);
    }
    const startOf = (m: TournamentMatch) => saved.games.find((g) => g.matchId === m.id)!.scheduledStart!.getTime();
    const matchday = (n: number) => saved.matches.filter((m) => m.round === n).map(startOf);
    expect(Math.min(...matchday(2))).toBeGreaterThan(Math.max(...matchday(1)));
    // Each player hears about their schedule once.
    const scheduled = tournamentsService.sendNotifications.mock.calls.filter(
      ([, n]) => (n as { title: string }).title === 'Match scheduled',
    );
    expect(scheduled).toHaveLength(12);
  });

  it('gives byes to the top seeds and schedules the matches they feed', async () => {
    const { service, saved } = setup(participants(5, TournamentType.PVP), TournamentType.PVP);

    await service.generateStructure('organizer', 't1');

    const byes = saved.matches.filter((m) => m.status === 'bye');
    expect(byes).toHaveLength(3);
    const semis = saved.matches.filter((m) => m.roundName === 'Semi-final');
    expect(semis.some((m) => m.participantAId && m.participantBId)).toBe(true);
    // Games only for fixtures that already have both entrants.
    const playable = saved.matches.filter((m) => m.status === 'scheduled' && m.participantAId && m.participantBId);
    expect(saved.games).toHaveLength(playable.length);
  });

  it('keeps a tournament out of "live" until its start time, even once fixtures are out', async () => {
    const early = setup(participants(4, TournamentType.PVP), TournamentType.PVP);
    const future = { ...(await early.tournamentsService.findOne()), startAt: new Date(Date.now() + 3 * 60 * 60 * 1000) };
    early.tournamentsService.findOne.mockResolvedValue(future);
    await early.service.generateStructure('organizer', 't1');
    expect(early.saved.update).toMatchObject({ format: 'knockout', status: 'submission_phase' });

    const late = setup(participants(4, TournamentType.PVP), TournamentType.PVP);
    const past = { ...(await late.tournamentsService.findOne()), startAt: new Date(Date.now() - 60 * 1000) };
    late.tournamentsService.findOne.mockResolvedValue(past);
    await late.service.generateStructure(null, 't1');
    expect(late.saved.update).toMatchObject({ format: 'knockout', status: 'ongoing' });
  });

  it('seeds a PvP knockout by player points, not by who registered first', async () => {
    // Registered p1…p8, but points rise with the number: p8 is the strongest.
    const { service, saved, profilesRepository } = setup(participants(8, TournamentType.PVP), TournamentType.PVP);
    profilesRepository.find.mockResolvedValue(
      Array.from({ length: 8 }, (_, i) => ({ userId: `user${i + 1}`, points: (i + 1) * 100 })),
    );

    await service.generateStructure('organizer', 't1');

    const quarterFinals = saved.matches
      .filter((m) => m.roundName === 'Quarter-final')
      .map((m) => [m.participantAId, m.participantBId].sort().join(' v '))
      .sort();
    // Seeds by points: 1=p8 … 8=p1, paired 1v8, 4v5, 2v7, 3v6.
    expect(quarterFinals).toEqual(['p1 v p8', 'p2 v p7', 'p3 v p6', 'p4 v p5']);
  });

  it('seeds a CvC knockout by club points', async () => {
    const clubs = participants(4, TournamentType.CVC).map((p, i) => ({
      ...p,
      club: { name: `Club ${i + 1}`, points: [300, 100, 400, 200][i] },
    }));
    const { service, saved } = setup(clubs, TournamentType.CVC);

    await service.generateStructure('organizer', 't1');

    // Seeds: p3 (400), p1 (300), p4 (200), p2 (100) → semis p3 v p2 and p1 v p4.
    const semis = saved.matches
      .filter((m) => m.roundName === 'Semi-final')
      .map((m) => [m.participantAId, m.participantBId].sort().join(' v '))
      .sort();
    expect(semis).toEqual(['p1 v p4', 'p2 v p3']);
  });

  it('splits 12 PvP players into 2 round-robin groups of 6', async () => {
    const { service, saved } = setup(participants(12, TournamentType.PVP), TournamentType.PVP);

    await service.generateStructure('organizer', 't1');

    expect(saved.update).toMatchObject({ format: 'groups_knockout' });
    const labels = new Set(saved.matches.map((m) => m.groupLabel));
    expect([...labels].sort()).toEqual(['A', 'B']);
    // 6 players → 15 fixtures per group.
    expect(saved.matches).toHaveLength(30);
    expect(saved.games).toHaveLength(30);
  });

  it.each([
    ['fewer than 4 entrants', participants(3, TournamentType.PVP), TournamentType.PVP, 0],
    ['fixtures already exist', participants(4, TournamentType.PVP), TournamentType.PVP, 3],
  ])('refuses when %s', async (_case, entrants, type, existing) => {
    const { service, saved } = setup(entrants, type, existing);
    await expect(service.generateStructure('organizer', 't1')).rejects.toThrow(BadRequestException);
    expect(saved.matches).toHaveLength(0);
  });

  it('refuses while a club has not submitted a full team', async () => {
    const entrants = participants(4, TournamentType.CVC);
    entrants[2].lineup = null;
    const { service } = setup(entrants, TournamentType.CVC);
    await expect(service.generateStructure('organizer', 't1')).rejects.toThrow(/Club 3/);
  });
});

describe('TournamentMatchesService.completeFixtureIfReady', () => {
  const approved = (goalsA: number, goalsB: number) => ({ status: 'approved', goalsA, goalsB });

  function advanceSetup(match: Record<string, unknown>, extra: { next?: Record<string, unknown>; all?: unknown[] } = {}) {
    const updates: Array<[unknown, unknown]> = [];
    const saved: { games: unknown[]; matches: unknown[]; tournament: unknown } = { games: [], matches: [], tournament: null };
    const tournament = {
      id: 't1', name: 'Cup', communityId: 'c1', type: TournamentType.PVP,
      participants: ['pa', 'pb', 'pc', 'pd'].map((id) => ({ id, userId: `u-${id}`, user: { name: id.toUpperCase() } })),
    };
    const matchesRepository = {
      findOne: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === match.id ? match : where.id === extra.next?.id ? extra.next : null),
      update: vi.fn(async (where: unknown, values: unknown) => { updates.push([where, values]); }),
      find: vi.fn().mockResolvedValue(extra.all ?? []),
      create: vi.fn((m) => Object.assign(new TournamentMatch(), m)),
    };
    const repoFor = (entity: unknown) => ({
      save: vi.fn(async (rows: unknown) => { if (entity === TournamentMatchGame) saved.games = rows as unknown[]; }),
      update: vi.fn(async (_w: unknown, values: unknown) => { saved.tournament = values; }),
    });
    const dataSource = {
      getRepository: vi.fn(repoFor),
      transaction: vi.fn(async (work: (m: unknown) => Promise<void>) =>
        work({
          save: vi.fn(async (entity: unknown, rows: unknown[]) => {
            if (entity === TournamentMatch) saved.matches = rows;
            else saved.games = rows;
          }),
        })),
    };
    const tournamentsService = {
      findOne: vi.fn().mockResolvedValue(tournament),
      notifyParticipants: vi.fn().mockResolvedValue(undefined),
      sendNotifications: vi.fn().mockResolvedValue(undefined),
    };
    const service = new TournamentMatchesService(
      matchesRepository as never,
      { find: vi.fn().mockResolvedValue([]) } as never,
      dataSource as never,
      tournamentsService as never,
    );
    return { service, updates, saved, tournamentsService };
  }

  it('waits until every game is approved', async () => {
    const { service, updates } = advanceSetup({ id: 'm1', status: 'in_review', stage: 'knockout', games: [approved(1, 0), { status: 'submitted' }] });
    expect(await service.completeFixtureIfReady('m1')).toBe('pending');
    expect(updates).toHaveLength(0);
  });

  it('moves a knockout winner into the next fixture and creates its games', async () => {
    const next = { id: 'm3', participantAId: null, participantBId: 'pc', games: [], roundName: 'Final' };
    const { service, updates, saved } = advanceSetup(
      { id: 'm1', status: 'in_review', stage: 'knockout', participantAId: 'pa', participantBId: 'pb', nextMatchId: 'm3', nextSlot: 'A', games: [approved(0, 2)] },
      { next },
    );

    expect(await service.completeFixtureIfReady('m1')).toBe('completed');
    expect(updates[0][1]).toMatchObject({ status: 'completed', winnerParticipantId: 'pb', scoreA: 0, scoreB: 2 });
    expect(updates[1]).toEqual([{ id: 'm3' }, { participantAId: 'pb', participantBId: 'pc' }]);
    expect(saved.games).toHaveLength(1);
  });

  it('needs a decider for a level knockout fixture', async () => {
    const match = { id: 'm1', status: 'in_review', stage: 'knockout', participantAId: 'pa', participantBId: 'pb', nextMatchId: null, games: [approved(1, 1)] };
    const { service } = advanceSetup(match);
    expect(await service.completeFixtureIfReady('m1')).toBe('needs_decider');
    expect(await service.completeFixtureIfReady('m1', 'A')).toBe('completed');
  });

  it('finishes the tournament after the final', async () => {
    const { service, saved, tournamentsService } = advanceSetup({
      id: 'final', status: 'in_review', stage: 'knockout', participantAId: 'pa', participantBId: 'pb', nextMatchId: null, games: [approved(3, 1)],
    });
    await service.completeFixtureIfReady('final');
    expect(saved.tournament).toMatchObject({ status: 'completed' });
    expect(tournamentsService.notifyParticipants).toHaveBeenCalledWith(expect.anything(), '', expect.objectContaining({ title: 'Tournament finished' }));
  });

  it('draws the knockout once the last group fixture completes', async () => {
    const done = (id: string, group: string, a: string, b: string, winner: string) => ({
      id, stage: 'group', groupLabel: group, status: 'completed', participantAId: a, participantBId: b,
      scoreA: winner === a ? 1 : 0, scoreB: winner === b ? 1 : 0, goalsA: winner === a ? 1 : 0, goalsB: winner === b ? 1 : 0, winnerParticipantId: winner,
    });
    const all = [done('g1', 'A', 'pa', 'pb', 'pa'), done('g2', 'B', 'pc', 'pd', 'pc')];
    const { service, saved } = advanceSetup(
      { id: 'g2', status: 'in_review', stage: 'group', participantAId: 'pc', participantBId: 'pd', games: [approved(1, 0)] },
      { all },
    );

    await service.completeFixtureIfReady('g2');

    const knockout = saved.matches as TournamentMatch[];
    expect(knockout.map((m) => m.roundName).sort()).toEqual(['Final', 'Semi-final', 'Semi-final']);
    const semis = knockout.filter((m) => m.roundName === 'Semi-final').map((m) => [m.participantAId, m.participantBId]);
    expect(semis).toEqual(expect.arrayContaining([['pa', 'pd'], ['pc', 'pb']]));
  });
});

describe('TournamentMatchesService knockout forfeits', () => {
  it('sends the other finalist through by walkover when a semi-final is a double forfeit', async () => {
    const updates: Array<[unknown, unknown]> = [];
    let tournamentUpdate: unknown = null;
    const semi = {
      id: 'semi1', status: 'in_review', stage: 'knockout', participantAId: 'pa', participantBId: 'pb',
      nextMatchId: 'final', nextSlot: 'A', games: [{ status: 'forfeited', goalsA: 0, goalsB: 0 }],
    };
    const final = { id: 'final', participantAId: null, participantBId: 'pc', nextMatchId: null, games: [] };
    const matchesRepository = {
      findOne: vi.fn(async ({ where }: { where: { id: string } }) => (where.id === 'semi1' ? semi : where.id === 'final' ? final : null)),
      update: vi.fn(async (where: unknown, values: unknown) => { updates.push([where, values]); }),
      find: vi.fn().mockResolvedValue([{ id: 'semi1', status: 'in_review' }, { id: 'semi2', status: 'completed' }]),
    };
    const dataSource = {
      getRepository: vi.fn(() => ({ update: vi.fn(async (_w: unknown, v: unknown) => { tournamentUpdate = v; }), save: vi.fn() })),
    };
    const tournamentsService = {
      findOne: vi.fn().mockResolvedValue({ id: 't1', name: 'Cup', communityId: 'c1', type: TournamentType.PVP, participants: [{ id: 'pc', user: { name: 'Carol' } }] }),
      notifyParticipants: vi.fn().mockResolvedValue(undefined),
      sendNotifications: vi.fn().mockResolvedValue(undefined),
    };
    const service = new TournamentMatchesService(
      matchesRepository as never,
      { find: vi.fn() } as never,
      dataSource as never,
      tournamentsService as never,
    );

    expect(await service.completeFixtureIfReady('semi1')).toBe('completed');

    expect(updates[0][1]).toMatchObject({ status: 'completed', doubleForfeit: true, winnerParticipantId: null });
    expect(updates).toContainEqual([{ id: 'final' }, expect.objectContaining({ status: 'bye', winnerParticipantId: 'pc' })]);
    expect(tournamentUpdate).toMatchObject({ status: 'completed' });
    expect(tournamentsService.notifyParticipants).toHaveBeenCalledWith(
      expect.anything(),
      '',
      expect.objectContaining({ message: expect.stringContaining('Carol won') }),
    );
  });
});

describe('TournamentMatchesService early vs automatic generation', () => {
  function earlySetup(filled: number) {
    const tournament = {
      id: 't1', type: TournamentType.PVP, startersCount: 1, maxParticipants: 8, format: null,
      startAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      participants: participants(filled, TournamentType.PVP),
    };
    const tournamentsService = {
      findOne: vi.fn().mockResolvedValue(tournament),
      assertCanManage: vi.fn().mockResolvedValue(undefined),
      notifyParticipants: vi.fn().mockResolvedValue(undefined),
      sendNotifications: vi.fn().mockResolvedValue(undefined),
    };
    const dataSource = {
      transaction: vi.fn(async (work: (m: unknown) => Promise<void>) => work({ save: vi.fn(), update: vi.fn() })),
    };
    const service = new TournamentMatchesService(
      { count: vi.fn().mockResolvedValue(0), create: vi.fn((m) => Object.assign(new TournamentMatch(), m)), find: vi.fn().mockResolvedValue([]) } as never,
      { find: vi.fn().mockResolvedValue([]) } as never,
      dataSource as never,
      tournamentsService as never,
    );
    return { service, dataSource, tournamentsService };
  }

  it('refuses early manual generation while slots are still open', async () => {
    const { service, dataSource } = earlySetup(6);
    await expect(service.generateStructure('organizer', 't1')).rejects.toThrow(/all 8 slots/);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('allows early manual generation once every slot is filled', async () => {
    const { service, dataSource } = earlySetup(8);
    await service.generateStructure('organizer', 't1');
    expect(dataSource.transaction).toHaveBeenCalled();
  });

  it('lets the system generate without an organizer, whatever the fill', async () => {
    const { service, dataSource, tournamentsService } = earlySetup(6);
    await service.generateStructure(null, 't1');
    expect(tournamentsService.assertCanManage).not.toHaveBeenCalled();
    expect(dataSource.transaction).toHaveBeenCalled();
  });
});
