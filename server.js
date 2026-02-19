const express = require("express");
const axios = require("axios");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

// -----------------------------
// Helpers
// -----------------------------
function dedupe(events) {
  const seen = new Set();
  const out = [];
  for (const e of events) {
    const day = (e.start || "").slice(0, 10);
    const key = `${e.title}`.toLowerCase().trim() + "|" + day + "|" + (e.city || "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

// Avoid hammering setlist.fm (rate limits). Keep small.
async function mapSequential(items, fn) {
  const out = [];
  for (const it of items) out.push(await fn(it));
  return out;
}

// -----------------------------
// Ticketmaster (future/upcoming events)
// -----------------------------
async function fetchTicketmaster({
  keyword,
  lat,
  lng,
  radiusKm = 30,
  size = 10,
  classificationName = "music",
}) {
  const url = "https://app.ticketmaster.com/discovery/v2/events.json";

  const latlong =
    lat != null && lng != null && !Number.isNaN(lat) && !Number.isNaN(lng)
      ? `${lat},${lng}`
      : undefined;

  const { data } = await axios.get(url, {
    params: {
      apikey: process.env.TICKETMASTER_API_KEY,
      classificationName,
      keyword: keyword || undefined,
      latlong,
      radius: radiusKm,
      unit: "km",
      size,
      sort: "date,asc",
    },
    timeout: 15000,
  });

  const events = data?._embedded?.events ?? [];

  function pickTicketmasterImage(images) {
    if (!Array.isArray(images) || images.length === 0) return null;

    const exact169 = images
      .filter((img) => img && img.url && img.ratio === "16_9")
      .sort((a, b) => (Number(b.width) || 0) - (Number(a.width) || 0));
    if (exact169.length > 0) return exact169[0].url;

    const any = images
      .filter((img) => img && img.url)
      .sort((a, b) => (Number(b.width) || 0) - (Number(a.width) || 0));
    return any.length > 0 ? any[0].url : null;
  }

  return events.map((e) => {
    const venue = e?._embedded?.venues?.[0];
    const attraction = e?._embedded?.attractions?.[0];
    const classification = e?.classifications?.[0];
    const genre =
      classification?.genre?.name ||
      classification?.subGenre?.name ||
      classification?.segment?.name ||
      classificationName ||
      null;

    return {
      source: "ticketmaster",
      sourceId: String(e.id),
      title: e.name,
      start: e.dates?.start?.dateTime || e.dates?.start?.localDate || null,
      venue: venue?.name || null,
      city: venue?.city?.name || null,
      lat: venue?.location?.latitude ? Number(venue.location.latitude) : null,
      lng: venue?.location?.longitude ? Number(venue.location.longitude) : null,
      url: e.url || null,
      imageUrl: pickTicketmasterImage(e?.images),
      genre,

      // Useful for setlist enrichment:
      artistName: attraction?.name || null,
    };
  });
}

// -----------------------------
// setlist.fm (historical setlists)
// -----------------------------
function requireSetlistFmKey() {
  if (!process.env.SETLISTFM_API_KEY) {
    throw new Error("Missing SETLISTFM_API_KEY in .env");
  }
}

async function fetchSetlistFmSetlistsByArtistName({ artistName, page = 1 }) {
  requireSetlistFmKey();

  const url = "https://api.setlist.fm/rest/1.0/search/setlists";
  const { data } = await axios.get(url, {
    params: {
      artistName,
      p: page,
    },
    headers: {
      "x-api-key": process.env.SETLISTFM_API_KEY,
      Accept: "application/json",
      // "Accept-Language": "en", // optional
    },
    timeout: 15000,
  });

  const list = data?.setlist ?? [];
  return {
    total: Number(data?.total) || null,
    items: list.map((s) => ({
      id: s?.id || null,
      eventDate: s?.eventDate || null, // dd-MM-yyyy
      tour: s?.tour?.name || null,
      venue: s?.venue?.name || null,
      city: s?.venue?.city?.name || null,
      country: s?.venue?.city?.country?.name || null,
      url: s?.url || null,
    })),
  };
}

async function fetchSetlistFmSetlistsByCityName({ cityName, page = 1 }) {
  requireSetlistFmKey();

  const url = "https://api.setlist.fm/rest/1.0/search/setlists";
  const { data } = await axios.get(url, {
    params: {
      cityName,
      p: page,
    },
    headers: {
      "x-api-key": process.env.SETLISTFM_API_KEY,
      Accept: "application/json",
    },
    timeout: 15000,
  });

  const list = data?.setlist ?? [];
  return {
    total: Number(data?.total) || null,
    items: list.map((s) => ({
      id: s?.id || null,
      eventDate: s?.eventDate || null,
      artist: s?.artist?.name || null,
      venue: s?.venue?.name || null,
      city: s?.venue?.city?.name || null,
      country: s?.venue?.city?.country?.name || null,
      url: s?.url || null,
    })),
  };
}

// -----------------------------
// Endpoints
// -----------------------------

/**
 * GET /events
 * Query params:
 * - lat, lng, radiusKm (variables)
 * - keyword (optional)
 * - size (optional)
 * - includeSetlists=1 (optional; enrich with setlist.fm for artists)
 * - setlistsPerArtist (optional; default 3)
 * - maxArtists (optional; default 5)  // to avoid rate limits
 *
 * Examples:
 * /events?lat=50.8503&lng=4.3517&radiusKm=30
 * /events?keyword=rock&lat=50.8503&lng=4.3517&radiusKm=30&includeSetlists=1
 */
app.get("/events", async (req, res) => {
  try {
    const {
      keyword = "",
      lat = "50.8503",
      lng = "4.3517",
      radiusKm = "30",
      classificationName = "music",
      size = "10",

      includeSetlists = "0",
      setlistsPerArtist = "3",
      maxArtists = "5",
    } = req.query;

    const latNum = Number(lat);
    const lngNum = Number(lng);
    const radiusNum = Number(radiusKm);
    const sizeNum = Number(size);

    if (Number.isNaN(latNum) || Number.isNaN(lngNum)) {
      return res.status(400).json({
        ok: false,
        error: "Invalid lat/lng. Example: lat=50.8503&lng=4.3517",
      });
    }
    if (Number.isNaN(radiusNum) || radiusNum <= 0) {
      return res.status(400).json({
        ok: false,
        error: "Invalid radiusKm. Example: radiusKm=30",
      });
    }

    const tmEvents = await fetchTicketmaster({
      keyword,
      lat: latNum,
      lng: lngNum,
      radiusKm: radiusNum,
      size: sizeNum,
      classificationName,
    });

    let events = dedupe(tmEvents).slice(0, 30);

    // Optional enrichment with setlist.fm
    const wantSetlists = String(includeSetlists) === "1";
    if (wantSetlists) {
      // Collect unique artist names
      const artists = [];
      const seen = new Set();
      for (const e of events) {
        const name = (e.artistName || "").trim();
        if (!name) continue;
        const key = name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        artists.push(name);
      }

      const maxA = Math.max(0, Number(maxArtists) || 0);
      const perArtist = Math.max(1, Number(setlistsPerArtist) || 3);
      const selected = artists.slice(0, maxA);

      // Fetch sequentially to reduce chance of rate-limit issues
      const artistToSetlists = {};
      await mapSequential(selected, async (artistName) => {
        try {
          const result = await fetchSetlistFmSetlistsByArtistName({ artistName, page: 1 });
          artistToSetlists[artistName] = {
            total: result.total,
            items: (result.items || []).slice(0, perArtist),
          };
        } catch (err) {
          artistToSetlists[artistName] = { error: String(err) };
        }
      });

      // Attach to events
      events = events.map((e) => {
        if (!e.artistName) return e;
        const payload = artistToSetlists[e.artistName];
        if (!payload) return e;
        return { ...e, setlistFm: payload };
      });
    }

    return res.json({
      ok: true,
      keyword,
      lat: latNum,
      lng: lngNum,
      radiusKm: radiusNum,
      classificationName,
      includeSetlists: wantSetlists,
      count: events.length,
      events,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

/**
 * GET /setlists
 * Query params:
 * - artistName=Coldplay OR cityName=Brussels
 * - page=1
 *
 * Examples:
 * /setlists?artistName=Coldplay
 * /setlists?cityName=Brussels
 */
app.get("/setlists", async (req, res) => {
  try {
    const { artistName, cityName, page = "1" } = req.query;
    const pageNum = Number(page) || 1;

    if (!artistName && !cityName) {
      return res.status(400).json({
        ok: false,
        error: "Provide artistName or cityName. Example: /setlists?artistName=Coldplay",
      });
    }

    if (artistName) {
      const result = await fetchSetlistFmSetlistsByArtistName({ artistName, page: pageNum });
      return res.json({ ok: true, mode: "artistName", artistName, page: pageNum, ...result });
    }

    const result = await fetchSetlistFmSetlistsByCityName({ cityName, page: pageNum });
    return res.json({ ok: true, mode: "cityName", cityName, page: pageNum, ...result });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

// -----------------------------
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`));
