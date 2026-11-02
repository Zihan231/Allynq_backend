import 'dotenv/config';
import bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';

/**
 * Demo sponsors to look around Sponsor mode: two brands (one verified) with logos, banners
 * and approved posts in the feed; Gamer Cola is the Title sponsor of "Demo Creators Cup"
 * (seed:creators) and Pixel Net sponsors the biggest community for 30 days. The demo
 * sponsorships are 0 tk (branding only), so no wallet money moves. The cup also has an open
 * call for Gold / Partner sponsors. Artwork: uploads/sponsors/demo-*.png. Safe to run again.
 *
 *   npm run build && npm run seed:sponsors
 *
 * Demo logins: demo.sponsor.<n>@allync.demo / 123456
 */

const PASSWORD = '123456';
const ART = '/uploads/sponsors';

const SPONSORS = [
  {
    name: 'Rahim Uddin',
    brandName: 'Gamer Cola',
    tagline: 'Ice-cold energy for every match',
    industry: 'Drinks',
    about: 'The drink of Bangladesh’s eFootball scene. We back tournaments big and small.',
    website: 'https://example.com/gamer-cola',
    logo: 'demo-gamer-cola-logo',
    banner: 'demo-gamer-cola-banner',
    verified: true,
    posts: [
      'Finals weekend! Every finalist of the Demo Creators Cup gets a crate of Gamer Cola. 🥤⚽',
      'Stay sharp in extra time: hydrate between matches. Good luck to everyone in this week’s cups!',
    ],
  },
  {
    name: 'Karim Hasan',
    brandName: 'Pixel Net',
    tagline: 'Low-ping internet for gamers',
    industry: 'Internet',
    about: 'Fibre internet built for online play. Proud partner of grassroots communities.',
    website: 'https://example.com/pixel-net',
    logo: 'demo-pixel-net-logo',
    banner: 'demo-pixel-net-banner',
    verified: false,
    posts: ['Lag cost you a goal? Our gamer plan keeps ping under 20 ms in Dhaka. Ask us about community discounts.'],
  },
];

async function main() {
  const dataSource = new DataSource({ type: 'postgres', url: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, synchronize: false });
  await dataSource.initialize();
  const q = (sql: string, params: unknown[] = []) => dataSource.query(sql, params);
  const hash = await bcrypt.hash(PASSWORD, 10);
  const created: string[] = [];

  try {
    const ids: string[] = [];
    for (const [i, s] of SPONSORS.entries()) {
      const email = `demo.sponsor.${i + 1}@allync.demo`;
      let [user] = await q(`SELECT id FROM users WHERE email = $1`, [email]);
      if (!user) {
        [user] = await q(
          `INSERT INTO users (name, email, password, roles, "primaryRole", "rolesChosenAt", country, "gamingPlatform")
           VALUES ($1, $2, $3, '["sponsor","player"]'::jsonb, 'sponsor', now(), 'Bangladesh', 'mobile') RETURNING id`,
          [s.name, email, hash],
        );
        await q(`INSERT INTO efootball_profiles ("userId", points) VALUES ($1, 0)`, [user.id]);
        created.push(`sponsor ${s.brandName} <${email}>`);
      }
      ids.push(user.id);
      await q(
        `INSERT INTO sponsor_profiles ("userId", "brandName", tagline, about, industry, website, "logoUrl", "bannerUrl", "verifiedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT ("userId") DO NOTHING`,
        [user.id, s.brandName, s.tagline, s.about, s.industry, s.website, `${ART}/${s.logo}.png`, `${ART}/${s.banner}.png`, s.verified ? new Date() : null],
      );
      const [{ n }] = await q(`SELECT count(*)::int AS n FROM coach_posts WHERE "coachUserId" = $1 AND "authorRole" = 'sponsor'`, [user.id]);
      if (n === 0) {
        for (const [j, body] of s.posts.entries()) {
          await q(
            `INSERT INTO coach_posts ("coachUserId", "authorRole", body, links, status, "reviewedAt", "createdAt")
             VALUES ($1, 'sponsor', $2, '[]'::jsonb, 'approved', now(), now() - make_interval(hours => $3))`,
            [user.id, body, (j + 1) * 5],
          );
        }
        created.push(`${s.posts.length} approved posts by ${s.brandName}`);
      }
    }

    const day = 24 * 3600_000;
    // Gamer Cola: Title sponsor of the demo cup (branding only).
    const [cup] = await q(`SELECT id, "creatorId" FROM tournaments WHERE name = 'Demo Creators Cup' AND "deletedAt" IS NULL`);
    if (cup) {
      const [has] = await q(`SELECT 1 FROM sponsorships WHERE "tournamentId" = $1 AND "sponsorUserId" = $2`, [cup.id, ids[0]]);
      if (!has) {
        await q(
          `INSERT INTO sponsorships ("sponsorUserId", "targetType", "tournamentId", tier, "amountTk", origin, turn, bids, message, status,
                                     "expiresAt", "startedAt", "createdByUserId", "paidToUserId")
           VALUES ($1, 'tournament', $2, 'title', 0, 'sponsor', 'host', '[]'::jsonb, 'Demo sponsorship', 'active', $3, now(), $1, $4)`,
          [ids[0], cup.id, new Date(Date.now() + 3 * day), cup.creatorId],
        );
        created.push('Gamer Cola is the Title sponsor of Demo Creators Cup');
      }
      const [call] = await q(`SELECT 1 FROM sponsor_calls WHERE "tournamentId" = $1`, [cup.id]);
      if (!call) {
        await q(
          `INSERT INTO sponsor_calls ("targetType", "tournamentId", tiers, note, "askTk", "createdByUserId")
           VALUES ('tournament', $1, '["gold","partner"]'::jsonb, 'Logo on the bracket and a shout-out before every match.', 2000, $2)`,
          [cup.id, cup.creatorId],
        );
        created.push('open call for Gold / Partner sponsors on Demo Creators Cup');
      }
    }

    // Pixel Net: sponsors the biggest community for 30 days.
    const [community] = await q(
      `SELECT c.id, c."creatorId" FROM communities c LEFT JOIN community_members m ON m."communityId" = c.id
        WHERE c."deletedAt" IS NULL AND c.name NOT LIKE 'E2E %' GROUP BY c.id ORDER BY count(m.id) DESC LIMIT 1`,
    );
    if (community) {
      const [has] = await q(`SELECT 1 FROM sponsorships WHERE "communityId" = $1 AND "sponsorUserId" = $2`, [community.id, ids[1]]);
      if (!has) {
        await q(
          `INSERT INTO sponsorships ("sponsorUserId", "targetType", "communityId", tier, "amountTk", days, origin, turn, bids, message, status,
                                     "expiresAt", "startedAt", "endsAt", "createdByUserId", "paidToUserId")
           VALUES ($1, 'community', $2, 'gold', 0, 30, 'sponsor', 'host', '[]'::jsonb, 'Demo sponsorship', 'active', $3, now(), $4, $1, $5)`,
          [ids[1], community.id, new Date(Date.now() + 3 * day), new Date(Date.now() + 30 * day), community.creatorId],
        );
        created.push('Pixel Net sponsors the biggest community (Gold, 30 days)');
      }
    }
  } finally {
    await dataSource.destroy();
  }

  console.log(created.length ? `Created:\n- ${created.join('\n- ')}` : 'Nothing to do: the demo sponsors already exist.');
  console.log(`\nDemo logins: demo.sponsor.1@allync.demo, demo.sponsor.2@allync.demo, password ${PASSWORD}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
