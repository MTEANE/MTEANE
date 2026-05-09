# Deploying Triggrr

This guide covers deploying the API to [Fly.io](https://fly.io) with managed Postgres (Neon) and Redis (Upstash).

---

## Prerequisites

- [Fly CLI](https://fly.io/docs/hands-on/install-flyctl/) installed and authenticated (`fly auth login`)
- A [Neon](https://neon.tech) account (managed Postgres)
- An [Upstash](https://upstash.com) account (managed Redis)
- [SMTP credentials](https://docs.nodemailer.com/smtp/) if you use email actions

---

## 1. Create the Fly app

```bash
fly apps create triggrr-api
```

If you want a different app name, update the `app` field in `fly.toml` first.

---

## 2. Provision managed services

### Neon Postgres

1. Create a project at [console.neon.tech](https://console.neon.tech).
2. Copy the connection string — it looks like:
   ```
   postgresql://user:password@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```

### Upstash Redis

1. Create a database at [console.upstash.com](https://console.upstash.com).
2. Copy the **Redis URL** (`rediss://...` — note the double `s` for TLS).

---

## 3. Set secrets

```bash
fly secrets set \
  DATABASE_URL="postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require" \
  REDIS_URL="rediss://default:xxx@us1-xxx.upstash.io:6379" \
  API_KEY_SECRET="your-32-char-random-secret" \
  RATE_LIMIT="1000/60s" \
  SMTP_HOST="smtp.example.com" \
  SMTP_PORT="587" \
  SMTP_USER="you@example.com" \
  SMTP_PASS="yourpassword" \
  SMTP_FROM="Triggrr <noreply@example.com>" \
  --app triggrr-api
```

---

## 4. Run database migrations

Run migrations once before first deploy (requires local access to the DB or via fly ssh):

```bash
DATABASE_URL="<your-neon-url>" npm run migrate
```

Or after deploy via `fly ssh console`:

```bash
fly ssh console --app triggrr-api -C "node dist/db/migrate.js"
```

---

## 5. Deploy the API

```bash
fly deploy --app triggrr-api
```

Fly will build the Docker image from `Dockerfile.api`, push it, and launch a machine.

---

## 6. Deploy the Worker

The worker is a separate process. Create a second Fly app:

```bash
fly apps create triggrr-worker
fly secrets set \
  DATABASE_URL="<neon-url>" \
  REDIS_URL="<upstash-url>" \
  API_KEY_SECRET="<same-secret>" \
  RATE_LIMIT="1000/60s" \
  SMTP_HOST="..." SMTP_PORT="..." SMTP_USER="..." SMTP_PASS="..." SMTP_FROM="..." \
  --app triggrr-worker

# Deploy using the worker Dockerfile
fly deploy --dockerfile Dockerfile.worker --app triggrr-worker
```

---

## 7. Verify

```bash
# Check API is healthy
curl https://triggrr-api.fly.dev/health

# Open Swagger UI
open https://triggrr-api.fly.dev/docs
```

---

## Local Docker Compose (full stack)

To run everything locally with Docker:

```bash
cp .env.example .env
# Edit .env with your values (defaults work for local postgres/redis)
docker compose up --build
```

The API will be at `http://localhost:3000` and Swagger UI at `http://localhost:3000/docs`.
