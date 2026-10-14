# Deploying LifeOS (free): Render + Neon

```
 browser ──HTTPS──> Render (Docker web service: Express API + built Vite client)
                       │  DATABASE_URL (sslmode=require)
                       └──────────────> Neon (Postgres)
 cron-job.org ──every 10 min──> GET https://<app>.onrender.com/healthz   (keeps Render awake)
```

The local `docker-compose.yml` is unchanged and is for development only; production uses just the
app image from `Dockerfile` plus a hosted database.

## 1. Database (Neon)

1. Sign up at neon.com, create a project (region close to you, e.g. Frankfurt `aws-eu-central-1`).
2. Copy the **pooled** connection string (host contains `-pooler`). It ends in `?sslmode=require`.
3. Nothing to create by hand: the app runs its idempotent migrations on startup.

### Move your existing data (optional)

```bash
# dump the local dev DB (read-only operation)
docker compose exec db pg_dump -U lifeos --no-owner --no-acl lifeos > lifeos.sql
# load into Neon (use the NON-pooled connection string for restores)
psql "<neon-direct-connection-string>" < lifeos.sql
```

Alternatively skip this and use the in-app account export/import.

## 2. App (Render)

1. Push this repo to GitHub (already is).
2. Render dashboard -> **New -> Blueprint** -> pick the repo. It reads `render.yaml`.
3. When prompted, set `DATABASE_URL` to the Neon string. Optionally set `VAPID_*`
   (otherwise keys are generated once and stored in the DB, which is fine).
4. First boot: open `https://<app>.onrender.com`, register the single account, then keep
   `ALLOW_REGISTRATION=0`.

## 3. Keep-alive (cron-job.org)

Free Render services sleep after ~15 minutes without traffic, which would stop push reminders and
calendar-feed sync. Create a free cron-job.org job: `GET https://<app>.onrender.com/healthz`
every 10 minutes. `/healthz` does not touch the database.

## 4. Backups

Free tiers have limited restore options. Run this from time to time (or schedule it):

```bash
pg_dump "<neon-direct-connection-string>" --no-owner --no-acl > lifeos-$(date +%F).sql
```

## Environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string (required in production) |
| `COOKIE_SECURE=1` | mark session cookies Secure (HTTPS) |
| `TRUST_PROXY=1` | trust one proxy hop so login rate limits use the real client IP |
| `ALLOW_REGISTRATION` | `1` lets additional accounts register (default off) |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | optional Web Push keys |
| `PORT` | set by Render automatically |
