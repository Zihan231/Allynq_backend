import 'dotenv/config';
import { DataSource } from 'typeorm';
import { buildDbOptions } from './src/config/db-options.js';

/** The TypeORM CLI's data source (migrations): same connection and entity list as the app. */
export default new DataSource(buildDbOptions(process.env.DATABASE_URL, { migrations: ['src/migrations/*.ts'] }));
