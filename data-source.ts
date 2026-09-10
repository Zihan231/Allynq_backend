import 'dotenv/config';
import { DataSource } from 'typeorm';
import { EfootballProfile } from './src/users/entities/efootball-profile.entity.js';
import { User } from './src/users/entities/user.entity.js';

export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  entities: [User, EfootballProfile],
  migrations: ['src/migrations/*.ts'],
  synchronize: false,
});
