import { Pool, QueryResultRow } from 'pg';
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

export class DatabaseError extends Error {
  constructor(
    message: string,
    public readonly cause: unknown,
    public readonly query: string,
  ) {
    super(message);
    this.name = 'DatabaseError';
  }
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<T[]> {
  if (config.isDev) {
    console.log('[db]', text.replace(/\s+/g, ' ').trim(), params ?? []);
  }

  try {
    const result = await db.query<T>(text, params);
    return result.rows;
  } catch (err) {
    throw new DatabaseError(
      `Query failed: ${(err as Error).message}`,
      err,
      text,
    );
  }
}
