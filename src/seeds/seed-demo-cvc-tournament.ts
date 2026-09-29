import 'dotenv/config';
import bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { EfootballPosition } from '../users/enums/efootball-position.enum.js';
import { ClubRole, CommunityRole, LineupStatus } from '../users/enums/user-attributes.enum.js';

/**
 * Demo CvC tournament for a community: an 8-club, 8v8 tournament starting in
 * 2 days, plus 8 new clubs (12 players each) that join the community, register
 * and submit their team. Fixtures are left for the organizer to generate
 * (all slots are filled, so "Generate" is available immediately).
 *
 *   node --loader ts-node/esm src/seeds/seed-demo-cvc-tournament.ts <communityId>
 *
 * Demo logins: demo.cup.<run>.c<club>p<player>@allync.demo / 123456
 * (player 1 of each club is its President).
 */

const PASSWORD = '123456';
const CLUBS = 8;
const STARTERS = 8;
const SUBS = 4;
const PLAYERS_PER_CLUB = STARTERS + SUBS;
const START_IN_MS = 2 * 24 * 60 * 60 * 1000;
const LINEUP_CUTOFF_MS = 2 * 60 * 60 * 1000;

const CLUB_NAMES = ['Padma Tigers', 'Meghna Hawks', 'Jamuna Wolves', 'Karnaphuli Kings', 'Surma Strikers', 'Teesta Titans', 'Buriganga Bulls', 'Rupsha Rangers'];
const COLORS = ['#E63946', '#1D3557', '#2A9D8F', '#F4A261', '#8338EC', '#FF006E', '#3A86FF', '#06D6A0'];
const FIRST = ['Arif', 'Tanvir', 'Rakib', 'Sabbir', 'Nayeem', 'Fahim', 'Shakib', 'Imran', 'Rasel', 'Mahin', 'Sajid', 'Tamim', 'Rifat', 'Jubayer', 'Asif', 'Hasib'];
const LAST = ['Hossain', 'Rahman', 'Islam', 'Ahmed', 'Chowdhury', 'Karim', 'Uddin', 'Sarker', 'Mia', 'Talukder'];
const POSITIONS = Object.values(EfootballPosition);
const randInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

