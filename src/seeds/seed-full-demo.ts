import 'dotenv/config';
import bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { DataSource, type QueryRunner } from 'typeorm';
import { ClubStage, JoinPolicy } from '../clubs/enums/club.enum.js';
import {
  CommunityJoinRequestStatus,
  CommunityJoinRequestType,
  CommunityTier,
} from '../communities/enums/community.enum.js';
import {
  ParticipantStatus,
  ParticipantType,
  TournamentPreset,
  TournamentStatus,
  TournamentType,
} from '../tournaments/enums/tournament.enum.js';
import { EfootballPosition } from '../users/enums/efootball-position.enum.js';
import { ClubRole, CommunityRole, LineupStatus, SquadTeam } from '../users/enums/user-attributes.enum.js';

/**
 * Full demo dataset: 10 communities (all officer roles), 52 clubs (6 officials + 20 players each,
 * Main + Academy teams), club/community join requests, tournaments with lineups and brackets,
 * and notifications. Existing clubless users fill club player slots first; every user's
 * password is reset to PASSWORD. Runs in one transaction and refuses to run twice.
 */

const PASSWORD = '123456';
const PLAYERS_PER_CLUB = 20;
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

const dataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  synchronize: false,
});

// ---------------------------------------------------------------- reference data

const COMMUNITIES = [
  { name: 'Padma Premier League', tier: CommunityTier.FEATURED, joinPolicy: JoinPolicy.APPROVAL, location: 'Dhaka', color: '#2563eb', motto: 'The river runs through every rivalry.' },
  { name: 'Meghna eFootball Alliance', tier: CommunityTier.VERIFIED, joinPolicy: JoinPolicy.INSTANT, location: 'Narayanganj', color: '#0891b2', motto: 'United by the Meghna, divided by the scoreline.' },
  { name: 'Jamuna Masters Circuit', tier: CommunityTier.FEATURED, joinPolicy: JoinPolicy.APPROVAL, location: 'Rajshahi', color: '#7c3aed', motto: 'Only masters survive the circuit.' },
  { name: 'Sundarbans Esports Collective', tier: CommunityTier.REGIONAL, joinPolicy: JoinPolicy.INSTANT, location: 'Khulna', color: '#15803d', motto: 'Fierce as the Royal Bengal.' },
  { name: 'Karnaphuli Cup Series', tier: CommunityTier.VERIFIED, joinPolicy: JoinPolicy.APPROVAL, location: 'Chattogram', color: '#ea580c', motto: 'Port city football, every weekend.' },
  { name: 'Teesta Valley League', tier: CommunityTier.REGIONAL, joinPolicy: JoinPolicy.INSTANT, location: 'Rangpur', color: '#0d9488', motto: 'Northern grit, northern glory.' },
  { name: 'Surma Pro Circuit', tier: CommunityTier.VERIFIED, joinPolicy: JoinPolicy.APPROVAL, location: 'Sylhet', color: '#16a34a', motto: 'Tea-garden calm, penalty-box chaos.' },
  { name: 'Buriganga Legends Hub', tier: CommunityTier.OPEN, joinPolicy: JoinPolicy.INSTANT, location: 'Dhaka', color: '#b45309', motto: 'Old Dhaka heart, new-gen skill.' },
  { name: 'Kirtankhola Coastal League', tier: CommunityTier.OPEN, joinPolicy: JoinPolicy.APPROVAL, location: 'Barishal', color: '#0284c7', motto: 'Where the tides decide the title.' },
  { name: 'Brahmaputra Rising Stars', tier: CommunityTier.NEW, joinPolicy: JoinPolicy.INSTANT, location: 'Mymensingh', color: '#db2777', motto: 'Tomorrow’s champions start here.' },
];

const CLUB_NAMES = [
  'Dhaka Dynamos', 'Chattogram Sharks', 'Sylhet Tigers', 'Rajshahi Royals FC', 'Khulna Kraken', 'Barishal Boatmen',
  'Rangpur Rhinos', 'Mymensingh Mustangs', 'Gazipur Gladiators', 'Narayanganj Navigators', 'Cumilla Comets', 'Bogura Bulls',
  'Jashore Jaguars', 'Dinajpur Dragons', 'Moulvibazar Monarchs', "Cox's Bazar Corsairs", 'Tangail Thunder', 'Pabna Panthers',
  'Noakhali Nomads', 'Feni Foxes', 'Kushtia Knights', 'Faridpur Falcons', 'Savar Spartans', 'Uttara United',
  'Mirpur Mavericks', 'Dhanmondi Dragons', 'Gulshan Galaxy', 'Banani Blaze', 'Motijheel Meteors', 'Old Dhaka Owls',
  'Tejgaon Titans', 'Mohammadpur Mariners', 'Bashundhara Blues', 'Agrabad Arrows', 'Halishahar Hawks', 'Patenga Pirates',
  'Zindabazar Zealots', 'Shahjalal Stallions', 'Padma Pumas', 'Meghna Marauders', 'Jamuna Jets', 'Teesta Troopers',
  'Surma Strikers', 'Karnaphuli Kings', 'Sundarbans Scorpions', 'Kaptai Crusaders', 'Sreemangal Samurai', 'Bandarban Bears',
  'Rangamati Rangers', 'Kuakata Waves', 'Mongla Mariners', 'Brahmaputra Blazers',
];

const LOCATIONS: Array<[district: string, division: string]> = [
  ['Dhaka', 'Dhaka'], ['Chattogram', 'Chattogram'], ['Sylhet', 'Sylhet'], ['Rajshahi', 'Rajshahi'],
  ['Khulna', 'Khulna'], ['Barishal', 'Barishal'], ['Rangpur', 'Rangpur'], ['Mymensingh', 'Mymensingh'],
  ['Gazipur', 'Dhaka'], ['Narayanganj', 'Dhaka'], ['Cumilla', 'Chattogram'], ['Bogura', 'Rajshahi'],
  ['Jashore', 'Khulna'], ['Dinajpur', 'Rangpur'], ['Moulvibazar', 'Sylhet'], ["Cox's Bazar", 'Chattogram'],
];

