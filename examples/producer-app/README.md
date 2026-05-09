# Triggrr — Producer Demo App

A Next.js web app that demonstrates how any backend integrates with the **Triggrr** event automation engine. Send events, manage rules, and watch actions fire — live.

---

## What this is

Triggrr is a self-hosted event automation service. You send it events from your backend; it evaluates rules and fires actions (webhooks, emails, Slack messages) automatically.

This demo app is the **producer** — a UI that lets you:
- Fire pre-built events (e-commerce, auth, DevOps scenarios)
- Write and send custom events via a JSON editor
- Manage rules (create, toggle on/off, delete)
- Watch the action log feed with cursor-based pagination

```
This App (producer)          Triggrr API                 Actions
┌────────────────┐           ┌───────────┐               ┌──────────────┐
│ POST /events   │──────────▶│  Evaluate │──────────────▶│ Webhook POST │
│ GET  /rules    │◀──────────│  rules    │               │ Slack msg    │
│ GET  /logs     │           │  Queue    │               │ Email send   │
└────────────────┘           └───────────┘               └──────────────┘
```

---

## Deploy in two steps

### Step 1 — Deploy Triggrr

Follow the [Triggrr deployment guide](../../docs/deploy.md).

Quick summary:
1. Deploy Triggrr API + Worker to Render (or Fly.io / Docker Compose)
2. Provision Neon Postgres + Upstash Redis
3. Set env vars and run migrations
4. Register an org and copy the API key

### Step 2 — Deploy this app to Vercel

```bash
cd examples/producer-app

# Set environment variables in Vercel dashboard:
#   TRIGGRR_URL=https://your-triggrr.onrender.com
#   TRIGGRR_API_KEY=your-api-key-here

# Or deploy via CLI:
npx vercel --env TRIGGRR_URL=https://... --env TRIGGRR_API_KEY=...
```

The app's API routes proxy all Triggrr calls server-side — the API key never reaches the browser.

---

## Run locally

```bash
# Prerequisites: Triggrr running locally (docker-compose up -d in the repo root)

cd examples/producer-app
cp .env.example .env.local

# Edit .env.local:
#   TRIGGRR_URL=http://localhost:8080   # must match root .env PORT
#   TRIGGRR_API_KEY=<from npm run seed in the Triggrr root>

npm install
npm run dev -- -p 3001
# Open http://localhost:3001 (Triggrr API on :8080 when PORT=8080)
```

---

## Seed demo rules

Two ways:

**Via the UI** — go to **Rules** and click **"Add example rules"**. Seeds one rule per scenario (9 total) in one click.

**Via the Scenarios page** — click **"Seed Rule"** on any scenario card to create just that rule.

---

## Scenarios

| Category | Event type | What it demos |
|----------|-----------|----------------|
| E-commerce | `order.placed` | Webhook to fulfilment when amount > $200 |
| E-commerce | `payment.failed` | Slack alert to ops on any failure |
| E-commerce | `order.refunded` | Webhook for finance reconciliation |
| Auth | `user.signup` | Welcome email on free plan signup |
| Auth | `user.login_failed` | Slack security alert after 5+ attempts |
| Auth | `user.password_reset` | Audit webhook on reset request |
| DevOps | `deploy.failed` | Slack on-call ping for production failures |
| DevOps | `alert.triggered` | Webhook on critical severity alerts |
| DevOps | `service.down` | Slack alert when any service goes down |
| Custom | anything | Write any `event_type` + JSON payload |

> **Note:** Demo rules use placeholder Slack/webhook URLs. On **Rules**, use **Create rule** (or **Edit** on a row) to set real HTTPS webhook or Slack incoming webhook URLs, or adjust `src/lib/scenarios.ts` before seeding.

---

## Project structure

```
src/
├── app/
│   ├── layout.tsx                # Sidebar + global layout
│   ├── page.tsx                  # Dashboard (stats + top rules)
│   ├── scenarios/page.tsx        # Pre-built scenario cards
│   ├── rules/page.tsx            # Rule list + seed button
│   ├── logs/page.tsx             # Paginated action log feed
│   └── api/
│       ├── events/route.ts       # Proxy → POST /events
│       ├── rules/route.ts        # Proxy → GET/POST /rules
│       ├── rules/[id]/route.ts   # Proxy → PATCH/DELETE /rules/:id
│       ├── logs/route.ts         # Proxy → GET /logs
│       └── stats/route.ts        # Proxy → GET /stats
├── components/
│   ├── sidebar.tsx
│   ├── page-header.tsx
│   ├── scenario-card.tsx
│   ├── custom-event-form.tsx
│   ├── rule-row.tsx
│   └── log-row.tsx
└── lib/
    ├── triggrr.ts                # Typed client (calls /api/* routes)
    ├── server.ts                 # Server-side Triggrr fetch (injects API key)
    └── scenarios.ts              # Static scenario + demo rule definitions
```

---

## Environment variables

| Variable | Description |
|----------|-------------|
| `TRIGGRR_URL` | Base URL of the Triggrr API (no trailing slash) |
| `TRIGGRR_API_KEY` | API key issued by Triggrr at `POST /auth/register` |
| `NEXT_PUBLIC_DEMO_WEBHOOK_URL` | Optional browser-visible demo receiver URL used by seeded webhook rules |

`TRIGGRR_URL` and `TRIGGRR_API_KEY` are **server-side only** — never exposed to the browser.
`NEXT_PUBLIC_DEMO_WEBHOOK_URL` is intentionally browser-visible because it only points to the demo receiver.
