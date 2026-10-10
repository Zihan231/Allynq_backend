import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { createPaginatedResult, type PaginatedResult } from '../common/interfaces/paginated-result.interface.js';
import { MY_GAME_STATES, type MyGameState, type MyGamesQueryDto } from './dto/my-games-query.dto.js';
import { tournamentLink } from './entities/tournament.entity.js';

/** Who hosts the game's tournament; 'general' = an organizer-run tournament. */
type HostKind = 'club' | 'community' | 'general';

export interface MyGameView {
  id: string;
  matchId: string;
  state: MyGameState;
  status: string;
  resolution: string | null;
  /** From the player's side once the game is finished. */
  outcome: 'won' | 'lost' | 'draw' | null;
  myGoals: number | null;
  opponentGoals: number | null;
  mySubmitted: boolean;
  reviewNote: string | null;
  stage: string;
  roundName: string;
  groupLabel: string | null;
  isDecider: boolean;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  evidenceDeadline: string | null;
  me: { name: string; dpUrl: string | null };
  opponent: { userId: string | null; name: string; dpUrl: string | null };
  /** The clubs in the fixture (CvC only). */
  myClubName: string | null;
  opponentClubName: string | null;
  tournament: { id: string; name: string; type: string; status: string; link: string };
  host: { kind: HostKind; id: string; name: string; dpUrl: string | null };
}

export interface MyGamesFacets {
  /** Games per state, within the chosen host segment and search. */
  states: Record<MyGameState, number>;
  /** Games per host kind, within the chosen state and search. */
  hostKinds: Record<HostKind, number>;
  /** Each club / community whose tournaments the player has games in. */
  hosts: Array<{ kind: HostKind; id: string; name: string; count: number }>;
}

/**
 * A player's games across every tournament (PvP games and their CvC starter
 * pairings), for the Matches page. The `state` is from the player's point of view.
 */
@Injectable()
export class MyGamesService {
  constructor(private readonly dataSource: DataSource) {}

  async getMyGames(
    userId: string,
    query: MyGamesQueryDto,
  ): Promise<PaginatedResult<MyGameView> & { facets: MyGamesFacets }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 12;
    const search = query.search?.trim();

