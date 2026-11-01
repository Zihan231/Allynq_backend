import 'dotenv/config';
import bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';

/**
 * Demo creators to look around the creator marketplace: two creators (Creative artist role)
 * with approved designs on sale (badges, frames, themes, club themes, tournament banners) and one design each waiting for
 * staff review. The artwork lives in uploads/creators/demo-*.png. Safe to run again.
 *
 *   npm run build && npm run seed:creators
 *
 * Demo logins: demo.creator.<n>@allync.demo / 123456
 */

const PASSWORD = '123456';
const ART = '/uploads/creators';

type Design = {
  sku: string;
  name: string;
  description: string;
  category: 'badge' | 'frame' | 'theme' | 'club_theme' | 'tournament_banner';
  priceTk: number;
  rarity: string;
  file: string;
  colors?: { primary: string; secondary: string };
  pending?: boolean;
};

const CREATORS: Array<{ name: string; designs: Design[] }> = [
  {
    name: 'Mitu Akter',
    designs: [
      { sku: 'cr-demo-neon-wave', name: 'Neon Wave', description: 'Cyan to indigo, cut like a gem.', category: 'badge', priceTk: 150, rarity: 'rare', file: 'demo-neon-wave' },
      { sku: 'cr-demo-crimson-ember', name: 'Crimson Ember', description: 'A warm shield that glows like coals.', category: 'badge', priceTk: 250, rarity: 'epic', file: 'demo-crimson-ember' },
      { sku: 'cr-demo-aurora-ring', name: 'Aurora Ring', description: 'Northern-lights colours circling your photo.', category: 'frame', priceTk: 300, rarity: 'epic', file: 'demo-aurora-ring' },
      {
        sku: 'cr-demo-midnight-tide',
        name: 'Midnight Tide',
        description: 'Deep blue water and light trails.',
        category: 'theme',
        priceTk: 450,
        rarity: 'legendary',
        file: 'demo-midnight-tide',
        colors: { primary: '#1d4ed8', secondary: '#22d3ee' },
      },
      {
        sku: 'cr-demo-night-stadium',
        name: 'Night Stadium',
        description: 'Floodlit stands for your club page.',
        category: 'club_theme',
        priceTk: 500,
        rarity: 'epic',
        file: 'demo-night-stadium',
        colors: { primary: '#1e293b', secondary: '#facc15' },
      },
      { sku: 'cr-demo-ice-arena', name: 'Ice Arena', description: 'A cold blue stage for a winter cup.', category: 'tournament_banner', priceTk: 150, rarity: 'rare', file: 'demo-ice-arena' },
      { sku: 'cr-demo-jade-lotus', name: 'Jade Lotus', description: 'A green star, waiting for review.', category: 'badge', priceTk: 200, rarity: 'rare', file: 'demo-jade-lotus', pending: true },
    ],
  },
  {
    name: 'Arif Hossain',
    designs: [
      { sku: 'cr-demo-storm-bolt', name: 'Storm Bolt', description: 'A free badge to say hello.', category: 'badge', priceTk: 0, rarity: 'common', file: 'demo-storm-bolt' },
      { sku: 'cr-demo-ember-halo', name: 'Ember Halo', description: 'Gold to red, with sparks all around.', category: 'frame', priceTk: 200, rarity: 'rare', file: 'demo-ember-halo' },
      {
        sku: 'cr-demo-sunset-pitch',
        name: 'Sunset Pitch',
        description: 'Floodlights against an orange sky.',
        category: 'theme',
        priceTk: 350,
        rarity: 'epic',
        file: 'demo-sunset-pitch',
        colors: { primary: '#f97316', secondary: '#facc15' },
      },
      {
        sku: 'cr-demo-royal-crest',
        name: 'Royal Crest',
        description: 'Purple and pink, for clubs with style.',
        category: 'club_theme',
        priceTk: 400,
        rarity: 'rare',
        file: 'demo-royal-crest',
        colors: { primary: '#7c3aed', secondary: '#f472b6' },
      },
      { sku: 'cr-demo-golden-final', name: 'Golden Final', description: 'Gold light for the big final.', category: 'tournament_banner', priceTk: 0, rarity: 'common', file: 'demo-golden-final' },
      {
        sku: 'cr-demo-forest-night',
        name: 'Forest Night',
        description: 'Waiting for review.',
        category: 'theme',
        priceTk: 300,
        rarity: 'rare',
        file: 'demo-forest-night',
        colors: { primary: '#15803d', secondary: '#a3e635' },
        pending: true,
      },
    ],
  },
];

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
    for (const [i, c] of CREATORS.entries()) {
      const email = `demo.creator.${i + 1}@allync.demo`;
      let [user] = await q(`SELECT id FROM users WHERE email = $1`, [email]);
      if (!user) {
        [user] = await q(
          `INSERT INTO users (name, email, password, roles, "primaryRole", "rolesChosenAt", country, "gamingPlatform")
           VALUES ($1, $2, $3, '["creative","player"]'::jsonb, 'creative', now(), 'Bangladesh', 'mobile') RETURNING id`,
          [c.name, email, hash],
        );
        await q(`INSERT INTO efootball_profiles ("userId", points) VALUES ($1, 0)`, [user.id]);
        created.push(`creator ${c.name} <${email}>`);
      }

      for (const [j, d] of c.designs.entries()) {
        const [exists] = await q(`SELECT id FROM store_items WHERE sku = $1`, [d.sku]);
        if (exists) continue;
        const key = d.category === 'badge' ? 'imageUrl' : d.category === 'frame' ? 'frameUrl' : 'bannerUrl';
        const target = d.category === 'club_theme' ? 'club' : d.category === 'tournament_banner' ? 'tournament' : 'player';
        const assets = { [key]: `${ART}/${d.file}.png`, ...(d.colors ? { colors: d.colors } : {}) };
        await q(
          `INSERT INTO store_items (sku, name, description, category, "priceTk", active, "sortOrder", metadata,
                                    "creatorUserId", "reviewStatus", target, assets, "reviewedAt", "createdAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $14, $11::jsonb, $12, now() - make_interval(days => $13))`,
          [
            d.sku,
            d.name,
            d.description,
            d.category,
            d.priceTk,
            !d.pending,
            100 + j,
            JSON.stringify({ rarity: d.rarity }),
            user.id,
            d.pending ? 'pending' : 'approved',
            JSON.stringify(assets),
            d.pending ? null : new Date(),
            c.designs.length - j,
            target,
          ],
        );
        created.push(`${d.name} (${d.category}, ${d.pending ? 'waiting for review' : `on sale, ${d.priceTk} tk`}) by ${c.name}`);
      }
    }
  } finally {
    await dataSource.destroy();
  }

  console.log(created.length ? `Created:\n- ${created.join('\n- ')}` : 'Nothing to do: the demo creators already exist.');
  console.log(`\nDemo logins: demo.creator.1@allync.demo … demo.creator.${CREATORS.length}@allync.demo, password ${PASSWORD}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
