import 'dotenv/config';
import { DataSource } from 'typeorm';

/**
 * Gives (or removes) an Allync staff role. The only way to create the first super admin;
 * after that, super admins manage roles from the admin panel.
 *
 *   npm run admin:grant -- <email> [super_admin|admin|moderator|none]
 */
const ROLES = ['super_admin', 'admin', 'moderator', 'none'];

async function main() {
  const [email, roleArg = 'super_admin'] = process.argv.slice(2);
  if (!email || !ROLES.includes(roleArg)) {
    throw new Error(`Usage: admin:grant <email> [${ROLES.join('|')}]`);
  }
  const dataSource = new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await dataSource.initialize();
  try {
    const role = roleArg === 'none' ? null : roleArg;
    const rows = await dataSource.query(
      `UPDATE users SET "systemRole" = $2 WHERE LOWER(email) = LOWER($1) RETURNING id, name, email, "systemRole"`,
      [email.trim(), role],
    );
    const [user] = Array.isArray(rows[0]) ? rows[0] : rows;
    if (!user) throw new Error(`No user with email ${email}`);
    await dataSource.query(
      `INSERT INTO admin_audit_logs ("actorId", "actorName", "actorRole", action, "targetType", "targetId", "targetName", after, reason)
       VALUES (NULL, 'CLI', 'system', 'user.role', 'user', $1, $2, $3, 'Granted from the command line')`,
      [user.id, user.name, JSON.stringify({ systemRole: role })],
    );
    console.log(`${user.name} <${user.email}> is now: ${user.systemRole ?? 'a normal user'}`);
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
