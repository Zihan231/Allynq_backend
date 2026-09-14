import 'dotenv/config';
import { DataSource } from 'typeorm';
import { Club } from './src/clubs/entities/club.entity.js';
import { Team } from './src/clubs/entities/team.entity.js';
import { EfootballProfile } from './src/users/entities/efootball-profile.entity.js';
import { User } from './src/users/entities/user.entity.js';

export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  entities: [User, EfootballProfile, Club, Team],
  migrations: ['src/migrations/*.ts'],
  synchronize: false,
});
