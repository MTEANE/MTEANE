# ⚡ Triggrr
### Multi-Tenant Event Automation & Notification Engine

> Organizations send events. Define rules. Actions happen automatically.

---

## What It Is

A backend infrastructure project that lets organizations plug in events (`order.created`, `payment.failed`) and define IF→THEN automation rules that trigger webhooks, emails, or Slack alerts — processed asynchronously, reliably, at scale.

Think: a lightweight self-hosted Zapier backend.

---

## Tech Stack

| Layer | Tech |
|---|---|
| Runtime | Node.js + TypeScript |
| Framework | Fastify |
| Queue | BullMQ |
| Database | PostgreSQL |
| Cache | Redis |
| Infra | Docker Compose |

---

## Roadmap

---

### Phase 1 — Foundation
**Goal:** Project runs locally. Auth works. Events can be received.

- [ ] Monorepo setup (TypeScript + Fastify + Docker Compose)
- [ ] PostgreSQL schema — `organizations`, `api_keys`
- [ ] API key generation + SHA-256 hashing
- [ ] Auth middleware — validate key on every request
- [ ] `POST /events` — accepts and validates event payload
- [ ] Health check endpoint

**Deliverable:** A secured API that accepts events and stores them in Postgres.

---

### Phase 2 — Queue & Worker
**Goal:** Events flow from API into a queue and get processed by a worker.

- [ ] BullMQ setup with Redis
- [ ] On event receipt → push `event_id` into queue
- [ ] Worker process — picks up jobs, logs to console
- [ ] Idempotency — reject duplicate events via `idempotency_key`
- [ ] Basic retry config (3 attempts, exponential backoff)

**Deliverable:** End-to-end async flow. API enqueues, worker dequeues, retries on failure.

---

### Phase 3 — Rules Engine
**Goal:** Workers match events against org-defined rules.

- [ ] `rules` table + CRUD API (`POST`, `GET`, `PATCH`, `DELETE`)
- [ ] Rule schema — `{ field, operator, value }` condition format
- [ ] Rule evaluator — compare `event.payload` against condition
- [ ] Support operators: `eq`, `gt`, `lt`, `contains`
- [ ] Index on `(org_id, event_type)` for fast rule lookup

**Deliverable:** Worker processes an event, finds matching rules, logs which rules fired.

---

### Phase 4 — Action Executors
**Goal:** Matched rules actually do something.

- [ ] Action executor interface (plug-in pattern)
- [ ] **Webhook** executor — POST to external URL
- [ ] **Email** executor — via Nodemailer (SMTP)
- [ ] **Slack** executor — incoming webhook
- [ ] `action_logs` table — record every attempt (success/fail/retrying)

**Deliverable:** A rule fires → a Slack message/email/webhook is triggered and logged.

---

### Phase 5 — Reliability & Rate Limiting
**Goal:** System is production-honest. Handles failures gracefully.

- [ ] Dead-letter queue — failed jobs after max retries move to DLQ
- [ ] Per-tenant rate limiting — Redis sliding window on `POST /events`
- [ ] Rule result caching — cache active rules per org in Redis (TTL: 60s)
- [ ] Graceful worker shutdown — drain queue before process exit

**Deliverable:** System doesn't break under failure or abuse. DLQ captures what fell through.

---

### Phase 6 — Observability & Polish
**Goal:** System is explainable and demo-ready.

- [ ] `GET /logs` — paginated action log per org
- [ ] `GET /stats` — rule hit counts, failure rates per org
- [ ] Structured JSON logging (Pino)
- [ ] API docs via Swagger (Fastify plugin)
- [ ] Architecture diagram (for README)
- [ ] Postman collection with all endpoints

**Deliverable:** Clean README, documented API, working demo script.

---

## Folder Structure (Target)

```
triggrr/
├── src/
│   ├── api/          # Fastify routes
│   ├── workers/      # BullMQ worker logic
│   ├── engine/       # Rule evaluator + action executors
│   ├── db/           # Postgres queries (pg or Drizzle)
│   ├── queue/        # BullMQ setup
│   ├── middleware/   # Auth, rate limiting
│   └── config/       # Env, constants
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## Timeline

| Week | Phase |
|---|---|
| Week 1 | Phase 1 — Foundation |
| Week 2 | Phase 2 — Queue & Worker |
| Week 3 | Phase 3 + 4 — Rules + Actions |
| Week 4 | Phase 5 + 6 — Reliability + Polish |

---

*Each phase = one PR. Each deliverable = something you can demo.*
