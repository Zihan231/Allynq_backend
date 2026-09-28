import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, In, Repository } from 'typeorm';
import { EfootballProfile } from '../users/entities/efootball-profile.entity.js';
import {
  chooseFormat,
  drawGroups,
  groupCount,
  groupLabel,
  MIN_ENTRANTS,
  QUALIFIERS_PER_GROUP,
  type TournamentFormat,
} from './bracket/format.js';
import { planKnockout, seededPairs } from './bracket/knockout.js';
import { roundRobin } from './bracket/round-robin.js';
import { computeStandings, type CompletedFixture, type StandingRow } from './bracket/standings.js';
import { TournamentMatchGame } from './entities/tournament-match-game.entity.js';
import { TournamentMatch } from './entities/tournament-match.entity.js';
import { TournamentParticipant } from './entities/tournament-participant.entity.js';
import { Tournament } from './entities/tournament.entity.js';
import { TournamentStatus, TournamentType } from './enums/tournament.enum.js';
import { TournamentsService } from './tournaments.service.js';

/** A player who takes part in a fixture's 1v1 games. */
interface FixturePlayer {
  profileId: string | null;
  userId: string | null;
  name: string;
  dpUrl: string | null;
}

export interface EntrantView {
  participantId: string;
  name: string;
  dpUrl: string | null;
  color: string | null;
  initials: string | null;
}

export interface MatchGameView {
  id: string;
  slot: number;
  isDecider: boolean;
  playerA: { profileId: string | null; userId: string | null; name: string; dpUrl: string | null };
  playerB: { profileId: string | null; userId: string | null; name: string; dpUrl: string | null };
  goalsA: number | null;
  goalsB: number | null;
  status: TournamentMatchGame['status'];
}

export interface MatchView {
  id: string;
  stage: TournamentMatch['stage'];
  groupLabel: string | null;
  round: number;
  roundName: string;
  matchNumber: number;
  status: TournamentMatch['status'];
  participantA: EntrantView | null;
  participantB: EntrantView | null;
  scoreA: number | null;
  scoreB: number | null;
  goalsA: number | null;
  goalsB: number | null;
  winnerParticipantId: string | null;
  games: MatchGameView[];
}

export interface TournamentStructure {
  tournamentId: string;
  format: TournamentFormat | null;
  isCvC: boolean;
  groups: Array<{
    label: string;
    standings: Array<StandingRow & { entrant: EntrantView | null; qualifies: boolean }>;
    matches: MatchView[];
  }>;
  knockout: {
    /** Groups format: the knockout is drawn once every group fixture is complete. */
    pending: boolean;
    size: number;
    rounds: Array<{ round: number; name: string; matches: MatchView[] }>;
  };
}

@Injectable()
export class TournamentMatchesService {
  constructor(
    @InjectRepository(TournamentMatch)
    private readonly matchesRepository: Repository<TournamentMatch>,
    @InjectRepository(EfootballProfile)
    private readonly profilesRepository: Repository<EfootballProfile>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly tournamentsService: TournamentsService,
  ) {}

  /**
   * Creates the tournament's fixtures from whoever registered: a knockout for
   * up to 8 entrants, otherwise groups (round-robin) whose top 2 later advance.
   */
  async generateStructure(
    userId: string,
    tournamentId: string,
    rng: () => number = Math.random,
  ): Promise<TournamentStructure> {
    const tournament = await this.tournamentsService.findOne(tournamentId);
    await this.tournamentsService.assertCanManage(userId, tournament, 'generate fixtures');

    if (await this.matchesRepository.count({ where: { tournamentId } })) {
      throw new BadRequestException('Fixtures have already been generated for this tournament');
    }

    const participants = [...(tournament.participants ?? [])].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    if (participants.length < MIN_ENTRANTS) {
      throw new BadRequestException(
        `At least ${MIN_ENTRANTS} entrants are needed to generate fixtures (currently ${participants.length})`,
      );
    }

    const isCvC = tournament.type === TournamentType.CVC;
    if (isCvC) {
      const missing = participants.filter(
        (p) => (p.lineup?.starters.length ?? 0) !== tournament.startersCount,
      );
      if (missing.length) {
        throw new BadRequestException(
          `These clubs still need to submit a full team: ${missing.map((p) => p.club?.name ?? p.id).join(', ')}`,
        );
      }
    }

    const playersByParticipant = await this.fixturePlayers(participants, isCvC);
    const format = chooseFormat(participants.length);
    const matches: TournamentMatch[] = [];

    if (format === 'knockout') {
      matches.push(...this.buildKnockout(tournament.id, seededPairs(participants.map((p) => p.id))));
    } else {
      let matchNumber = 0;
      const groups = drawGroups(participants.map((p) => p.id), groupCount(participants.length), rng);
      groups.forEach((groupIds, index) => {
        roundRobin(groupIds).forEach((matchday, dayIndex) => {
          for (const [a, b] of matchday) {
            matches.push(
              this.matchesRepository.create({
                id: randomUUID(),
                tournamentId: tournament.id,
                stage: 'group',
                groupLabel: groupLabel(index),
                round: dayIndex + 1,
                roundName: `Matchday ${dayIndex + 1}`,
                matchNumber: ++matchNumber,
                participantAId: a,
                participantBId: b,
                status: 'scheduled',
              }),
            );
          }
        });
      });
    }

    const games = matches
      .filter((m) => m.status === 'scheduled' && m.participantAId && m.participantBId)
      .flatMap((m) =>
        this.buildGames(
          m.id,
          playersByParticipant.get(m.participantAId!) ?? [],
          playersByParticipant.get(m.participantBId!) ?? [],
        ),
      );

    await this.dataSource.transaction(async (manager) => {
      // Later knockout rounds first, so `nextMatchId` always points at a saved row.
      const ordered = [...matches].sort((a, b) => b.round - a.round);
      await manager.save(TournamentMatch, ordered);
      if (games.length) await manager.save(TournamentMatchGame, games);
      await manager.update(Tournament, { id: tournament.id }, { format, status: TournamentStatus.ONGOING });
    });

    return this.getStructure(tournamentId);
  }

