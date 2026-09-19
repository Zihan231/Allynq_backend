import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
const res = await client.query('SELECT name, "dpUrl", "coverUrl" FROM communities LIMIT 10');
console.table(res.rows);
await client.end();
