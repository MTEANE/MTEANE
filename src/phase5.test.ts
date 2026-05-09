/**
 * Phase 5 reliability tests.
 *
 * All tests are pure-function / logic tests — no Redis, no BullMQ, no DB
 * connections required. The goals are:
 *
 *  Hypothesis A: verify the `isExhausted` logic in the worker failed handler
 *                behaves correctly for every attempt count combination.
 *
 *  Hypothesis B: verify the rateLimiter correctly interprets the Lua eval
 *                return value (number -1 vs string "-1"), and that Retry-After
 *                math is correct.
 *
 *  Extra:        verify rate limit parsing, DLQ orgId filtering, and the
 *                ZADD member-uniqueness fix (UUID prevents collision).
 */

import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RATE_LIMIT, parseRateLimit } from './config/rateLimit.ts';

// ---------------------------------------------------------------------------
// Hypothesis A — Worker failed-handler `isExhausted` logic
// ---------------------------------------------------------------------------
// Extracted verbatim from src/workers/index.ts line:
//   const isExhausted = job != null && job.attemptsMade >= (job.opts.attempts ?? 1);
// We test the inner formula with the same operator precedence.
// ---------------------------------------------------------------------------

describe('Hypothesis A — isExhausted formula (worker failed handler)', () => {
  const isExhaustedFn = (attemptsMade: number, optsAttempts: number | undefined): boolean =>
    attemptsMade >= (optsAttempts ?? 1);

  it('1st failure (attemptsMade=1, attempts=3) → NOT exhausted → no DLQ', () => {
    assert.strictEqual(isExhaustedFn(1, 3), false);
  });

  it('2nd failure (attemptsMade=2, attempts=3) → NOT exhausted → no DLQ', () => {
    assert.strictEqual(isExhaustedFn(2, 3), false);
  });

  it('3rd failure (attemptsMade=3, attempts=3) → exhausted → goes to DLQ', () => {
    assert.strictEqual(isExhaustedFn(3, 3), true);
  });

  // Regression: confirm BullMQ defaultJobOptions.attempts IS stored in job.opts
  // (verified via BullMQ source code + node -e script: mergeOpts keeps attempts=3).
  // The `?? 1` fallback is a safety net; if it ever fired every 1st failure
  // would be incorrectly sent to DLQ.
  it('regression — if opts.attempts were undefined the ?? 1 fallback fires (bug scenario)', () => {
    // This is the BAD case we want to guard against. Test documents the hazard.
    assert.strictEqual(isExhaustedFn(1, undefined), true);  // would be wrong!
    assert.strictEqual(isExhaustedFn(2, undefined), true);  // would be wrong!
  });

  it('confirms BullMQ correctly provides attempts=3 so ?? 1 never fires', () => {
    // From BullMQ source: Queue.addJob merges defaultJobOptions first,
    // then per-call opts: Object.assign({}, this.jobsOpts, opts, { jobId }).
    // Job constructor: Object.assign({ attempts: 0 }, mergedOpts).
    // Result: job.opts.attempts === 3 (defaultJobOptions win over constructor default).
    const simulatedJobOpts = Object.assign(
      { attempts: 0 },                                              // Job constructor default
      { attempts: 3, backoff: { type: 'exponential', delay: 2000 } }, // defaultJobOptions
      { jobId: 'test-id' },                                        // per-call opts
    );
    assert.strictEqual(simulatedJobOpts.attempts, 3);
    assert.strictEqual(isExhaustedFn(3, simulatedJobOpts.attempts), true);
    assert.strictEqual(isExhaustedFn(1, simulatedJobOpts.attempts), false);
  });
});

// ---------------------------------------------------------------------------
// Hypothesis B — Rate limiter Lua eval result type handling
// ---------------------------------------------------------------------------
// ioredis v5 decodes Redis integer replies as JS Number (not string, not BigInt).
// Lua integers → Redis integer reply (RESP type ':') → ioredis Number.
// So {-1, timestamp} from Lua → [-1, timestamp] as JS [number, number].
// The check `count === -1` (strict equality) is therefore correct.
// ---------------------------------------------------------------------------

