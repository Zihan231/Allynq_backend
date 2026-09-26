import 'dotenv/config';
import { DataSource } from 'typeorm';

const dataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  synchronize: false,
});

const communities = [
  { name: 'Dhaka Elite Community', tier: 'Featured', joinPolicy: 'approval', points: 3200, color: '#4c8dff', initials: 'DE', location: 'Dhaka', motto: 'One community, every club held to the same standard.' },
  { name: 'Sylhet Strikers Community', tier: 'Regional', joinPolicy: 'instant', points: 1950, color: '#34d399', initials: 'SS', location: 'Sylhet', motto: 'Small community, big welcome.' },
  { name: 'Chittagong Kings Arena', tier: 'Featured', joinPolicy: 'approval', points: 2850, color: '#f59e0b', initials: 'CK', location: 'Chittagong', motto: 'Port City pride on the pitch.' },
  { name: 'Rajshahi Royals Community', tier: 'Verified', joinPolicy: 'instant', points: 2100, color: '#ec4899', initials: 'RR', location: 'Rajshahi', motto: 'Silk City passion in competitive gaming.' },
  { name: 'Khulna Titans Esports', tier: 'Verified', joinPolicy: 'approval', points: 2400, color: '#8b5cf6', initials: 'KT', location: 'Khulna', motto: 'Fierce competition from the delta.' },
  { name: 'Barisal Warriors League', tier: 'Regional', joinPolicy: 'instant', points: 1650, color: '#06b6d4', initials: 'BW', location: 'Barisal', motto: 'Riverine strength in every tournament.' },
  { name: 'Rangpur Riders Gaming', tier: 'Regional', joinPolicy: 'instant', points: 1750, color: '#10b981', initials: 'RG', location: 'Rangpur', motto: 'Northern power unleashing on eFootball.' },
  { name: 'Mymensingh Mavericks', tier: 'Open', joinPolicy: 'instant', points: 1400, color: '#6366f1', initials: 'MM', location: 'Mymensingh', motto: "Brahmaputra's finest competing together." },
  { name: 'Apex Champions League', tier: 'Featured', joinPolicy: 'approval', points: 4100, color: '#e11d48', initials: 'AC', location: 'Dhaka', motto: 'Only the highest tier clubs compete here.' },
  { name: 'Varsity Gamers Hub', tier: 'Verified', joinPolicy: 'instant', points: 2600, color: '#3b82f6', initials: 'VG', location: 'Dhaka', motto: 'Inter-university eFootball headquarters.' },
  { name: 'Bangladesh eFootball Federation Hub', tier: 'Featured', joinPolicy: 'approval', points: 4800, color: '#059669', initials: 'BF', location: 'Dhaka', motto: 'Official national tournament rails.' },
  { name: 'South Asia Pro League', tier: 'Featured', joinPolicy: 'approval', points: 5200, color: '#d97706', initials: 'SA', location: 'Dhaka', motto: 'Cross-border competitive gaming ecosystem.' },
  { name: 'Gulshan Elite Club Arena', tier: 'Verified', joinPolicy: 'approval', points: 2300, color: '#64748b', initials: 'GE', location: 'Dhaka', motto: 'Top-tier club vs club spectacles.' },
  { name: 'Uttara Strikers Federation', tier: 'Open', joinPolicy: 'instant', points: 1550, color: '#ef4444', initials: 'US', location: 'Dhaka', motto: 'Grassroots competitive hub for North Dhaka.' },
  { name: 'Mirpur Gaming Brotherhood', tier: 'Open', joinPolicy: 'instant', points: 1680, color: '#84cc16', initials: 'MB', location: 'Dhaka', motto: 'Home of gritty, disciplined squad gameplay.' },
  { name: 'Old Dhaka Heritage Cup', tier: 'Regional', joinPolicy: 'instant', points: 1920, color: '#f97316', initials: 'OH', location: 'Dhaka', motto: 'Historic rivalries brought to the virtual arena.' },
  { name: 'Dhanmondi Esports Guild', tier: 'Verified', joinPolicy: 'instant', points: 2250, color: '#14b8a6', initials: 'DG', location: 'Dhaka', motto: 'Tactical minds and precise execution.' },
  { name: 'Comilla Blasters Community', tier: 'Regional', joinPolicy: 'instant', points: 1820, color: '#a855f7', initials: 'CB', location: 'Comilla', motto: 'Eastern powerhouses united.' },
  { name: 'Bogra Legends League', tier: 'Open', joinPolicy: 'instant', points: 1390, color: '#fb7185', initials: 'BL', location: 'Bogra', motto: 'Historic battles and emerging talent.' },
  { name: 'Narayanganj Mariners Esports', tier: 'Open', joinPolicy: 'instant', points: 1470, color: '#0284c7', initials: 'NM', location: 'Narayanganj', motto: 'The river port warriors.' },
  { name: 'Gazipur Tigers Community', tier: 'Open', joinPolicy: 'instant', points: 1510, color: '#ea580c', initials: 'GT', location: 'Gazipur', motto: 'Relentless drive and passion.' },
  { name: 'Jessore Gladiators Arena', tier: 'Open', joinPolicy: 'instant', points: 1250, color: '#7c3aed', initials: 'JG', location: 'Jessore', motto: 'South-western gladiators on the pitch.' },
  { name: "Cox's Bazar Coastal League", tier: 'New', joinPolicy: 'instant', points: 980, color: '#0ea5e9', initials: 'CC', location: "Cox's Bazar", motto: 'Where the ocean meets the competition.' },
  { name: 'Dinajpur Dynamos Esports', tier: 'New', joinPolicy: 'instant', points: 890, color: '#16a34a', initials: 'DD', location: 'Dinajpur', motto: 'Northern youth rising to the top.' },
  { name: 'Feni Falcons Esports Guild', tier: 'New', joinPolicy: 'instant', points: 810, color: '#ca8a04', initials: 'FF', location: 'Feni', motto: 'Rising through grassroots battles.' },
];

