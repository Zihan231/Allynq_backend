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
import { crossGroupPairs, planKnockout, seededPairs } from './bracket/knockout.js';
import { roundRobin } from './bracket/round-robin.js';
import {
  assignRange,
  DAY_MS,
  FIRST_GAME_DELAY_MS,
  firstPlayableDay,
  formatRange,
  normalizePlayHours,
  type PlayHours,
} from './bracket/schedule.js';
import { fixtureOutcome } from './bracket/scoring.js';
import { computeStandings, type CompletedFixture, type StandingRow } from './bracket/standings.js';
import { TournamentGameTimeRequest } from './entities/tournament-game-time-request.entity.js';
import { TournamentMatchGame } from './entities/tournament-match-game.entity.js';
import { TournamentMatch } from './entities/tournament-match.entity.js';
import { TournamentParticipant } from './entities/tournament-participant.entity.js';
import { Tournament } from './entities/tournament.entity.js';
import { TournamentStatus, TournamentType } from './enums/tournament.enum.js';
import { TournamentsService } from './tournaments.service.js';

/** Where new games are placed: a local day inside the play hours, not before `notBefore`. */
interface ScheduleSlot {
  dayStart: number;
  hours: PlayHours;
  notBefore: Date;
  rng: () => number;
}

/** Game statuses that count as a final result for the fixture. */
const FINISHED_GAME_STATUSES: TournamentMatchGame['status'][] = ['approved', 'walkover', 'forfeited'];

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
  /** Sides that have submitted evidence (the evidence itself is only shown to reviewers). */
  submittedSides: Array<'A' | 'B'>;
  reviewNote: string | null;
  resolution: TournamentMatchGame['resolution'];
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  systemScheduledStart: Date | null;
  evidenceDeadline: Date | null;
  pendingTimeRequest: { id: string; requestedByUserId: string; proposedStart: Date } | null;
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
  doubleForfeit: boolean;
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

    const schedule = this.scheduleContext(tournament);
    const games = matches
      .filter((m) => m.status === 'scheduled' && m.participantAId && m.participantBId)
      .flatMap((m) =>
        this.buildGames(
          m.id,
          playersByParticipant.get(m.participantAId!) ?? [],
          playersByParticipant.get(m.participantBId!) ?? [],
          {
            dayStart: schedule.firstDay + (m.stage === 'group' ? (m.round - 1) * DAY_MS : 0),
            hours: schedule.hours,
            notBefore: schedule.earliest,
            rng,
          },
        ),
      );

    await this.dataSource.transaction(async (manager) => {
      // Later knockout rounds first, so `nextMatchId` always points at a saved row.
      const ordered = [...matches].sort((a, b) => b.round - a.round);
      await manager.save(TournamentMatch, ordered);
      if (games.length) await manager.save(TournamentMatchGame, games);
      await manager.update(Tournament, { id: tournament.id }, { format, status: TournamentStatus.ONGOING });
    });

    const groupsText = format === 'knockout' ? 'a straight knockout' : `${groupCount(participants.length)} groups`;
    await this.tournamentsService.notifyParticipants(tournament, userId, {
      title: 'Fixtures are out',
      message: `The fixtures for "${tournament.name}" have been drawn (${groupsText}). Check your first match.`,
      link: `/dashboard/efootball/community/${tournament.communityId}/tournaments/${tournament.id}?tab=bracket`,
    });
    await this.notifyScheduled(tournament, games);

    return this.getStructure(tournamentId);
  }

  async getStructure(tournamentId: string): Promise<TournamentStructure> {
    const tournament = await this.tournamentsService.findOne(tournamentId);
    const matches = await this.matchesRepository.find({
      where: { tournamentId },
      relations: { games: { submissions: true } },
      order: { round: 'ASC', matchNumber: 'ASC', games: { slot: 'ASC' } },
    });

    const entrants = new Map((tournament.participants ?? []).map((p) => [p.id, entrantView(p)]));
    const gameIds = matches.flatMap((m) => (m.games ?? []).map((g) => g.id));
    const pendingRequests = gameIds.length
      ? await this.dataSource
          .getRepository(TournamentGameTimeRequest)
          .find({ where: { gameId: In(gameIds), status: 'pending' } })
      : [];
    const requestByGame = new Map(pendingRequests.map((r) => [r.gameId, r]));
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
      doubleForfeit: m.doubleForfeit,
      games: (m.games ?? []).map((g) => gameView(g, requestByGame.get(g.id) ?? null)),
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

  /**
   * Called whenever a game gets its final result (approved, walkover or
   * forfeited). Once every game is done the fixture is scored and completed; a
   * knockout winner moves on, a finished group stage draws the knockout, and
   * the final ends the tournament. A fixture where every game was forfeited is
   * a double forfeit (both lose). A level knockout fixture needs `deciderWinner`.
   */
  async completeFixtureIfReady(
    matchId: string,
    deciderWinner?: 'A' | 'B' | null,
  ): Promise<'pending' | 'needs_decider' | 'completed'> {
    const match = await this.matchesRepository.findOne({ where: { id: matchId }, relations: { games: true } });
    if (!match || match.status === 'completed' || match.status === 'bye') return 'completed';
    const games = match.games ?? [];
    if (!games.length || games.some((g) => !FINISHED_GAME_STATUSES.includes(g.status))) return 'pending';

    const tournament = await this.tournamentsService.findOne(match.tournamentId);

    if (games.every((g) => g.status === 'forfeited')) {
      await this.matchesRepository.update(
        { id: match.id },
        { status: 'completed', doubleForfeit: true, scoreA: 0, scoreB: 0, goalsA: 0, goalsB: 0, winnerParticipantId: null, completedAt: new Date() },
      );
      if (match.stage === 'knockout') await this.advanceWinner(tournament, match, null);
      else await this.drawKnockoutIfGroupsDone(tournament);
      return 'completed';
    }

    const outcome = fixtureOutcome(
      games.map((g) => ({ goalsA: g.goalsA ?? 0, goalsB: g.goalsB ?? 0 })),
      { isSeries: tournament.type === TournamentType.CVC, deciderWinner },
    );
    if (match.stage === 'knockout' && !outcome.winner) return 'needs_decider';

    const winnerId =
      outcome.winner === 'A' ? match.participantAId : outcome.winner === 'B' ? match.participantBId : null;
    await this.matchesRepository.update(
      { id: match.id },
      {
        status: 'completed',
        scoreA: outcome.scoreA,
        scoreB: outcome.scoreB,
        goalsA: outcome.goalsA,
        goalsB: outcome.goalsB,
        winnerParticipantId: winnerId,
        completedAt: new Date(),
      },
    );

    if (match.stage === 'knockout') await this.advanceWinner(tournament, match, winnerId);
    else await this.drawKnockoutIfGroupsDone(tournament);
    return 'completed';
  }

  /**
   * Moves a knockout result into the next fixture once both feeders are done:
   * two entrants → schedule the games; one → walkover; none (both feeders
   * forfeited) → double forfeit that keeps propagating. The final ends the
   * tournament (possibly without a champion).
   */
  private async advanceWinner(tournament: Tournament, match: TournamentMatch, winnerId: string | null): Promise<void> {
    const link = `/dashboard/efootball/community/${tournament.communityId}/tournaments/${tournament.id}?tab=bracket`;

    if (!match.nextMatchId) {
      await this.dataSource.getRepository(Tournament).update({ id: tournament.id }, { status: TournamentStatus.COMPLETED });
      const champion = tournament.participants?.find((p) => p.id === winnerId);
      await this.tournamentsService.notifyParticipants(tournament, '', {
        title: 'Tournament finished',
        message: champion
          ? `${entrantView(champion).name} won "${tournament.name}"! Congratulations to the champions.`
          : `"${tournament.name}" has finished without a champion — both finalists forfeited.`,
        link,
      });
      return;
    }

    const next = await this.matchesRepository.findOne({ where: { id: match.nextMatchId }, relations: { games: true } });
    if (!next) return;
    if (match.nextSlot === 'A') next.participantAId = winnerId;
    else next.participantBId = winnerId;
    await this.matchesRepository.update(
      { id: next.id },
      { participantAId: next.participantAId, participantBId: next.participantBId },
    );

    const feeders = await this.matchesRepository.find({ where: { nextMatchId: next.id } });
    const feedersDone = feeders.every((f) => f.id === match.id || f.status === 'completed' || f.status === 'bye');
    if (!feedersDone) return;

    const present = [next.participantAId, next.participantBId].filter((id): id is string => Boolean(id));

    if (present.length === 1) {
      await this.matchesRepository.update(
        { id: next.id },
        { status: 'bye', winnerParticipantId: present[0], completedAt: new Date() },
      );
      await this.advanceWinner(tournament, next, present[0]);
      return;
    }
    if (present.length === 0) {
      await this.matchesRepository.update(
        { id: next.id },
        { status: 'completed', doubleForfeit: true, winnerParticipantId: null, completedAt: new Date() },
      );
      await this.advanceWinner(tournament, next, null);
      return;
    }
    if ((next.games ?? []).length) return;

    const entrants = (tournament.participants ?? []).filter((p) => present.includes(p.id));
    const players = await this.fixturePlayers(entrants, tournament.type === TournamentType.CVC);
    const schedule = this.scheduleContext(tournament);
    const newGames = this.buildGames(
      next.id,
      players.get(next.participantAId!) ?? [],
      players.get(next.participantBId!) ?? [],
      { dayStart: schedule.firstDay, hours: schedule.hours, notBefore: schedule.earliest, rng: Math.random },
    );
    await this.dataSource.getRepository(TournamentMatchGame).save(newGames);
    await this.notifyScheduled(tournament, newGames);
    await this.tournamentsService.notifyParticipants(
      { ...tournament, participants: entrants } as Tournament,
      '',
      {
        title: `${next.roundName} is set`,
        message: `${entrants.map((p) => entrantView(p).name).join(' vs ')} — your ${next.roundName} in "${tournament.name}" is ready.`,
        link: `${link}&match=${next.id}`,
      },
    );
  }

  /** When every group fixture is complete, the top 2 of each group are drawn into the knockout. */
  private async drawKnockoutIfGroupsDone(tournament: Tournament): Promise<void> {
    const all = await this.matchesRepository.find({ where: { tournamentId: tournament.id } });
    const groupMatches = all.filter((m) => m.stage === 'group');
    if (all.some((m) => m.stage === 'knockout') || groupMatches.some((m) => m.status !== 'completed')) return;

    const labels = [...new Set(groupMatches.map((m) => m.groupLabel!))].sort();
    const qualifiers = labels.map((label) => {
      const own = groupMatches.filter((m) => m.groupLabel === label);
      const ids = [...new Set(own.flatMap((m) => [m.participantAId, m.participantBId]))].filter(
        (id): id is string => Boolean(id),
      );
      const table = computeStandings(ids, own.filter(isCompletedFixture).map(toCompletedFixture));
      return { winner: table[0].entrantId, runnerUp: table[1].entrantId };
    });

    const matches = this.buildKnockout(tournament.id, crossGroupPairs(qualifiers));
    const qualified = (tournament.participants ?? []).filter((p) =>
      qualifiers.some((q) => q.winner === p.id || q.runnerUp === p.id),
    );
    const players = await this.fixturePlayers(qualified, tournament.type === TournamentType.CVC);
    const schedule = this.scheduleContext(tournament);
    const games = matches
      .filter((m) => m.participantAId && m.participantBId)
      .flatMap((m) =>
        this.buildGames(m.id, players.get(m.participantAId!) ?? [], players.get(m.participantBId!) ?? [], {
          dayStart: schedule.firstDay,
          hours: schedule.hours,
          notBefore: schedule.earliest,
          rng: Math.random,
        }),
      );

    await this.dataSource.transaction(async (manager) => {
      await manager.save(TournamentMatch, [...matches].sort((a, b) => b.round - a.round));
      if (games.length) await manager.save(TournamentMatchGame, games);
    });

    await this.tournamentsService.notifyParticipants(tournament, '', {
      title: 'Knockout draw is out',
      message: `The group stage of "${tournament.name}" is over. ${qualified.length} teams go through to the knockout — check the bracket.`,
      link: `/dashboard/efootball/community/${tournament.communityId}/tournaments/${tournament.id}?tab=bracket`,
    });
    await this.notifyScheduled(tournament, games);
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
    slot?: ScheduleSlot,
  ): TournamentMatchGame[] {
    const count = Math.max(playersA.length, playersB.length, 1);
    return Array.from({ length: count }, (_, index) => {
      const a = playersA[index];
      const b = playersB[index];
      const range = slot ? assignRange(slot.dayStart, slot.hours, slot.rng, slot.notBefore) : null;
      return Object.assign(new TournamentMatchGame(), {
        id: randomUUID(),
        scheduledStart: range?.start ?? null,
        scheduledEnd: range?.end ?? null,
        systemScheduledStart: range?.start ?? null,
        evidenceDeadline: range?.evidenceDeadline ?? null,
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

  /**
   * Scheduling bounds for new games: the organizer's play hours and the first
   * playable day at least 3h after the later of tournament start and now.
   */
  private scheduleContext(tournament: Tournament): { hours: PlayHours; earliest: Date; firstDay: number } {
    const hours = normalizePlayHours(tournament.playHoursStart, tournament.playHoursEnd);
    const startMs = new Date(tournament.startAt).getTime();
    const base = Number.isNaN(startMs) ? Date.now() : Math.max(startMs, Date.now());
    const earliest = new Date(base + FIRST_GAME_DELAY_MS);
    return { hours, earliest, firstDay: firstPlayableDay(earliest, hours) };
  }

  /** One notification per player with their game time(s), linking to the timing panel. */
  private async notifyScheduled(tournament: Tournament, games: TournamentMatchGame[]): Promise<void> {
    const byPlayer = new Map<string, Array<{ game: TournamentMatchGame; opponent: string }>>();
    for (const game of games) {
      if (!game.scheduledStart || !game.scheduledEnd) continue;
      const pairs: Array<[string | null, string]> = [
        [game.playerAUserId, game.playerBName],
        [game.playerBUserId, game.playerAName],
      ];
      for (const [userId, opponent] of pairs) {
        if (!userId) continue;
        byPlayer.set(userId, [...(byPlayer.get(userId) ?? []), { game, opponent }]);
      }
    }

    const base = `/dashboard/efootball/community/${tournament.communityId}/tournaments/${tournament.id}?tab=bracket`;
    await Promise.all(
      [...byPlayer].map(([userId, entries]) => {
        const sorted = entries.sort((x, y) => x.game.scheduledStart!.getTime() - y.game.scheduledStart!.getTime());
        const first = sorted[0];
        const when = formatRange({ start: first.game.scheduledStart!, end: first.game.scheduledEnd! });
        const message =
          sorted.length === 1
            ? `Your match vs ${first.opponent} in "${tournament.name}" is scheduled for ${when} (Bangladesh time). Upload your evidence within 30 minutes after it ends.`
            : `You have ${sorted.length} matches scheduled in "${tournament.name}". First: vs ${first.opponent}, ${when} (Bangladesh time).`;
        return this.tournamentsService.sendNotifications([userId], {
          title: 'Match scheduled',
          message,
          link: `${base}&match=${first.game.matchId}&game=${first.game.id}&panel=time`,
        });
      }),
    );
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

function gameView(g: TournamentMatchGame, pendingRequest: TournamentGameTimeRequest | null): MatchGameView {
  return {
    id: g.id,
    slot: g.slot,
    isDecider: g.isDecider,
    playerA: { profileId: g.playerAProfileId, userId: g.playerAUserId, name: g.playerAName, dpUrl: g.playerADpUrl },
    playerB: { profileId: g.playerBProfileId, userId: g.playerBUserId, name: g.playerBName, dpUrl: g.playerBDpUrl },
    goalsA: g.goalsA,
    goalsB: g.goalsB,
    status: g.status,
    submittedSides: (g.submissions ?? []).map((s) => s.side).sort(),
    reviewNote: g.reviewNote,
    resolution: g.resolution,
    scheduledStart: g.scheduledStart,
    scheduledEnd: g.scheduledEnd,
    systemScheduledStart: g.systemScheduledStart,
    evidenceDeadline: g.evidenceDeadline,
    pendingTimeRequest: pendingRequest
      ? { id: pendingRequest.id, requestedByUserId: pendingRequest.requestedByUserId, proposedStart: pendingRequest.proposedStart }
      : null,
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
    doubleForfeit: m.doubleForfeit,
  };
}