const MOTTOS = [
  'Fly high, strike hard.', 'One club, one heartbeat.', 'Pressure makes diamonds.', 'Play the badge, not the name.',
  'Every pass with purpose.', 'Born to press.', 'Glory through discipline.', 'Win together, lose together.',
];

const COLORS = ['#E63946', '#1D3557', '#2A9D8F', '#F4A261', '#8338EC', '#FF006E', '#3A86FF', '#06D6A0', '#FFB703', '#EF476F', '#118AB2', '#6A4C93'];
const STAGES = Object.values(ClubStage).filter((s) => s !== ClubStage.NA);

const CRESTS = [
  '/Bangladesh/bangladesh-football-federation-seeklogo.png', '/barca/barca-logo-transparent.png',
  '/real madrid/real-madrid-logo-preview.png', '/manu/manu-logo-transparent.png',
  '/arsenal/arsenal-logo-transparent.png', '/chelsea/chelsea-logo-transparent.png',
  '/man city/mancity-logo-transparent.png', '/bayern/bayern-logo-transparent.png',
  '/atleteco di madrid/atletico-logo-transparent.png', '/efootball.png',
];
const COVERS = [
  '/community 1.jpg', '/community 2.jpg', '/community 3.jpg', '/barca.jpg', '/Manu.jpg', '/real.jpg',
  '/arsenal/Arsenal HD Wallpaper For Desktop iPhone iPad And Android.jpg',
  '/chelsea/Chelsea Fc Wallpaper By Shangeeth Sugumar Shangeeths On.jpg', '/bayern/wallppaer.jpg',
  '/man city/Manchester City Vs United Full Time Win Derby.jpg', '/atleteco di madrid/wallpaperflare.com_wallpaper.jpg',
];

const FIRST_NAMES = [
  'Abir', 'Adnan', 'Ahnaf', 'Akash', 'Alif', 'Amin', 'Anik', 'Arafat', 'Arman', 'Ashik', 'Ayaan', 'Azim',
  'Fahim', 'Faisal', 'Farhad', 'Habib', 'Hasib', 'Imtiaz', 'Irfan', 'Jamil', 'Jubayer', 'Kamrul', 'Mahin', 'Mamun',
  'Mehedi', 'Mishu', 'Mizan', 'Nafis', 'Nahid', 'Naim', 'Nasif', 'Omar', 'Parvez', 'Rafi', 'Rahat', 'Raihan',
  'Rashed', 'Riyad', 'Sajid', 'Sakib', 'Samin', 'Shafin', 'Shuvo', 'Tahmid', 'Tanim', 'Yasin', 'Zarif', 'Zayan',
];
const LAST_NAMES = [
  'Ahmed', 'Alam', 'Ali', 'Bhuiyan', 'Chowdhury', 'Das', 'Haque', 'Hasan', 'Hossain', 'Islam', 'Kabir', 'Karim',
  'Khan', 'Mahmud', 'Miah', 'Mollah', 'Rahman', 'Rana', 'Reza', 'Roy', 'Saha', 'Sarkar', 'Sheikh', 'Siddique',
  'Talukder', 'Uddin', 'Zaman', 'Molla', 'Patwary', 'Sikder',
];
const DEVICES: Array<[name: string, model: string]> = [
  ['Samsung Galaxy', 'S23 Ultra'], ['iPhone', '14 Pro'], ['Xiaomi Redmi', 'Note 12'], ['Realme', 'GT Neo 3'],
  ['PlayStation', 'PS5'], ['PC', 'Steam'], ['OnePlus', '11R'], ['Poco', 'X5 Pro'],
];

// 4-3-3 slot order (matches FORMATION_SLOT_MAP['4-3-3']) with the conventional shirt numbers.
const MAIN_XI: Array<{ pos: EfootballPosition; shirt: number }> = [
  { pos: EfootballPosition.GK, shirt: 1 }, { pos: EfootballPosition.LB, shirt: 3 },
  { pos: EfootballPosition.CB, shirt: 4 }, { pos: EfootballPosition.CB, shirt: 5 },
  { pos: EfootballPosition.RB, shirt: 2 }, { pos: EfootballPosition.DMF, shirt: 6 },
  { pos: EfootballPosition.CMF, shirt: 8 }, { pos: EfootballPosition.CMF, shirt: 14 },
  { pos: EfootballPosition.LWF, shirt: 11 }, { pos: EfootballPosition.CF, shirt: 10 },
  { pos: EfootballPosition.RWF, shirt: 7 },
];
const CAPTAIN_SLOT = 9; // CF
const VICE_CAPTAIN_SLOT = 3; // CB
const MAIN_SUBS = 5;
const ACADEMY_PLAYERS = PLAYERS_PER_CLUB - (MAIN_XI.length - 2) - MAIN_SUBS; // players besides captain/VC

const OFFICER_ROLES = [
  CommunityRole.PRESIDENT,
  CommunityRole.VICE_PRESIDENT,
  CommunityRole.TEAM_MANAGER,
  CommunityRole.HEAD_OF_DISCIPLINE,
  CommunityRole.SCOUT,
];
const CLUB_AUTHORITY_ROLES = [ClubRole.PRESIDENT, ClubRole.GENERAL_SECRETARY, ClubRole.MANAGER, ClubRole.CAPTAIN, ClubRole.VICE_CAPTAIN];
const COMMUNITY_AUTHORITY_ROLES = [CommunityRole.PRESIDENT, CommunityRole.VICE_PRESIDENT, CommunityRole.TEAM_MANAGER];

