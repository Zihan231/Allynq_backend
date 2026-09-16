import 'dotenv/config';
import bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { Club } from '../clubs/entities/club.entity.js';
import { Team } from '../clubs/entities/team.entity.js';
import { ClubStage, JoinPolicy } from '../clubs/enums/club.enum.js';
import { EfootballProfile } from '../users/entities/efootball-profile.entity.js';
import { User } from '../users/entities/user.entity.js';
import { ClubRole, LineupStatus, SquadTeam } from '../users/enums/user-attributes.enum.js';
import { EfootballPosition } from '../users/enums/efootball-position.enum.js';

const dataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  entities: [User, EfootballProfile, Club, Team],
  synchronize: false,
});

async function seed() {
  await dataSource.initialize();
  console.log('Database connected for seeding.');

  const clubRepo = dataSource.getRepository(Club);
  const teamRepo = dataSource.getRepository(Team);
  const userRepo = dataSource.getRepository(User);
  const profileRepo = dataSource.getRepository(EfootballProfile);

  // 1. Create or find Demo Club "Red Falcons"
  let club = await clubRepo.findOne({ where: { name: 'Red Falcons' } });
  if (!club) {
    club = clubRepo.create({
      name: 'Red Falcons',
      color: '#E63946',
      initials: 'RF',
      description: 'Official Red Falcons eFootball Club',
      points: 120,
      joinPolicy: JoinPolicy.INSTANT,
      minRoster: 4,
      maxRoster: 100,
      communityIds: [],
      stage: ClubStage.FOUNDATION,
      location: 'Dhaka',
      motto: 'Fly High, Strike Hard',
      facebookUrl: 'https://facebook.com/redfalcons',
    });
    club = await clubRepo.save(club);
    console.log(`Created club: ${club.name} (${club.id})`);
  } else {
    club.maxRoster = 100;
    club = await clubRepo.save(club);
    console.log(`Found existing club: ${club.name} (${club.id}), maxRoster set to 100`);
  }

  // 2. Create or find Team A under Red Falcons
  let teamA = await teamRepo.findOne({ where: { name: 'Team A', clubId: club.id } });
  if (!teamA) {
    teamA = teamRepo.create({
      name: 'Team A',
      clubId: club.id,
    });
    teamA = await teamRepo.save(teamA);
    console.log(`Created team: ${teamA.name} (${teamA.id})`);
  }

  const defaultPasswordHash = await bcrypt.hash('password123', 10);

  // 3. Define 50 Members:
  // - 11 Starters for Team A (Full 4-3-3 starting lineup)
  // - 5 Substitutes for Team A (Positionless on bench)
  // - 1 Manager (Tamim Iqbal)
  // - 33 Free Club Players (teamId: null, reserves/free for other teams)

  const startersList = [
    { name: 'Imran Kabir', email: 'p@allync.com', role: ClubRole.PRESIDENT, pos: EfootballPosition.GK, shirt: 1, points: 1100 },
    { name: 'Asif Mahmud', email: 'pl5@allync.com', role: ClubRole.PLAYER, pos: EfootballPosition.LB, shirt: 3, points: 830 },
    { name: 'Farhan Ahmed', email: 'vc@allync.com', role: ClubRole.VICE_CAPTAIN, pos: EfootballPosition.CB, shirt: 5, points: 1050 },
    { name: 'Nayeem Islam', email: 'pl3@allync.com', role: ClubRole.PLAYER, pos: EfootballPosition.CB, shirt: 4, points: 850 },
    { name: 'Rafiul Karim', email: 'pl4@allync.com', role: ClubRole.PLAYER, pos: EfootballPosition.RB, shirt: 2, points: 820 },
    { name: 'Jahid Hossain', email: 'pl6@allync.com', role: ClubRole.PLAYER, pos: EfootballPosition.DMF, shirt: 6, points: 880 },
    { name: 'Nusrat Jahan', email: 'se@allync.com', role: ClubRole.GENERAL_SECRETARY, pos: EfootballPosition.CMF, shirt: 8, points: 950 },
    { name: 'Tanvir Ahmed', email: 'pl8@allync.com', role: ClubRole.PLAYER, pos: EfootballPosition.CMF, shirt: 14, points: 740 },
    { name: 'Mahmudul Hasan', email: 'pl2@allync.com', role: ClubRole.PLAYER, pos: EfootballPosition.LWF, shirt: 11, points: 900 },
    { name: 'Rakib Hasan', email: 'c@allync.com', role: ClubRole.CAPTAIN, pos: EfootballPosition.CF, shirt: 10, points: 1500 },
    { name: 'Shakib Al', email: 'pl1@allync.com', role: ClubRole.PLAYER, pos: EfootballPosition.RWF, shirt: 7, points: 800 },
  ];

  const subsList = [
    { name: 'Sadman Anik', email: 'pl7@allync.com', shirt: 9, points: 760 },
    { name: 'Sabbir Rahman', email: 'ac@allync.com', shirt: 16, points: 700 },
    { name: 'Riazul Islam', email: 'pl9@allync.com', shirt: 17, points: 720 },
    { name: 'Mehedi Hasan', email: 'pl10@allync.com', shirt: 18, points: 750 },
    { name: 'Kazi Anik', email: 'pl11@allync.com', shirt: 19, points: 730 },
  ];

  const freePlayersNames = [
    'Zubair Ahmed', 'Arif Hossain', 'Tariqul Islam', 'Shahidul Alam', 'Rubel Hossain',
    'Al-Amin Hossain', 'Mustafizur Rahman', 'Soumya Sarkar', 'Liton Das', 'Taskin Ahmed',
    'Taijul Islam', 'Shoriful Islam', 'Nasum Ahmed', 'Mehidy Hasan', 'Najmul Shanto',
    'Towhid Hridoy', 'Tanzim Sakib', 'Rishad Hossain', 'Jaker Ali', 'Shamim Hossain',
    'Hasan Mahmud', 'Khaled Ahmed', 'Mosaddek Hossain', 'Afif Hossain', 'Mohammad Naim',
    'Anamul Haque', 'Yasir Ali', 'Ebadot Hossain', 'Nasir Hossain', 'Ziaur Rahman',
    'Suhrawadi Shuvo', 'Arafat Sunny', 'Enamul Haque Jr',
  ];

  let captainProfile: EfootballProfile | null = null;

  // A. Seed Starters (11)
  console.log('Seeding 11 Starters for Team A...');
  for (const s of startersList) {
    let user = await userRepo.findOne({ where: { email: s.email } });
    if (!user) {
      user = userRepo.create({
        name: s.name,
        email: s.email,
        password: defaultPasswordHash,
      });
      user = await userRepo.save(user);
    } else {
      user.name = s.name;
      user.password = defaultPasswordHash;
      await userRepo.save(user);
    }

    let profile = await profileRepo.findOne({ where: { userId: user.id } });
    if (!profile) {
      profile = profileRepo.create({
        userId: user.id,
        clubId: club.id,
        teamId: teamA.id,
        clubRole: s.role,
        shirtNumber: s.shirt,
        squadTeam: SquadTeam.MAIN,
        gamePosition: s.pos,
        lineupStatus: LineupStatus.STARTER,
        points: s.points,
      });
    } else {
      profile.clubId = club.id;
      profile.teamId = teamA.id;
      profile.clubRole = s.role;
      profile.shirtNumber = s.shirt;
      profile.squadTeam = SquadTeam.MAIN;
      profile.gamePosition = s.pos;
      profile.lineupStatus = LineupStatus.STARTER;
      profile.points = s.points;
    }
    profile = await profileRepo.save(profile);

    if (s.role === ClubRole.CAPTAIN) {
      captainProfile = profile;
    }
  }

  // B. Seed Substitutes (5)
  console.log('Seeding 5 Substitutes for Team A (positionless)...');
  for (const sub of subsList) {
    let user = await userRepo.findOne({ where: { email: sub.email } });
    if (!user) {
      user = userRepo.create({
        name: sub.name,
        email: sub.email,
        password: defaultPasswordHash,
      });
      user = await userRepo.save(user);
    } else {
      user.name = sub.name;
      user.password = defaultPasswordHash;
      await userRepo.save(user);
    }

    let profile = await profileRepo.findOne({ where: { userId: user.id } });
    if (!profile) {
      profile = profileRepo.create({
        userId: user.id,
        clubId: club.id,
        teamId: teamA.id,
        clubRole: ClubRole.PLAYER,
        shirtNumber: sub.shirt,
        squadTeam: SquadTeam.MAIN,
        gamePosition: null, // Sub is positionless until subbed
        lineupStatus: LineupStatus.SUB,
        points: sub.points,
      });
    } else {
      profile.clubId = club.id;
      profile.teamId = teamA.id;
      profile.clubRole = ClubRole.PLAYER;
      profile.shirtNumber = sub.shirt;
      profile.squadTeam = SquadTeam.MAIN;
      profile.gamePosition = null;
      profile.lineupStatus = LineupStatus.SUB;
      profile.points = sub.points;
    }
    await profileRepo.save(profile);
  }

  // C. Seed Manager (Tamim Iqbal)
  console.log('Seeding Manager Tamim Iqbal...');
  let mgrUser = await userRepo.findOne({ where: { email: 'm@allync.com' } });
  if (!mgrUser) {
    mgrUser = userRepo.create({
      name: 'Tamim Iqbal',
      email: 'm@allync.com',
      password: defaultPasswordHash,
    });
    mgrUser = await userRepo.save(mgrUser);
  } else {
    mgrUser.name = 'Tamim Iqbal';
    mgrUser.password = defaultPasswordHash;
    await userRepo.save(mgrUser);
  }

  let mgrProfile = await profileRepo.findOne({ where: { userId: mgrUser.id } });
  if (!mgrProfile) {
    mgrProfile = profileRepo.create({
      userId: mgrUser.id,
      clubId: club.id,
      teamId: teamA.id,
      clubRole: ClubRole.MANAGER,
      shirtNumber: 99,
      squadTeam: SquadTeam.MAIN,
      gamePosition: null,
      lineupStatus: LineupStatus.NONE,
      points: 1200,
    });
  } else {
    mgrProfile.clubId = club.id;
    mgrProfile.teamId = teamA.id;
    mgrProfile.clubRole = ClubRole.MANAGER;
    mgrProfile.shirtNumber = 99;
    mgrProfile.squadTeam = SquadTeam.MAIN;
    mgrProfile.gamePosition = null;
    mgrProfile.lineupStatus = LineupStatus.NONE;
    mgrProfile.points = 1200;
  }
  await profileRepo.save(mgrProfile);

  // D. Seed 33 Free Club Players (teamId: null, free for new teams)
  console.log('Seeding 33 Free Club Players for Red Falcons...');
  for (let i = 0; i < freePlayersNames.length; i++) {
    const pName = freePlayersNames[i];
    const pEmail = `free${i + 1}@allync.com`;
    let user = await userRepo.findOne({ where: { email: pEmail } });
    if (!user) {
      user = userRepo.create({
        name: pName,
        email: pEmail,
        password: defaultPasswordHash,
      });
      user = await userRepo.save(user);
    } else {
      user.name = pName;
      user.password = defaultPasswordHash;
      await userRepo.save(user);
    }

    let profile = await profileRepo.findOne({ where: { userId: user.id } });
    if (!profile) {
      profile = profileRepo.create({
        userId: user.id,
        clubId: club.id,
        teamId: null, // Free player
        clubRole: ClubRole.PLAYER,
        shirtNumber: 20 + i,
        squadTeam: SquadTeam.MAIN,
        gamePosition: null,
        lineupStatus: LineupStatus.NONE,
        points: 650 + (i % 15) * 20,
      });
    } else {
      profile.clubId = club.id;
      profile.teamId = null; // Free player
      profile.clubRole = ClubRole.PLAYER;
      profile.shirtNumber = 20 + i;
      profile.squadTeam = SquadTeam.MAIN;
      profile.gamePosition = null;
      profile.lineupStatus = LineupStatus.NONE;
      profile.points = 650 + (i % 15) * 20;
    }
    await profileRepo.save(profile);
  }

  // Set captain on Team A
  if (captainProfile) {
    teamA.captainProfileId = captainProfile.id;
    await teamRepo.save(teamA);
    console.log('Assigned Rakib Hasan as Team A captain!');
  }

  const totalMembers = await profileRepo.count({ where: { clubId: club.id } });
  console.log(`\n🎉 Red Falcons seeding complete! Total club members: ${totalMembers}`);
  console.log(`- Team A Starters: 11`);
  console.log(`- Team A Substitutes: 5`);
  console.log(`- Team A Manager: 1`);
  console.log(`- Free Club Members: ${totalMembers - 17}`);

  await dataSource.destroy();
}

seed().catch((error) => {
  console.error('Seeding failed:', error);
  process.exit(1);
});
