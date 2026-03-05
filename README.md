# Eventify 🎫🎶  
**Hyper-lokale concert discovery web-app**  
Vind snel de beste events in je buurt — met filters op genre, afstand en timing, én (later) persoonlijke aanbevelingen en social proof.

---

## Waarom Eventify?
Mensen willen last-minute iets doen, maar verdwalen in Facebook-events, posters en stories.  
Eventify bundelt lokale events op één plek en maakt ontdekken simpel, snel en leuk.

**Voor bezoekers (B2C)**  
- “Wat is er deze week in mijn buurt dat ik écht leuk vind?”
- Filter op **genre**, **afstand**, **datum**
- Duidelijke eventinfo: **locatie, tijd, sfeer, afstand**
- Social (in roadmap): **going/saves/vrienden**

**Voor organisatoren (B2B light)**
- Event posten = zichtbaar worden bij de juiste doelgroep  
- Simpel beheer (in roadmap): **organizer/admin flow**

---

## Features (huidig)
- Event feed / overzicht
- Filters (bv. muziekstijl/genre + afstand)
- Event detail pagina met alle info
- Auth flow (demo): register/login + sessie in localStorage
- (Optioneel afhankelijk van branch) kaartweergave via OpenStreetMap/Leaflet of Google Maps

> ⚠️ Dit is een **demo/studentenproject**: auth & data kunnen lokaal (mock) zijn en zijn niet bedoeld als productie-security.

---

## Tech Stack
- **React + TypeScript**
- **React Router**
- **Vite** (typische dev server + build flow)
- **CSS/Tailwind (afhankelijk van projectsetup)**  
- Data: **mock repo / local store** (eventsRepo / eventsStore)

---

## Projectstructuur (indicatief)

---

## Web scraping + DB sync (nieuw)

De backend kan nu events uit extra websites scrapen en samenvoegen met Ticketmaster:

- `GET /events` combineert:
  - Ticketmaster events
  - JSON-LD (`schema.org/Event`) scraping van URL's in `SCRAPE_SOURCE_URLS`
  - Eventbrite listing pages (`/d/.../events/`) worden direct ondersteund, inclusief detail-verrijking
  - Venue agenda pages werken ook (bv. `.../agenda`, `.../calendar`) zolang event detailpagina's JSON-LD Event bevatten
- Cross-source dedupe: events met dezelfde titel+tijd+stad+venue worden samengevoegd
- Scrape cache (stale-while-refresh) houdt laadtijd laag
- Songkick verrijking: volgt `Venue Website`/ticket-redirects en gebruikt de officiële venue-eventpagina als link (`url`) wanneer beschikbaar
- `sync.js` slaat verrijkte velden op in Postgres, inclusief ruwe bronpayload in `events.source_metadata` (JSONB)

### Belangrijke env vars

- `SCRAPE_ENABLED=true|false`
- `SCRAPE_SOURCE_URLS=https://site-a.com/events,https://site-b.com/calendar`
- Voorbeeld: `SCRAPE_SOURCE_URLS=https://www.eventbrite.com/d/belgium--brussels/music--events/,https://www.eventbrite.com/d/belgium--antwerp/music--events/`
- `SCRAPE_MAX_EVENTS=40`
- `SCRAPE_MAX_EVENTS_PER_SOURCE=25`
- `SCRAPE_MAX_LINKS_PER_SOURCE=20`
- `SCRAPE_TIMEOUT_MS=12000`
- `SCRAPE_SOURCE_CONCURRENCY=3`
- `SCRAPE_REQUEST_WAIT_MS=2500` (hoe lang `/events` op first-run op scrape-cache wacht)
- `SCRAPE_SYNC_WAIT_MS=25000` (extra wachttijd voor interne sync-calls naar `/events`)
- `SCRAPE_EVENTBRITE_DETAIL_LOOKUP=true`
- `SCRAPE_EVENTBRITE_DETAIL_ENRICH_LIMIT=8`
- `SCRAPE_EVENTBRITE_DETAIL_TIMEOUT_MS=10000`
- `PRICE_ENRICH_ENABLED=true`
- `PRICE_ENRICH_MAX_PER_REQUEST=12`
- `PRICE_ENRICH_TICKETMASTER_MAX_PER_REQUEST=6`
- `PRICE_ENRICH_CONCURRENCY=4`
- `PRICE_ENRICH_TIMEOUT_MS=4500`
- `PRICE_ENRICH_USER_AGENT=Mozilla/5.0`
- `PRICE_ENRICH_BACKGROUND_ENABLED=true`
- `PRICE_ENRICH_BACKGROUND_DELAY_MS=2000`
- `PRICE_ENRICH_BACKGROUND_MAX_QUEUE=250`
- `PRICE_ENRICH_CACHE_TTL_MS=21600000`
- `PRICE_ENRICH_BLOCK_TTL_MS=600000`
- `PRICE_ENRICH_TICKETMASTER_PROXY_BASE_URL=` (optioneel, gebruik bij voorkeur een anti-bot geschikte scraping proxy)
- `PRICE_ENRICH_TICKETMASTER_PROXY_TIMEOUT_MS=10000`