const crests = [
  '/Bangladesh/bangladesh-football-federation-seeklogo.png', '/barca/barca-logo-transparent.png',
  '/real madrid/real-madrid-logo-preview.png', '/manu/manu-logo-transparent.png',
  '/arsenal/arsenal-logo-transparent.png', '/chelsea/chelsea-logo-transparent.png',
  '/man city/mancity-logo-transparent.png', '/bayern/bayern-logo-transparent.png',
  '/atleteco di madrid/atletico-logo-transparent.png', '/efootball.png',
];
const covers = [
  '/community 1.jpg', '/community 2.jpg', '/community 3.jpg', '/barca.jpg', '/Manu.jpg',
  '/real.jpg', '/arsenal/Arsenal HD Wallpaper For Desktop iPhone iPad And Android.jpg',
  '/chelsea/Chelsea Fc Wallpaper By Shangeeth Sugumar Shangeeths On.jpg', '/bayern/wallppaer.jpg',
  '/man city/Manchester City Vs United Full Time Win Derby.jpg', '/atleteco di madrid/wallpaperflare.com_wallpaper.jpg',
];

async function seedCommunities() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.');
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();

  try {
    const [creator] = await runner.query('SELECT id FROM users ORDER BY "createdAt" ASC LIMIT 1');
    if (!creator) throw new Error('No users found. Seed at least one user before adding communities.');

    let inserted = 0;
    for (const [index, community] of communities.entries()) {
      const existing = await runner.query('SELECT id FROM communities WHERE name = $1 LIMIT 1', [community.name]);
      if (existing.length) continue;

      await runner.query(
        `INSERT INTO communities
          ("name", "rules", "tier", "joinPolicy", "points", "color", "initials", "location", "motto", "facebookUrl", "dpUrl", "coverUrl", "creatorId")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          community.name,
          `Official rules for ${community.name}: Fair play strictly enforced. Results require match evidence. Respect community discipline.`,
          community.tier,
          community.joinPolicy,
          community.points,
          community.color,
          community.initials,
          community.location,
          community.motto,
          `https://facebook.com/${community.name.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
          crests[index % crests.length],
          covers[index % covers.length],
          creator.id,
        ],
      );
      inserted++;
    }

    await runner.commitTransaction();
    console.log(`Added ${inserted} communities; existing communities were left unchanged.`);
  } catch (error) {
    await runner.rollbackTransaction();
    throw error;
  } finally {
    await runner.release();
    await dataSource.destroy();
  }
}

seedCommunities().catch((error: unknown) => {
  console.error('Community seeding failed:', error);
  process.exitCode = 1;
});
