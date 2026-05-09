# Triggrr — API Reference

Interactive Swagger UI is available at **`GET /docs`** while the server is running.  
This document is the human-readable narrative companion.

---

## Table of contents

1. [Authentication](#1-authentication)
2. [Rate limit](#2-rate-limit)
3. [Health — `GET /health`](#3-health--get-health)
4. [Auth — `POST /auth/register`](#4-auth--post-authregister)
5. [Events — `POST /events`](#5-events--post-events)
6. [Rules](#6-rules)
   - [`POST /rules`](#post-rules)
   - [`GET /rules`](#get-rules)
   - [`PATCH /rules/:id`](#patch-rulesid)
   - [`DELETE /rules/:id`](#delete-rulesid)
   - [`GET /rules/:id/logs`](#get-rulesidlogs)
7. [Logs & Stats](#7-logs--stats)
   - [`GET /logs`](#get-logs)
   - [`GET /stats`](#get-stats)
8. [Dead Letter Queue](#8-dead-letter-queue)
   - [`GET /dlq`](#get-dlq)
   - [`POST /dlq/:job_id/retry`](#post-dlqjob_idretry)
9. [Conditions reference](#9-conditions-reference)
10. [Action configs reference](#10-action-configs-reference)
11. [Error shapes](#11-error-shapes)

---

## 1. Authentication

All endpoints **except** `GET /health` and `POST /auth/register` require an API key.

Pass it in the request header:

```
x-api-key: <your-64-char-hex-key>
```

**How it works internally**

1. The middleware reads `x-api-key` from the request headers.
2. It HMAC-SHA256 hashes the key using the server's `API_KEY_SECRET` environment variable.
3. The hash is looked up in the `api_keys` table.
4. If the key is found and `is_active = true`, the associated organisation is attached to the request object — every subsequent handler reads `request.org`.
5. The key's `last_used_at` is updated asynchronously (best-effort, does not block the response).

**Error responses**

| Condition | Status | Message |
|-----------|--------|---------|
| `x-api-key` header missing | 401 | `"Missing x-api-key header"` |
| Key not found in DB | 403 | `"Invalid API key"` |
| Key found but `is_active = false` | 403 | `"API key is inactive"` |

---

## 2. Rate limit

`POST /events` uses a per-organisation Redis sorted-set sliding window. Configure it with `RATE_LIMIT=<requests>/<seconds>s`; the default is `1000/60s`. The Lua script is atomic — no race conditions. When the limit is hit:

- HTTP **429** is returned
- `Retry-After` header: seconds until the window resets
- `X-RateLimit-Limit` header: the configured request limit
- `X-RateLimit-Remaining: 0`

---

## 3. Health — `GET /health`

No authentication required. Intended for load-balancer / Kubernetes liveness probes.

**What it checks (in parallel)**

| Check    | How | Passes when |
|----------|-----|-------------|
| Database | `SELECT 1` on the Postgres connection pool | Query completes without error |
| Redis    | `PING` via ioredis, expects `PONG` | Response is exactly `"PONG"` |
| Memory   | Reads Node.js process RSS | RSS ≤ 512 MB |

**Response — 200 (all healthy)**

```json
{
  "status": "ok",
  "db": "ok",
  "redis": "ok",
  "memory": "ok",
  "memory_mb": 128,
  "uptime": 3600.42
}
```

**Response — 503 (one or more unhealthy)**

Same shape, `status` becomes `"degraded"` and the failing field becomes `"down"` or `"high"`:

```json
{
  "status": "degraded",
  "db": "ok",
  "redis": "down",
  "memory": "ok",
  "memory_mb": 130,
  "uptime": 3600.42
}
```

---

## 4. Auth — `POST /auth/register`

No authentication required. Creates a new organisation and issues an API key.

**Request body**

| Field  | Type   | Required | Rules |
|--------|--------|----------|-------|
| `name` | string | yes      | 1–120 chars, any UTF-8 |
| `slug` | string | yes      | 1–60 chars, `^[a-z0-9-]+$` only — must be globally unique |

```json
{
  "name": "Acme Corp",
  "slug": "acme-corp"
}
```

**What happens internally**

1. Body is validated with Zod (400 on failure).
2. A UUID organisation row is inserted into `organizations`.
3. `crypto.randomBytes(32).toString('hex')` generates a 64-char key.
4. The key is `HMAC-SHA256(key, API_KEY_SECRET)` and stored in `api_keys` — **the plain-text key is never written to the DB**.
5. Both `org_id` and the plain-text key are returned.

**Response — 201**

```json
{
  "org_id": "550e8400-e29b-41d4-a716-446655440000",
  "api_key": "a3f8e2c1d94b6071f52890abcde34f67...",
  "warning": "Store this key — it will never be shown again"
}
```

**Error responses**

| Status | When |
|--------|------|
| 400    | `name` or `slug` fails validation |
| 409    | `slug` already registered |

---

## 5. Events — `POST /events`

**Auth required.** Ingest an event. The event is persisted synchronously, then queued for async rule evaluation.

**Request body**

| Field             | Type   | Required | Rules |
|-------------------|--------|----------|-------|
| `event_type`      | string | yes      | Must match `^[a-z]+\.[a-z_]+$` — dot-separated noun.verb (e.g. `order.placed`, `user.signup`) |
| `payload`         | object | yes      | Arbitrary JSON — values are accessed by rule conditions via dot-notation |
| `idempotency_key` | string | no       | Max 256 chars — if supplied, duplicate events with the same key are silently de-duplicated |

```json
{
  "event_type": "order.placed",
  "payload": {
    "amount": 250,
    "customer_id": "cus_abc123",
    "plan": "pro"
  },
  "idempotency_key": "order-placed-ord_001"
}
```

**Processing pipeline**

```
Request
  → Auth middleware (HMAC key lookup)
  → Rate limiter (Redis sliding window)
  → Zod validation
  → Idempotency check (if key supplied)
  → INSERT into events table
  → PUSH job onto BullMQ "events" queue
  → 200 response returned immediately

(async — separate worker process)
  → Worker pops job
  → Fetches active rules for org+event_type (Redis cache → DB fallback)
  → Evaluates each rule condition against payload
  → For each matching rule: execute action → write action_log
```

**Response — 200**

```json
{
  "event_id": "b1c2d3e4-...",
  "received_at": "2026-04-13T12:00:00.000Z",
  "status": "received"
}
```

`received` means "stored and queued" — rule execution is async and reflected in `/logs`.

**Error responses**

| Status | When |
|--------|------|
| 400    | `event_type` format invalid, `payload` not an object, `idempotency_key` > 256 chars |
| 401    | Missing `x-api-key` header |
| 403    | Invalid or inactive API key |
| 413    | Request body > 512 KB |
| 429    | Configured rate limit exceeded for the org |

---

## 6. Rules

Rules define: **when** to act (which `event_type`), **what condition** must pass on the payload, **what action** to execute, and **how** to configure it.

---

### `POST /rules`

**Auth required.** Create a new rule.

**Request body**

| Field           | Type   | Required | Notes |
|-----------------|--------|----------|-------|
| `name`          | string | yes      | Display label |
| `event_type`    | string | yes      | Must match the `event_type` in `POST /events` |
| `condition`     | object | yes      | `{ field, operator, value }` — see [Conditions reference](#9-conditions-reference) |
| `action_type`   | enum   | yes      | `webhook`, `email`, or `slack` |
| `action_config` | object | yes      | Shape depends on `action_type` — see [Action configs reference](#10-action-configs-reference) |

```json
{
  "name": "Webhook on large order",
  "event_type": "order.placed",
  "condition": { "field": "amount", "operator": "gt", "value": 200 },
  "action_type": "webhook",
  "action_config": { "url": "https://hooks.example.com/triggrr" }
}
```

**What happens internally**

1. Body validated with Zod (400 on failure).
2. `action_config` validated against the `action_type`-specific schema (400 on failure).
3. Rule inserted into `rules` table.
4. Redis cache for `org_id + event_type` is invalidated immediately so the worker picks up the new rule on the next job (no 60 s TTL wait).

**Error responses**

| Status | When |
|--------|------|
| 400    | Validation failure on any field |

---

### `GET /rules`

**Auth required.** List all rules for the org (including soft-deleted).

Each rule includes a computed `last_triggered_at` — the `executed_at` timestamp of the most recent successful action log (single LEFT JOIN, no extra request needed). Returns newest first.

**Response — 200**

```json
{
  "rules": [
    {
      "id": "...",
      "name": "Webhook on large order",
      "event_type": "order.placed",
      "condition": { "field": "amount", "operator": "gt", "value": 200 },
      "action_type": "webhook",
      "action_config": { "url": "https://hooks.example.com/triggrr" },
      "is_active": true,
      "last_triggered_at": "2026-04-13T11:00:00Z",
      "created_at": "2026-04-01T10:00:00Z",
      "updated_at": "2026-04-01T10:00:00Z"
    }
  ]
}
```

---

### `PATCH /rules/:id`

**Auth required.** Partially update a rule. At least one field required.

**Patchable fields**

| Field           | Notes |
|-----------------|-------|
| `name`          | Rename the rule |
| `condition`     | Full replacement — same shape as `POST /rules` |
| `action_config` | Full replacement — validated against the **existing** `action_type`; you cannot change `action_type` |
| `is_active`     | `true` re-enables a soft-deleted rule; `false` pauses it |

After update, the rule cache is immediately invalidated for both old and new `event_type` (in case they differ).

**Error responses**

| Status | When |
|--------|------|
| 400    | No fields provided, or `condition`/`action_config` failed validation |
| 404    | Rule not found for this org |

---

### `DELETE /rules/:id`

**Auth required.** Soft-delete a rule — sets `is_active = false`.

The rule row is **kept** so historical action logs remain queryable. The cache is immediately invalidated. To re-enable, use `PATCH /rules/:id` with `{ "is_active": true }`.

**Response — 200**

```json
{
  "id": "...",
  "is_active": false,
  "status": "soft_deleted"
}
```

**Error responses**

| Status | When |
|--------|------|
| 404    | Rule not found for this org |

---

### `GET /rules/:id/logs`

**Auth required.** Last 50 action log entries for a specific rule, ordered by most-recently executed first.

Use this for per-rule debugging. For org-wide paginated logs with filters use `GET /logs`.

**Response — 200**

```json
{
  "logs": [
    {
      "id": "...",
      "event_id": "...",
      "rule_id": "...",
      "org_id": "...",
      "status": "success",
      "attempt_count": 1,
      "error_message": null,
      "response_body": "{\"ok\":true}",
      "executed_at": "2026-04-13T11:00:00Z",
      "created_at": "2026-04-13T11:00:00Z",
      "updated_at": "2026-04-13T11:00:00Z"
    }
  ]
}
```

**Error responses**

| Status | When |
|--------|------|
| 404    | Rule not found for this org |

---

## 7. Logs & Stats

---

### `GET /logs`

**Auth required.** Paginated, filterable list of every action log for the org. Newest first.

Each row is enriched with the parent rule's `name`, `action_type`, and `event_type`.

**Query parameters**

| Param     | Type   | Required | Notes |
|-----------|--------|----------|-------|
| `status`  | enum   | no       | `pending`, `success`, `failed`, `retrying`, `dead` |
| `rule_id` | uuid   | no       | Filter to a single rule |
| `cursor`  | string | no       | ISO-8601 timestamp — the `next_cursor` from the previous response |
| `limit`   | number | no       | Page size 1–100, default 20 |

**Pagination example**

```
GET /logs?limit=20
→ { logs: [...20 items], next_cursor: "2026-04-13T10:00:00.000Z" }

GET /logs?limit=20&cursor=2026-04-13T10:00:00.000Z
→ { logs: [...next page], next_cursor: "2026-04-13T09:00:00.000Z" }

GET /logs?limit=20&cursor=2026-04-13T09:00:00.000Z
→ { logs: [...last page], next_cursor: null }  ← end of data
```

**Status value meanings**

| Value     | Meaning |
|-----------|---------|
| `pending`  | Job is queued — action not yet attempted |
| `success`  | Action executed and target responded OK |
| `failed`   | Action executed but errored — worker may retry |
| `retrying` | DLQ retry triggered — job re-entered queue |
| `dead`     | All retries exhausted — sitting in DLQ |

---

### `GET /stats`

**Auth required.** Aggregate dashboard statistics, computed in a single SQL CTE.

**Response — 200**

```json
{
  "total_events": 1200,
  "total_actions_fired": 850,
  "success_rate": 94.12,
  "top_rules": [
    {
      "id": "...",
      "name": "Webhook on large order",
      "action_type": "webhook",
      "event_type": "order.placed",
      "fire_count": 320
    }
  ]
}
```

| Field                 | How computed |
|-----------------------|--------------|
| `total_events`        | COUNT of all `events` rows for this org |
| `total_actions_fired` | COUNT of all `action_logs` rows for this org |
| `success_rate`        | `(success_count / total_actions_fired) × 100`, 2 dp; `0` when no actions yet |
| `top_rules`           | Top 5 rules by action_log count (LEFT JOIN to include rules with 0 fires) |

---

## 8. Dead Letter Queue

---

### `GET /dlq`

**Auth required.** List all DLQ jobs belonging to the authenticated org.

**What is the DLQ?**  
When a BullMQ event job exhausts all automatic retries, the worker moves it to the `dlq` queue and marks all associated `action_logs` as `dead`. No further processing happens automatically — the DLQ is a holding area for human intervention.

**Common causes**
- Webhook URL consistently returns 4xx/5xx
- SMTP server or Slack webhook unavailable for all retry attempts
- Unhandled exception in the action executor

**Response — 200**

```json
{
  "jobs": [
    {
      "id": "42",
      "eventId": "b1c2d3e4-...",
      "orgId": "...",
      "eventType": "order.placed",
      "failedReason": "connect ETIMEDOUT",
      "finalAttempt": true,
      "timestamp": 1712000000000,
      "processedOn": 1712000005000
    }
  ]
}
```

---

### `POST /dlq/:job_id/retry`

**Auth required.** Manually re-queue a DLQ job for reprocessing.

**Steps executed**

1. Look up the job by `job_id` in the DLQ queue — **404** if not found.
2. Verify `job.data.orgId === request.org.id` — **403** if not (cross-org protection).
3. Update all `action_logs` for the event to `status = 'retrying'`.
4. Push a **new** job onto the main `events` BullMQ queue with the original `eventId`, `orgId`, and `eventType`.
5. Remove the job from the DLQ.

The worker re-evaluates all active rules and re-executes matching actions. If it fails again it goes through normal retry logic before landing back in the DLQ.

**Response — 200**

```json
{
  "message": "Job re-enqueued successfully",
  "eventId": "b1c2d3e4-..."
}
```

**Error responses**

| Status | When |
|--------|------|
| 400    | `job_id` param is empty |
| 403    | DLQ job belongs to a different org |
| 404    | No DLQ job with this ID |

---

## 9. Conditions reference

A condition is a JSON object with three fields:

```json
{ "field": "<dot-notation-path>", "operator": "<op>", "value": <any> }
```

`field` is resolved against the event `payload` using dot-notation. `payload.user.plan` is addressed as `"user.plan"`. Prototype-polluting paths (`__proto__`, `prototype`, `constructor`) are rejected.

### Operators

| Operator     | Value type     | Passes when |
|--------------|----------------|-------------|
| `eq`         | any            | `field === value` |
| `neq`        | any            | `field !== value` |
| `gt`         | number         | `field > value` |
| `gte`        | number         | `field >= value` |
| `lt`         | number         | `field < value` |
| `lte`        | number         | `field <= value` |
| `in`         | array          | `value.includes(field)` |
| `contains`   | string         | `field.includes(value)` |
| `startsWith` | string         | `field.startsWith(value)` |
| `endsWith`   | string         | `field.endsWith(value)` |
| `exists`     | *(not needed)* | field is not `undefined` or `null` |
| `regex`      | string (pattern) | `new RegExp(value).test(field)` — max 200 chars, no nested quantifiers |

### Examples

```jsonc
// Number comparison
{ "field": "amount", "operator": "gte", "value": 100 }

// String match
{ "field": "status", "operator": "eq", "value": "failed" }

// Nested path
{ "field": "user.plan", "operator": "eq", "value": "free" }

// Array membership — fires if payload.status is "failed" OR "error"
{ "field": "status", "operator": "in", "value": ["failed", "error"] }

// Existence check
{ "field": "metadata.trace_id", "operator": "exists" }

// Regex
{ "field": "email", "operator": "regex", "value": "^admin@" }
```

---

## 10. Action configs reference

### `webhook`

Sends an HTTP **POST** to the specified URL with the full event payload as the JSON body.

```json
{
  "url": "https://hooks.example.com/triggrr"
}
```

| Field | Type   | Required | Notes |
|-------|--------|----------|-------|
| `url` | string | yes      | Must be HTTPS. Private/reserved IP ranges (10.x, 192.168.x, 127.x, 169.254.x) are blocked (SSRF guard). |

---

### `email`

Sends a plain-text email via the configured SMTP server (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` in `.env`).

```json
{
  "to": "ops-team@example.com",
  "subject": "Payment failed alert",
  "body": "A payment has failed. Please investigate."
}
```

| Field     | Type   | Required |
|-----------|--------|----------|
| `to`      | string | yes      |
| `subject` | string | yes      |
| `body`    | string | yes      |

---

### `slack`

Posts a message to a Slack channel via an [Incoming Webhook](https://api.slack.com/messaging/webhooks) URL.

```json
{
  "webhook_url": "https://hooks.slack.com/services/T.../B.../..."
}
```

| Field         | Type   | Required | Notes |
|---------------|--------|----------|-------|
| `webhook_url` | string | yes      | Must be HTTPS. Same SSRF guard as webhook applies. |

The message body sent to Slack includes the `event_type` and full event payload formatted as JSON.

---

## 11. Error shapes

All error responses follow one of two shapes:

**Simple error**
```json
{ "message": "Human-readable description" }
```

**Validation error** (400)
```json
{
  "message": "Validation failed",
  "errors": [
    { "path": "event_type", "message": "Invalid" },
    { "path": "payload.amount", "message": "Expected number" }
  ]
}
```

**HTTP status codes used across the API**

| Code | Meaning |
|------|---------|
| 200  | Success |
| 201  | Resource created |
| 400  | Validation failure |
| 401  | Missing `x-api-key` header |
| 403  | Invalid key, inactive key, or cross-org access denied |
| 404  | Resource not found for this org |
| 409  | Conflict (duplicate slug) |
| 413  | Request body too large (> 512 KB) |
| 429  | Rate limit exceeded |
| 503  | Server degraded (health check only) |
