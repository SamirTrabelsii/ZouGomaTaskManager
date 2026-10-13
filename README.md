# LifeOS — your personal studio

One 3D room, one personal data set. React + TypeScript + React Three Fiber + Tailwind on the front,
an optional Node + PostgreSQL API for accounts and sync.

LifeOS runs in two modes and picks automatically:

| Mode | When | Where your data lives |
|---|---|---|
| **Local-only** | No server reachable | This browser (`localStorage`) with rotating backups |
| **Account + sync** | The API is reachable | Your PostgreSQL database; the browser keeps an offline cache |

## Run it

Local-only (no backend, no Docker):

```bash
npm install --legacy-peer-deps
npm run dev            # http://localhost:5173
```

With an account and cloud sync (needs Docker for PostgreSQL):

```bash
npm run db:up          # PostgreSQL in Docker (localhost:5433)
cp .env.example .env   # optional; defaults work for local development
npm run dev:all        # web on :5173 + API on :3001 (the web dev server proxies /api)
```

Open http://localhost:5173. On a fresh database you are asked to **create the one account**.
If the browser already holds LifeOS data, it is moved into the account on first sign-in.
After that the page is sign-in only (further sign-ups are refused unless `ALLOW_REGISTRATION=1`).

Everything in Docker (database + built app on http://localhost:3001):

```bash
docker compose up -d --build
```

Tests: `npm test` (the API tests need `npm run db:up`; they are skipped if PostgreSQL is unreachable and use a separate `lifeos_test` database).

Browser tests: `npm run test:e2e` (Playwright, uses the Chrome installed on your machine; needs `npm run db:up`). It starts its own API on :3101 and dev server on :5273, wipes and uses only the `lifeos_test` database (refuses any other), and never touches your real `lifeos` data. `node e2e/perf-quality.mjs [--dpr=2]` measures frame pacing at each graphics quality.

## Account, sync and safety

- **Local first.** Every change is saved in the browser immediately, then pushed to the server a moment later. The app keeps working offline and syncs when the server returns (header cloud icon shows the state).
- **No silent overwrites.** Each device remembers the server revision it last saw. If the server moved on while this device also has unsynced edits, you choose which copy to keep; the other is backed up first (`Settings → Cloud backups`).
- **Server backups.** Hourly rotating backups (last 20) plus one before every forced overwrite. Browser backups still exist as before.
- **Auth.** Email + password (bcrypt, cost 12). Session = random 256-bit token in an `HttpOnly`, `SameSite=Lax` cookie (set `COOKIE_SECURE=1` behind HTTPS); only a SHA-256 of it is stored. Login attempts are rate-limited. Writes require JSON and a same-origin `Origin`.
- **Password change** (`Settings → Account & sync → Change password`) needs the current password, is rate-limited, and signs out every *other* device.
- **Recovery code.** Creating the account shows a one-time code (100 random bits, `XXXX-XXXX-XXXX-XXXX-XXXX`); only its SHA-256 is stored, so it can't be shown again. On the sign-in screen, **Forgot your password?** takes the email, that code and a new password. Resetting is rate-limited per IP+email and per email, ends all sessions, signs this device in, and spends the code — a replacement is shown at once. Accounts created before this feature (or a lost code) can mint a new one under `Settings → New recovery code` while signed in (needs the password). If both the password and the code are lost there is no remote reset: it needs access to the database.
- **Account download** (`Settings → Download account data`, `GET /api/account/export`): one JSON file with the email, your studio, every server backup, push devices and session dates. Password/recovery hashes, session tokens and push encryption keys are never included.
- **Sign-out** keeps a local backup and removes the cached sync state.

### Configuration (environment)

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | — (required for the API) | PostgreSQL connection string |
| `PORT` | `3001` | API port |
| `COOKIE_SECURE` | `0` | `1` when served over HTTPS |
| `ALLOW_REGISTRATION` | `0` | `1` to allow more than one account |
| `SERVE_STATIC` | on if `dist/` exists | `0` to serve only the API |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | generated, stored in DB | Web Push identity (optional override) |
| `POSTGRES_PASSWORD` | `lifeos-dev-password` | Used by docker compose — **change it for anything but local use** |

### Deploying

Build the image (`docker compose build app`) and run it behind an HTTPS reverse proxy that forwards `Host` (or `X-Forwarded-Host`). Set a strong `POSTGRES_PASSWORD`, `COOKIE_SECURE=1`, and back up the `lifeos-db` volume. Do not expose PostgreSQL publicly.

## Architecture

| Layer | Where | Notes |
|---|---|---|
| Domain model & pure logic | `src/domain` | Types, dates, streaks, plant growth, progress, insights, templates. No React/Three. |
| Persistence | `src/data/storage.ts` | `Storage` interface + `LocalStorageAdapter` (validation/migration via `normalize`, rotating backups, corrupt-data quarantine). |
| Sync | `src/data/sync.ts`, `src/data/cloud.ts` | Local-first sync with revisions, conflict handling, offline retry; thin API client. |
| App state | `src/state/store.ts` | One zustand store; debounced saves; undo for deletes. |
| 3D scene | `src/scene` | Read-only view of the store. Never stores personal data. |
| UI | `src/ui` | Panels, views, settings, sign-in, sync status, recovery. |
| API | `server/` | Express + `pg`: auth, one JSON document per user with optimistic concurrency, backups. |

## Room ↔ data

- **Desk** monitor shows today's done/total; one paper sheet per open task.
- **Bookshelf** one book per project (thickness = size, band = progress, ribbon = complete); goal jars fill with progress.
- **Plants** one plant per habit. Growth comes from lifetime completions only, so it never shrinks.
- **Wall calendar** is painted from live events, deadlines, milestones and due tasks. Click the wanted poster for a close-up.
- **Notebook** thickens with the number of notes.

## Reminders

- **Tab open:** reminders are checked every 15 s and delivered once (persisted `deliveredAt`), as a system notification if permitted (via the service worker), otherwise inside the app.
- **Background reminders (Web Push):** with the server running, *Settings → Reminders → Background reminders → Turn on* subscribes this device. The server checks your reminders every 30 s and pushes each one at its time (in your time zone), even with no LifeOS tab open. Each reminder is pushed once per scheduled time; snoozing re-arms it; reminders missed by more than 6 h are not pushed.
- **Honest limits:** on desktop the browser itself must be running (a background Chrome/Edge process is enough); on Android the system delivers it; iOS requires installing LifeOS to the Home Screen first. If the server is down at the reminder time it cannot push, and the app shows it when you next open it. The server only reads your data; it never edits it.
- VAPID keys are generated on first start and kept in the database (or set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`). Push requires HTTPS or `localhost`.

## Not included yet

A template editor and multi-user sharing. Templates (`src/domain/templates.ts`) are versioned config only.
