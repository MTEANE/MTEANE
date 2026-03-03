import { Pool } from 'pg';
import { config } from './config';

// Neon requires SSL. The connection string already includes ?sslmode=require
// but we also enforce it here so local dev with a plain URL still works.
export const db = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseUrl.includes('neon.tech') ? { rejectUnauthorized: true } : false,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});
