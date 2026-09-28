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
  return { service, saved, tournamentsService };
}

describe('TournamentMatchesService.generateStructure', () => {
  it('builds a knockout for 4 CvC clubs with one game per starter pairing', async () => {
    const { service, saved, tournamentsService } = setup(participants(4, TournamentType.CVC), TournamentType.CVC);

    await service.generateStructure('organizer', 't1');

    expect(tournamentsService.assertCanManage).toHaveBeenCalled();
    expect(saved.update).toMatchObject({ format: 'knockout' });
    expect(saved.matches.map((m) => m.roundName).sort()).toEqual(['Final', 'Semi-final', 'Semi-final']);
    // 2 semi-finals × 4 starter pairings; the final waits for its entrants.
    expect(saved.games).toHaveLength(8);
    const semiGames = saved.games.filter((g) => g.matchId === saved.matches.find((m) => m.participantAId === 'p1')!.id);
    expect(semiGames.map((g) => [g.slot, g.playerAProfileId])).toEqual([
      [1, 'c1s1'], [2, 'c1s2'], [3, 'c1s3'], [4, 'c1s4'],
    ]);
    // Saved deepest rounds first so nextMatchId references exist.
    expect(saved.matches[0].roundName).toBe('Final');
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
