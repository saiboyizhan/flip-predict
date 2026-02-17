import { Pool } from 'pg';
import path from 'path';
import fs from 'fs';

const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

let pool: Pool;

export async function initDatabase(): Promise<Pool> {
  const connectionString = process.env.DATABASE_URL;

  const isProduction = process.env.NODE_ENV === 'production';

  const poolConfig = {
    max: isProduction ? 20 : 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  };

  // Enable SSL for production database connections (e.g. cloud-hosted PostgreSQL)
  const sslConfig = isProduction && process.env.DATABASE_SSL !== 'false'
    ? { ssl: { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' } }
    : {};

  if (connectionString) {
    pool = new Pool({ connectionString, ...poolConfig, ...sslConfig });
  } else {
    pool = new Pool({
      host: process.env.PG_HOST || 'localhost',
      port: parseInt(process.env.PG_PORT || '5432', 10),
      user: process.env.PG_USER || 'postgres',
      password: process.env.PG_PASSWORD || 'postgres',
      database: process.env.PG_DB || 'prediction',
      ...poolConfig,
      ...sslConfig,
    });
  }

  pool.on('error', (err) => {
    console.error('Unexpected pool error:', err);
  });

  const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
  await pool.query(schema);

  return pool;
}

export function getDb(): Pool {
  if (!pool) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return pool;
}

export default { initDatabase, getDb };
