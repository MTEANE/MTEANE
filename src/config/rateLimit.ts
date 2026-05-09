export interface RateLimitConfig {
  /** Maximum POST /events requests allowed inside the sliding window. */
  maxRequests: number;
  /** Sliding window size in milliseconds. */
  windowMs: number;
  /** Sliding window size in seconds, used in API documentation/headers. */
  windowSeconds: number;
}

export const DEFAULT_RATE_LIMIT = '1000/60s';

export function parseRateLimit(raw: string = DEFAULT_RATE_LIMIT): RateLimitConfig {
  const match = raw.trim().match(/^(\d+)\/(\d+)s$/);
  if (!match) {
    throw new Error('RATE_LIMIT must use the format <requests>/<seconds>s, for example 1000/60s');
  }

  const maxRequests = Number.parseInt(match[1], 10);
  const windowSeconds = Number.parseInt(match[2], 10);

  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1) {
    throw new Error('RATE_LIMIT requests must be a positive integer');
  }

  if (!Number.isSafeInteger(windowSeconds) || windowSeconds < 1) {
    throw new Error('RATE_LIMIT window must be at least 1 second');
  }

  return {
    maxRequests,
    windowMs: windowSeconds * 1000,
    windowSeconds,
  };
}
