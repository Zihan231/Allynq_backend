import 'dotenv/config';
import { DataSource } from 'typeorm';
import { ClubJoinRequest } from './src/clubs/entities/club-join-request.entity.js';
import { Club } from './src/clubs/entities/club.entity.js';
import { Team } from './src/clubs/entities/team.entity.js';
import { CommunityJoinRequest } from './src/communities/entities/community-join-request.entity.js';
import { CommunityMember } from './src/communities/entities/community-member.entity.js';
import { Community } from './src/communities/entities/community.entity.js';
import { Notification } from './src/notifications/entities/notification.entity.js';
import { EfootballProfile } from './src/users/entities/efootball-profile.entity.js';
import { User } from './src/users/entities/user.entity.js';

export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  entities: [
    User,
    EfootballProfile,
    Club,
    Team,
    ClubJoinRequest,
    Community,
    CommunityMember,
    CommunityJoinRequest,
    Notification,
  ],
  migrations: ['src/migrations/*.ts'],
  synchronize: false,
});
