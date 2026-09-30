import 'dotenv/config';
import bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { DataSource, QueryRunner } from 'typeorm';
import { EfootballPosition } from '../users/enums/efootball-position.enum.js';
import { ClubRole, CommunityRole, LineupStatus } from '../users/enums/user-attributes.enum.js';

/**
 * Fills a CvC tournament with registered clubs and submitted teams.
 * Existing clubs passed as arguments are registered first; each gets fresh
 * demo players when it doesn't have enough members who are free (not already
 * in another active tournament). The remaining slots go to new demo clubs.
 *
 *   node --loader ts-node/esm src/seeds/seed-tournament-entries.ts <tournamentId> [existingClubId ...] [--extra-free=N]
 *
 * --extra-free=N also gives each existing club N more players who stay out of every tournament.
 *
 * Demo logins: demo.entry.<run>.<club>.<n>@allync.demo / 123456
 */

const PASSWORD = '123456';
const PLACES = [
  'Padma', 'Meghna', 'Jamuna', 'Karnaphuli', 'Surma', 'Teesta', 'Buriganga', 'Rupsha', 'Sundarbans', 'Cox Bazar',
  'Sylhet', 'Rangpur', 'Barishal', 'Khulna', 'Mymensingh', 'Cumilla', 'Bogura', 'Gazipur', 'Narayanganj', 'Jessore',
  'Dinajpur', 'Pabna', 'Tangail', 'Noakhali', 'Feni', 'Kushtia', 'Bandarban', 'Rajshahi', 'Chandpur', 'Sirajganj',
];
const MASCOTS = ['Tigers', 'Hawks', 'Wolves', 'Kings', 'Strikers', 'Titans', 'Bulls', 'Rangers', 'Eagles', 'Lions'];
const COLORS = ['#E63946', '#1D3557', '#2A9D8F', '#F4A261', '#8338EC', '#FF006E', '#3A86FF', '#06D6A0', '#FB5607', '#8AC926'];
// Crests shipped in the frontend's public/ folder.
const LOGOS = [
  '/arsenal/arsenal-logo-transparent.png',
  '/atleteco di madrid/atletico-logo-transparent.png',
  '/barca/barca-logo-transparent.png',
  '/bayern/bayern-logo-transparent.png',
  '/chelsea/chelsea-logo-transparent.png',
  '/man city/mancity-logo-transparent.png',
  '/manu/manu-logo-transparent.png',
  '/real madrid/real-madrid-logo-preview.png',
  '/Bangladesh/bangladesh-football-federation-seeklogo.png',
];
const FIRST = ['Arif', 'Tanvir', 'Rakib', 'Sabbir', 'Nayeem', 'Fahim', 'Shakib', 'Imran', 'Rasel', 'Mahin', 'Sajid', 'Tamim', 'Rifat', 'Jubayer', 'Asif', 'Hasib', 'Siam', 'Nafis', 'Rayhan', 'Ayon'];
const LAST = ['Hossain', 'Rahman', 'Islam', 'Ahmed', 'Chowdhury', 'Karim', 'Uddin', 'Sarker', 'Mia', 'Talukder'];
const POSITIONS = Object.values(EfootballPosition);
const randInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = <T>(items: readonly T[]) => items[randInt(0, items.length - 1)];

interface Member {
  profileId: string;
  userId: string;
  name: string;
  position: string | null;
  inGameId: string | null;
  dpUrl: string | null;
}

/** Multi-row INSERT: `rows` share the same columns. */
async function insertRows(runner: QueryRunner, table: string, columns: string[], rows: unknown[][]): Promise<void> {
  if (!rows.length) return;
  const params: unknown[] = [];
  const values = rows.map((row) => `(${row.map((value) => `$${params.push(value)}`).join(', ')})`);
  await runner.query(
    `INSERT INTO ${table} (${columns.map((c) => `"${c}"`).join(', ')}) VALUES ${values.join(', ')}`,
    params,
  );
}

