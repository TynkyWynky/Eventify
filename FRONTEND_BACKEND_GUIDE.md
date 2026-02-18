# Eventify Backend -> Frontend Integration Guide

## 0) One-command startup (Windows / PowerShell)

From `Eventify/`:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup.ps1 -Detach
```

Useful flags:
- `-Detach`: runs Docker Compose in background
- `-SkipInstall`: skip `npm install` steps
- `-SkipDocker`: do not start Docker stack
- `-NoFrontend`: do not launch `npm run dev` for frontend

If you get:
`open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified`
it means Docker Desktop engine is not running yet. Start Docker Desktop, wait until it is ready, then retry.

## 1) Backend shape (what exists today)

- `server.js` exposes:
  - `GET /events`: fetches upcoming events from Ticketmaster, optional setlist enrichment.
  - `GET /setlists`: fetches historical setlists by `artistName` or `cityName`.
- `sync.js` is a worker:
  - pulls from `GET /events`
  - upserts into PostgreSQL (`events` table)
  - runs on cron (`SYNC_INTERVAL`)

Important: your frontend currently consumes `/events` directly, not the DB.

## 2) Database shape (from `dbSetup.sql`)

Main tables:
- `users`
- `events`
- `event_registrations`
- `sync_logs`

Key points:
- `events` has source-tracking fields (`source`, `source_id`, `source_url`)
- unique source constraint: `(source, source_id)`
- helper views exist: `upcoming_events`, `user_event_registrations`, `api_synced_events`

## 3) Docker setup (now fixed)

`docker-compose.yml` now:
- mounts schema correctly from `./dbSetup.sql`
- starts `postgres`
- starts `api` (`node server.js`) on port `3000`
- starts `sync` worker, defaulting to `API_BASE_URL=http://api:3000`

Run:

```bash
docker compose up --build
```

## 4) Frontend integration (now added)

A new API-backed repo is available:
- `eventify-web/src/data/events/apiEventsRepo.ts`

Your existing pages do not need changes because they already read from:
- `eventify-web/src/data/events/index.ts`
- `eventify-web/src/pages/EventDetailPage.tsx` now also uses backend fields:
  - `artistName`
  - `sourceUrl` (ticket link)
  - `startIso`
  - `/setlists?artistName=...` for recent setlists

Repo mode is env-driven:
- `VITE_EVENTS_REPO_MODE=auto` (default): API first, fallback to mock
- `VITE_EVENTS_REPO_MODE=api`: API only
- `VITE_EVENTS_REPO_MODE=mock`: mock only

Frontend env file:
- copy `eventify-web/.env.example` to `.env`

Backend env file:
- copy `.env.example` to `.env`

## 5) Field mapping used by frontend repo

`GET /events` payload is mapped to frontend `EventItem` as:
- `id` <- route-safe stable id derived from `${source}:${sourceId}`
- `title` <- `title`
- `venue` <- `venue`
- `city` <- `city`
- `dateLabel` <- formatted `start`
- `distanceKm` <- computed from default origin (`VITE_DEFAULT_LAT/LNG`) and event coords
- `tags` <- inferred from title/artist (or forced by selected filter)

## 6) Current API gaps to be aware of

Not implemented yet in backend routes:
- login/register/auth endpoints
- CRUD for organizer events in DB
- favorites/goings endpoints

So frontend auth/favorites/goings/organizer flows still use localStorage by design.
