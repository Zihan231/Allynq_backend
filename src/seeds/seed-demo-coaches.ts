import 'dotenv/config';
import bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';

/**
 * Demo coaches to look around the coaching feature: coach role + coach card, approved
 * tutorial posts (and one waiting for review each), one coach coaching a club, two coach
 * requests waiting for clubs to answer, and feed signals (likes, comments, saves, follows).
 * Safe to run again (skips what exists).
 *
 *   npm run build && npm run seed:coaches
 *
 * Demo logins: demo.coach.<n>@allync.demo / 123456
 */

const PASSWORD = '123456';
const CHANNEL = 'https://www.youtube.com/@eFootball';

const COACHES = [
  {
    name: 'Rafiq Hasan',
    headline: 'Tactics coach · ex-Division 1 captain',
    bio: 'Ten years of competitive eFootball. I teach shape, pressing triggers and how to manage a lead.',
    specialities: ['Pressing', 'Game management', 'Formations'],
    askingFeeTk: 600,
    available: true,
  },
  {
    name: 'Nusrat Jahan',
    headline: 'Set-piece specialist',
    bio: 'Corners, free kicks and long throws: small details that win tight matches.',
    specialities: ['Set pieces', 'Free kicks'],
    askingFeeTk: 400,
    available: true,
  },
  {
    name: 'Tanvir Ahmed',
    headline: 'Attacking play & finishing',
    bio: 'From build-up to the final shot. Through balls, one-twos and finesse finishing drills.',
    specialities: ['Attacking play', 'Finishing', 'Dribbling'],
    askingFeeTk: 500,
    available: true,
  },
  {
    name: 'Sadia Karim',
    headline: 'Defending fundamentals',
    bio: 'Jockeying, matching runs and the patience that keeps clean sheets.',
    specialities: ['Defending', 'Positioning'],
    askingFeeTk: 350,
    available: true,
  },
  {
    name: 'Imran Chowdhury',
    headline: 'Mental game & tournament prep',
    bio: 'How to prepare for knockouts, handle pressure and review your own matches.',
    specialities: ['Mindset', 'Match review'],
    askingFeeTk: 300,
    available: true,
  },
  {
    name: 'Fahim Rahman',
    headline: 'Goalkeeping & counter-attacks',
    bio: 'Currently booked with a club; follow the tutorials meanwhile.',
    specialities: ['Counter-attacks', 'Goalkeeping'],
    askingFeeTk: 700,
    available: false,
  },
];

const POSTS = [
  'Pressing triggers: jump the passing lane only when the receiver faces his own goal. Drill: 10 minutes in Training Mode, focus on the second presser.',
  'Three mistakes that cost you late goals: dropping too deep, wasting time in your own half, and switching off at throw-ins.',
  'Free-kick routine I use in every tournament: aim just inside the near post, half-power, add a touch of curl.',
  'Build-up from the back against a high press: keep both centre-backs wide and use the pivot as the third man.',
];
const PENDING_POST = 'New tutorial: reading the opponent’s formation in the first five minutes (waiting for review).';