async function main() {
  const args = process.argv.slice(2);
  const extraFree = Number(args.find((a) => a.startsWith('--extra-free='))?.split('=')[1] ?? 0);
  const [tournamentId, ...existingClubIds] = args.filter((a) => !a.startsWith('--'));
  if (!tournamentId) throw new Error('Usage: seed-tournament-entries <tournamentId> [existingClubId ...]');

  const dataSource = new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    synchronize: false,
  });
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();

  try {
    const [tournament] = await runner.query(
      `SELECT id, name, type, "startersCount", "subsCount", "maxParticipants", "communityId"
         FROM tournaments WHERE id = $1`,
      [tournamentId],
    );
    if (!tournament) throw new Error(`Tournament ${tournamentId} not found`);
    if (tournament.type !== 'cvc') throw new Error('Only CvC tournaments are supported');

    const registered: Array<{ clubId: string }> = await runner.query(
      `SELECT "clubId" FROM tournament_participants WHERE "tournamentId" = $1`,
      [tournamentId],
    );
    const registeredClubIds = new Set(registered.map((r) => r.clubId));
    const teamSize = tournament.startersCount + tournament.subsCount;
    let openSlots = tournament.maxParticipants - registered.length;
    const run = randomUUID().slice(0, 4);
    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    const communityId: string = tournament.communityId;

    await runner.startTransaction();

    /** Creates `count` demo players in a club and returns them. */
    const addPlayers = async (
      clubId: string,
      communityIds: string[],
      prefix: string,
      count: number,
      withPresident: boolean,
    ): Promise<Member[]> => {
      const created: Member[] = [];
      const users: unknown[][] = [];
      const profiles: unknown[][] = [];
      const memberships: unknown[][] = [];
      for (let n = 1; n <= count; n++) {
        const member: Member = {
          profileId: randomUUID(),
          userId: randomUUID(),
          name: `${pick(FIRST)} ${pick(LAST)}`,
          position: pick(POSITIONS),
          inGameId: `ALQ-${randInt(100000, 999999)}`,
          dpUrl: null,
        };
        users.push([member.userId, member.name, `demo.entry.${run}.${prefix}.${n}@allync.demo`, passwordHash, member.inGameId, 'Bangladesh']);
        profiles.push([
          member.profileId, member.userId, String(randInt(100000000, 999999999)), member.position, randInt(100, 900), clubId,
          withPresident && n === 1 ? ClubRole.PRESIDENT : ClubRole.PLAYER, LineupStatus.NONE, communityIds[0] ?? null,
          communityIds.length ? CommunityRole.MEMBER : null,
        ]);
        for (const cid of communityIds) {
          memberships.push([randomUUID(), cid, member.profileId, CommunityRole.MEMBER, false, JSON.stringify([clubId])]);
        }
        created.push(member);
      }
      await insertRows(runner, 'users', ['id', 'name', 'email', 'password', 'inGameId', 'country'], users);
      await insertRows(
        runner,
        'efootball_profiles',
        ['id', 'userId', 'konamiUid', 'gamePosition', 'points', 'clubId', 'clubRole', 'lineupStatus', 'communityId', 'communityRole'],
        profiles,
      );
      await insertRows(
        runner,
        'community_members',
        ['id', 'communityId', 'profileId', 'role', 'isDirectMember', 'sourceClubIds'],
        memberships,
      );
      return created;
    };

    const register = async (clubId: string, registrarUserId: string, team: Member[]) => {
      const toPlayer = (m: Member) => ({
        profileId: m.profileId,
        name: m.name,
        gamePosition: m.position,
        inGameId: m.inGameId,
        dpUrl: m.dpUrl,
      });
      const lineup = {
        teamId: null,
        teamName: null,
        starters: team.slice(0, tournament.startersCount).map(toPlayer),
        substitutes: team.slice(tournament.startersCount, teamSize).map(toPlayer),
      };
      await runner.query(
        `INSERT INTO tournament_participants (id, "tournamentId", "participantType", "clubId", "registeredByUserId", status,
           lineup, "submittedAt", "submittedByUserId")
         VALUES ($1, $2, 'club', $3, $4, 'lineup_submitted', $5, now(), $4)`,
        [randomUUID(), tournamentId, clubId, registrarUserId, JSON.stringify(lineup)],
      );
      openSlots--;
    };

    // 1. Existing clubs: register with members who are free, adding fresh players if needed.
    for (const clubId of existingClubIds) {
      if (registeredClubIds.has(clubId)) {
        console.log(`- ${clubId}: already registered, skipped`);
        continue;
      }
      if (openSlots <= 0) throw new Error('No open slots left for the existing clubs');
      const [club] = await runner.query(`SELECT id, name, "communityIds" FROM clubs WHERE id = $1`, [clubId]);
      if (!club) throw new Error(`Club ${clubId} not found`);
      const communityIds: string[] = club.communityIds ?? [];
      if (!communityIds.includes(communityId)) throw new Error(`Club ${club.name} is not in the tournament's community`);

      const [president] = await runner.query(
        `SELECT "userId" FROM efootball_profiles WHERE "clubId" = $1 AND "clubRole" IN ($2, $3) ORDER BY "clubRole" LIMIT 1`,
        [clubId, ClubRole.PRESIDENT, ClubRole.GENERAL_SECRETARY],
      );
      if (!president) throw new Error(`Club ${club.name} has no President or General Secretary to register it`);

      // Members not already in another active tournament (same rule as TournamentsService).
      const free: Member[] = await runner.query(
        `SELECT ep.id AS "profileId", ep."userId", COALESCE(u.name, 'Player') AS name, ep."gamePosition" AS position,
                u."inGameId", u."dpUrl"
           FROM efootball_profiles ep
           JOIN users u ON u.id = ep."userId"
          WHERE ep."clubId" = $1
            AND NOT EXISTS (
              SELECT 1 FROM tournament_participants p
                JOIN tournaments t ON t.id = p."tournamentId"
               WHERE t.status NOT IN ('completed', 'cancelled') AND t.id <> $2
                 AND (
                   (p."participantType" = 'player' AND p."userId" = ep."userId")
                   OR EXISTS (
                     SELECT 1 FROM jsonb_array_elements(
                       COALESCE(p.lineup->'starters', '[]'::jsonb) || COALESCE(p.lineup->'substitutes', '[]'::jsonb)
                     ) e WHERE e->>'profileId' = ep.id::text
                   )
                 )
            )
          ORDER BY ep.points DESC`,
        [clubId, tournamentId],
      );
      const missing = Math.max(0, teamSize - free.length);
      const added = missing ? await addPlayers(clubId, communityIds, club.name.toLowerCase().replace(/\W+/g, ''), missing, false) : [];
      await register(clubId, president.userId, [...free, ...added]);
      console.log(`- ${club.name}: ${free.length} free member(s) + ${added.length} new player(s) → team of ${teamSize} submitted`);
      if (extraFree > 0) {
        await addPlayers(clubId, communityIds, `${club.name.toLowerCase().replace(/\W+/g, '')}free`, extraFree, false);
        console.log(`  + ${extraFree} extra free player(s) added to ${club.name}`);
      }
    }

    // 2. New demo clubs for every remaining slot.
    for (let c = 0; openSlots > 0; c++) {
      const clubId = randomUUID();
      const base = `${PLACES[c % PLACES.length]} ${MASCOTS[(c * 3) % MASCOTS.length]}`;
      const name = `${base} ${run.toUpperCase()}`;
      await runner.query(
        `INSERT INTO clubs (id, name, color, initials, description, points, "joinPolicy", "communityIds", location, "dpUrl")
         VALUES ($1, $2, $3, $4, $5, $6, 'instant', $7, 'Bangladesh', $8)`,
        [
          clubId, name, COLORS[c % COLORS.length], base.split(' ').map((w) => w[0]).join('').slice(0, 3).toUpperCase(),
          `${name}: demo club.`, randInt(500, 3000), JSON.stringify([communityId]), LOGOS[c % LOGOS.length],
        ],
      );
      await runner.query('INSERT INTO community_clubs ("communityId", "clubId") VALUES ($1, $2)', [communityId, clubId]);
      const players = await addPlayers(clubId, [communityId], `c${c + 1}`, teamSize, true);
      await register(clubId, players[0].userId, players);
      console.log(`- ${name}: ${teamSize} players, team submitted (President: demo.entry.${run}.c${c + 1}.1@allync.demo)`);
    }

    await runner.commitTransaction();
    console.log(`\n"${tournament.name}" now has ${tournament.maxParticipants} of ${tournament.maxParticipants} clubs registered.`);
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
