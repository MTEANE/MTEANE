import 'dotenv/config';
import { createRedisConnection } from '../shared/queue';

// Worker entry-point — picks up BullMQ jobs.
// Will be expanded in Phase 2.
const connection = createRedisConnection();

connection.on('connect', () => {
  console.log('[worker] Redis connected');
});

connection.on('error', (err) => {
  console.error('[worker] Redis error', err);
});

console.log('[worker] started — waiting for jobs');