  async getStructure(tournamentId: string): Promise<TournamentStructure> {
    const tournament = await this.tournamentsService.findOne(tournamentId);
    const matches = await this.matchesRepository.find({
      where: { tournamentId },
      relations: { games: true },
      order: { round: 'ASC', matchNumber: 'ASC', games: { slot: 'ASC' } },
    });

    const entrants = new Map((tournament.participants ?? []).map((p) => [p.id, entrantView(p)]));
    const toView = (m: TournamentMatch): MatchView => ({
      id: m.id,
      stage: m.stage,
      groupLabel: m.groupLabel,
      round: m.round,
      roundName: m.roundName,
      matchNumber: m.matchNumber,
      status: m.status,
      participantA: m.participantAId ? entrants.get(m.participantAId) ?? null : null,
      participantB: m.participantBId ? entrants.get(m.participantBId) ?? null : null,
      scoreA: m.scoreA,
      scoreB: m.scoreB,
      goalsA: m.goalsA,
      goalsB: m.goalsB,
      winnerParticipantId: m.winnerParticipantId,
      games: (m.games ?? []).map(gameView),
    });

    const groupMatches = matches.filter((m) => m.stage === 'group');
    const labels = [...new Set(groupMatches.map((m) => m.groupLabel!))].sort();
    const groups = labels.map((label) => {
      const own = groupMatches.filter((m) => m.groupLabel === label);
      const ids = [...new Set(own.flatMap((m) => [m.participantAId, m.participantBId]))].filter(
        (id): id is string => Boolean(id),
      );
      const standings = computeStandings(ids, own.filter(isCompletedFixture).map(toCompletedFixture)).map(
        (row) => ({ ...row, entrant: entrants.get(row.entrantId) ?? null, qualifies: row.rank <= QUALIFIERS_PER_GROUP }),
      );
      return { label, standings, matches: own.map(toView) };
    });

    const knockoutMatches = matches.filter((m) => m.stage === 'knockout');
    const rounds = [...new Set(knockoutMatches.map((m) => m.round))].sort((a, b) => a - b).map((round) => {
      const inRound = knockoutMatches.filter((m) => m.round === round);
      return { round, name: inRound[0].roundName, matches: inRound.map(toView) };
    });

    return {
      tournamentId,
      format: tournament.format,
      isCvC: tournament.type === TournamentType.CVC,
      groups,
      knockout: {
        pending: tournament.format === 'groups_knockout' && knockoutMatches.length === 0,
        size: tournament.format === 'groups_knockout' ? labels.length * QUALIFIERS_PER_GROUP : rounds[0]?.matches.length * 2 || 0,
        rounds,
      },
    };
  }