Prijsverrijking gebeurt on-demand in `GET /events` voor events zonder prijsdata
(max-per-request + concurrency cap + host block cache). De response bevat ook
`priceCoverage` statistieken:
- `total`
- `withAnyPrice`
- `enrichedThisRequest`
- `unknownPrice`
- `blockedHostSkips`

Let op voor Ticketmaster:
- Discovery API geeft in BE vaak geen `priceRanges`
- Price-enrichment probeert daarom eerst Ticketmaster web-JSON (`/api/ticketselection/{eventId}` afgeleid uit de event-URL)
- Directe Ticketmaster eventpagina's returnen vaak `401/403` voor bots
- Daarom is er een optionele proxy fallback (`PRICE_ENRICH_TICKETMASTER_PROXY_BASE_URL`)
- Simpele text-mirrors/proxy's kunnen nog steeds door Ticketmaster geblokkeerd worden

### Snelle test

1. Zet minstens 1 URL in `SCRAPE_SOURCE_URLS`
2. Start API: `npm run start`
3. Vraag events op:
   - `http://localhost:3000/events?includeScraped=1`
4. Start sync:
   - `npm run sync:once`

---

## AI features (MVP)

Nieuwe backend endpoints voor explainable AI-functionaliteit:

- `POST /ai/recommendations`
  - Explainable ranking per event met componenten:
    - `genreMatch`, `distance`, `popularity`, `similarity`
  - Geeft per event redenen terug, bv:
    - `Je houdt van indie / rock`
    - `Het is op 6 km van je locatie`
    - `3 gelijkaardige events heb je al geliket`

- `POST /ai/genre-predict`
  - Predict automatisch genre(s) op basis van titel/description/tags
  - Inclusief `confidence` score
  - Ondersteunt ook batch-predictie voor een events-array

- `POST /ai/radar`
  - Detecteert labels:
    - `Hidden Gem`
    - `Trending Local`
  - Gebaseerd op relevantie, zichtbaarheid, freshness en trend-velocity

- `POST /ai/taste-dna`
  - Bouwt een smaakprofiel, bv:
    - `48% Indie Explorer, 44% Jazz Drifter, ...`
  - Gebruikt likes, genre-voorkeuren, afstand en tijdspatroon

- `POST /ai/success-predictor`
  - Voor organizer events:
    - `probabilityHighAttendance`
    - `bestPromotionDay`
    - `targetAudienceAgeRange`
  - Gebaseerd op vergelijkbare historische events + timing/prijs/locatie

### Chatbot + LLM API (fast mode)

`POST /chatbot` gebruikt een snelle LLM-chatflow (zonder de trage copilot-ranking pipeline).
`POST /copilot` blijft bestaan voor compatibiliteit en volgt dezelfde fast mode zolang `CHATBOT_FAST_ONLY=true`.

