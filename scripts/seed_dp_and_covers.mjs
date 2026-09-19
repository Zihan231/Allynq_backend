import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const CREST_LOGOS = [
  '/Bangladesh/bangladesh-football-federation-seeklogo.png',
  '/barca/barca-logo-transparent.png',
  '/real madrid/real-madrid-logo-preview.png',
  '/manu/manu-logo-transparent.png',
  '/arsenal/arsenal-logo-transparent.png',
  '/chelsea/chelsea-logo-transparent.png',
  '/man city/mancity-logo-transparent.png',
  '/bayern/bayern-logo-transparent.png',
  '/atleteco di madrid/atletico-logo-transparent.png',
  '/efootball.png',
];

const COVER_WALLPAPERS = [
  '/community 1.jpg',
  '/community 2.jpg',
  '/community 3.jpg',
  '/barca.jpg',
  '/Manu.jpg',
  '/real.jpg',
  '/arsenal/Arsenal HD Wallpaper For Desktop iPhone iPad And Android.jpg',
  '/chelsea/Chelsea Fc Wallpaper By Shangeeth Sugumar Shangeeths On.jpg',
  '/bayern/wallppaer.jpg',
  '/man city/Manchester City Vs United Full Time Win Derby.jpg',
  '/atleteco di madrid/wallpaperflare.com_wallpaper.jpg',
];

async function updateDpsAndCovers() {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log('Connected to PostgreSQL database.');

  // 1. Update Communities
  const commRes = await client.query('SELECT id, name FROM communities ORDER BY name ASC');
  console.log(`Updating ${commRes.rows.length} communities...`);

  for (let i = 0; i < commRes.rows.length; i++) {
    const comm = commRes.rows[i];
    const dpUrl = CREST_LOGOS[i % CREST_LOGOS.length];
    const coverUrl = COVER_WALLPAPERS[i % COVER_WALLPAPERS.length];

    await client.query(
      'UPDATE communities SET "dpUrl" = $1, "coverUrl" = $2 WHERE id = $3',
      [dpUrl, coverUrl, comm.id],
    );
  }
  console.log('✓ All communities updated with dpUrl and coverUrl.');

  // 2. Update Clubs
  const clubsRes = await client.query('SELECT id, name FROM clubs ORDER BY name ASC');
  console.log(`Updating ${clubsRes.rows.length} clubs...`);

  for (let i = 0; i < clubsRes.rows.length; i++) {
    const club = clubsRes.rows[i];
    const dpUrl = CREST_LOGOS[(i + 3) % CREST_LOGOS.length];
    const coverUrl = COVER_WALLPAPERS[(i + 2) % COVER_WALLPAPERS.length];

    await client.query(
      'UPDATE clubs SET "dpUrl" = $1, "coverUrl" = $2 WHERE id = $3',
      [dpUrl, coverUrl, club.id],
    );
  }
  console.log('✓ All clubs updated with dpUrl and coverUrl.');

  // 3. Verify
  const sample = await client.query(
    'SELECT name, "dpUrl", "coverUrl" FROM communities WHERE name LIKE \'%Rajshahi%\' OR name LIKE \'%Dhaka%\' LIMIT 4',
  );
  console.table(sample.rows);

  await client.end();
}

updateDpsAndCovers().catch((err) => {
  console.error(err);
  process.exit(1);
});
