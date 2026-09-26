import 'dotenv/config';
import bcrypt from 'bcrypt';
import { DataSource, type QueryRunner } from 'typeorm';

const dataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  synchronize: false,
});

const OFFICER_ROLES = [
  'President',
  'Vice President',
  'Team Manager',
  'Head of Discipline',
  'Scout',
] as const;

type OfficerRole = (typeof OFFICER_ROLES)[number];
type CommunityRow = { id: string; name: string; initials: string };
type ProfileRow = { id: string; userId: string };

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function ensureProfile(
  runner: QueryRunner,
  email: string,
  name: string,
  passwordHash: string,
): Promise<ProfileRow> {
  const users = await runner.query('SELECT id FROM users WHERE email = $1 LIMIT 1', [email]);
  const user = users[0] ?? (await runner.query(
    'INSERT INTO users ("name", "email", "password") VALUES ($1, $2, $3) RETURNING id',
    [name, email, passwordHash],
  ))[0];

  const profiles = await runner.query('SELECT id, "userId" FROM efootball_profiles WHERE "userId" = $1 LIMIT 1', [user.id]);
  return profiles[0] ?? (await runner.query(
    'INSERT INTO efootball_profiles ("userId", "points") VALUES ($1, $2) RETURNING id, "userId"',
    [user.id, 0],
  ))[0];
}

async function syncMembership(
  runner: QueryRunner,
  communityId: string,
  profile: ProfileRow,
  role: OfficerRole | 'Member',
) {
  await runner.query(
    `INSERT INTO community_members ("communityId", "profileId", "role", "isDirectMember", "sourceClubIds")
     VALUES ($1, $2, $3, true, '[]'::jsonb)
     ON CONFLICT ("communityId", "profileId") DO UPDATE
     SET "role" = EXCLUDED."role", "isDirectMember" = true, "sourceClubIds" = '[]'::jsonb`,
    [communityId, profile.id, role],
  );
  await runner.query(
    'UPDATE efootball_profiles SET "communityId" = $1, "communityRole" = $2 WHERE id = $3',
    [communityId, role, profile.id],
  );
}

async function seedCommunityDirectory() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.');
  const passwordHash = await bcrypt.hash('123456', 10);
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();

  try {
    const communities: CommunityRow[] = await runner.query(
      'SELECT id, name, initials FROM communities ORDER BY name ASC',
    );
    if (!communities.length) throw new Error('No communities found. Run npm run seed:communities first.');

    let officersAdded = 0;
    let membersAdded = 0;
    for (const community of communities) {
      const communitySlug = slug(community.name);
      let presidentProfile: ProfileRow | null = null;

      for (const role of OFFICER_ROLES) {
        const existing = await runner.query(
          'SELECT cm."profileId" AS id, p."userId" AS "userId" FROM community_members cm JOIN efootball_profiles p ON p.id = cm."profileId" WHERE cm."communityId" = $1 AND cm.role = $2 LIMIT 1',
          [community.id, role],
        );

        const profile: ProfileRow = existing[0] ?? await ensureProfile(
          runner,
          `seed-${communitySlug}-${slug(role)}@allync.com`,
          `${community.name} ${role}`,
          passwordHash,
        );
        if (!existing[0]) officersAdded++;
        await syncMembership(runner, community.id, profile, role);
        if (role === 'President') presidentProfile = profile;
      }

      if (!presidentProfile) throw new Error(`Could not assign a President to ${community.name}.`);
      await runner.query('UPDATE communities SET "creatorId" = $1 WHERE id = $2', [presidentProfile.userId, community.id]);

      for (let index = 1; index <= 3; index++) {
        const email = `seed-${communitySlug}-member-${index}@allync.com`;
        const existing = await runner.query(
          'SELECT p.id, p."userId" FROM efootball_profiles p JOIN users u ON u.id = p."userId" WHERE u.email = $1 LIMIT 1',
          [email],
        );
        const profile: ProfileRow = existing[0] ?? await ensureProfile(
          runner,
          email,
          `${community.name} Member ${index}`,
          passwordHash,
        );
        const membership = await runner.query(
          'SELECT id FROM community_members WHERE "communityId" = $1 AND "profileId" = $2 LIMIT 1',
          [community.id, profile.id],
        );
        if (!membership[0]) membersAdded++;
        await syncMembership(runner, community.id, profile, 'Member');
      }
    }

    await runner.commitTransaction();
    console.log(`Community directory ready: ${communities.length} communities, ${officersAdded} officers added, ${membersAdded} members added.`);
  } catch (error) {
    await runner.rollbackTransaction();
    throw error;
  } finally {
    await runner.release();
    await dataSource.destroy();
  }
}

seedCommunityDirectory().catch((error: unknown) => {
  console.error('Community directory seeding failed:', error);
  process.exitCode = 1;
});
