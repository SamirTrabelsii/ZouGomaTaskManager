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

## 5. Staging (try big features before production)

Render deploys `main` automatically, so a big feature is built on its own integration branch (e.g.
`feat/gamification`) and its PRs merge there, not into `main`. Before it ships, try it on a staging
copy that runs that branch against a **copy of your real data**. This matters most when a feature
raises the data version (`DATA_VERSION` in `src/domain/types.ts`). Once production has saved your
data in the new format, an older deploy refuses to open it, so it can't simply be rolled back.

```
 feat/gamification ──auto-deploy──> Render "lifeos-staging" ──> Neon branch "staging" (copy of production)
 main              ──auto-deploy──> Render "lifeos"         ──> Neon branch "production"
```

### Database copy (Neon branch)

1. Neon console → project LifeOS → **Branches → New branch**. Parent: `production`, name: `staging`,
   include data up to now. It is an instant copy-on-write snapshot: nothing you do on it touches
   production.
2. **Stop duplicate reminders.** The copy includes production's push subscriptions and push keys, so a
   staging server would send your phone every reminder a second time. On the `staging` branch, open the
   SQL editor and run:

   ```sql
   DELETE FROM push_subscriptions;
   ```

   Don't turn on notifications on the staging site.
3. Copy the `staging` branch's **pooled** connection string (Connect → branch `staging`). Drop
   `&channel_binding=require` and keep `?sslmode=require`, as for production.

### App (second Render service)

Render dashboard → **New → Web Service** → this repo:

| Setting | Value |
|---|---|
| Name | `lifeos-staging` |
| Branch | `feat/gamification` (the feature's integration branch) |
| Runtime / plan / region | Docker · Free · Frankfurt |
| Health check path | `/healthz` |
| `DATABASE_URL` | the `staging` branch's pooled string |
| `COOKIE_SECURE` / `TRUST_PROXY` | `1` / `1` |
| `ALLOW_REGISTRATION` | `0` |
| `FEED_SYNC_MINUTES` | `60` |

Leave the `VAPID_*` keys unset. Sign in with your normal account: it was copied with the data.

- **No keep-alive job for staging.** Letting it sleep keeps the free hours (shared with other Render
  services) for production. The first visit after a sleep takes ~1 minute.
- When you're not testing, **Suspend** the service in Render settings, and resume it the next time.
- Want fresher data? On the Neon `staging` branch, use **Reset from parent**, then run the `DELETE`
  from step 2 again.

### Shipping to production

1. Everything for the feature is merged into the integration branch and works on staging.
2. Take a backup: Settings → cloud backups in the app, plus the `pg_dump` from section 4.
3. Open one PR from the integration branch into `main`, then merge it. Render deploys production.
4. Suspend `lifeos-staging`, or point it at the next integration branch.

## Environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string (required in production) |
| `COOKIE_SECURE=1` | mark session cookies Secure (HTTPS) |
| `TRUST_PROXY=1` | trust one proxy hop so login rate limits use the real client IP |
| `ALLOW_REGISTRATION` | `1` lets additional accounts register (default off) |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | optional Web Push keys |
| `PORT` | set by Render automatically |