  /** Knockout tree from first-round pairings; byes advance immediately. */
  private buildKnockout(
    tournamentId: string,
    firstRound: Array<[string | null, string | null]>,
  ): TournamentMatch[] {
    const planned = planKnockout(firstRound);
    const idByKey = new Map(planned.map((p) => [p.key, randomUUID()]));
    const byKey = new Map(
      planned.map((p) => [
        p.key,
        this.matchesRepository.create({
          id: idByKey.get(p.key)!,
          tournamentId,
          stage: 'knockout',
          groupLabel: null,
          round: p.round,
          roundName: p.roundName,
          matchNumber: p.matchNumber,
          participantAId: p.entrantA,
          participantBId: p.entrantB,
          nextMatchId: p.nextKey ? idByKey.get(p.nextKey)! : null,
          nextSlot: p.nextSlot,
          status: 'scheduled',
        }),
      ]),
    );

    for (const p of planned.filter((m) => m.isBye)) {
      const match = byKey.get(p.key)!;
      const winner = p.entrantA ?? p.entrantB!;
      match.status = 'bye';
      match.winnerParticipantId = winner;
      match.completedAt = new Date();
      const next = p.nextKey ? byKey.get(p.nextKey) : undefined;
      if (next) {
        if (p.nextSlot === 'A') next.participantAId = winner;
        else next.participantBId = winner;
      }
    }

    return [...byKey.values()];
  }

  /** One game per starter pairing (CvC, lineup slot i vs slot i) or a single game (PvP). */
  private buildGames(
    matchId: string,
    playersA: FixturePlayer[],
    playersB: FixturePlayer[],
  ): TournamentMatchGame[] {
    const count = Math.max(playersA.length, playersB.length, 1);
    return Array.from({ length: count }, (_, index) => {
      const a = playersA[index];
      const b = playersB[index];
      return Object.assign(new TournamentMatchGame(), {
        matchId,
        slot: index + 1,
        isDecider: false,
        playerAProfileId: a?.profileId ?? null,
        playerAUserId: a?.userId ?? null,
        playerAName: a?.name ?? 'TBD',
        playerADpUrl: a?.dpUrl ?? null,
        playerBProfileId: b?.profileId ?? null,
        playerBUserId: b?.userId ?? null,
        playerBName: b?.name ?? 'TBD',
        playerBDpUrl: b?.dpUrl ?? null,
        status: 'pending' as const,
      });
    });
  }

  /** Who plays for each entrant: the club's starters in lineup order, or the player. */
  private async fixturePlayers(
    participants: TournamentParticipant[],
    isCvC: boolean,
  ): Promise<Map<string, FixturePlayer[]>> {
    if (!isCvC) {
      return new Map(
        participants.map((p) => [
          p.id,
          [{ profileId: null, userId: p.userId, name: p.user?.name ?? 'Player', dpUrl: p.user?.dpUrl ?? null }],
        ]),
      );
    }

    const profileIds = participants.flatMap((p) => p.lineup?.starters.map((s) => s.profileId) ?? []);
    const profiles = profileIds.length
      ? await this.profilesRepository.find({ where: { id: In(profileIds) }, relations: { user: true } })
      : [];
    const profileById = new Map(profiles.map((profile) => [profile.id, profile]));

    return new Map(
      participants.map((p) => [
        p.id,
        (p.lineup?.starters ?? []).map((starter) => {
          const profile = profileById.get(starter.profileId);
          return {
            profileId: starter.profileId,
            userId: profile?.userId ?? null,
            name: starter.name || profile?.user?.name || 'Player',
            dpUrl: starter.dpUrl ?? profile?.user?.dpUrl ?? null,
          };
        }),
      ]),
    );
  }
}

function entrantView(p: TournamentParticipant): EntrantView {
  return {
    participantId: p.id,
    name: p.club?.name ?? p.user?.name ?? 'TBD',
    dpUrl: p.club?.dpUrl ?? p.user?.dpUrl ?? null,
    color: p.club?.color ?? null,
    initials: p.club?.initials ?? null,
  };
}

function gameView(g: TournamentMatchGame): MatchGameView {
  return {
    id: g.id,
    slot: g.slot,
    isDecider: g.isDecider,
    playerA: { profileId: g.playerAProfileId, userId: g.playerAUserId, name: g.playerAName, dpUrl: g.playerADpUrl },
    playerB: { profileId: g.playerBProfileId, userId: g.playerBUserId, name: g.playerBName, dpUrl: g.playerBDpUrl },
    goalsA: g.goalsA,
    goalsB: g.goalsB,
    status: g.status,
  };
}

function isCompletedFixture(m: TournamentMatch): boolean {
  return m.status === 'completed' && Boolean(m.participantAId && m.participantBId);
}

function toCompletedFixture(m: TournamentMatch): CompletedFixture {
  const winner =
    m.winnerParticipantId === m.participantAId ? 'A' : m.winnerParticipantId === m.participantBId ? 'B' : null;
  return {
    entrantA: m.participantAId!,
    entrantB: m.participantBId!,
    scoreA: m.scoreA ?? 0,
    scoreB: m.scoreB ?? 0,
    goalsA: m.goalsA ?? 0,
    goalsB: m.goalsB ?? 0,
    winner,
  };
}
