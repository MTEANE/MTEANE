# ⚡ Triggrr — Detailed Day-by-Day Work Plan
### 2 Developers · What to Actually Build Each Day

> **Dev A** = API / Infrastructure focus
> **Dev B** = Worker / Engine / Logic focus

---

## Phase 1 — Foundation

---

### Day 1 — Project Setup 🔗
*Do this together. Get aligned before splitting.*

**Dev A**
Init the repo with `npm init -y`, install TypeScript, Fastify, and `tsx` for running TS directly. Create `tsconfig.json` targeting ES2020 with strict mode on. Write `docker-compose.yml` with three services: `postgres` (image: postgres:15, port 5432, with a named volume), `redis` (image: redis:7-alpine, port 6379), and `app` (your Node container, depends on both). Create `.env.example` listing every variable the app will ever need — `DATABASE_URL`, `REDIS_URL`, `PORT`, `API_KEY_SECRET`. Create the full `src/` folder tree with empty `index.ts` files so the structure is visible from day one. The Fastify app should boot, print "server running on port X", and that's it.

**Dev B**
Write `src/db/client.ts` — create a `pg` Pool using `DATABASE_URL` from env, export a `query(text, params)` wrapper that logs the SQL in dev mode and throws typed errors. Write `src/queue/client.ts` — create a single Redis connection using `ioredis`, export it as a singleton so BullMQ and the rate limiter reuse the same connection. Write a `src/config/index.ts` that reads and validates all env variables on startup using `zod` — if any required variable is missing, throw immediately with a clear message so the app refuses to start rather than failing silently later.

---

### Day 2 — Database Schema + Migrations

**Dev A**
Write raw SQL migration files in `src/db/migrations/`. Migration `001_create_organizations.sql` creates the `organizations` table with `id` (UUID, default `gen_random_uuid()`), `name` (text, not null), `slug` (text, unique), `plan` (text, default `'free'`), and `created_at`. Migration `002_create_api_keys.sql` creates `api_keys` with a foreign key to `organizations`, a `key_hash` column (text, unique — this stores the SHA-256 of the real key), `label` (text, nullable), `is_active` (boolean, default true), and `last_used_at` (timestamptz). Write a `src/db/migrate.ts` script that reads and executes these files in order — run it with `npm run migrate`. Write a `src/db/seed.ts` that inserts one test org and generates a real API key, logs the plaintext key to console once so you can copy it for testing.

**Dev B**
Write `src/utils/hash.ts` — a `hashApiKey(key: string): string` function using Node's built-in `crypto.createHash('sha256')`. This is the only place hashing happens — everywhere else imports this. Write `src/db/queries/orgs.ts` with `findOrgById(id)` and `createOrg(name, slug)` — these are plain async functions that call the `query` wrapper and return typed objects. Write `src/db/queries/apiKeys.ts` with `findActiveKeyByHash(hash)` — this is what the auth middleware will call on every request. It should join to `organizations` and return both the key record and the org record in one query, because auth needs both.

---

### Day 3 — Auth Middleware + Events Route

**Dev A**
Write `POST /auth/register` — accepts `{ name, slug }` in the body, creates the org, generates a random 32-byte API key using `crypto.randomBytes(32).toString('hex')`, stores its hash in `api_keys`, and returns `{ org_id, api_key }` exactly once in plaintext. The response should include a warning message: `"Store this key — it will never be shown again"`. Write `src/middleware/auth.ts` — a Fastify `preHandler` hook that reads the `x-api-key` header, hashes it, calls `findActiveKeyByHash`, and if found attaches `request.org` to the request object. If the key is missing return `401`, if not found return `403`, if the key exists but `is_active` is false return `403` with a specific message. Extend Fastify's TypeScript types so `request.org` is typed everywhere.

**Dev B**
Write `POST /events` in `src/api/routes/events.ts`. Define a Fastify schema for the request body requiring `event_type` (string, pattern: `^[a-z]+\.[a-z_]+$` — enforces format like `order.created`) and `payload` (object, any shape). Optional field: `idempotency_key` (string). The route handler inserts a row into the `events` table using `request.org.id` as `org_id`, and returns `{ event_id, received_at, status: "received" }`. At this point it's not queued yet — just stored. Write `src/db/queries/events.ts` with `insertEvent(orgId, eventType, payload, idempotencyKey?)` as the underlying query function.