// ---------------------------------------------------------------- helpers

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260927);
const randInt = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const pick = <T>(items: readonly T[]) => items[Math.floor(rand() * items.length)];

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function initials(name: string) {
  const parts = name.replace(/[^A-Za-z ]/g, '').split(/\s+/).filter(Boolean);
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts.slice(0, 3).map((p) => p[0]).join('')).toUpperCase();
}

let nameCursor = 0;
function nextPersonName() {
  const first = FIRST_NAMES[nameCursor % FIRST_NAMES.length];
  const last = LAST_NAMES[Math.floor(nameCursor / FIRST_NAMES.length) % LAST_NAMES.length];
  nameCursor += 7; // co-prime stride so consecutive people look unrelated
  return `${first} ${last}`;
}

type Row = Record<string, unknown>;

async function insertMany(runner: QueryRunner, table: string, rows: Row[]) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const chunkSize = Math.max(1, Math.floor(60000 / cols.length));
  for (let i = 0; i < rows.length; i += chunkSize) {
    const params: unknown[] = [];
    const values = rows.slice(i, i + chunkSize).map(
      (row) => `(${cols.map((c) => { params.push(row[c]); return `$${params.length}`; }).join(', ')})`,
    );
    await runner.query(
      `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES ${values.join(', ')}`,
      params,
    );
  }
}

// ---------------------------------------------------------------- in-memory model

type Person = {
  userId: string;
  profileId: string;
  name: string;
  email: string;
  inGameId: string;
  existing: boolean;
  profile: {
    gamePosition: string | null;
    squadTeam: SquadTeam | null;
    shirtNumber: number | null;
    points: number;
    clubId: string | null;
    teamId: string | null;
    lineupStatus: LineupStatus;
    clubRole: ClubRole | null;
    communityId: string | null;
    communityRole: CommunityRole | null;
  };
};

type ClubModel = {
  id: string;
  name: string;
  row: Row;
  mainTeamId: string;
  academyTeamId: string;
  members: Person[];
  byRole: Map<ClubRole, Person>;
  starters: Person[];
  subs: Person[];
  communityIds: string[];
};

type CommunityModel = {
  id: string;
  name: string;
  joinPolicy: JoinPolicy;
  officers: Map<CommunityRole, Person>;
  clubIds: string[];
};

const newUsers: Row[] = [];
const newProfiles: Person[] = [];

function makeNewPerson(email: string, name: string, district: [string, string], passwordHash: string): Person {
  const userId = randomUUID();
  const inGameId = `ALQ-${randInt(100000, 999999)}`;
  const [deviceName, deviceModel] = pick(DEVICES);
  newUsers.push({
    id: userId,
    name,
    email,
    password: passwordHash,
    inGameId,
    phoneNumber: `+8801${randInt(3, 9)}${randInt(10000000, 99999999)}`,
    country: 'Bangladesh',
    division: district[1],
    district: district[0],
    deviceName,
    deviceModel,
    bio: `eFootball player from ${district[0]}.`,
    facebookUrl: `https://facebook.com/${slug(name)}.${randInt(10, 999)}`,
    verificationLevel: String(pick([0, 0, 1, 1, 2, 3])),
  });
  const person: Person = {
    userId,
    profileId: randomUUID(),
    name,
    email,
    inGameId,
    existing: false,
    profile: {
      gamePosition: null, squadTeam: null, shirtNumber: null, points: randInt(100, 600),
      clubId: null, teamId: null, lineupStatus: LineupStatus.NONE, clubRole: null,
      communityId: null, communityRole: null,
    },
  };
  newProfiles.push(person);
  return person;
}

// ---------------------------------------------------------------- seed

