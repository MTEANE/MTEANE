import { randomUUID } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { redis } from '../shared/queue';
import { config } from '../config';

// Sliding window rate limiter via a single atomic Lua script.
// Uses a Redis sorted set keyed by orgId where every member is the
// request timestamp (ms). Older entries outside the configured window
// are pruned atomically so there are no race conditions.

// ARGV[4] is a unique member (UUID) passed from TypeScript so that two requests
// arriving at the exact same millisecond each get their own sorted-set entry
// rather than overwriting each other (which would undercount the window).
const LUA_SCRIPT = `
local key    = KEYS[1]
local now    = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit  = tonumber(ARGV[3])
local member = ARGV[4]

-- Remove entries older than the sliding window
redis.call('ZREMRANGEBYSCORE', key, 0, now - window)

-- Count requests still in window
local count = redis.call('ZCARD', key)

if count >= limit then
  -- Return the score of the oldest entry so the caller can compute Retry-After
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  return {-1, tonumber(oldest[2]) or now}
end

-- Record this request with a unique member to avoid collisions at the same ms
redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, window)

return {count + 1, 0}
`;

export async function rateLimiter(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const org = request.org;
  const key = `ratelimit:${org.id}`;
  const now = Date.now();
  const { maxRequests, windowMs } = config.RATE_LIMIT;

  const result = await (redis.eval(
    LUA_SCRIPT,
    1,
    key,
    String(now),
    String(windowMs),
    String(maxRequests),
    randomUUID(),
  ) as Promise<[number, number]>);

  const [count, oldestTimestamp] = result;

  if (count === -1) {
    // Window is full — calculate how many seconds until the oldest entry expires
    const retryAfterMs = Math.max(0, oldestTimestamp + windowMs - now);
    const retryAfterSecs = Math.ceil(retryAfterMs / 1000);

    reply.header('Retry-After', String(retryAfterSecs));
    reply.header('X-RateLimit-Limit', String(maxRequests));
    reply.header('X-RateLimit-Remaining', '0');
    await reply.status(429).send({
      message: `Rate limit exceeded. Try again in ${retryAfterSecs}s.`,
      retryAfter: retryAfterSecs,
    });
    return;
  }

  reply.header('X-RateLimit-Limit', String(maxRequests));
  reply.header('X-RateLimit-Remaining', String(maxRequests - count));
}