async function main() {
  const dataSource = new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    synchronize: false,
  });
  await dataSource.initialize();
  const q = (sql: string, params: unknown[] = []) => dataSource.query(sql, params);
  const hash = await bcrypt.hash(PASSWORD, 10);
  const created: string[] = [];

  try {
    const coachIds: string[] = [];
    for (const [i, c] of COACHES.entries()) {
      const email = `demo.coach.${i + 1}@allync.demo`;
      let [user] = await q(`SELECT id FROM users WHERE email = $1`, [email]);
      if (!user) {
        [user] = await q(
          `INSERT INTO users (name, email, password, roles, "primaryRole", "rolesChosenAt", country, "gamingPlatform")
           VALUES ($1, $2, $3, '["coach","player"]'::jsonb, 'coach', now(), 'Bangladesh', 'mobile') RETURNING id`,
          [c.name, email, hash],
        );
        await q(`INSERT INTO efootball_profiles ("userId", points) VALUES ($1, 0)`, [user.id]);
        created.push(`coach ${c.name} <${email}>`);
      }
      coachIds.push(user.id);

      await q(
        `INSERT INTO coach_profiles ("userId", headline, bio, "youtubeChannelUrl", specialities, "askingFeeTk", available)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
         ON CONFLICT ("userId") DO NOTHING`,
        [user.id, c.headline, c.bio, CHANNEL, JSON.stringify(c.specialities), c.askingFeeTk, c.available],
      );

      const [{ n }] = await q(`SELECT count(*)::int AS n FROM coach_posts WHERE "coachUserId" = $1`, [user.id]);
      if (n === 0) {
        for (const [j, body] of [POSTS[i % POSTS.length], POSTS[(i + 1) % POSTS.length]].entries()) {
          await q(
            `INSERT INTO coach_posts ("coachUserId", body, links, status, "reviewedAt", "createdAt")
             VALUES ($1, $2, $3::jsonb, 'approved', now(), now() - make_interval(days => $4))`,
            [user.id, body, JSON.stringify([CHANNEL]), (j + 1) * 3],
          );
        }
        await q(`INSERT INTO coach_posts ("coachUserId", body, status) VALUES ($1, $2, 'pending')`, [user.id, PENDING_POST]);
        created.push(`3 posts for ${c.name} (2 public, 1 waiting for review)`);
      }
    }

    // Real clubs, biggest first, for the deals.
    const clubs: Array<{ id: string; name: string }> = await q(
      `SELECT c.id, c.name FROM clubs c
         LEFT JOIN efootball_profiles ep ON ep."clubId" = c.id
        WHERE c."deletedAt" IS NULL AND c.name NOT LIKE 'E2E %'
        GROUP BY c.id ORDER BY count(ep.id) DESC, c.name LIMIT 3`,
    );
    const [{ n: deals }] = await q(`SELECT count(*)::int AS n FROM coaching_deals WHERE "coachUserId" = ANY($1)`, [coachIds]);
    if (clubs.length && deals === 0) {
      const day = 24 * 3600_000;
      const now = Date.now();
      // The last coach (not available) coaches the biggest club: a free 30-day deal, no money involved.
      await q(
        `INSERT INTO coaching_deals ("coachUserId", "clubId", origin, turn, "feeTk", "heldTk", days, "commissionPct", "commissionTk",
                                     status, message, bids, "createdByUserId", "expiresAt", "startedAt", "endsAt")
         VALUES ($1, $2, 'club', 'coach', 0, 0, 30, 10, 0, 'active', 'Demo deal', '[]'::jsonb, $1, $3, $4, $5)`,
        [coachIds[5], clubs[0].id, new Date(now + 3 * day), new Date(now - 5 * day), new Date(now + 25 * day)],
      );
      created.push(`${COACHES[5].name} coaches ${clubs[0].name} (30 days)`);
      // Two coaches ask clubs to hire them: the club leaders answer from the club's Transfers tab.
      for (const [k, coachIndex] of [0, 1].entries()) {
        const club = clubs[Math.min(k + 1, clubs.length - 1)];
        const fee = COACHES[coachIndex].askingFeeTk;
        await q(
          `INSERT INTO coaching_deals ("coachUserId", "clubId", origin, turn, "feeTk", "heldTk", days, status, message, bids,
                                       "createdByUserId", "expiresAt")
           VALUES ($1, $2, 'coach', 'club', $3, 0, 30, 'pending', $4, $5::jsonb, $1, $6)`,
          [
            coachIds[coachIndex],
            club.id,
            fee,
            `I'd like to coach ${club.name} for a month.`,
            JSON.stringify([{ party: 'coach', byUserId: coachIds[coachIndex], feeTk: fee, days: 30, message: null, at: new Date().toISOString() }]),
            new Date(now + 3 * day),
          ],
        );
        created.push(`${COACHES[coachIndex].name} asks ${club.name} (${fee} tk, 30 days)`);
      }
    }

    // Feed signals: the demo coaches follow, like and comment on each other's public posts.
    const [{ n: signals }] = await q(`SELECT count(*)::int AS n FROM coach_post_likes WHERE "userId" = ANY($1)`, [coachIds]);
    if (signals === 0) {
      const COMMENTS = ['Great drill, trying it tonight!', 'This fixed my pressing, thanks coach.', 'Can you do one on corners next?', 'Clear and simple, love it.'];
      const posts: Array<{ id: string; coachUserId: string }> = await q(
        `SELECT id, "coachUserId" FROM coach_posts WHERE "coachUserId" = ANY($1) AND status = 'approved' ORDER BY "createdAt"`,
        [coachIds],
      );
      for (const [i, post] of posts.entries()) {
        const others = coachIds.filter((id) => id !== post.coachUserId);
        // Some posts get more love than others, so the ranking has something to work with.
        const likers = others.slice(0, 1 + (i % others.length));
        for (const u of likers) await q(`INSERT INTO coach_post_likes ("postId", "userId") VALUES ($1, $2) ON CONFLICT DO NOTHING`, [post.id, u]);
        const commenters = others.slice(0, i % 3);
        for (const [k, u] of commenters.entries()) {
          await q(`INSERT INTO coach_post_comments ("postId", "userId", body) VALUES ($1, $2, $3)`, [post.id, u, COMMENTS[(i + k) % COMMENTS.length]]);
        }
        if (i % 4 === 0) await q(`INSERT INTO coach_post_saves ("postId", "userId") VALUES ($1, $2) ON CONFLICT DO NOTHING`, [post.id, others[0]]);
        await q(
          `UPDATE coach_posts SET
             "likeCount" = (SELECT count(*) FROM coach_post_likes WHERE "postId" = $1),
             "commentCount" = (SELECT count(*) FROM coach_post_comments WHERE "postId" = $1 AND "deletedAt" IS NULL),
             "saveCount" = (SELECT count(*) FROM coach_post_saves WHERE "postId" = $1)
           WHERE id = $1`,
          [post.id],
        );
      }
      for (const [i, follower] of coachIds.entries()) {
        for (const coach of [coachIds[(i + 1) % coachIds.length], coachIds[(i + 2) % coachIds.length]]) {
          await q(`INSERT INTO coach_follows ("coachUserId", "followerUserId") VALUES ($1, $2) ON CONFLICT DO NOTHING`, [coach, follower]);
        }
      }
      created.push(`feed signals: likes, comments, saves and follows on ${posts.length} posts`);
    }

    console.log(created.length ? `Added:\n  ${created.join('\n  ')}` : 'Demo coaches already there; nothing added.');
    console.log(`Logins: demo.coach.1@allync.demo … demo.coach.${COACHES.length}@allync.demo / ${PASSWORD}`);
  } finally {
    await dataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
