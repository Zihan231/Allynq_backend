import 'dotenv/config';
import bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';

const dataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  synchronize: false,
});

const FIRST_NAMES = [
  'Aarif', 'Abdullah', 'Abir', 'Adnan', 'Afif', 'Ahmed', 'Ahsan', 'Akash', 'Al-Amin', 'Ali',
  'Aminul', 'Anamul', 'Arafat', 'Arham', 'Arif', 'Arman', 'Ashik', 'Ashraful', 'Asif', 'Biplob',
  'Delwar', 'Ebadot', 'Ehsan', 'Fahad', 'Fahim', 'Farhan', 'Habib', 'Hafiz', 'Hamid', 'Hasan',
  'Hasibul', 'Hossain', 'Humayun', 'Ibrahim', 'Imran', 'Imtiaz', 'Iqbal', 'Ismail', 'Jahid', 'Jaker',
  'Jamil', 'Kamal', 'Kamrul', 'Karim', 'Khaled', 'Liton', 'Mahadi', 'Mahbub', 'Mahedi', 'Mahfuz',
  'Mahir', 'Mahmud', 'Mahmudul', 'Mamun', 'Maruf', 'Mashrafe', 'Masum', 'Mehedi', 'Mehidy', 'Mizanur',
  'Mohammad', 'Mominul', 'Monir', 'Morshed', 'Mosaddek', 'Mostafa', 'Mubashir', 'Murad', 'Mushfiqur', 'Mustafizur',
  'Nabil', 'Nadeem', 'Nafis', 'Naim', 'Najmul', 'Nasir', 'Nasum', 'Nazmul', 'Niaz', 'Nurul',
  'Parvez', 'Rabiul', 'Radwan', 'Rafi', 'Rafiqul', 'Rafiul', 'Rafsan', 'Rahim', 'Raihan', 'Rajib',
  'Rakib', 'Rashid', 'Rayhan', 'Riad', 'Riaz', 'Rifat', 'Ripon', 'Rishad', 'Riyad', 'Rony',
  'Rubel', 'Sabbir', 'Sadik', 'Sadman', 'Saiful', 'Saikat', 'Sajjad', 'Sakib', 'Salahuddin', 'Salman',
  'Samir', 'Sarwar', 'Sayed', 'Shahadat', 'Shahidul', 'Shahriar', 'Shakib', 'Shamim', 'Shanto', 'Sharif',
  'Shawon', 'Shefat', 'Shihab', 'Shohag', 'Shoriful', 'Shuvo', 'Siam', 'Sikandar', 'Sohel', 'Soumya',
  'Sowrav', 'Subrata', 'Suhrawadi', 'Sumon', 'Tahmid', 'Taijul', 'Tamim', 'Tanjim', 'Tanvir', 'Tanzid',
  'Tanzim', 'Tariqul', 'Taskin', 'Taufiq', 'Touhid', 'Towhid', 'Walid', 'Wasim', 'Yasin', 'Yasir',
  'Zahid', 'Zakir', 'Zaman', 'Zayan', 'Ziaur', 'Zishan', 'Zubair',
];

const LAST_NAMES = [
  'Ahmed', 'Alam', 'Ali', 'Bhuiyan', 'Chowdhury', 'Dewan', 'Hasan', 'Haque', 'Hossain', 'Howlader',
  'Islam', 'Karim', 'Khan', 'Mahmud', 'Mazumder', 'Miah', 'Mirza', 'Mollah', 'Mondal', 'Munshi',
  'Patwary', 'Rahman', 'Roy', 'Saha', 'Sardar', 'Sarker', 'Sheikh', 'Siddique', 'Talukdar', 'Uddin',
];

const POSITIONS = ['GK', 'CB', 'LB', 'RB', 'DMF', 'CMF', 'AMF', 'RWF', 'LWF', 'CF', 'SS'];
const DISTRICTS = [
  'Dhaka', 'Chittagong', 'Sylhet', 'Rajshahi', 'Khulna', 'Barisal', 'Rangpur', 'Mymensingh',
  'Comilla', 'Gazipur', 'Narayanganj', 'Bogra', 'Jessore', 'Dinajpur', 'Cox\'s Bazar', 'Feni',
];
const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