---

### Day 4 — Idempotency + Health Check 🟡

**Dev A**
Write `GET /health` that checks three things: can we `SELECT 1` from Postgres, can we ping Redis, and is the process memory under a threshold. Return `{ status: "ok", db: "ok", redis: "ok", uptime: X }` or `{ status: "degraded", ... }` with appropriate HTTP status. Write test cases for the auth middleware manually using `curl` or a test script — verify that missing header returns 401, wrong key returns 403, deactivated key returns 403 with the right message, and a valid key returns 200 and the request proceeds. Document these cases in a `tests/auth.md` file so Dev B can replicate them.

**Dev B**
Add idempotency to `insertEvent`. Before inserting, check if a row already exists with `WHERE org_id = $1 AND idempotency_key = $2`. If it does, return the existing `event_id` without inserting. If it doesn't, insert normally. Add a unique index `idx_events_idempotency ON events(org_id, idempotency_key) WHERE idempotency_key IS NOT NULL` — this handles race conditions at the DB level as a safety net. The route should return `200` either way — the caller shouldn't be able to tell whether it was a duplicate or a new event, just that it was accepted.

---

## Phase 2 — Queue & Worker

---

### Day 5 — BullMQ Integration 🔴

**Dev A**
Write `src/queue/eventsQueue.ts` — create a BullMQ `Queue` named `"events"` using the shared Redis connection. Export an `enqueueEvent(eventId, orgId, eventType)` function that calls `queue.add(eventType, { eventId, orgId, eventType }, { attempts: 3, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: 100, removeOnFail: 500 })`. The `removeOnComplete: 100` keeps only the last 100 completed jobs in Redis to avoid memory bloat. Call `enqueueEvent` from the `POST /events` handler right after the DB insert succeeds. If the enqueue fails, the event is still in the DB — log the error but still return `200` to the client (the worker can be built to catch up later).

**Dev B**
Write `src/workers/index.ts` — create a BullMQ `Worker` that processes the `"events"` queue. The process function for now just logs `Processing event ${job.data.eventId}` and returns. Set `concurrency: 5` so it processes five jobs at a time. Write the graceful shutdown: on `SIGTERM` and `SIGINT`, call `worker.close()` which waits for in-progress jobs to finish before the process exits. This prevents jobs being marked as failed just because the process restarted. The worker should run as a completely separate process (`dev:worker` script) so it can be scaled independently.

---

### Day 6 — Worker Fetches Real Event Data 🔴