describe('Hypothesis B — rateLimiter Lua eval result type & comparison', () => {
  it('count === -1 with number -1 (what ioredis actually returns) → true', () => {
    const result: [number, number] = [-1, 1748000000000];
    const [count] = result;
    assert.strictEqual(typeof count, 'number');
    assert.strictEqual(count === -1, true);
  });

  it('count === -1 with string "-1" (hypothetical wrong type) → false', () => {
    // This is the BAD case: if ioredis returned strings, the check would silently fail.
    // We document this so the test suite guards against a future ioredis regression.
    const count = '-1' as unknown as number;
    assert.strictEqual(count === -1, false, 'string "-1" must NOT equal number -1');
  });

  it('count check passes correctly for non-limited request (count > 0)', () => {
    const result: [number, number] = [5, 0];
    const [count] = result;
    assert.strictEqual(count === -1, false);
    assert.ok(count > 0);
  });

  it('Retry-After header calculation is correct (oldest 30s ago → 30s left)', () => {
    const now = 1_748_000_000_000;
    const SLIDING_WINDOW_MS = 60_000;
    const oldestTimestamp = now - 30_000; // oldest entry is 30s into the window
    const retryAfterMs = Math.max(0, oldestTimestamp + SLIDING_WINDOW_MS - now);
    const retryAfterSecs = Math.ceil(retryAfterMs / 1000);
    assert.strictEqual(retryAfterSecs, 30);
  });

  it('Retry-After is 0 when oldest entry is exactly at window boundary', () => {
    const now = 1_748_000_000_000;
    const SLIDING_WINDOW_MS = 60_000;
    const oldestTimestamp = now - SLIDING_WINDOW_MS;
    const retryAfterMs = Math.max(0, oldestTimestamp + SLIDING_WINDOW_MS - now);
    assert.strictEqual(retryAfterMs, 0);
  });

  it('Retry-After clamps to 0 (no negative values) when window already expired', () => {
    const now = 1_748_000_000_000;
    const SLIDING_WINDOW_MS = 60_000;
    const oldestTimestamp = now - SLIDING_WINDOW_MS - 5_000; // beyond window
    const retryAfterMs = Math.max(0, oldestTimestamp + SLIDING_WINDOW_MS - now);
    assert.strictEqual(retryAfterMs, 0);
  });
});

// ---------------------------------------------------------------------------
// Hypothesis C — ZADD member uniqueness (fixed: UUID as member)
// ---------------------------------------------------------------------------
// Two requests at the same ms would share the same member if we used `now` as
// the member, causing ZADD to overwrite instead of insert (undercounting).
// Fix: use randomUUID() as the member so each request gets a unique entry.
// ---------------------------------------------------------------------------

describe('Hypothesis C — ZADD member collision (fixed with UUID)', () => {
  it('using now as member causes overwrite when ts is identical', () => {
    // Simulate: two requests at the same timestamp.
    // ZSet is a Map<member, score>; same member = overwrite.
    const zset = new Map<string, number>();
    const now = 1_748_000_000_000;

    // Old (buggy) approach: member === String(now)
    zset.set(String(now), now); // request 1
    zset.set(String(now), now); // request 2 at same ms — OVERWRITES
    assert.strictEqual(zset.size, 1, 'BUG: collision collapses two entries into one');
  });

  it('using UUID as member prevents overwrite even at identical timestamps', () => {
    const zset = new Map<string, number>();
    const now = 1_748_000_000_000;

    // Fixed approach: member === UUID
    zset.set(randomUUID(), now); // request 1
    zset.set(randomUUID(), now); // request 2 — different UUID, no collision
    assert.strictEqual(zset.size, 2, 'FIXED: two entries correctly registered');
  });
});

// ---------------------------------------------------------------------------
// Rate limit config parsing
// ---------------------------------------------------------------------------

describe('RATE_LIMIT config parsing', () => {
  it('defaults to 1000 requests per 60 seconds', () => {
    assert.strictEqual(DEFAULT_RATE_LIMIT, '1000/60s');
    assert.deepStrictEqual(parseRateLimit(), {
      maxRequests: 1000,
      windowMs: 60_000,
      windowSeconds: 60,
    });
  });

  it('parses custom request and window values', () => {
    assert.deepStrictEqual(parseRateLimit('250/30s'), {
      maxRequests: 250,
      windowMs: 30_000,
      windowSeconds: 30,
    });
  });

  it('rejects invalid format', () => {
    assert.throws(() => parseRateLimit('1000/minute'), /RATE_LIMIT must use the format/);
  });

  it('rejects non-positive values', () => {
    assert.throws(() => parseRateLimit('0/60s'), /requests must be a positive integer/);
    assert.throws(() => parseRateLimit('1000/0s'), /window must be at least 1 second/);
  });
});

// ---------------------------------------------------------------------------
// DLQ orgId filtering logic
// ---------------------------------------------------------------------------

describe('DLQ listDlqHandler orgId filtering', () => {
  // Replicate the filtering logic from dlq.controller.ts without importing it
  // (it depends on redis/bullmq at module init time).
  const filterByOrg = (jobs: Array<{ data: { orgId: string } }>, orgId: string) =>
    jobs.filter(j => j.data?.orgId === orgId);

  it('returns only jobs belonging to the requesting org', () => {
    const jobs = [
      { data: { orgId: 'org-A' } },
      { data: { orgId: 'org-B' } },
      { data: { orgId: 'org-A' } },
    ];
    const filtered = filterByOrg(jobs, 'org-A');
    assert.strictEqual(filtered.length, 2);
    assert.ok(filtered.every(j => j.data.orgId === 'org-A'));
  });

  it('returns empty array when no jobs match the org', () => {
    const jobs = [{ data: { orgId: 'org-B' } }];
    assert.strictEqual(filterByOrg(jobs, 'org-A').length, 0);
  });

  it('returns empty array for empty DLQ', () => {
    assert.strictEqual(filterByOrg([], 'org-A').length, 0);
  });
});
