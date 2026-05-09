import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { db, query } from '../shared/db';
import { hashApiKey } from '../utils/hash';
import { config } from '../config';
import { logger } from '../utils/logger';

async function seed() {
  try {
    logger.info('Seeding database...');

    const orgResult = await query(
      `INSERT INTO organizations (name, slug)
       VALUES ($1, $2)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
       RETURNING id, slug`,
      ['Test Organization', 'test-org'],
    );

    const org = orgResult.rows[0];
    logger.info({ org_id: org.id, slug: org.slug }, 'Organization ready');

    const plainKey = randomBytes(32).toString('hex');
    const hashedKey = hashApiKey(plainKey, config.API_KEY_SECRET);

    const keyResult = await query(
      `INSERT INTO api_keys (org_id, key_hash, label, is_active)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (key_hash) DO UPDATE SET label = EXCLUDED.label
       RETURNING id, org_id, label, is_active`,
      [org.id, hashedKey, 'test-key', true],
    );

    const apiKey = keyResult.rows[0];
    logger.info({ key_id: apiKey.id, label: apiKey.label }, 'API key ready');

    // Print plaintext key directly to stdout so it's easy to copy from terminal.
    process.stdout.write('\nPLAINTEXT API KEY (SAVE THIS NOW - IT WILL NEVER BE SHOWN AGAIN):\n');
    process.stdout.write(`\n   ${plainKey}\n\n`);
    process.stdout.write('Use this key in the x-api-key header:\n\n');
    process.stdout.write(`   curl -H "x-api-key: ${plainKey}" http://localhost:3000/health\n\n`);

    logger.info('Seeding complete');
    process.exit(0);
  } catch (error) {
    logger.error({ error }, 'Seed failed');
    process.exit(1);
  } finally {
    await db.end();
  }
}

seed();