**Dev A**
Add `fetchEventWithOrg(eventId)` to `src/db/queries/events.ts` — a single query that joins `events` and `organizations` and returns the full event row plus the org's plan and name. In the worker's process function, after receiving a job, call this query. If the event is not found (shouldn't happen, but could if DB was manually modified), call `job.discard()` to permanently fail the job without retrying — retrying a missing event will never succeed so there's no point.

**Dev B**
Set up Pino logging in `src/utils/logger.ts`. Create a logger with `level: process.env.LOG_LEVEL || 'info'` and in dev mode use `pino-pretty` for readable output. Export a single `logger` instance. Replace every `console.log` and `console.error` in the codebase. In the worker, log a structured object on each job: `{ event_id, org_id, event_type, attempt: job.attemptsMade, status: 'processing' }`. On job completion log `status: 'completed'`, on failure log `status: 'failed', error: err.message`. Structured logs mean you can grep by `event_id` and trace the full lifecycle of one event.

---

### Day 7 — Rule Fetching in Worker 🔴

**Dev A**
Write migration `003_create_rules.sql` — the `rules` table needs `id`, `org_id` (FK), `name`, `event_type`, `condition` (jsonb), `action_type` (text), `action_config` (jsonb), `is_active` (boolean default true), `created_at`, `updated_at`. Add the index `idx_rules_org_event ON rules(org_id, event_type) WHERE is_active = true` — this partial index only indexes active rules, keeping it small. Write `getActiveRules(orgId, eventType)` in `src/db/queries/rules.ts`.

**Dev B**
Add rule caching to the worker. After fetching the event, before hitting the DB for rules, check Redis for key `rules:{orgId}:{eventType}`. If it exists, parse the JSON and use it directly. If it doesn't exist, call `getActiveRules`, then write the result to Redis with `EX 60` (60-second TTL). This means if an org has 10 events/second of the same type, you hit the DB once per minute instead of 600 times. Add a helper `src/cache/rules.ts` that encapsulates the get/set/invalidate logic so other parts of the code can call it cleanly.

---

### Day 8 — Rules CRUD API 🟡

**Dev A**
Write `POST /rules` — accepts `{ name, event_type, condition, action_type, action_config }`. Validate the condition shape with Zod: it must be `{ field: string, operator: string, value: unknown }`. Validate `action_type` is one of `"webhook" | "email" | "slack"`. Validate `action_config` shape based on `action_type` — webhook needs `url` (must be a valid URL), email needs `to`, `subject`, `body`, slack needs `webhook_url`. Reject with `400` and a clear error if any field is wrong. Write `GET /rules` — returns all rules for the authenticated org, ordered by `created_at DESC`.

**Dev B**
Write `PATCH /rules/:id` — accepts partial updates to `name`, `condition`, `action_config`, `is_active`. When a rule is updated or deactivated, call `invalidateRulesCache(orgId, eventType)` from `src/cache/rules.ts` which deletes the Redis key for that org+event_type combination — otherwise the worker would keep using stale cached rules for up to 60 seconds. Write `DELETE /rules/:id` — does a soft delete by setting `is_active = false` rather than actually deleting, and also invalidates the cache. Never hard-delete rules because `action_logs` reference them and you want the history to make sense.

---

## Phase 3 — Rule Engine

---

### Day 9 — Rule Evaluator 🔗
*Sync first: agree on the exact condition JSON format before writing code.*

**Dev A**
Write `src/engine/evaluator.ts`. The main export is `evaluate(condition: Condition, payload: Record<string, unknown>): boolean`. The `field` in a condition supports dot notation — `"order.amount"` should resolve to `payload.order.amount`. Write a `resolvePath(obj, path)` helper using `path.split('.').reduce(...)`. Implement operators: `eq` (strict equality), `neq` (not equal), `gt` / `gte` / `lt` / `lte` (numeric comparison — cast both sides to Number before comparing), `in` (check if value is in an array).

**Dev B**
Add remaining operators to the evaluator: `contains` (check if a string field includes the value, or if an array field includes the value), `startsWith`, `endsWith` (string ops), `exists` (check the field is present and not null/undefined), `regex` (test the field against a regex pattern string). Write `src/engine/evaluator.test.ts` with at least 15 test cases — include edge cases like nested paths, null values, type mismatches (comparing string "100" with number 100 for `gt` should still work after casting), and missing fields for the `exists` operator.

---

### Day 10 — Wire Evaluator into Worker 🔴

**Dev A**
Update the worker's process function to run the full matching loop: for each rule returned from the cache/DB, call `evaluate(rule.condition, event.payload)`. Collect matched rules in an array. Log `{ matched: matchedRules.length, total: rules.length }`. If no rules match, log it and mark the job complete — this is a normal case, not an error. If matching throws (malformed condition), catch the error per-rule, log it, and continue to the next rule rather than failing the whole job.

**Dev B**
Write migration `004_create_action_logs.sql` — the `action_logs` table needs `id`, `event_id` (FK to events), `rule_id` (FK to rules), `org_id`, `status` (text: `pending | success | failed | retrying | dead`), `attempt_count` (int default 1), `error_message` (text nullable), `response_body` (text nullable), `executed_at`. After the matching loop, for each matched rule insert an `action_log` row with `status: 'pending'`. These pending rows become the record that the executor will update — if the process dies after matching but before executing, you have a trace of what was supposed to happen.

---

## Phase 4 — Action Executors

---

### Day 11 — Executor Interface + Webhook 🔴

**Dev A**
Write `src/engine/executors/types.ts` — define the `Executor` interface with one method: `execute(config: unknown, event: EventRow): Promise<ExecutionResult>` where `ExecutionResult` is `{ success: boolean, response?: string, error?: string }`. Write `src/engine/executors/webhook.ts` implementing this interface. Use `node-fetch` or the native `fetch` to POST to `config.url` with the event payload as JSON body and `Content-Type: application/json`. Set a 10-second timeout using `AbortController`. Capture the response status and body (truncate body to 1000 chars). Return `success: true` for 2xx responses, `success: false` for everything else.

**Dev B**
After each executor runs, update the corresponding `action_log` row. On success: set `status = 'success'`, `response_body = result.response`, `executed_at = now()`. On failure: set `status = 'failed'`, `error_message = result.error`, increment `attempt_count`. Write `src/db/queries/actionLogs.ts` with `updateActionLog(id, updates)`. If BullMQ retries the job, update the existing log row rather than inserting a new one — use the `action_log.id` stored in the job's data. This means each rule match has exactly one log row that gets updated through retries rather than N rows.

---

### Day 12 — Email Executor 🟡

**Dev A**
Write `src/engine/executors/email.ts`. Use `nodemailer` with SMTP config from env (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`). Create the transporter once as a module-level singleton, not inside the execute function. The `config` for email actions looks like `{ to, subject, body }` where any of these fields can contain template variables like `{{event_type}}` or `{{payload.amount}}`. Call the template interpolator (written by Dev B) before sending. Return success/failure based on nodemailer's callback. For local dev, point `SMTP_HOST` at a Mailtrap or Mailhog instance so emails are caught and not actually sent.

**Dev B**
Write `src/utils/template.ts` — a `interpolate(template: string, context: object): string` function. It should replace `{{event_type}}` with `context.event_type`, `{{payload.amount}}` with `context.payload.amount` (using dot notation resolution), and `{{org.name}}` with `context.org.name`. Use a regex like `/\{\{([^}]+)\}\}/g` to find all placeholders and replace them. If a path doesn't resolve (field doesn't exist), replace the placeholder with an empty string rather than leaving `{{undefined}}` in the output. Export it and make sure Dev A imports it from here rather than re-implementing it.

---

### Day 13 — Slack Executor + Registry 🟡

**Dev A**
Write `src/engine/executors/slack.ts`. Slack incoming webhooks accept a POST with `{ text: string }` or a richer `{ blocks: [...] }` payload. Keep it simple: send a `text` message that includes the org name, event type, and a formatted summary of key payload fields. The `config` for a Slack action just needs `{ webhook_url }`. Use `fetch` to POST to it, same timeout pattern as the webhook executor. Slack returns `"ok"` as a plain text 200 response on success — check for that specifically.

**Dev B**
Write `src/engine/executors/registry.ts` — a `Map<string, Executor>` that maps `"webhook"` to a `WebhookExecutor` instance, `"email"` to `EmailExecutor`, `"slack"` to `SlackExecutor`. Export a `getExecutor(actionType: string): Executor` function that throws a typed `UnknownActionTypeError` if the type isn't registered. Update the worker's process function to use the registry: for each matched rule, call `getExecutor(rule.action_type).execute(rule.action_config, event)`. This means adding a new action type in the future is just: write the class, register it — nothing else changes.

---

## Phase 5 — Reliability

---

### Day 14 — Dead Letter Queue 🔴

**Dev A**
Create a separate BullMQ `Queue` named `"dead-letter"` in `src/queue/dlqQueue.ts`. In the main worker, listen for the `"failed"` event on the worker instance — BullMQ fires this after all retry attempts are exhausted. In that handler, add the job to the dead-letter queue with the original job data plus `{ failedReason: job.failedReason, finalAttempt: job.attemptsMade }`. Write `GET /dlq` — queries the `"dead-letter"` queue via BullMQ's `Queue.getFailed()` method and returns the list, filtered to jobs belonging to the authenticated org.

**Dev B**
Write `POST /dlq/:job_id/retry` — fetches the job from the dead-letter queue by ID, validates it belongs to the requesting org, then re-adds it to the main `"events"` queue with fresh retry counters. Update the corresponding `action_log` rows for that event back to `status: 'retrying'` so the dashboard doesn't show them as permanently dead. Also listen for the `"failed"` event in the worker and update `action_logs` to `status: 'dead'` when a job exhausts all retries — this is the DB-side counterpart to the queue-side DLQ.

---

### Day 15 — Rate Limiting 🟡

**Dev A**
Write `src/middleware/rateLimiter.ts` implementing a Redis sliding window. The algorithm: on each request, use `ZADD` to add the current timestamp to a sorted set keyed `ratelimit:{orgId}`, then use `ZREMRANGEBYSCORE` to remove entries older than 60 seconds, then `ZCARD` to count remaining entries. If the count exceeds the limit, return `429` with a `Retry-After` header set to the number of seconds until the oldest entry expires. Use a Lua script to run all three Redis commands atomically — a Lua script in Redis runs as a single atomic operation, preventing race conditions where two requests both read "99" and both proceed.

**Dev B**
Add plan-based limits: read `request.org.plan` (already attached by auth middleware) and map it to a limit — `free: 100`, `pro: 1000`, `enterprise: 10000`. Store this mapping in `src/config/plans.ts` so it's easy to update. Also add a second rate limit for rule creation — orgs on the free plan can only have 10 active rules at a time. Enforce this in `POST /rules` by counting existing active rules before inserting: if `count >= planLimit.maxRules`, return `403` with message `"Rule limit reached for your plan"`.

---

### Day 16 — Resilience Hardening 🟡

**Dev A**
Add cache invalidation to the rules CRUD routes: whenever `PATCH /rules/:id` or `DELETE /rules/:id` is called, after updating the DB, call `invalidateRulesCache(orgId, eventType)`. But you also need to handle the case where `event_type` is being changed — invalidate the cache for both the old and new `event_type`. Add DB-level query timeouts: pass `{ statement_timeout: 5000 }` in the connection pool config so runaway queries fail fast rather than holding connections. Add a `src/db/healthCheck.ts` that the health endpoint already uses — make it also run on a 30-second interval and log a warning if DB latency exceeds 200ms.

**Dev B**
Add a duplicate job guard in the enqueue path: before calling `queue.add(...)`, check if a job with the same `event_id` already exists in the queue using `queue.getJob(eventId)`. If it does (status is `waiting` or `active`), skip adding it and log a warning. This prevents the same event being processed twice if the API receives a retry from the client before the first job completes. Also make the worker concurrency configurable via `WORKER_CONCURRENCY` env variable — default to 5 but allow tuning without code changes. Document this in `.env.example`.

---

## Phase 6 — Observability & Polish

---

### Day 17 — Logs & Stats API 🟡

**Dev A**
Write `GET /logs` — queries `action_logs` joined with `rules` (for rule name) filtered by `org_id`. Support query params: `status` (filter by status), `rule_id` (filter by specific rule), `limit` (default 20, max 100), `cursor` (the `id` of the last item from the previous page — use cursor pagination rather than offset for performance on large tables). Return `{ logs: [...], next_cursor: "..." }`. Write `GET /stats` — a single query that returns `total_events` (count from `events`), `total_actions_fired` (count from `action_logs`), `success_rate` (percentage), `top_rules` (top 5 rules by fire count).

**Dev B**
Add `GET /rules/:id/logs` — returns the action log history for a specific rule, useful for debugging why a rule fired or didn't. Add `last_triggered_at` to the rules list response — a subquery or join that finds the most recent `action_log` for each rule. This makes the rules list much more useful in a dashboard context. Add proper indexes for all these queries: `action_logs(org_id, status)`, `action_logs(rule_id, executed_at DESC)`. Run `EXPLAIN ANALYZE` on each query and paste the output in a comment above the query so future devs know the query plan was verified.

---

### Day 18 — API Documentation 🟡

**Dev A**
Install `@fastify/swagger` and `@fastify/swagger-ui`. In every route definition, add a `schema` object with `description`, `tags`, `body` (with property descriptions), and `response` (document both success and error shapes). Use `$ref` to avoid repeating common response shapes like the error response. The OpenAPI spec should be accessible at `GET /docs/json` and the Swagger UI at `GET /docs`. Make sure the `x-api-key` header is documented as a security scheme so testers can authenticate directly in the Swagger UI.

**Dev B**
Create a Postman collection JSON file at `docs/triggrr.postman_collection.json`. Organize requests into folders matching the phases: Auth, Events, Rules, Logs, DLQ. For each request, write a short description, pre-fill example request bodies, and add Postman test scripts that assert the response status and key fields. Add a Postman environment file `docs/triggrr.postman_environment.json` with variables `base_url`, `api_key`, `org_id` — so testers can swap environments (local vs deployed) without editing requests. Finalize `.env.example` so it lists every variable with a one-line comment explaining what it does.

---

### Day 19 — Docker + Deployment Prep 🔗

**Dev A**
Write `Dockerfile.api` — multi-stage build: first stage uses `node:20-alpine` to install deps and compile TypeScript, second stage copies only the compiled `dist/` and `node_modules` for a lean final image. Write `fly.toml` for the API service: set `internal_port = 3000`, configure health check at `/health`, set `auto_stop_machines = false` (you need it always-on for the API). Set environment variables as secrets in Fly rather than hardcoding. Document the deployment steps in `docs/deploy.md`.

**Dev B**
Write `Dockerfile.worker` — same multi-stage pattern but the entrypoint runs `node dist/workers/index.js` instead of the API. Update `docker-compose.yml` to add an `api` service and a `worker` service, both building from their respective Dockerfiles, both sharing the same `DATABASE_URL` and `REDIS_URL` pointing to the compose network. Add `depends_on: [postgres, redis]` with `condition: service_healthy` — write healthcheck configs for both the postgres and redis containers so Docker actually waits for them to be ready before starting the app. Test that `docker compose up --build` starts everything cleanly.

---

### Day 20 — README + Architecture Diagram 🟡

**Dev A**
Draw the architecture diagram in Excalidraw showing: Client → API (Fastify) → Postgres (event stored) + Redis Queue (job enqueued) → Worker → Rule Engine (evaluator) → Executor (webhook/email/slack) → External Service. Show retry flow looping back. Show the cache layer sitting between the worker and Postgres for rules. Export as both SVG (for the README) and PNG (for sharing). Write the README with sections: What It Is, Architecture (embed the diagram), Tech Stack, How to Run Locally (step-by-step from `git clone` to first event processed), API Overview (table of endpoints), and Environment Variables (table matching `.env.example`).

**Dev B**
Write `scripts/demo.sh` — a bash script using `curl` that walks through the full flow: registers an org and captures the API key, creates a webhook rule pointing to a `webhook.site` URL (free service for catching webhooks), sends an event that matches the rule, polls `GET /logs` until the action log shows `status: success`, then prints the webhook.site URL so the viewer can open it and see the actual HTTP request that was received. The script should print each step clearly so it reads like a story. Record a Loom of running this script end-to-end for the portfolio.

---

### Day 21 — Final QA 🔗
*Both devs together.*

**Both**
Run `demo.sh` from scratch on a clean environment — fix anything that breaks. Check every error path: send an event with a bad API key, send a malformed event body, create a rule with an invalid condition, send an event that matches a rule pointing to a dead webhook URL and verify it retries and eventually lands in the DLQ. Check the `/stats` response is accurate. Check that `docker compose up` from a fresh clone requires zero manual steps. Tag `v1.0.0` on GitHub. Deploy to Fly.io + Neon + Upstash and verify the demo script works against the live URL.

---

## Summary

| Days | Phase |
|---|---|
| 1–4 | Foundation — auth, events API, idempotency |
| 5–8 | Queue & Worker — BullMQ, async flow, rules CRUD |
| 9–10 | Rule Engine — evaluator, matching, action logs |
| 11–13 | Executors — webhook, email, Slack, registry |
| 14–16 | Reliability — DLQ, rate limiting, hardening |
| 17–21 | Polish — logs API, docs, Docker, README, QA |

---

*If you finish a day's tasks early, start the next day's work. The day numbers are ordering, not time boxes.*
