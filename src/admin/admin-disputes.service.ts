import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { TournamentResultsService } from '../tournaments/tournament-results.service.js';
import { TournamentsService } from '../tournaments/tournaments.service.js';
import type { Actor, ActionContext } from './admin-users.service.js';
import { AuditService } from './audit.service.js';
import type { DecideGameDto, DisputeQueryDto } from './dto/manage.dto.js';

/**
 * The dispute centre: every game waiting for an evidence decision, across all tournaments.
 * Staff can decide any of them (the officials' rules and the evidence window don't apply),
 * which unsticks reviews whose officials are missing or slow.
 */
@Injectable()
export class AdminDisputesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly results: TournamentResultsService,
    private readonly tournaments: TournamentsService,
    private readonly audit: AuditService,
  ) {}

  async list(query: DisputeQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const params: unknown[] = [];
    const p = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };
    const where = [`t."deletedAt" IS NULL`, `m.status NOT IN ('completed', 'bye')`];
    const waiting = `g.status IN ('submitted', 'awaiting_opponent')`;
    switch (query.state ?? 'review') {
      case 'review':
        where.push(waiting);
        break;
      case 'ready':
        where.push(waiting, `(g."evidenceDeadline" IS NULL OR g."evidenceDeadline" < now())`);
        break;
      case 'stale':
        where.push(waiting, `g."updatedAt" < now() - interval '48 hours'`);
        break;
      case 'rejected':
        where.push(`g.status = 'rejected'`);
        break;
      default:
        where.push(`g.status IN ('submitted', 'awaiting_opponent', 'rejected')`);
    }
    if (query.tournamentId) where.push(`t.id = ${p(query.tournamentId)}`);
    if (query.communityId) where.push(`t."communityId" = ${p(query.communityId)}`);
    if (query.clubId) {
      const c = p(query.clubId);
      where.push(`(t."hostClubId" = ${c} OR EXISTS (SELECT 1 FROM tournament_participants tp WHERE tp.id IN (m."participantAId", m."participantBId") AND tp."clubId" = ${c}))`);
    }
    if (query.search?.trim()) {
      const q = p(`%${query.search.trim().toLowerCase()}%`);
      where.push(`(LOWER(t.name) LIKE ${q} OR LOWER(g."playerAName") LIKE ${q} OR LOWER(g."playerBName") LIKE ${q})`);
    }
    const from = `FROM tournament_match_games g
      JOIN tournament_matches m ON m.id = g."matchId"
      JOIN tournaments t ON t.id = m."tournamentId"
      WHERE ${where.join(' AND ')}`;
    const [{ total }] = await this.dataSource.query(`SELECT count(*)::int AS total ${from}`, params);
    const data = await this.dataSource.query(
      `SELECT g.id, g.status, g.slot, g."isDecider", g."playerAName", g."playerBName", g."playerADpUrl", g."playerBDpUrl",
              g."evidenceDeadline", g."updatedAt", g."reviewNote",
              m.id AS "matchId", m."roundName", m.stage, m."groupLabel",
              t.id AS "tournamentId", t.name AS "tournamentName", t.type AS "tournamentType",
              COALESCE((SELECT name FROM communities WHERE id = t."communityId"), (SELECT name FROM clubs WHERE id = t."hostClubId")) AS "hostName",
              (SELECT count(*)::int FROM tournament_game_submissions s WHERE s."gameId" = g.id) AS submissions,
              jsonb_array_length(COALESCE(t."matchOfficialIds", '[]'::jsonb))::int AS officials,
              (g."evidenceDeadline" IS NULL OR g."evidenceDeadline" < now()) AS "reviewOpen",
              (g."updatedAt" < now() - interval '48 hours') AS stale
         ${from}
        ORDER BY (g."evidenceDeadline" IS NULL OR g."evidenceDeadline" < now()) DESC, g."updatedAt" ASC
        LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      params,
    );
    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) || 1 } };
  }

  async detail(actor: Actor, gameId: string) {
    const tournamentId = await this.tournamentOf(gameId);
    const [game, tournament] = await Promise.all([
      this.results.getGameForReview(actor.id, tournamentId, gameId, { staff: true }),
      this.tournaments.findOne(tournamentId),
    ]);
    const reviewerIds = await this.results.reviewerUserIds(tournament);
    const reviewers = reviewerIds.length
      ? await this.dataSource.query(`SELECT id, name FROM users WHERE id = ANY($1::uuid[]) ORDER BY name`, [reviewerIds])
      : [];
    return {
      game,
      tournament: {
        id: tournament.id,
        name: tournament.name,
        type: tournament.type,
        status: tournament.status,
        hostName: tournament.hostClub?.name ?? tournament.community?.name ?? null,
        hostClubId: tournament.hostClubId,
        communityId: tournament.communityId,
        matchOfficialIds: tournament.matchOfficialIds ?? [],
      },
      reviewers,
    };
  }

  async decide(actor: Actor, gameId: string, dto: DecideGameDto, ctx: ActionContext = {}) {
    const tournamentId = await this.tournamentOf(gameId);
    const result = await this.results.reviewGame(
      actor.id,
      tournamentId,
      gameId,
      { action: dto.action, goalsA: dto.goalsA, goalsB: dto.goalsB, note: dto.note, deciderWinner: dto.deciderWinner },
      { staff: true },
    );
    await this.audit.record(actor, {
      action: dto.action === 'approve' ? 'match.decide' : 'match.reject',
      targetType: 'tournament',
      targetId: tournamentId,
      targetName: `${result.game.playerA.name} vs ${result.game.playerB.name} · ${result.game.roundName}`,
      after: dto.action === 'approve' ? { goalsA: dto.goalsA, goalsB: dto.goalsB, fixture: result.fixture } : { rejected: true },
      reason: dto.note,
      ip: ctx.ip,
    });
    return result;
  }

  private async tournamentOf(gameId: string): Promise<string> {
    const [row] = await this.dataSource.query(
      `SELECT m."tournamentId" FROM tournament_match_games g JOIN tournament_matches m ON m.id = g."matchId" WHERE g.id = $1`,
      [gameId],
    );
    if (!row) throw new NotFoundException('Game not found');
    return row.tournamentId;
  }
}
