import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';

/**
 * Registers a community's clubs in an existing CvC tournament and submits a
 * complete team for each one. Safe to rerun: teams are reused and tournament
 * participants are upserted by (tournamentId, clubId).
 *
 * Usage:
 *   node --loader ts-node/esm src/seeds/seed-tournament-club-lineups.ts <communityId> <tournamentId> [clubCount]
 */

interface TournamentRow {
  id: string;
  name: string;
  type: string;
  communityId: string;
  startersCount: number;
  subsCount: number;
  maxParticipants: number;
}

interface ClubRow {
  id: string;
  name: string;
}

interface PlayerRow {
  profileId: string;
  userId: string;
  name: string;
  inGameId: string | null;
  dpUrl: string | null;
  gamePosition: string | null;
  shirtNumber: number | null;
  clubRole: string | null;
}

async function main(): Promise<void> {
  const [communityId, tournamentId, requestedCount = '12'] = process.argv.slice(2);
  const clubCount = Number(requestedCount);

  if (!communityId || !tournamentId || !Number.isInteger(clubCount) || clubCount < 1) {
    throw new Error('Usage: seed-tournament-club-lineups <communityId> <tournamentId> [clubCount]');
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');

  const dataSource = new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    synchronize: false,
  });
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();

  try {
    await runner.startTransaction();
    // Serialize reruns for the same tournament without locking unrelated seeds.
    await runner.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`tournament-lineups:${tournamentId}`]);

    const [tournament] = (await runner.query(
      `SELECT id, name, type, "communityId", "startersCount", "subsCount", "maxParticipants"
       FROM tournaments
       WHERE id = $1
       FOR UPDATE`,
      [tournamentId],
    )) as TournamentRow[];

    if (!tournament) throw new Error(`Tournament ${tournamentId} not found`);
    if (tournament.communityId !== communityId) {
      throw new Error(`Tournament ${tournamentId} does not belong to community ${communityId}`);
    }
    if (tournament.type !== 'cvc') throw new Error(`Tournament ${tournamentId} is not a CvC tournament`);
    if (clubCount > tournament.maxParticipants) {
      throw new Error(`Requested ${clubCount} clubs, but the tournament has only ${tournament.maxParticipants} slots`);
    }

    const clubs = (await runner.query(
      `SELECT c.id, c.name
       FROM community_clubs cc
       JOIN clubs c ON c.id = cc."clubId"
       WHERE cc."communityId" = $1
       ORDER BY c."createdAt", c.id
       LIMIT $2`,
      [communityId, clubCount],
    )) as ClubRow[];

    if (clubs.length !== clubCount) {
      throw new Error(`Community has ${clubs.length} approved clubs; ${clubCount} are required`);
    }

    const rosterSize = tournament.startersCount + tournament.subsCount;
    for (const club of clubs) {
      const players = (await runner.query(
        `SELECT p.id AS "profileId", p."userId", u.name, u."inGameId", u."dpUrl",
                p."gamePosition", p."shirtNumber", p."clubRole"
         FROM efootball_profiles p
         JOIN users u ON u.id = p."userId"
         WHERE p."clubId" = $1
         ORDER BY
           CASE p."clubRole"
             WHEN 'President' THEN 0
             WHEN 'General Secretary' THEN 1
             WHEN 'Manager' THEN 2
             WHEN 'Captain' THEN 3
             ELSE 4
           END,
           p."createdAt", p.id
         LIMIT $2`,
        [club.id, rosterSize],
      )) as PlayerRow[];

      if (players.length !== rosterSize) {
        throw new Error(`${club.name} has ${players.length} players; ${rosterSize} are required`);
      }

      let [team] = (await runner.query(
        `SELECT id, name FROM teams WHERE "clubId" = $1 ORDER BY "createdAt", id LIMIT 1`,
        [club.id],
      )) as Array<{ id: string; name: string }>;

      if (!team) {
        [team] = (await runner.query(
          `INSERT INTO teams (id, name, "clubId", formation)
           VALUES ($1, $2, $3, '4-3-3')
           RETURNING id, name`,
          [randomUUID(), `${club.name} Main`, club.id],
        )) as Array<{ id: string; name: string }>;
      }

      const starters = players.slice(0, tournament.startersCount);
      const substitutes = players.slice(tournament.startersCount);
      const starterIds = starters.map((player) => player.profileId);
      const substituteIds = substitutes.map((player) => player.profileId);
      const rosterIds = [...starterIds, ...substituteIds];

      await runner.query(
        `UPDATE efootball_profiles
         SET "teamId" = NULL, "lineupStatus" = 'None', "updatedAt" = now()
         WHERE "teamId" = $1 AND NOT (id = ANY($2::uuid[]))`,
        [team.id, rosterIds],
      );
      await runner.query(
        `UPDATE efootball_profiles
         SET "teamId" = $1,
             "lineupStatus" = CASE WHEN id = ANY($2::uuid[]) THEN 'Starter'::efootball_profiles_lineupstatus_enum ELSE 'Sub'::efootball_profiles_lineupstatus_enum END,
             "squadTeam" = COALESCE("squadTeam", 'Main'::efootball_profiles_squadteam_enum),
             "updatedAt" = now()
         WHERE id = ANY($3::uuid[])`,
        [team.id, starterIds, rosterIds],
      );
      await runner.query(
        `UPDATE teams SET "captainProfileId" = $2, "updatedAt" = now() WHERE id = $1`,
        [team.id, players[0].profileId],
      );

      const lineupPlayer = (player: PlayerRow) => ({
        profileId: player.profileId,
        name: player.name,
        inGameId: player.inGameId,
        position: player.gamePosition,
        gamePosition: player.gamePosition,
        dpUrl: player.dpUrl,
        shirtNumber: player.shirtNumber,
      });
      const lineup = {
        teamId: team.id,
        teamName: team.name,
        starters: starters.map(lineupPlayer),
        substitutes: substitutes.map(lineupPlayer),
      };
      const submitter = players.find((player) =>
        ['President', 'General Secretary', 'Manager'].includes(player.clubRole ?? ''),
      );
      if (!submitter) throw new Error(`${club.name} has no authorized lineup submitter`);

      await runner.query(
        `INSERT INTO tournament_participants
           (id, "tournamentId", "participantType", "clubId", "registeredByUserId", status,
            lineup, "submittedAt", "submittedByUserId")
         VALUES ($1, $2, 'club', $3, $4, 'lineup_submitted', $5::jsonb, now(), $4)
         ON CONFLICT ("tournamentId", "clubId") WHERE "clubId" IS NOT NULL
         DO UPDATE SET
           "participantType" = 'club',
           "registeredByUserId" = EXCLUDED."registeredByUserId",
           status = 'lineup_submitted',
           lineup = EXCLUDED.lineup,
           "submittedAt" = now(),
           "submittedByUserId" = EXCLUDED."submittedByUserId",
           "updatedAt" = now()`,
        [randomUUID(), tournamentId, club.id, submitter.userId, JSON.stringify(lineup)],
      );

      console.log(`- ${club.name}: ${tournament.startersCount} starters + ${tournament.subsCount} substitutes submitted`);
    }

    const [{ total, submitted }] = (await runner.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status = 'lineup_submitted')::int AS submitted
       FROM tournament_participants
       WHERE "tournamentId" = $1`,
      [tournamentId],
    )) as Array<{ total: number; submitted: number }>;

    if (total !== clubCount || submitted !== clubCount) {
      throw new Error(`Verification failed: expected ${clubCount} submitted clubs, found ${submitted}/${total}`);
    }

    await runner.commitTransaction();
    console.log(`Seed complete: ${submitted} clubs submitted teams for "${tournament.name}" (${tournament.id}).`);
  } catch (error) {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    throw error;
  } finally {
    await runner.release();
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