Eigenschappen:
- Directe antwoordgeneratie via LLM provider (`openai` of `ollama`)
- Korte timeout + korte reply-limiet voor snellere UX
- In-memory reply cache voor herhaalde prompts

Env:
- `LLM_PROVIDER=openai|ollama`
- `LLM_ENABLED=true|false`
- `LLM_API_KEY=<secret>` (nodig voor `openai`)
- `OPENAI_API_KEY=<secret>` (alias van `LLM_API_KEY`)
- `LLM_BASE_URL=https://api.openai.com/v1` (of Ollama endpoint)
- `LLM_MODEL=gpt-4o-mini` (of jouw model)
- `LLM_TIMEOUT_MS=5500`
- `LLM_MAX_MESSAGE_CHARS=1200`
- `CHATBOT_FAST_ONLY=true`
- `CHATBOT_TIMEOUT_MS=12000`
- `CHATBOT_CACHE_TTL_MS=120000`
- `CHATBOT_MAX_REPLY_CHARS=1400`

### Voorbeeld payloads

```json
POST /ai/recommendations
{
  "userProfile": {
    "preferredGenres": ["indie", "rock"],
    "lat": 50.8503,
    "lng": 4.3517,
    "maxDistanceKm": 30,
    "likedEvents": []
  },
  "query": { "classificationName": "music", "maxResults": 120 },
  "limit": 20
}
```

```json
POST /ai/success-predictor
{
  "draftEvent": {
    "title": "New Indie Showcase",
    "description": "Indie and folk artists live",
    "genre": "Indie",
    "city": "Brussels",
    "start": "2026-04-17T19:30:00Z",
    "cost": 18
  }
}
```

---

## Deploy op Vercel + Managed Postgres

Postgres draait niet op Vercel. Gebruik een managed DB (Neon, Supabase, Render, RDS, ...).

### 1) Backend deployen (deze map `Eventify/`)

- Vercel config staat in `vercel.json`
- API draait als Node Serverless Functions:
  - `api/[...all].js` -> Express app
  - `api/cron/sync.js` -> scheduled sync endpoint
- Belangrijke runtime routes:
  - `GET /api/health`
  - `GET /api/events`
  - `POST /api/chatbot`
  - `POST /api/copilot`

### 2) Environment variables in Vercel

Minimaal:
- `DATABASE_URL` = managed Postgres connection string
- `DATABASE_SSL=require` (meestal nodig bij managed providers)
- `JWT_SECRET` = sterke random string (>= 32 chars)
- `CORS_ORIGINS` = frontend origin(s)
- `CRON_SECRET` = random secret voor cron endpoint authenticatie
- `CORS_ALLOW_VERCEL_APP=true` (handig voor Vercel preview/frontends op `*.vercel.app`)
- `CORS_ALLOW_ALL=false` (alleen tijdelijk op `true` zetten voor CORS-debugging)

Optioneel maar aanbevolen:
- `TICKETMASTER_API_KEY`
- `SETLISTFM_API_KEY`
- `LLM_PROVIDER=openai`
- `LLM_ENABLED=true`
- `LLM_API_KEY` (voor chatbot/copilot intent parsing op Vercel)
- `API_BASE_URL=https://<jouw-app>.vercel.app/api` (of leeg laten voor auto-detect in cron)

### 3) Scheduled sync (Vercel Cron)

- `vercel.json` bevat standaard een hourly cron:
  - `path: /api/cron/sync`
  - `schedule: 0 * * * *`
- Endpoint verwacht `CRON_SECRET` (Bearer token of query `?secret=` voor manuele test).
- Manueel testen:
  - `GET https://<jouw-app>.vercel.app/api/cron/sync?secret=<CRON_SECRET>`

### 4) Frontend koppelen

- Voor aparte frontend deploy: zet `VITE_API_BASE_URL=https://<backend>.vercel.app/api`
- Voor frontend + backend in dezelfde Vercel app: zet `VITE_API_BASE_URL=/api`
