import 'dotenv/config';
import bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { EfootballPosition } from '../users/enums/efootball-position.enum.js';
import { ClubRole, CommunityRole, LineupStatus } from '../users/enums/user-attributes.enum.js';

/**
 * Adds demo players to an existing club, the same way a real join would:
 * a user + eFootball profile (club role Player) per person, plus an indirect
 * membership in every community the club belongs to.
 *
 *   npm run seed:club-members -- <clubId> [count=20]
 *
 * Demo logins: demo.<club-prefix>.<n>@allync.demo / 123456
 */

const PASSWORD = '123456';

const FIRST_NAMES = [
  'Arif', 'Tanvir', 'Rakib', 'Sabbir', 'Nayeem', 'Fahim', 'Shakib', 'Imran', 'Rasel', 'Mahin',
  'Sajid', 'Tamim', 'Rifat', 'Jubayer', 'Asif', 'Hasib', 'Siam', 'Nafis', 'Rayhan', 'Ayon',
];
const LAST_NAMES = [
  'Hossain', 'Rahman', 'Islam', 'Ahmed', 'Chowdhury', 'Karim', 'Uddin', 'Sarker', 'Mia', 'Talukder',
];
const POSITIONS = Object.values(EfootballPosition);

const randInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

async function main() {
  const [clubId, countArg] = process.argv.slice(2);
  const count = Number(countArg ?? 20);
  if (!clubId || !Number.isInteger(count) || count < 1 || count > 200) {
    throw new Error('Usage: seed-club-members <clubId> [count 1-200]');
  }

  const dataSource = new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    synchronize: false,
  });
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();

  try {
    const [club] = await runner.query('SELECT id, name FROM clubs WHERE id = $1', [clubId]);
    if (!club) throw new Error(`Club ${clubId} not found`);

    const communityRows: Array<{ communityId: string }> = await runner.query(
      'SELECT "communityId" FROM community_clubs WHERE "clubId" = $1',
      [clubId],
    );
    const communityIds = communityRows.map((r) => r.communityId);

    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    const prefix = clubId.slice(0, 8);
    const [{ n: existingDemo }] = await runner.query(
      'SELECT COUNT(*)::int AS n FROM users WHERE email LIKE $1',
      [`demo.${prefix}.%@allync.demo`],
    );

    await runner.startTransaction();
    const created: string[] = [];

    for (let i = 1; i <= count; i++) {
      const seq = existingDemo + i;
      const name = `${FIRST_NAMES[(seq * 7) % FIRST_NAMES.length]} ${LAST_NAMES[(seq * 3) % LAST_NAMES.length]}`;
      const email = `demo.${prefix}.${seq}@allync.demo`;
      const userId = randomUUID();
      const profileId = randomUUID();

      await runner.query(
        `INSERT INTO users (id, name, email, password, "inGameId", country)
         VALUES ($1, $2, $3, $4, $5, 'Bangladesh')`,
        [userId, name, email, passwordHash, `ALQ-${randInt(100000, 999999)}`],
      );
      await runner.query(
        `INSERT INTO efootball_profiles
           (id, "userId", "konamiUid", "gamePosition", points, "clubId", "clubRole", "lineupStatus",
            "communityId", "communityRole")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          profileId, userId, String(randInt(100000000, 999999999)), POSITIONS[seq % POSITIONS.length],
          randInt(100, 900), clubId, ClubRole.PLAYER, LineupStatus.NONE,
          communityIds[0] ?? null, communityIds.length ? CommunityRole.MEMBER : null,
        ],
      );
      for (const communityId of communityIds) {
        await runner.query(
          `INSERT INTO community_members (id, "communityId", "profileId", role, "isDirectMember", "sourceClubIds")
           VALUES ($1, $2, $3, $4, false, $5)`,
          [randomUUID(), communityId, profileId, CommunityRole.MEMBER, JSON.stringify([clubId])],
        );
      }
      created.push(`${name} <${email}>`);
    }

    await runner.commitTransaction();
    console.log(`Added ${created.length} demo players to "${club.name}" (password: ${PASSWORD}):`);
    for (const line of created) console.log(`- ${line}`);
    if (communityIds.length) console.log(`Also linked to ${communityIds.length} community(ies) via the club.`);
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