const COMMUNITY_DEFS = [
  { name: 'Dhaka Elite Community', tier: 'Featured', joinPolicy: 'approval', points: 3200, color: '#4c8dff', initials: 'DE', location: 'Dhaka', motto: 'One community, every club held to the same standard.' },
  { name: 'Sylhet Strikers Community', tier: 'Regional', joinPolicy: 'instant', points: 1950, color: '#34d399', initials: 'SS', location: 'Sylhet', motto: 'Small community, big welcome.' },
  { name: 'Chittagong Kings Arena', tier: 'Featured', joinPolicy: 'approval', points: 2850, color: '#f59e0b', initials: 'CK', location: 'Chittagong', motto: 'Port City pride on the pitch.' },
  { name: 'Rajshahi Royals Community', tier: 'Verified', joinPolicy: 'instant', points: 2100, color: '#ec4899', initials: 'RR', location: 'Rajshahi', motto: 'Silk City passion in competitive gaming.' },
  { name: 'Khulna Titans Esports', tier: 'Verified', joinPolicy: 'approval', points: 2400, color: '#8b5cf6', initials: 'KT', location: 'Khulna', motto: 'Fierce competition from the delta.' },
  { name: 'Barisal Warriors League', tier: 'Regional', joinPolicy: 'instant', points: 1650, color: '#06b6d4', initials: 'BW', location: 'Barisal', motto: 'Riverine strength in every tournament.' },
  { name: 'Rangpur Riders Gaming', tier: 'Regional', joinPolicy: 'instant', points: 1750, color: '#10b981', initials: 'RG', location: 'Rangpur', motto: 'Northern power unleashing on eFootball.' },
  { name: 'Mymensingh Mavericks', tier: 'Open', joinPolicy: 'instant', points: 1400, color: '#6366f1', initials: 'MM', location: 'Mymensingh', motto: 'Brahmaputra\'s finest competing together.' },
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
  { name: 'Cox\'s Bazar Coastal League', tier: 'New', joinPolicy: 'instant', points: 980, color: '#0ea5e9', initials: 'CC', location: 'Cox\'s Bazar', motto: 'Where the ocean meets the competition.' },
  { name: 'Dinajpur Dynamos Esports', tier: 'New', joinPolicy: 'instant', points: 890, color: '#16a34a', initials: 'DD', location: 'Dinajpur', motto: 'Northern youth rising to the top.' },
  { name: 'Feni Falcons Esports Guild', tier: 'New', joinPolicy: 'instant', points: 810, color: '#ca8a04', initials: 'FF', location: 'Feni', motto: 'Rising through grassroots battles.' },
];

const CLUB_NAMES = [
  'Red Falcons', 'Blue Tigers', 'Chittagong Kings', 'Sylhet Strikers FC', 'Uttara Gunners',
  'Gulshan Barons', 'Mirpur Titans', 'Sylhet Comets', 'Dhanmondi Dragons', 'Motijheel Warriors',
  'Rajshahi Royals FC', 'Khulna Knights', 'Barisal Bulls', 'Rangpur Rangers', 'Mymensingh Lions',
  'Comilla Victors', 'Bogra Bisons', 'Narayanganj Nautical FC', 'Gazipur Giants', 'Jessore Jaguars',
  'Dinajpur Defenders', 'Feni Phoenix', 'Cox\'s Bazar Waves', 'Tangail Thunder', 'Kushtia Cobras',
  'Pabna Panthers', 'Jamalpur Jackals', 'Faridpur Fighters', 'Noakhali Navigators', 'Sirajganj Spartans',
  'Brahmanbaria Blitz', 'Madaripur Monarchs', 'Gopalganj Guardians', 'Chandpur Champions', 'Sunamganj Storm',
  'Moulvibazar Mavericks', 'Habiganj Hawks', 'Natore Knights', 'Naogaon Ninjas', 'Chapai Crusaders',
  'Kurigram Kings', 'Lalmonirhat Leopards', 'Nilphamari Nomads', 'Gaibandha Gryphons', 'Thakurgaon Titans',
  'Panchagarh Pioneers', 'Bagerhat Buccaneers', 'Satkhira Scorpions', 'Jhenaidah Jets', 'Magura Meteors',
  'Meherpur Mustangs', 'Chuadanga Cheetahs', 'Pirojpur Pirates', 'Jhalokati Juggernauts', 'Barguna Barracudas',
];

const CLUB_COLORS = [
  '#E63946', '#1D3557', '#F59E0B', '#10B981', '#6366F1', '#EC4899', '#8B5CF6', '#06B6D4',
  '#EF4444', '#3B82F6', '#14B8A6', '#84CC16', '#F97316', '#A855F7', '#D97706', '#059669',
  '#475569', '#E11D48', '#2563EB', '#0D9488',
];

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