async function main() {
  const [communityId] = process.argv.slice(2);
  if (!communityId) throw new Error('Usage: seed-demo-cvc-tournament <communityId>');

  const dataSource = new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    synchronize: false,
  });
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();

  try {
    const [community] = await runner.query('SELECT id, name, "creatorId" FROM communities WHERE id = $1', [communityId]);
    if (!community) throw new Error(`Community ${communityId} not found`);
    const [president] = await runner.query(
      `SELECT p."userId" FROM community_members m JOIN efootball_profiles p ON p.id = m."profileId"
        WHERE m."communityId" = $1 AND m.role = $2 LIMIT 1`,
      [communityId, CommunityRole.PRESIDENT],
    );
    const organizerId: string = president?.userId ?? community.creatorId;

    const run = randomUUID().slice(0, 6);
    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    // Kick-off 2 days from now, on the hour.
    const startAt = new Date(Math.ceil((Date.now() + START_IN_MS) / 3_600_000) * 3_600_000);
    const cutoff = new Date(startAt.getTime() - LINEUP_CUTOFF_MS);
    const tournamentId = randomUUID();

    await runner.startTransaction();

    await runner.query(
      `INSERT INTO tournaments (id, name, description, type, status, preset, "startersCount", "subsCount", "maxParticipants",
         "entryFeeBdt", "prizePoolBdt", "registrationDeadline", "teamSubmissionDeadline", "startAt", "communityId", "creatorId")
       VALUES ($1, $2, $3, 'cvc', 'registration_open', '8v8', $4, $5, $6, 0, 5000, $7, $7, $8, $9, $10)`,
      [
        tournamentId,
        `${community.name} Demo Cup ${run.toUpperCase()}`,
        'Demo 8-club, 8v8 knockout.',
        STARTERS,
        SUBS,
        CLUBS,
        cutoff,
        startAt,
        communityId,
        organizerId,
      ],
    );

    for (let c = 0; c < CLUBS; c++) {
      const clubId = randomUUID();
      const name = `${CLUB_NAMES[c]} ${run.toUpperCase()}`;
      await runner.query(
        `INSERT INTO clubs (id, name, color, initials, description, points, "joinPolicy", "communityIds", location)
         VALUES ($1, $2, $3, $4, $5, $6, 'instant', $7, 'Dhaka')`,
        [
          clubId,
          name,
          COLORS[c],
          CLUB_NAMES[c].split(' ').map((w) => w[0]).join('').slice(0, 3).toUpperCase(),
          `${name} — demo club.`,
          randInt(500, 3000),
          JSON.stringify([communityId]),
        ],
      );
      await runner.query('INSERT INTO community_clubs ("communityId", "clubId") VALUES ($1, $2)', [communityId, clubId]);

      const players: Array<{ profileId: string; userId: string; name: string; position: string; inGameId: string }> = [];
      for (let p = 0; p < PLAYERS_PER_CLUB; p++) {
        const userId = randomUUID();
        const profileId = randomUUID();
        const playerName = `${FIRST[(c * 5 + p) % FIRST.length]} ${LAST[(c * 3 + p) % LAST.length]}`;
        const inGameId = `ALQ-${randInt(100000, 999999)}`;
        const position = POSITIONS[(p + c) % POSITIONS.length];
        await runner.query(
          `INSERT INTO users (id, name, email, password, "inGameId", country) VALUES ($1, $2, $3, $4, $5, 'Bangladesh')`,
          [userId, playerName, `demo.cup.${run}.c${c + 1}p${p + 1}@allync.demo`, passwordHash, inGameId],
        );
        await runner.query(
          `INSERT INTO efootball_profiles (id, "userId", "konamiUid", "gamePosition", points, "clubId", "clubRole", "lineupStatus",
             "communityId", "communityRole")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            profileId, userId, String(randInt(100000000, 999999999)), position, randInt(100, 900), clubId,
            p === 0 ? ClubRole.PRESIDENT : ClubRole.PLAYER, LineupStatus.NONE, communityId, CommunityRole.MEMBER,
          ],
        );
        await runner.query(
          `INSERT INTO community_members (id, "communityId", "profileId", role, "isDirectMember", "sourceClubIds")
           VALUES ($1, $2, $3, $4, false, $5)`,
          [randomUUID(), communityId, profileId, CommunityRole.MEMBER, JSON.stringify([clubId])],
        );
        players.push({ profileId, userId, name: playerName, position, inGameId });
      }

      const toLineupPlayer = (p: (typeof players)[number]) => ({
        profileId: p.profileId,
        name: p.name,
        gamePosition: p.position,
        inGameId: p.inGameId,
        dpUrl: null,
      });
      await runner.query(
        `INSERT INTO tournament_participants (id, "tournamentId", "participantType", "clubId", "registeredByUserId", status,
           lineup, "submittedAt", "submittedByUserId")
         VALUES ($1, $2, 'club', $3, $4, 'lineup_submitted', $5, now(), $4)`,
        [
          randomUUID(),
          tournamentId,
          clubId,
          players[0].userId,
          JSON.stringify({
            teamId: null,
            teamName: null,
            starters: players.slice(0, STARTERS).map(toLineupPlayer),
            substitutes: players.slice(STARTERS).map(toLineupPlayer),
          }),
        ],
      );
      console.log(`- ${name}: ${PLAYERS_PER_CLUB} players, registered with an 8v8 team (President: demo.cup.${run}.c${c + 1}p1@allync.demo)`);
    }

    await runner.commitTransaction();
    console.log(`\nTournament: ${tournamentId}`);
    console.log(`Starts: ${startAt.toISOString()} (auto-generates at ${cutoff.toISOString()})`);
    console.log(`Link: /dashboard/efootball/community/${communityId}/tournaments/${tournamentId}`);
  } catch (err) {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    throw err;
  } finally {
    await runner.release();
    await dataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
