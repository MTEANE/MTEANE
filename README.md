# Triggrr

> Multi-Tenant Event Automation & Notification Engine — a lightweight self-hosted Zapier backend.

## Tech Stack

| Layer      | Tech                          |
|------------|-------------------------------|
| Runtime    | Node.js 22 + TypeScript       |
| Framework  | Fastify                       |
| Queue      | BullMQ                        |
| Database   | PostgreSQL via **Neon**        |
| Cache      | Redis via **Upstash**          |
| Hosting    | **Fly.io** (API + Worker)     |

## Project Structure

```
src/
├── api/          # Fastify routes
│   └── routes/   # health, events, rules …
├── workers/      # BullMQ worker process
├── engine/       # Rule evaluator + action executors
└── shared/       # config, db (Neon), queue (Upstash)
```

## Local Development

```bash
# 1. Copy env template and fill in your Neon + Upstash credentials
cp .env.example .env

# 2. Install dependencies
npm install

# 3. Start API in watch mode
npm run dev

# 4. Start worker in a separate terminal
npm run worker
```

## Deployment (Fly.io)

```bash
# First time
fly launch --no-deploy
fly secrets set DATABASE_URL="postgresql://..." REDIS_URL="rediss://..."
fly deploy

# Subsequent deploys
fly deploy
```

Fly.io runs two processes from the same image (see `fly.toml`):
- `app`    — Fastify API server
- `worker` — BullMQ event processor

## Environment Variables

See `.env.example` for all required variables.

| Variable       | Where to get it                                      |
|----------------|------------------------------------------------------|
| `DATABASE_URL` | Neon dashboard → Project → Connection string         |
| `REDIS_URL`    | Upstash dashboard → Database → Connect → ioredis URL |