async function seedMassive() {
  await dataSource.initialize();
  console.log('Database connected. Starting massive seed...');

  const defaultPasswordHash = await bcrypt.hash('password123', 10);
  console.log('Password hash generated.');

  // 1. Seed or retrieve existing Admin/Creator User
  let [admin] = await dataSource.query(`SELECT id FROM users ORDER BY "createdAt" ASC LIMIT 1`);
  if (!admin) {
    const res = await dataSource.query(
      `INSERT INTO users ("id", "name", "email", "password", "verificationLevel")
       VALUES (uuid_generate_v4(), 'Admin User', 'admin@allynq.com', $1, '3')
       RETURNING id`,
      [defaultPasswordHash],
    );
    admin = res[0];
  }
  const creatorId = admin.id;

  // 2. Seed 25 Communities
  console.log(`Seeding ${COMMUNITY_DEFS.length} Communities...`);
  const communityMap = new Map<string, string>(); // name -> id

  for (const c of COMMUNITY_DEFS) {
    const existing = await dataSource.query(`SELECT id FROM communities WHERE name = $1`, [c.name]);
    if (existing.length > 0) {
      communityMap.set(c.name, existing[0].id);
    } else {
      const res = await dataSource.query(
        `INSERT INTO communities
         ("id", "name", "rules", "tier", "joinPolicy", "points", "color", "initials", "location", "motto", "facebookUrl", "creatorId")
         VALUES (uuid_generate_v4(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id`,
        [
          c.name,
          `Official rules for ${c.name}: Fair play strictly enforced. Results require match evidence. Respect community discipline.`,
          c.tier,
          c.joinPolicy,
          c.points,
          c.color,
          c.initials,
          c.location,
          c.motto,
          `https://facebook.com/${c.name.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
          creatorId,
        ],
      );
      communityMap.set(c.name, res[0].id);
    }
  }
  const communityIds = Array.from(communityMap.values());
  console.log(`✓ Communities ready: ${communityIds.length}`);

  // 3. Seed 55 Clubs
  console.log(`Seeding ${CLUB_NAMES.length} Clubs...`);
  const clubMap = new Map<string, string>(); // name -> id

  for (let i = 0; i < CLUB_NAMES.length; i++) {
    const name = CLUB_NAMES[i];
    const existing = await dataSource.query(`SELECT id FROM clubs WHERE name = $1`, [name]);
    if (existing.length > 0) {
      clubMap.set(name, existing[0].id);
    } else {
      const color = CLUB_COLORS[i % CLUB_COLORS.length];
      const initials = getInitials(name);
      const location = DISTRICTS[i % DISTRICTS.length];
      const res = await dataSource.query(
        `INSERT INTO clubs
         ("id", "name", "color", "initials", "description", "points", "joinPolicy", "minRoster", "maxRoster", "location", "motto", "facebookUrl")
         VALUES (uuid_generate_v4(), $1, $2, $3, $4, $5, 'instant', 4, 30, $6, $7, $8)
         RETURNING id`,
        [
          name,
          color,
          initials,
          `Official eFootball club representing ${name}.`,
          800 + (i * 35) % 1500,
          location,
          `Victory through unity and precision.`,
          `https://facebook.com/${name.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
        ],
      );
      clubMap.set(name, res[0].id);
    }
  }
  const clubIds = Array.from(clubMap.values());
  console.log(`✓ Clubs ready: ${clubIds.length}`);

  // 4. Enroll Clubs into Communities (1-3 communities per club)
  console.log('Enrolling Clubs into Communities...');
  for (let i = 0; i < clubIds.length; i++) {
    const clubId = clubIds[i];
    const assignedCommCount = 1 + (i % 3); // 1, 2, or 3 communities
    const assignedCommIds: string[] = [];

    for (let cIdx = 0; cIdx < assignedCommCount; cIdx++) {
      const targetCommId = communityIds[(i * 2 + cIdx) % communityIds.length];
      assignedCommIds.push(targetCommId);
      await dataSource.query(
        `INSERT INTO community_clubs ("communityId", "clubId")
         VALUES ($1, $2)
         ON CONFLICT ("communityId", "clubId") DO NOTHING`,
        [targetCommId, clubId],
      );
    }

    await dataSource.query(
      `UPDATE clubs SET "communityIds" = $1 WHERE id = $2`,
      [JSON.stringify(assignedCommIds), clubId],
    );
  }
  console.log('✓ Clubs enrolled into communities.');

  // 5. Seed 700 Users with EfootballProfiles
  const TOTAL_USERS_TARGET = 700;
  console.log(`Seeding ${TOTAL_USERS_TARGET} realistic Users & eFootball Profiles...`);

  // We assign 10 players per club = 550 club players, plus 150 Free Agents
  // Clean up any orphaned users without profile from previous aborted runs
  await dataSource.query(`DELETE FROM users WHERE id NOT IN (SELECT "userId" FROM efootball_profiles) AND email LIKE 'player%@allync.com'`);

  const existingUsersCountRes = await dataSource.query(`SELECT COUNT(*) as count FROM users`);
  const currentUsersCount = parseInt(existingUsersCountRes[0].count, 10);
  const needed = Math.max(0, TOTAL_USERS_TARGET - currentUsersCount);
  console.log(`Current users in DB: ${currentUsersCount}. Creating ${needed} additional users...`);

  const createdUserProfiles: { userId: string; profileId: string; clubId: string | null; clubRole: string | null }[] = [];

  // Batch insert users in chunks of 100 for high performance
  const CHUNK_SIZE = 100;
  let createdCount = 0;

  for (let batchStart = 0; batchStart < needed; batchStart += CHUNK_SIZE) {
    const batchEnd = Math.min(batchStart + CHUNK_SIZE, needed);
    const countInBatch = batchEnd - batchStart;

    const valuesSql: string[] = [];
    const params: any[] = [];
    let pIdx = 1;

    for (let i = 0; i < countInBatch; i++) {
      const globalIndex = currentUsersCount + batchStart + i;
      const fName = pick(FIRST_NAMES);
      const lName = pick(LAST_NAMES);
      const fullName = `${fName} ${lName}`;
      const email = `player${globalIndex + 1}@allync.com`;
      const district = pick(DISTRICTS);
      const blood = pick(BLOOD_GROUPS);
      const inGameId = `EF-${100000 + globalIndex}`;
      const phone = `+88017${String(10000000 + globalIndex).slice(1)}`;

      valuesSql.push(
        `(uuid_generate_v4(), $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++}, $${pIdx++})`,
      );
      params.push(fullName, email, defaultPasswordHash, district, district, blood, inGameId, phone);
    }

    const insertedUsers = await dataSource.query(
      `INSERT INTO users
       ("id", "name", "email", "password", "district", "division", "bloodGroup", "inGameId", "phoneNumber")
       VALUES ${valuesSql.join(', ')}
       RETURNING id, name`,
      params,
    );

    // Create efootball_profiles for this batch
    const profileValuesSql: string[] = [];
    const profileParams: any[] = [];
    let profIdx = 1;

    for (let i = 0; i < insertedUsers.length; i++) {
      const u = insertedUsers[i];
      const globalIndex = currentUsersCount + batchStart + i;

      // Distribute to club or free agent
      let clubId: string | null = null;
      let clubRole: string | null = null;
      let squadTeam: string | null = null;
      let lineupStatus = 'None';
      let shirtNumber: number | null = null;
      const gamePosition = pick(POSITIONS);
      const points = 500 + (globalIndex % 40) * 25;

      // Club allocation: 10 players per club (index 0 to 549)
      if (globalIndex < clubIds.length * 10) {
        const clubIndex = Math.floor(globalIndex / 10);
        const playerWithinClub = globalIndex % 10;
        clubId = clubIds[clubIndex];

        if (playerWithinClub === 0) clubRole = 'President';
        else if (playerWithinClub === 1) clubRole = 'General Secretary';
        else if (playerWithinClub === 2) clubRole = 'Captain';
        else if (playerWithinClub === 3) clubRole = 'Manager';
        else clubRole = 'Player';

        squadTeam = playerWithinClub < 7 ? 'Main' : 'Academy';
        lineupStatus = playerWithinClub < 5 ? 'Starter' : 'Sub';
        shirtNumber = playerWithinClub + 1;
      }

      profileValuesSql.push(
        `(uuid_generate_v4(), $${profIdx++}, $${profIdx++}, $${profIdx++}, $${profIdx++}, $${profIdx++}, $${profIdx++}, $${profIdx++}, $${profIdx++})`,
      );
      profileParams.push(
        u.id,
        clubId,
        clubRole,
        squadTeam,
        lineupStatus,
        shirtNumber,
        gamePosition,
        points,
      );
    }

    const insertedProfiles = await dataSource.query(
      `INSERT INTO efootball_profiles
       ("id", "userId", "clubId", "clubRole", "squadTeam", "lineupStatus", "shirtNumber", "gamePosition", "points")
       VALUES ${profileValuesSql.join(', ')}
       RETURNING id, "userId", "clubId", "clubRole"`,
      profileParams,
    );

    for (const prof of insertedProfiles) {
      createdUserProfiles.push({
        userId: prof.userId,
        profileId: prof.id,
        clubId: prof.clubId,
        clubRole: prof.clubRole,
      });
    }

    createdCount += countInBatch;
    console.log(`  Processed ${createdCount} / ${needed} users...`);
  }

  // 6. Synchronize Community Memberships
  console.log('Synchronizing Community Memberships for all players...');

  // A. Auto-join club members into their clubs' communities
  await dataSource.query(`
    INSERT INTO community_members ("id", "communityId", "profileId", "role", "isDirectMember", "sourceClubIds")
    SELECT
      uuid_generate_v4(),
      cc."communityId",
      p."id" as "profileId",
      CASE WHEN p."clubRole" = 'President' THEN 'President'::public.efootball_profiles_communityrole_enum ELSE 'Member'::public.efootball_profiles_communityrole_enum END,
      CASE WHEN p."clubRole" = 'President' THEN true ELSE false END,
      json_build_array(p."clubId")::jsonb
    FROM efootball_profiles p
    INNER JOIN community_clubs cc ON cc."clubId" = p."clubId"
    ON CONFLICT ("communityId", "profileId") DO UPDATE
    SET "sourceClubIds" = (
      SELECT json_agg(DISTINCT elem)::jsonb
      FROM jsonb_array_elements_text(community_members."sourceClubIds" || json_build_array(EXCLUDED."sourceClubIds"->>0)::jsonb) as elem
    )
  `);
  console.log('✓ Auto-joined club members into community_members.');

  // B. Enroll free agents directly into 1-2 communities as individual members
  const freeAgents = await dataSource.query(`
    SELECT id FROM efootball_profiles
    WHERE "clubId" IS NULL
  `);

  if (freeAgents.length > 0) {
    console.log(`Enrolling ${freeAgents.length} free agents directly into communities...`);
    for (let i = 0; i < freeAgents.length; i++) {
      const fa = freeAgents[i];
      const targetCommId = communityIds[i % communityIds.length];
      await dataSource.query(`
        INSERT INTO community_members ("id", "communityId", "profileId", "role", "isDirectMember", "sourceClubIds")
        VALUES (uuid_generate_v4(), $1, $2, 'Member', true, '[]'::jsonb)
        ON CONFLICT ("communityId", "profileId") DO NOTHING
      `, [targetCommId, fa.id]);

      // Set active communityId on free agent profile
      await dataSource.query(`
        UPDATE efootball_profiles
        SET "communityId" = $1, "communityRole" = 'Member'
        WHERE id = $2 AND "communityId" IS NULL
      `, [targetCommId, fa.id]);
    }
  }

  // C. Update communityId on club players to point to their primary community
  await dataSource.query(`
    UPDATE efootball_profiles p
    SET
      "communityId" = cm."communityId",
      "communityRole" = cm."role"
    FROM community_members cm
    WHERE cm."profileId" = p."id"
      AND p."communityId" IS NULL
  `);
  console.log('✓ Primary community links updated on profiles.');

  // 7. Verify and Print Summary Stats
  const [totalUsers] = await dataSource.query(`SELECT COUNT(*) as count FROM users`);
  const [totalClubs] = await dataSource.query(`SELECT COUNT(*) as count FROM clubs`);
  const [totalComms] = await dataSource.query(`SELECT COUNT(*) as count FROM communities`);
  const [totalMemberships] = await dataSource.query(`SELECT COUNT(*) as count FROM community_members`);
  const [totalEnrollments] = await dataSource.query(`SELECT COUNT(*) as count FROM community_clubs`);

  console.log('\n========================================');
  console.log('🎉 MASSIVE SEED COMPLETE!');
  console.log('========================================');
  console.log(`• Total Users:               ${totalUsers.count}`);
  console.log(`• Total Clubs:               ${totalClubs.count}`);
  console.log(`• Total Communities:         ${totalComms.count}`);
  console.log(`• Club-Community Links:      ${totalEnrollments.count}`);
  console.log(`• Total Community Members:   ${totalMemberships.count}`);
  console.log('========================================\n');

  await dataSource.destroy();
}

seedMassive().catch((err) => {
  console.error('Massive seed failed:', err);
  process.exit(1);
});