async function seedFullDemo() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.');
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();

  try {
    const already = await runner.query('SELECT id FROM clubs WHERE name = ANY($1) LIMIT 1', [CLUB_NAMES]);
    const alreadyComm = await runner.query('SELECT id FROM communities WHERE name = ANY($1) LIMIT 1', [COMMUNITIES.map((c) => c.name)]);
    if (already.length || alreadyComm.length) {
      throw new Error('Full demo data already exists (a demo club or community name is taken). Aborting without changes.');
    }

    const now = Date.now();

    // 1. Existing clubless users become club players (their community links are left intact).
    const existingRows: Array<{ userId: string; profileId: string; name: string; email: string; inGameId: string | null; communityId: string | null; communityRole: CommunityRole | null; points: number }> =
      await runner.query(
        `SELECT u.id AS "userId", p.id AS "profileId", u.name, u.email, u."inGameId", p."communityId", p."communityRole", p.points
         FROM efootball_profiles p JOIN users u ON u.id = p."userId"
         WHERE p."clubId" IS NULL ORDER BY u."createdAt" ASC, u.email ASC`,
      );
    const existingPool: Person[] = existingRows.map((r) => ({
      userId: r.userId,
      profileId: r.profileId,
      name: r.name,
      email: r.email,
      inGameId: r.inGameId ?? `ALQ-${randInt(100000, 999999)}`,
      existing: true,
      profile: {
        gamePosition: null, squadTeam: null, shirtNumber: null, points: r.points,
        clubId: null, teamId: null, lineupStatus: LineupStatus.NONE, clubRole: null,
        communityId: r.communityId, communityRole: r.communityRole,
      },
    }));

    // 2. Communities + officers.
    const communities: CommunityModel[] = [];
    const communityRows: Row[] = [];
    for (const [index, c] of COMMUNITIES.entries()) {
      const id = randomUUID();
      const loc = LOCATIONS.find(([d]) => d === c.location) ?? LOCATIONS[0];
      const officers = new Map<CommunityRole, Person>();
      for (const role of OFFICER_ROLES) {
        const person = makeNewPerson(`demo-${slug(c.name)}-${slug(role)}@allync.com`, nextPersonName(), loc, passwordHash);
        person.profile.communityId = id;
        person.profile.communityRole = role;
        person.profile.points = randInt(1200, 2500);
        officers.set(role, person);
      }
      communities.push({ id, name: c.name, joinPolicy: c.joinPolicy, officers, clubIds: [] });
      communityRows.push({
        id,
        name: c.name,
        rules: `1. Kick-off on time or forfeit after 10 minutes.\n2. Screenshot or clip evidence is required for every result.\n3. One account per player — no smurfing.\n4. Respect officials; disputes go to the Head of Discipline.`,
        dpUrl: CRESTS[index % CRESTS.length],
        coverUrl: COVERS[index % COVERS.length],
        color: c.color,
        initials: initials(c.name),
        points: randInt(900, 5000),
        tier: c.tier,
        joinPolicy: c.joinPolicy,
        location: c.location,
        motto: c.motto,
        facebookUrl: `https://facebook.com/${slug(c.name).replace(/-/g, '')}`,
        creatorId: officers.get(CommunityRole.PRESIDENT)!.userId,
      });
    }

    // 3. Clubs, teams, members.
    const clubs: ClubModel[] = [];
    const teamRows: Row[] = [];
    for (const [index, name] of CLUB_NAMES.entries()) {
      const id = randomUUID();
      const loc = LOCATIONS[index % LOCATIONS.length];
      const mainTeamId = randomUUID();
      const academyTeamId = randomUUID();
      clubs.push({
        id,
        name,
        mainTeamId,
        academyTeamId,
        members: [],
        byRole: new Map(),
        starters: [],
        subs: [],
        communityIds: [],
        row: {
          id,
          name,
          color: COLORS[index % COLORS.length],
          initials: initials(name),
          dpUrl: CRESTS[index % CRESTS.length],
          coverUrl: COVERS[index % COVERS.length],
          description: `${name} — competitive eFootball club based in ${loc[0]}.`,
          points: randInt(200, 3500),
          joinPolicy: index % 3 === 1 ? JoinPolicy.APPROVAL : JoinPolicy.INSTANT,
          minRoster: 11,
          maxRoster: 30,
          communityIds: '[]', // filled after community enrolment
          stage: STAGES[index % STAGES.length],
          location: loc[0],
          motto: MOTTOS[index % MOTTOS.length],
          facebookUrl: `https://facebook.com/${slug(name).replace(/-/g, '')}`,
        },
      });
      teamRows.push(
        { id: mainTeamId, name: `${name} Main`, formation: '4-3-3', clubId: id },
        { id: academyTeamId, name: `${name} Academy`, formation: '4-3-3', clubId: id },
      );
    }

    // Build the 26 slots of every club. Player slots are filled round-robin across clubs so the
    // existing users are spread evenly instead of packing the first few clubs.
    type Slot = { club: ClubModel; kind: 'official' | 'player'; apply: (p: Person) => void; email: string };
    const slotsByClub: Slot[][] = clubs.map((club) => {
      const clubSlug = slug(club.name);
      const base = (p: Person, role: ClubRole) => {
        p.profile.clubId = club.id;
        p.profile.clubRole = role;
        club.members.push(p);
        if (role !== ClubRole.PLAYER) club.byRole.set(role, p);
      };
      const slots: Slot[] = [];
      const official = (role: ClubRole, extra: (p: Person) => void) =>
        slots.push({ club, kind: 'official', email: `demo-${clubSlug}-${slug(role)}@allync.com`, apply: (p) => { base(p, role); extra(p); } });

      official(ClubRole.PRESIDENT, (p) => { p.profile.squadTeam = SquadTeam.MAIN; p.profile.points = randInt(1200, 2200); });
      official(ClubRole.GENERAL_SECRETARY, (p) => { p.profile.squadTeam = SquadTeam.MAIN; p.profile.points = randInt(1000, 1800); });
      official(ClubRole.MANAGER, (p) => {
        p.profile.squadTeam = SquadTeam.MAIN; p.profile.teamId = club.mainTeamId; p.profile.shirtNumber = 99;
        p.profile.points = randInt(1000, 1800);
      });

      let playerNo = 0;
      const player = (role: ClubRole, extra: (p: Person) => void) => {
        const email = role === ClubRole.PLAYER
          ? `demo-${clubSlug}-player-${String(++playerNo).padStart(2, '0')}@allync.com`
          : `demo-${clubSlug}-${slug(role)}@allync.com`;
        slots.push({ club, kind: role === ClubRole.PLAYER ? 'player' : 'official', email, apply: (p) => { base(p, role); extra(p); } });
      };

      MAIN_XI.forEach((slot, i) => {
        const role = i === CAPTAIN_SLOT ? ClubRole.CAPTAIN : i === VICE_CAPTAIN_SLOT ? ClubRole.VICE_CAPTAIN : ClubRole.PLAYER;
        player(role, (p) => {
          p.profile.squadTeam = SquadTeam.MAIN;
          p.profile.teamId = club.mainTeamId;
          p.profile.gamePosition = slot.pos;
          p.profile.shirtNumber = slot.shirt;
          p.profile.lineupStatus = LineupStatus.STARTER;
          p.profile.points = randInt(800, 1600);
          club.starters.push(p);
        });
      });
      for (let i = 0; i < MAIN_SUBS; i++) {
        player(ClubRole.PLAYER, (p) => {
          p.profile.squadTeam = SquadTeam.MAIN;
          p.profile.teamId = club.mainTeamId;
          p.profile.gamePosition = null; // subs are positionless until subbed on
          p.profile.shirtNumber = 12 + i;
          p.profile.lineupStatus = LineupStatus.SUB;
          p.profile.points = randInt(600, 1100);
          club.subs.push(p);
        });
      }
      player(ClubRole.ACADEMY_CAPTAIN, (p) => {
        p.profile.squadTeam = SquadTeam.ACADEMY;
        p.profile.teamId = club.academyTeamId;
        p.profile.shirtNumber = 17;
        p.profile.points = randInt(600, 1000);
      });
      for (let i = 0; i < ACADEMY_PLAYERS; i++) {
        player(ClubRole.PLAYER, (p) => {
          p.profile.squadTeam = SquadTeam.ACADEMY;
          p.profile.teamId = club.academyTeamId;
          p.profile.shirtNumber = 18 + i;
          p.profile.points = randInt(300, 800);
        });
      }
      return slots;
    });

    // Assign existing users to player slots round-robin, then create new users for the rest.
    const assigned = new Map<Slot, Person>();
    const maxPlayers = Math.max(...slotsByClub.map((s) => s.filter((x) => x.kind === 'player').length));
    let poolCursor = 0;
    for (let n = 0; n < maxPlayers && poolCursor < existingPool.length; n++) {
      for (const slots of slotsByClub) {
        if (poolCursor >= existingPool.length) break;
        const slot = slots.filter((s) => s.kind === 'player')[n];
        if (slot) assigned.set(slot, existingPool[poolCursor++]);
      }
    }
    for (const [clubIndex, slots] of slotsByClub.entries()) {
      for (const slot of slots) {
        const person = assigned.get(slot)
          ?? makeNewPerson(slot.email, nextPersonName(), LOCATIONS[clubIndex % LOCATIONS.length], passwordHash);
        slot.apply(person);
      }
    }

    // 4. Club → community enrolment (primary + some secondary), mirroring executeClubJoin().
    const communityClubRows: Row[] = [];
    clubs.forEach((club, i) => {
      const targets = [i % communities.length];
      if (i % 3 === 0) targets.push((i + 4) % communities.length);
      if (i % 7 === 0) targets.push((i + 7) % communities.length);
      for (const t of [...new Set(targets)]) {
        const community = communities[t];
        club.communityIds.push(community.id);
        community.clubIds.push(club.id);
        communityClubRows.push({ communityId: community.id, clubId: club.id });
      }
      club.row.communityIds = JSON.stringify(club.communityIds);
    });

    const memberships = new Map<string, { communityId: string; profileId: string; role: CommunityRole; isDirectMember: boolean; sourceClubIds: string[]; joinedAt: Date }>();
    const key = (c: string, p: string) => `${c}:${p}`;
    const addDirect = (communityId: string, person: Person, role: CommunityRole) => {
      const existing = memberships.get(key(communityId, person.profileId));
      if (existing) {
        existing.isDirectMember = true;
        existing.role = role;
      } else {
        memberships.set(key(communityId, person.profileId), {
          communityId, profileId: person.profileId, role, isDirectMember: true, sourceClubIds: [], joinedAt: new Date(now - randInt(20, 90) * DAY),
        });
      }
      if (!person.profile.communityId) {
        person.profile.communityId = communityId;
        person.profile.communityRole = role;
      }
    };

    for (const community of communities) {
      for (const [role, officer] of community.officers) addDirect(community.id, officer, role);
    }
    for (const club of clubs) {
      for (const communityId of club.communityIds) {
        for (const person of club.members) {
          const m = memberships.get(key(communityId, person.profileId));
          if (m) {
            if (!m.sourceClubIds.includes(club.id)) m.sourceClubIds.push(club.id);
          } else {
            memberships.set(key(communityId, person.profileId), {
              communityId, profileId: person.profileId, role: CommunityRole.MEMBER, isDirectMember: false,
              sourceClubIds: [club.id], joinedAt: new Date(now - randInt(10, 60) * DAY),
            });
          }
          if (!person.profile.communityId) {
            person.profile.communityId = communityId;
            person.profile.communityRole = CommunityRole.MEMBER;
          }
        }
      }
    }
    // A few players also join other communities individually (a user can be in many communities).
    communities.forEach((community, ci) => {
      const outsiders = clubs
        .filter((club) => !club.communityIds.includes(community.id))
        .slice(ci, ci + 4)
        .map((club) => club.subs[0]);
      for (const person of outsiders) addDirect(community.id, person, CommunityRole.MEMBER);
    });

    // 5. Free agents (no club) + join requests.
    const freeAgents: Person[] = Array.from({ length: 15 }, (_, i) =>
      makeNewPerson(`demo-freeagent-${String(i + 1).padStart(2, '0')}@allync.com`, nextPersonName(), LOCATIONS[i % LOCATIONS.length], passwordHash),
    );

    const clubRequestRows: Row[] = [];
    const communityRequestRows: Row[] = [];
    const notificationRows: Row[] = [];
    const notify = (userId: string, title: string, message: string, type: string, link: string | null, read = false, at = new Date(now)) =>
      notificationRows.push({ id: randomUUID(), userId, title, message, type, link, read, createdAt: at, updatedAt: at });
    const clubLink = (c: ClubModel) => `/dashboard/efootball/clubs/${c.id}`;
    const communityLink = (c: CommunityModel) => `/dashboard/efootball/community/${c.id}`;

    const approvalClubs = clubs.filter((c) => c.row.joinPolicy === JoinPolicy.APPROVAL);
    // Pending club requests (free agents 1-8) → notify club authorities.
    for (let i = 0; i < 8; i++) {
      const club = approvalClubs[i];
      const fa = freeAgents[i];
      const at = new Date(now - randInt(1, 48) * HOUR);
      clubRequestRows.push({ id: randomUUID(), clubId: club.id, requesterUserId: fa.userId, status: 'pending', reviewedByUserId: null, createdAt: at, updatedAt: at });
      for (const role of CLUB_AUTHORITY_ROLES) {
        const auth = club.byRole.get(role);
        if (auth) notify(auth.userId, 'Club Join Request', `${fa.name} requested to join ${club.name}`, 'club_join_request', `${clubLink(club)}/requests`, false, at);
      }
    }
    // Rejected club requests (free agents 9-10).
    for (let i = 8; i < 10; i++) {
      const club = approvalClubs[i];
      const fa = freeAgents[i];
      const at = new Date(now - randInt(3, 10) * DAY);
      clubRequestRows.push({ id: randomUUID(), clubId: club.id, requesterUserId: fa.userId, status: 'rejected', reviewedByUserId: club.byRole.get(ClubRole.PRESIDENT)!.userId, createdAt: at, updatedAt: at });
      notify(fa.userId, 'Club Join Request Rejected', `Your request to join ${club.name} was declined.`, 'club_join_request', clubLink(club), true, at);
    }
    // Approved club requests: the last academy player of some approval clubs joined via approval.
    for (let i = 0; i < 6; i++) {
      const club = approvalClubs[i];
      const member = club.members[club.members.length - 1];
      const at = new Date(now - randInt(15, 40) * DAY);
      clubRequestRows.push({ id: randomUUID(), clubId: club.id, requesterUserId: member.userId, status: 'approved', reviewedByUserId: club.byRole.get(ClubRole.PRESIDENT)!.userId, createdAt: at, updatedAt: at });
      notify(member.userId, 'Club Join Request Approved', `Your request to join ${club.name} has been approved! Welcome to the club.`, 'club_join_request', clubLink(club), true, at);
    }

    const approvalCommunities = communities.filter((c) => c.joinPolicy === JoinPolicy.APPROVAL);
    const notifyCommunityAuthorities = (community: CommunityModel, title: string, message: string, at: Date) => {
      for (const role of COMMUNITY_AUTHORITY_ROLES) {
        const officer = community.officers.get(role);
        if (officer) notify(officer.userId, title, message, 'community_join_request', `${communityLink(community)}/requests`, false, at);
      }
    };
    // Pending player requests (free agents 1-5, one pending request each).
    for (let i = 0; i < 5; i++) {
      const community = approvalCommunities[i % approvalCommunities.length];
      const fa = freeAgents[i];
      const at = new Date(now - randInt(1, 72) * HOUR);
      communityRequestRows.push({ id: randomUUID(), communityId: community.id, requesterUserId: fa.userId, targetType: CommunityJoinRequestType.PLAYER, clubId: null, status: CommunityJoinRequestStatus.PENDING, reviewedByUserId: null, createdAt: at, updatedAt: at });
      notifyCommunityAuthorities(community, 'Community Join Request', `${fa.name} requested to join ${community.name}`, at);
    }
    // Approved player requests (free agents 11-12) → direct members.
    for (let i = 10; i < 12; i++) {
      const community = approvalCommunities[i % approvalCommunities.length];
      const fa = freeAgents[i];
      const at = new Date(now - randInt(5, 20) * DAY);
      communityRequestRows.push({ id: randomUUID(), communityId: community.id, requesterUserId: fa.userId, targetType: CommunityJoinRequestType.PLAYER, clubId: null, status: CommunityJoinRequestStatus.APPROVED, reviewedByUserId: community.officers.get(CommunityRole.PRESIDENT)!.userId, createdAt: at, updatedAt: at });
      addDirect(community.id, fa, CommunityRole.MEMBER);
      notify(fa.userId, 'Community Join Request Approved', `Your request to join ${community.name} has been approved!`, 'community_join_request', communityLink(community), true, at);
    }
    // Rejected player request (free agent 13).
    {
      const community = approvalCommunities[0];
      const fa = freeAgents[12];
      const at = new Date(now - 6 * DAY);
      communityRequestRows.push({ id: randomUUID(), communityId: community.id, requesterUserId: fa.userId, targetType: CommunityJoinRequestType.PLAYER, clubId: null, status: CommunityJoinRequestStatus.REJECTED, reviewedByUserId: community.officers.get(CommunityRole.VICE_PRESIDENT)!.userId, createdAt: at, updatedAt: at });
      notify(fa.userId, 'Community Join Request Rejected', `Your request to join ${community.name} was declined.`, 'community_join_request', communityLink(community), true, at);
    }
    // Club → community requests: 3 pending, 1 rejected (clubs not already in the target community).
    {
      let made = 0;
      for (const community of approvalCommunities) {
        const club = clubs.find((c) => !c.communityIds.includes(community.id) && !communityRequestRows.some((r) => r.clubId === c.id));
        if (!club || made >= 4) break;
        const president = club.byRole.get(ClubRole.PRESIDENT)!;
        const rejected = made === 3;
        const at = new Date(now - (rejected ? 8 * DAY : randInt(2, 30) * HOUR));
        communityRequestRows.push({
          id: randomUUID(), communityId: community.id, requesterUserId: president.userId, targetType: CommunityJoinRequestType.CLUB, clubId: club.id,
          status: rejected ? CommunityJoinRequestStatus.REJECTED : CommunityJoinRequestStatus.PENDING,
          reviewedByUserId: rejected ? community.officers.get(CommunityRole.PRESIDENT)!.userId : null, createdAt: at, updatedAt: at,
        });
        if (rejected) {
          notify(president.userId, 'Community Join Request Rejected', `Your request to join ${community.name} was declined.`, 'community_join_request', communityLink(community), true, at);
        } else {
          notifyCommunityAuthorities(community, 'Community Join Request', `${club.name} requested to join ${community.name}`, at);
        }
        made++;
      }
    }

    // 6. Tournaments (hosted by each community's President; leaders never participate).
    const tournamentRows: Row[] = [];
    const participantRows: Row[] = [];
    const roster = (p: Person, position: string | null) => ({ profileId: p.profileId, name: p.name, inGameId: p.inGameId, position, shirtNumber: p.profile.shirtNumber });
    const lineupFor = (club: ClubModel, starters: number, subs: number) => ({
      teamId: club.mainTeamId,
      teamName: `${club.name} Main`,
      starters: club.starters.slice(0, starters).map((p) => roster(p, p.profile.gamePosition)),
      substitutes: [...club.subs, ...club.starters.slice(starters)].slice(0, subs).map((p) => roster(p, null)),
    });
    const tournamentLink = (id: string) => `/dashboard/efootball/tournaments/${id}`;

    communities.forEach((community, ci) => {
      const president = community.officers.get(CommunityRole.PRESIDENT)!;
      const communityClubs = clubs.filter((c) => community.clubIds.includes(c.id));

      // A. Upcoming CvC 11v11, registration open.
      {
        const id = randomUUID();
        const startAt = new Date(now + (7 + ci) * DAY);
        startAt.setUTCHours(14, 0, 0, 0);
        const entrants = communityClubs.slice(0, 16);
        tournamentRows.push({
          id, name: `${community.name} Champions Cup`, description: `Club vs club knockout for every club enrolled in ${community.name}.`,
          type: TournamentType.CVC, status: TournamentStatus.REGISTRATION_OPEN, preset: TournamentPreset.ELEVEN_V_ELEVEN,
          startersCount: 11, subsCount: 5, maxParticipants: 16, entryFeeBdt: 500, prizePoolBdt: 6000,
          registrationDeadline: new Date(startAt.getTime() - 3 * DAY), teamSubmissionDeadline: new Date(startAt.getTime() - 2 * HOUR),
          startAt, endAt: null, bracket: null, communityId: community.id, creatorId: president.userId,
          createdAt: new Date(now - 5 * DAY), updatedAt: new Date(now - 5 * DAY),
        });
        entrants.forEach((club, k) => {
          const registrant = club.byRole.get(ClubRole.PRESIDENT)!;
          const submitted = k % 2 === 0;
          const submitter = club.byRole.get(ClubRole.GENERAL_SECRETARY)!;
          participantRows.push({
            id: randomUUID(), tournamentId: id, participantType: ParticipantType.CLUB, clubId: club.id, userId: null,
            registeredByUserId: registrant.userId,
            status: submitted ? ParticipantStatus.LINEUP_SUBMITTED : ParticipantStatus.REGISTERED,
            lineup: submitted ? JSON.stringify(lineupFor(club, 11, 5)) : null,
            submittedAt: submitted ? new Date(now - randInt(1, 48) * HOUR) : null,
            submittedByUserId: submitted ? submitter.userId : null,
          });
          notify(registrant.userId, 'Tournament Registration Confirmed', `${club.name} is registered for ${community.name} Champions Cup.`, 'system', tournamentLink(id), k % 3 === 0, new Date(now - randInt(1, 4) * DAY));
        });
      }

      if (ci < 5) {
        // B. Ongoing PvP 1v1 with a quarter-final bracket.
        const id = randomUUID();
        const startAt = new Date(now - DAY);
        const players = [...memberships.values()]
          .filter((m) => m.communityId === community.id && m.role === CommunityRole.MEMBER && !m.isDirectMember)
          .slice(0, 8)
          .map((m) => [...clubs.flatMap((c) => c.members)].find((p) => p.profileId === m.profileId)!);
        const parts = players.map((p) => ({ id: randomUUID(), person: p }));
        const bracket = [0, 1, 2, 3].map((m) => {
          const a = parts[m * 2];
          const b = parts[m * 2 + 1];
          const done = m < 2;
          const sa = done ? randInt(1, 4) : null;
          const sb = done ? (sa! === 1 ? 0 : randInt(0, sa! - 1)) : null;
          return {
            id: `match-${m + 1}-${id.slice(0, 8)}`, round: 'Quarter-final', matchNumber: m + 1,
            participantA: { id: a.id, name: a.person.name, dpUrl: null, score: sa },
            participantB: { id: b.id, name: b.person.name, dpUrl: null, score: sb },
            winnerId: done ? a.id : null, status: done ? 'completed' : m === 2 ? 'ongoing' : 'pending',
          };
        });
        tournamentRows.push({
          id, name: `${community.name} 1v1 Masters`, description: 'Individual knockout — best player takes the crown.',
          type: TournamentType.PVP, status: TournamentStatus.ONGOING, preset: TournamentPreset.CUSTOM,
          startersCount: 1, subsCount: 0, maxParticipants: 8, entryFeeBdt: 100, prizePoolBdt: 700,
          registrationDeadline: new Date(startAt.getTime() - 2 * DAY), teamSubmissionDeadline: new Date(startAt.getTime() - 2 * HOUR),
          startAt, endAt: null, bracket: JSON.stringify(bracket), communityId: community.id, creatorId: president.userId,
          createdAt: new Date(now - 10 * DAY), updatedAt: new Date(now - DAY),
        });
        for (const { id: pid, person } of parts) {
          participantRows.push({
            id: pid, tournamentId: id, participantType: ParticipantType.PLAYER, clubId: null, userId: person.userId,
            registeredByUserId: person.userId, status: ParticipantStatus.CONFIRMED, lineup: null,
            submittedAt: null, submittedByUserId: null,
          });
          notify(person.userId, 'Tournament Started', `${community.name} 1v1 Masters is live — check your quarter-final.`, 'system', tournamentLink(id), false, startAt);
        }
      } else if (communityClubs.length >= 4) {
        // C. Completed CvC 8v8 with full bracket.
        const id = randomUUID();
        const startAt = new Date(now - (20 + ci) * DAY);
        const four = communityClubs.slice(0, 4).map((club) => ({ id: randomUUID(), club }));
        const side = (x: (typeof four)[number], score: number) => ({ id: x.id, name: x.club.name, dpUrl: x.club.row.dpUrl as string, score });
        const [a, b, c, d] = four;
        const bracket = [
          { id: `match-1-${id.slice(0, 8)}`, round: 'Semi-final', matchNumber: 1, participantA: side(a, 2), participantB: side(b, 1), winnerId: a.id, status: 'completed' },
          { id: `match-2-${id.slice(0, 8)}`, round: 'Semi-final', matchNumber: 2, participantA: side(c, 0), participantB: side(d, 3), winnerId: d.id, status: 'completed' },
          { id: `match-3-${id.slice(0, 8)}`, round: 'Final', matchNumber: 3, participantA: side(a, 3), participantB: side(d, 1), winnerId: a.id, status: 'completed' },
        ];
        tournamentRows.push({
          id, name: `${community.name} Super Cup`, description: '8-a-side club showdown. Season finale.',
          type: TournamentType.CVC, status: TournamentStatus.COMPLETED, preset: TournamentPreset.EIGHT_V_EIGHT,
          startersCount: 8, subsCount: 4, maxParticipants: 4, entryFeeBdt: 300, prizePoolBdt: 1000,
          registrationDeadline: new Date(startAt.getTime() - 4 * DAY), teamSubmissionDeadline: new Date(startAt.getTime() - 2 * HOUR),
          startAt, endAt: new Date(startAt.getTime() + 5 * HOUR), bracket: JSON.stringify(bracket),
          communityId: community.id, creatorId: president.userId,
          createdAt: new Date(startAt.getTime() - 10 * DAY), updatedAt: new Date(startAt.getTime() + 5 * HOUR),
        });
        for (const { id: pid, club } of four) {
          participantRows.push({
            id: pid, tournamentId: id, participantType: ParticipantType.CLUB, clubId: club.id, userId: null,
            registeredByUserId: club.byRole.get(ClubRole.PRESIDENT)!.userId, status: ParticipantStatus.CONFIRMED,
            lineup: JSON.stringify(lineupFor(club, 8, 4)), submittedAt: new Date(startAt.getTime() - DAY),
            submittedByUserId: club.byRole.get(ClubRole.MANAGER)!.userId,
          });
        }
        notify(a.club.byRole.get(ClubRole.PRESIDENT)!.userId, 'Tournament Champions!', `${a.club.name} won the ${community.name} Super Cup.`, 'system', tournamentLink(id), true, new Date(startAt.getTime() + 5 * HOUR));
      }
    });

    // 7. Write everything in FK order.
    await runner.query('UPDATE users SET password = $1', [passwordHash]);
    await insertMany(runner, 'users', newUsers);
    await insertMany(runner, 'communities', communityRows);
    await insertMany(runner, 'clubs', clubs.map((c) => c.row));
    await insertMany(runner, 'teams', teamRows.map((t) => ({ ...t, captainProfileId: null })));

    const profileRow = (p: Person): Row => ({
      id: p.profileId, userId: p.userId, konamiUid: String(randInt(100000000, 999999999)),
      gamePosition: p.profile.gamePosition, squadTeam: p.profile.squadTeam, shirtNumber: p.profile.shirtNumber,
      points: p.profile.points, clubId: p.profile.clubId, teamId: p.profile.teamId, lineupStatus: p.profile.lineupStatus,
      clubRole: p.profile.clubRole, communityId: p.profile.communityId, communityRole: p.profile.communityRole,
    });
    await insertMany(runner, 'efootball_profiles', newProfiles.map(profileRow));

    const movedExisting = existingPool.filter((p) => p.profile.clubId);
    for (const p of movedExisting) {
      await runner.query(
        `UPDATE efootball_profiles SET "gamePosition" = $2, "squadTeam" = $3, "shirtNumber" = $4, points = $5, "clubId" = $6,
           "teamId" = $7, "lineupStatus" = $8, "clubRole" = $9, "communityId" = $10, "communityRole" = $11, "updatedAt" = now()
         WHERE id = $1`,
        [p.profileId, p.profile.gamePosition, p.profile.squadTeam, p.profile.shirtNumber, p.profile.points, p.profile.clubId,
          p.profile.teamId, p.profile.lineupStatus, p.profile.clubRole, p.profile.communityId, p.profile.communityRole],
      );
    }

    for (const club of clubs) {
      await runner.query('UPDATE teams SET "captainProfileId" = $2 WHERE id = $1', [club.mainTeamId, club.byRole.get(ClubRole.CAPTAIN)!.profileId]);
      await runner.query('UPDATE teams SET "captainProfileId" = $2 WHERE id = $1', [club.academyTeamId, club.byRole.get(ClubRole.ACADEMY_CAPTAIN)!.profileId]);
    }

    await insertMany(runner, 'community_clubs', communityClubRows);
    await insertMany(runner, 'community_members', [...memberships.values()].map((m) => ({
      id: randomUUID(), communityId: m.communityId, profileId: m.profileId, role: m.role,
      isDirectMember: m.isDirectMember, sourceClubIds: JSON.stringify(m.sourceClubIds), joinedAt: m.joinedAt, updatedAt: m.joinedAt,
    })));
    await insertMany(runner, 'club_join_requests', clubRequestRows);
    await insertMany(runner, 'community_join_requests', communityRequestRows);
    await insertMany(runner, 'tournaments', tournamentRows);
    await insertMany(runner, 'tournament_participants', participantRows);
    await insertMany(runner, 'notifications', notificationRows);

    await runner.commitTransaction();

    const members = clubs.reduce((n, c) => n + c.members.length, 0);
    console.log('Full demo seed complete:');
    console.log(`- ${communities.length} communities (${communities.length * OFFICER_ROLES.length} officers)`);
    console.log(`- ${clubs.length} clubs, ${teamRows.length} teams, ${members} club members (${movedExisting.length} existing users placed)`);
    console.log(`- ${newUsers.length} new users, ${freeAgents.length} free agents; all user passwords set to ${PASSWORD}`);
    console.log(`- ${communityClubRows.length} club enrolments, ${memberships.size} community memberships`);
    console.log(`- ${clubRequestRows.length} club join requests, ${communityRequestRows.length} community join requests`);
    console.log(`- ${tournamentRows.length} tournaments, ${participantRows.length} participants, ${notificationRows.length} notifications`);
  } catch (error) {
    await runner.rollbackTransaction();
    throw error;
  } finally {
    await runner.release();
    await dataSource.destroy();
  }
}

seedFullDemo().catch((error: unknown) => {
  console.error('Full demo seeding failed:', error);
  process.exitCode = 1;
});