    /**
     * Builds one query over the player's games. Each query gets its own parameter
     * list (Postgres rejects unused ones); `skip` leaves a filter out, so a facet
     * can count across its own dimension.
     */
    const build = (
      select: string,
      skip: { host?: boolean; state?: boolean } = {},
      tail: (param: (value: unknown) => string) => string = () => '',
    ): Promise<any[]> => {
      const params: unknown[] = [userId];
      const param = (value: unknown) => `$${params.push(value)}`;
      const filters: string[] = [];
      if (!skip.host && query.host) filters.push(`"hostKind" = ${param(query.host)}`);
      if (!skip.host && query.hostId) filters.push(`"hostId" = ${param(query.hostId)}`);
      if (!skip.state && query.state) filters.push(`state = ${param(query.state)}`);
      if (search) {
        // Escape LIKE wildcards so "%" or "_" in the search are matched literally.
        const like = param(`%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
        filters.push(
          `("tournamentName" ILIKE ${like} OR "opponentName" ILIKE ${like} OR "hostName" ILIKE ${like}
            OR "myClubName" ILIKE ${like} OR "opponentClubName" ILIKE ${like})`,
        );
      }
      const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
      const sql = `WITH games AS (${GAMES_SQL}) ${select} FROM games ${where} ${tail(param)}`;
      return this.dataSource.query(sql, params);
    };

    const [rows, [{ total }], stateRows, hostRows] = await Promise.all([
      build(
        'SELECT *',
        {},
        (param) => `ORDER BY (state = 'finished'),
                   CASE WHEN state <> 'finished' THEN "scheduledStart" END ASC NULLS LAST,
                   CASE WHEN state = 'finished' THEN "scheduledStart" END DESC NULLS LAST,
                   id
          LIMIT ${param(limit)} OFFSET ${param((page - 1) * limit)}`,
      ),
      build('SELECT count(*)::int AS total'),
      build('SELECT state, count(*)::int AS count', { state: true }, () => 'GROUP BY state'),
      build(
        'SELECT "hostKind", "hostId", "hostName", count(*)::int AS count',
        { host: true },
        () => 'GROUP BY "hostKind", "hostId", "hostName" ORDER BY "hostName"',
      ),
    ]);

    const states = Object.fromEntries(MY_GAME_STATES.map((s) => [s, 0])) as Record<MyGameState, number>;
    for (const r of stateRows as Array<{ state: MyGameState; count: number }>) states[r.state] = r.count;
    const hostKinds: Record<HostKind, number> = { club: 0, community: 0, general: 0 };
    const hosts = (hostRows as Array<{ hostKind: HostKind; hostId: string; hostName: string; count: number }>).map(
      (r) => {
        hostKinds[r.hostKind] += r.count;
        return { kind: r.hostKind, id: r.hostId, name: r.hostName, count: r.count };
      },
    );

    return {
      ...createPaginatedResult((rows as GameRow[]).map(toView), total, page, limit),
      facets: { states, hostKinds, hosts },
    };
  }
}

interface GameRow {
  id: string;
  matchId: string;
  state: MyGameState;
  status: string;
  resolution: string | null;
  mySide: 'A' | 'B';
  mySubmitted: boolean;
  goalsA: number | null;
  goalsB: number | null;
  reviewNote: string | null;
  stage: string;
  roundName: string;
  groupLabel: string | null;
  isDecider: boolean;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  evidenceDeadline: Date | null;
  myName: string;
  myDpUrl: string | null;
  opponentUserId: string | null;
  opponentName: string;
  opponentDpUrl: string | null;
  myClubName: string | null;
  opponentClubName: string | null;
  tournamentId: string;
  tournamentName: string;
  tournamentType: string;
  tournamentStatus: string;
  communityId: string | null;
  hostClubId: string | null;
  hostKind: HostKind;
  hostId: string;
  hostName: string;
  hostDpUrl: string | null;
}

/**
 * One row per game the player ($1) plays in, from their side, with its state:
 * - finished: approved, walkover or forfeited;
 * - review:   both sides uploaded, waiting for the officials;
 * - waiting:  the player uploaded, the opponent hasn't yet;
 * - to_play:  everything else (not played / no evidence from the player yet / rejected).
 */
const GAMES_SQL = `
  SELECT g.*,
         CASE
           WHEN g.status IN ('approved', 'walkover', 'forfeited') THEN 'finished'
           WHEN g.status = 'submitted' THEN 'review'
           WHEN g.status = 'awaiting_opponent' AND g."mySubmitted" THEN 'waiting'
           ELSE 'to_play'
         END AS state
    FROM (
      SELECT g.id, g."matchId", g.status, g.resolution, g."goalsA", g."goalsB", g."reviewNote", g."isDecider",
             g."scheduledStart", g."scheduledEnd", g."evidenceDeadline",
             s.side AS "mySide",
             EXISTS (SELECT 1 FROM tournament_game_submissions sub WHERE sub."gameId" = g.id AND sub.side = s.side)
               AS "mySubmitted",
             CASE WHEN s.side = 'A' THEN g."playerAName" ELSE g."playerBName" END AS "myName",
             CASE WHEN s.side = 'A' THEN g."playerADpUrl" ELSE g."playerBDpUrl" END AS "myDpUrl",
             CASE WHEN s.side = 'A' THEN g."playerBUserId" ELSE g."playerAUserId" END AS "opponentUserId",
             CASE WHEN s.side = 'A' THEN g."playerBName" ELSE g."playerAName" END AS "opponentName",
             CASE WHEN s.side = 'A' THEN g."playerBDpUrl" ELSE g."playerADpUrl" END AS "opponentDpUrl",
             CASE WHEN s.side = 'A' THEN ca.name ELSE cb.name END AS "myClubName",
             CASE WHEN s.side = 'A' THEN cb.name ELSE ca.name END AS "opponentClubName",
             m.stage, m."roundName", m."groupLabel",
             t.id AS "tournamentId", t.name AS "tournamentName", t.type AS "tournamentType",
             t.status AS "tournamentStatus", t."communityId", t."hostClubId",
             CASE WHEN t."hostClubId" IS NOT NULL THEN 'club' WHEN t."communityId" IS NOT NULL THEN 'community' ELSE 'general' END AS "hostKind",
             COALESCE(t."hostClubId", t."communityId", t."creatorId") AS "hostId",
             COALESCE(hc.name, co.name, org.name) AS "hostName",
             COALESCE(hc."dpUrl", co."dpUrl", org."dpUrl") AS "hostDpUrl"
        FROM tournament_match_games g
        CROSS JOIN LATERAL (
          SELECT CASE WHEN g."playerAUserId" = $1 THEN 'A' ELSE 'B' END AS side
        ) s
        JOIN tournament_matches m ON m.id = g."matchId"
        JOIN tournaments t ON t.id = m."tournamentId"
        LEFT JOIN clubs hc ON hc.id = t."hostClubId"
        LEFT JOIN communities co ON co.id = t."communityId"
        LEFT JOIN users org ON org.id = t."creatorId" AND t."communityId" IS NULL AND t."hostClubId" IS NULL
        LEFT JOIN tournament_participants pa ON pa.id = m."participantAId"
        LEFT JOIN clubs ca ON ca.id = pa."clubId"
        LEFT JOIN tournament_participants pb ON pb.id = m."participantBId"
        LEFT JOIN clubs cb ON cb.id = pb."clubId"
       WHERE (g."playerAUserId" = $1 OR g."playerBUserId" = $1)
         AND t.status <> 'cancelled'
    ) g`;

const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

function toView(r: GameRow): MyGameView {
  const mine = r.mySide === 'A' ? r.goalsA : r.goalsB;
  const theirs = r.mySide === 'A' ? r.goalsB : r.goalsA;
  const finished = r.state === 'finished';
  const outcome =
    !finished || mine == null || theirs == null ? null : mine > theirs ? 'won' : mine < theirs ? 'lost' : 'draw';
  return {
    id: r.id,
    matchId: r.matchId,
    state: r.state,
    status: r.status,
    resolution: r.resolution,
    outcome,
    myGoals: finished ? mine : null,
    opponentGoals: finished ? theirs : null,
    mySubmitted: r.mySubmitted,
    reviewNote: r.reviewNote,
    stage: r.stage,
    roundName: r.roundName,
    groupLabel: r.groupLabel,
    isDecider: r.isDecider,
    scheduledStart: iso(r.scheduledStart),
    scheduledEnd: iso(r.scheduledEnd),
    evidenceDeadline: iso(r.evidenceDeadline),
    me: { name: r.myName, dpUrl: r.myDpUrl },
    opponent: { userId: r.opponentUserId, name: r.opponentName, dpUrl: r.opponentDpUrl },
    myClubName: r.myClubName,
    opponentClubName: r.opponentClubName,
    tournament: {
      id: r.tournamentId,
      name: r.tournamentName,
      type: r.tournamentType,
      status: r.tournamentStatus,
      link: tournamentLink(
        { id: r.tournamentId, communityId: r.communityId, hostClubId: r.hostClubId },
        `?tab=bracket&match=${r.matchId}`,
      ),
    },
    host: { kind: r.hostKind, id: r.hostId, name: r.hostName, dpUrl: r.hostDpUrl },
  };
}
