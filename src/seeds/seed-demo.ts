import 'dotenv/config';
import bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { Club } from '../clubs/entities/club.entity.js';
import { Team } from '../clubs/entities/team.entity.js';
import { ClubStage, JoinPolicy } from '../clubs/enums/club.enum.js';
import { EfootballProfile } from '../users/entities/efootball-profile.entity.js';
import { User } from '../users/entities/user.entity.js';
import { ClubRole, LineupStatus, SquadTeam } from '../users/enums/user-attributes.enum.js';

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
      maxRoster: 8,
      communityIds: [],
      stage: ClubStage.FOUNDATION,
      location: 'Dhaka',
      motto: 'Fly High, Strike Hard',
      facebookUrl: 'https://facebook.com/redfalcons',
    });
    club = await clubRepo.save(club);
    console.log(`Created club: ${club.name} (${club.id})`);
  } else {
    console.log(`Found existing club: ${club.name} (${club.id})`);
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

  // 3. Demo Users & Profiles with Auth credentials
  const demoMembers = [
    {
      name: 'Imran Kabir',
      email: 'imran@allync.com',
      phoneNumber: '+8801711000001',
      permanentAddress: 'Dhanmondi, Dhaka',
      bio: 'Club President & Strategist',
      clubRole: ClubRole.PRESIDENT,
      shirtNumber: 1,
      squadTeam: SquadTeam.MAIN,
      gamePosition: 'GK',
      lineupStatus: LineupStatus.STARTER,
      points: 1100,
    },
    {
      name: 'Tamim Iqbal',
      email: 'tamim@allync.com',
      phoneNumber: '+8801711000002',
      permanentAddress: 'Gulshan, Dhaka',
      bio: 'Team Head Coach & Manager',
      clubRole: ClubRole.MANAGER,
      shirtNumber: 99,
      squadTeam: SquadTeam.MAIN,
      gamePosition: null,
      lineupStatus: LineupStatus.NONE,
      points: 1200,
    },
    {
      name: 'Nusrat Jahan',
      email: 'nusrat@allync.com',
      phoneNumber: '+8801711000003',
      permanentAddress: 'Uttara, Dhaka',
      bio: 'General Secretary',
      clubRole: ClubRole.GENERAL_SECRETARY,
      shirtNumber: 8,
      squadTeam: SquadTeam.MAIN,
      gamePosition: 'CMF',
      lineupStatus: LineupStatus.STARTER,
      points: 950,
    },
    {
      name: 'Rakib Hasan',
      email: 'rakib@allync.com',
      phoneNumber: '+8801711000004',
      permanentAddress: 'Mirpur, Dhaka',
      bio: 'Team Captain & Primary Striker',
      clubRole: ClubRole.CAPTAIN,
      shirtNumber: 10,
      squadTeam: SquadTeam.MAIN,
      gamePosition: 'CF',
      lineupStatus: LineupStatus.STARTER,
      points: 1500,
    },
    {
      name: 'Shakib Al',
      email: 'shakib@allync.com',
      phoneNumber: '+8801711000005',
      permanentAddress: 'Banani, Dhaka',
      bio: 'Impact Substitute Forward',
      clubRole: ClubRole.PLAYER,
      shirtNumber: 7,
      squadTeam: SquadTeam.MAIN,
      gamePosition: 'RWF',
      lineupStatus: LineupStatus.SUB,
      points: 800,
    },
  ];

  let captainProfile: EfootballProfile | null = null;

  for (const member of demoMembers) {
    let user = await userRepo.findOne({ where: { name: member.name } });
    if (!user) {
      user = userRepo.create({
        name: member.name,
        email: member.email,
        password: defaultPasswordHash,
        phoneNumber: member.phoneNumber,
        permanentAddress: member.permanentAddress,
        bio: member.bio,
      });
      user = await userRepo.save(user);
      console.log(`Created user: ${user.name} (${user.id})`);
    } else {
      user.email = member.email;
      user.password = defaultPasswordHash;
      user.phoneNumber = member.phoneNumber;
      user.permanentAddress = member.permanentAddress;
      await userRepo.save(user);
      console.log(`Updated user auth credentials: ${user.name} (${user.id})`);
    }

    let profile = await profileRepo.findOne({ where: { userId: user.id } });
    if (!profile) {
      profile = profileRepo.create({
        userId: user.id,
        clubId: club.id,
        teamId: teamA.id,
        clubRole: member.clubRole,
        shirtNumber: member.shirtNumber,
        squadTeam: member.squadTeam,
        gamePosition: member.gamePosition,
        lineupStatus: member.lineupStatus,
        points: member.points,
      });
    } else {
      profile.clubId = club.id;
      profile.teamId = teamA.id;
      profile.clubRole = member.clubRole;
      profile.shirtNumber = member.shirtNumber;
      profile.squadTeam = member.squadTeam;
      profile.gamePosition = member.gamePosition;
      profile.lineupStatus = member.lineupStatus;
      profile.points = member.points;
    }
    profile = await profileRepo.save(profile);

    if (member.clubRole === ClubRole.CAPTAIN) {
      captainProfile = profile;
    }
  }

  if (captainProfile && (!teamA.captainProfileId || teamA.captainProfileId !== captainProfile.id)) {
    teamA.captainProfileId = captainProfile.id;
    await teamRepo.save(teamA);
    console.log(`Assigned Rakib Hasan as Team A captain!`);
  }

  console.log('Seeding completed successfully!');
  await dataSource.destroy();
}

seed().catch((error) => {
  console.error('Seeding failed:', error);
  process.exit(1);
});
