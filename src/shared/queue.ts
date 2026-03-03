import Redis from 'ioredis';
import { config } from './config';

// Upstash uses a rediss:// (TLS) URL. ioredis parses it automatically.
// BullMQ requires enableReadyCheck: false and maxRetriesPerRequest: null.
const redisOptions = {
  enableReadyCheck: false,
  maxRetriesPerRequest: null as null,
};

export const createRedisConnection = () => new Redis(config.redisUrl, redisOptions);

// Shared connection for general cache usage
export const redis = createRedisConnection();
