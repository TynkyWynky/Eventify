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
- `SCRAPE_EVENTBRITE_DETAIL_LOOKUP=true`
- `SCRAPE_EVENTBRITE_DETAIL_ENRICH_LIMIT=8`
- `SCRAPE_EVENTBRITE_DETAIL_TIMEOUT_MS=10000`

### Snelle test

1. Zet minstens 1 URL in `SCRAPE_SOURCE_URLS`
2. Start API: `npm run start`
3. Vraag events op:
   - `http://localhost:3000/events?includeScraped=1`
4. Start sync:
   - `npm run sync:once`
