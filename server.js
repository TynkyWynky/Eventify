const express = require("express");
const axios = require("axios");
const cors = require("cors");
require("dotenv").config();
const {
  DEFAULT_USER_AGENT,
  fetchScrapedEvents,
  parseDelimitedUrls,
} = require("./webScraper");
const {
  DEFAULT_RECOMMENDATION_WEIGHTS,
  DEFAULT_RADAR_THRESHOLDS,
  predictGenresFromText,
  predictGenresForEvent,
  recommendEvents,
  buildUndergroundRadar,
  buildTasteDNA,
  predictEventSuccess,
} = require("./aiEngine");

const app = express();
app.use(cors());
app.use(express.json());

// -----------------------------
// Helpers
// -----------------------------
function toBool(value, fallback = false) {
  if (value == null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function toPositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function parseDelimitedList(rawValue) {
  if (!rawValue) return [];
  const seen = new Set();
  const out = [];
  for (const raw of String(rawValue).split(/[,\n]/)) {
    const value = cleanText(raw);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function cleanText(value) {
  if (value == null) return null;
  const text = String(value).replace(/\s+/g, " ").trim();
  return text || null;
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of tags) {
    const tag = cleanText(raw);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

function toNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function resolveMergedIsFree(primary, secondary, merged) {
  const costCandidates = [
    primary?.cost,
    primary?.priceMin,
    primary?.priceMax,
    secondary?.cost,
    secondary?.priceMin,
    secondary?.priceMax,
    merged?.cost,
    merged?.priceMin,
    merged?.priceMax,
  ]
    .map((value) => toNumberOrNull(value))
    .filter((value) => value != null);

  if (costCandidates.some((value) => value > 0)) return false;
  if (costCandidates.some((value) => value === 0)) return true;

  const flags = [primary?.isFree, secondary?.isFree].filter(
    (value) => typeof value === "boolean"
  );

  if (flags.includes(false)) return false;
  if (flags.includes(true)) return true;
  return false;
}

function normalizeCountryValue(value) {
  const normalized = cleanText(value)?.toLowerCase();
  if (!normalized) return null;
  if (
    ["be", "belgium", "belgique", "belgie", "kingdom of belgium"].includes(
      normalized
    )
  ) {
    return "belgium";
  }
  return normalized;
}

function normalizeKeyPart(value) {
  const clean = cleanText(value);
  if (!clean) return "";
  return clean
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeTitleForKey(value) {
  const key = normalizeKeyPart(value);
  if (!key) return "";
  return key
    .replace(/\b(19|20)\d{2}\b/g, " ")
    .replace(/\b(live|tickets|official|tour|concert|show)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getDateKey(startValue) {
  const clean = cleanText(startValue);
  if (!clean) return "";
  const dt = new Date(clean);
  if (Number.isNaN(dt.getTime())) return clean.slice(0, 10);
  return dt.toISOString().slice(0, 10);
}

function getTimeKey(startValue) {
  const clean = cleanText(startValue);
  if (!clean) return "";
  const dt = new Date(clean);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toISOString().slice(11, 16);
}

function buildDedupKeys(event) {
  const source = normalizeKeyPart(event?.source);
  const sourceId = normalizeKeyPart(event?.sourceId);
  const title = normalizeTitleForKey(event?.title);
  const day = getDateKey(event?.start);
  const time = getTimeKey(event?.start);
  const city = normalizeKeyPart(event?.city);
  const venue = normalizeKeyPart(event?.venue);
  const artist = normalizeKeyPart(event?.artistName);

  const keys = new Set();
  if (source && sourceId) {
    keys.add(`source|${source}|${sourceId}`);
  }
  if (title && day && city && venue && time) {
    keys.add(`strict|${title}|${day}|${time}|${city}|${venue}`);
  }
  if (title && day && city && venue && !time) {
    keys.add(`strict_day|${title}|${day}|${city}|${venue}`);
  }
  if (title && day && city && !time) {
    keys.add(`cityday|${title}|${day}|${city}`);
  }
  if (title && day && venue && !time) {
    keys.add(`venueday|${title}|${day}|${venue}`);
  }
  if (title && day && time) {
    keys.add(`titledaytime|${title}|${day}|${time}`);
  }
  if (artist && day && venue && time) {
    keys.add(`artist|${artist}|${day}|${time}|${venue}`);
  }
  if (artist && day && venue && !time) {
    keys.add(`artist_day|${artist}|${day}|${venue}`);
  }

  return [...keys];
}

function scoreEventQuality(event) {
  let score = 0;

  if (cleanText(event?.title)) score += 2;
  if (cleanText(event?.start)) score += 2;
  if (cleanText(event?.venue)) score += 1;
  if (cleanText(event?.city)) score += 1;
  if (cleanText(event?.country)) score += 1;
  if (toNumberOrNull(event?.lat) != null && toNumberOrNull(event?.lng) != null) {
    score += 2;
  }
  if (cleanText(event?.imageUrl)) score += 1;
  if (cleanText(event?.ticketUrl) || cleanText(event?.url)) score += 1;
  if (cleanText(event?.description) && cleanText(event?.description).length >= 40) {
    score += 1;
  }
  if (Array.isArray(event?.tags) && event.tags.length > 0) score += 1;

  const source = normalizeKeyPart(event?.source);
  if (source === "ticketmaster") score += 2;
  if (source === "webscrape") score += 1;

  return score;
}

function mergeEventsPrefer(primary, secondary) {
  const merged = { ...primary };
  const fillKeys = [
    "description",
    "end",
    "timezone",
    "address",
    "state",
    "country",
    "postalCode",
    "lat",
    "lng",
    "virtualLink",
    "cost",
    "priceMin",
    "priceMax",
    "currency",
    "ticketUrl",
    "url",
    "imageUrl",
    "genre",
    "category",
    "organizerName",
    "artistName",
  ];

  for (const key of fillKeys) {
    const current = merged[key];
    const candidate = secondary[key];
    const hasCurrent =
      current != null && !(typeof current === "string" && cleanText(current) == null);
    const hasCandidate =
      candidate != null &&
      !(typeof candidate === "string" && cleanText(candidate) == null);
    if (!hasCurrent && hasCandidate) {
      merged[key] = candidate;
    }
  }

  merged.isFree = resolveMergedIsFree(primary, secondary, merged);
  merged.isVirtual = Boolean(primary?.isVirtual || secondary?.isVirtual);

  const tags = new Set([...(primary?.tags || []), ...(secondary?.tags || [])]);
  merged.tags = [...tags].filter(Boolean);

  return merged;
}

function dedupe(events) {
  const keyToIndex = new Map();
  const out = [];

  for (const candidate of events) {
    const keys = buildDedupKeys(candidate);

    let existingIndex = null;
    for (const key of keys) {
      if (keyToIndex.has(key)) {
        existingIndex = keyToIndex.get(key);
        break;
      }
    }

    if (existingIndex == null) {
      const nextIndex = out.length;
      out.push(candidate);
      for (const key of keys) keyToIndex.set(key, nextIndex);
      continue;
    }

    const current = out[existingIndex];
    const currentScore = scoreEventQuality(current);
    const candidateScore = scoreEventQuality(candidate);

    let winner = current;
    let loser = candidate;
    if (candidateScore > currentScore) {
      winner = candidate;
      loser = current;
    } else if (candidateScore === currentScore) {
      const currentSource = normalizeKeyPart(current?.source);
      const candidateSource = normalizeKeyPart(candidate?.source);
      const sourceRank = {
        ticketmaster: 3,
        webscrape: 2,
      };
      const currentRank = sourceRank[currentSource] || 1;
      const candidateRank = sourceRank[candidateSource] || 1;
      if (candidateRank > currentRank) {
        winner = candidate;
        loser = current;
      }
    }

    out[existingIndex] = mergeEventsPrefer(winner, loser);
    const mergedKeys = new Set([
      ...buildDedupKeys(out[existingIndex]),
      ...buildDedupKeys(current),
      ...keys,
    ]);
    for (const key of mergedKeys) keyToIndex.set(key, existingIndex);
  }
  return out;
}

function interleaveBySource(events, limit) {
  const maxItems = Math.max(1, Number(limit) || events.length || 1);
  const groups = new Map();

  for (const event of events) {
    const source = (cleanText(event?.source) || "unknown").toLowerCase();
    if (!groups.has(source)) groups.set(source, []);
    groups.get(source).push(event);
  }

  const sourceOrder = [...groups.keys()].sort(
    (a, b) => groups.get(b).length - groups.get(a).length
  );

  const out = [];
  while (out.length < maxItems) {
    let added = false;
    for (const source of sourceOrder) {
      const queue = groups.get(source);
      if (!queue || queue.length === 0) continue;
      out.push(queue.shift());
      added = true;
      if (out.length >= maxItems) break;
    }
    if (!added) break;
  }

  return out;
}

// Avoid hammering setlist.fm (rate limits). Keep small.
async function mapSequential(items, fn) {
  const out = [];
  for (const it of items) out.push(await fn(it));
  return out;
}

function summarizeSources(events) {
  const counts = {};
  for (const event of events) {
    const source = cleanText(event.source) || "unknown";
    counts[source] = (counts[source] || 0) + 1;
  }
  return counts;
}

const SCRAPE_CONFIG = {
  enabled: toBool(process.env.SCRAPE_ENABLED, true),
  sourceUrls: parseDelimitedUrls(process.env.SCRAPE_SOURCE_URLS),
  maxEvents: toPositiveInt(process.env.SCRAPE_MAX_EVENTS, 40),
  maxEventsPerSource: toPositiveInt(
    process.env.SCRAPE_MAX_EVENTS_PER_SOURCE,
    25
  ),
  maxLinksPerSource: toPositiveInt(process.env.SCRAPE_MAX_LINKS_PER_SOURCE, 20),
  timeoutMs: toPositiveInt(process.env.SCRAPE_TIMEOUT_MS, 12000),
  userAgent:
    cleanText(process.env.SCRAPE_USER_AGENT) || DEFAULT_USER_AGENT,
  sourceConcurrency: toPositiveInt(process.env.SCRAPE_SOURCE_CONCURRENCY, 3),
  allowedCountries: parseDelimitedList(process.env.SCRAPE_ALLOWED_COUNTRIES),
  allowedCities: parseDelimitedList(process.env.SCRAPE_ALLOWED_CITIES),
  songkickOfficialLookup: toBool(
    process.env.SCRAPE_SONGKICK_OFFICIAL_LOOKUP,
    true
  ),
  songkickOfficialEnrichLimit: toPositiveInt(
    process.env.SCRAPE_SONGKICK_OFFICIAL_ENRICH_LIMIT,
    12
  ),
  songkickTicketTimeoutMs: toPositiveInt(
    process.env.SCRAPE_SONGKICK_TICKET_TIMEOUT_MS,
    10000
  ),
  officialPageTimeoutMs: toPositiveInt(
    process.env.SCRAPE_OFFICIAL_PAGE_TIMEOUT_MS,
    10000
  ),
  enableOfficialPageEnrichment: toBool(
    process.env.SCRAPE_ENABLE_OFFICIAL_PAGE_ENRICHMENT,
    true
  ),
  eventbriteDetailLookup: toBool(
    process.env.SCRAPE_EVENTBRITE_DETAIL_LOOKUP,
    true
  ),
  eventbriteDetailEnrichLimit: toPositiveInt(
    process.env.SCRAPE_EVENTBRITE_DETAIL_ENRICH_LIMIT,
    8
  ),
  eventbriteDetailTimeoutMs: toPositiveInt(
    process.env.SCRAPE_EVENTBRITE_DETAIL_TIMEOUT_MS,
    10000
  ),
};

const SCRAPE_CACHE_CONFIG = {
  ttlMs: toPositiveInt(process.env.SCRAPE_CACHE_TTL_MS, 15 * 60 * 1000),
  requestWaitMs: toPositiveInt(process.env.SCRAPE_REQUEST_WAIT_MS, 2500),
};

const scrapeCache = {
  events: [],
  fetchedAt: 0,
  inFlight: null,
  lastError: null,
};

const SCRAPE_ALLOWED_COUNTRIES_NORMALIZED = SCRAPE_CONFIG.allowedCountries
  .map((value) => normalizeCountryValue(value))
  .filter(Boolean);
const SCRAPE_ALLOWED_CITIES_NORMALIZED = SCRAPE_CONFIG.allowedCities
  .map((value) => value.toLowerCase())
  .filter(Boolean);

function isScrapeCacheFresh() {
  if (!Array.isArray(scrapeCache.events) || scrapeCache.events.length === 0) {
    return false;
  }
  const ageMs = Date.now() - scrapeCache.fetchedAt;
  return ageMs >= 0 && ageMs < SCRAPE_CACHE_CONFIG.ttlMs;
}

function getScrapeCacheAgeMs() {
  if (!scrapeCache.fetchedAt) return null;
  const ageMs = Date.now() - scrapeCache.fetchedAt;
  return ageMs >= 0 ? ageMs : 0;
}

function buildScrapeFetchOptions() {
  return {
    sourceUrls: SCRAPE_CONFIG.sourceUrls,
    maxEvents: SCRAPE_CONFIG.maxEvents,
    maxEventsPerSource: SCRAPE_CONFIG.maxEventsPerSource,
    maxLinksPerSource: SCRAPE_CONFIG.maxLinksPerSource,
    timeoutMs: SCRAPE_CONFIG.timeoutMs,
    userAgent: SCRAPE_CONFIG.userAgent,
    sourceConcurrency: SCRAPE_CONFIG.sourceConcurrency,
    songkickOfficialLookup: SCRAPE_CONFIG.songkickOfficialLookup,
    songkickOfficialEnrichLimit: SCRAPE_CONFIG.songkickOfficialEnrichLimit,
    songkickTicketTimeoutMs: SCRAPE_CONFIG.songkickTicketTimeoutMs,
    officialPageTimeoutMs: SCRAPE_CONFIG.officialPageTimeoutMs,
    enableOfficialPageEnrichment: SCRAPE_CONFIG.enableOfficialPageEnrichment,
    eventbriteDetailLookup: SCRAPE_CONFIG.eventbriteDetailLookup,
    eventbriteDetailEnrichLimit: SCRAPE_CONFIG.eventbriteDetailEnrichLimit,
    eventbriteDetailTimeoutMs: SCRAPE_CONFIG.eventbriteDetailTimeoutMs,
  };
}

function startScrapeRefresh() {
  if (scrapeCache.inFlight) return scrapeCache.inFlight;

  scrapeCache.inFlight = (async () => {
    try {
      const events = await fetchScrapedEvents(buildScrapeFetchOptions());
      scrapeCache.events = Array.isArray(events) ? events : [];
      scrapeCache.fetchedAt = Date.now();
      scrapeCache.lastError = null;
      return scrapeCache.events;
    } catch (err) {
      scrapeCache.lastError = String(err?.message || err);
      throw err;
    } finally {
      scrapeCache.inFlight = null;
    }
  })();

  return scrapeCache.inFlight;
}

async function getScrapedEventsForRequest() {
  if (!SCRAPE_CONFIG.enabled || SCRAPE_CONFIG.sourceUrls.length === 0) {
    return { events: [], cacheMode: "disabled", ageMs: null, timedOut: false };
  }

  if (isScrapeCacheFresh()) {
    return {
      events: scrapeCache.events,
      cacheMode: "fresh",
      ageMs: getScrapeCacheAgeMs(),
      timedOut: false,
      lastError: scrapeCache.lastError,
    };
  }

  if (!scrapeCache.inFlight) {
    startScrapeRefresh().catch(() => {
      // Error is captured in scrapeCache.lastError.
    });
  }

  // Serve stale cache immediately while refresh runs in background.
  if (Array.isArray(scrapeCache.events) && scrapeCache.events.length > 0) {
    return {
      events: scrapeCache.events,
      cacheMode: "stale",
      ageMs: getScrapeCacheAgeMs(),
      timedOut: false,
      lastError: scrapeCache.lastError,
    };
  }

  // First-run path: wait briefly for scrape results, then fall back.
  let timedOut = false;
  try {
    await Promise.race([
      scrapeCache.inFlight,
      new Promise((_, reject) =>
        setTimeout(() => {
          timedOut = true;
          reject(new Error("scrape_wait_timeout"));
        }, SCRAPE_CACHE_CONFIG.requestWaitMs)
      ),
    ]);
  } catch (err) {
    const msg = String(err?.message || err);
    if (msg !== "scrape_wait_timeout") {
      scrapeCache.lastError = msg;
    }
  }

  return {
    events: Array.isArray(scrapeCache.events) ? scrapeCache.events : [],
    cacheMode:
      scrapeCache.events.length > 0
        ? timedOut
          ? "warm_after_timeout"
          : "fresh_after_wait"
        : "empty_after_timeout",
    ageMs: getScrapeCacheAgeMs(),
    timedOut,
    lastError: scrapeCache.lastError,
  };
}

function matchesScrapeLocationFilters(event) {
  if (
    SCRAPE_ALLOWED_COUNTRIES_NORMALIZED.length === 0 &&
    SCRAPE_ALLOWED_CITIES_NORMALIZED.length === 0
  ) {
    return true;
  }

  const eventCountry = normalizeCountryValue(event.country);
  const eventCity = cleanText(event.city)?.toLowerCase() || "";

  const countryMatch =
    eventCountry &&
    SCRAPE_ALLOWED_COUNTRIES_NORMALIZED.some(
      (rule) => rule && eventCountry.includes(rule)
    );

  const cityMatch =
    eventCity &&
    SCRAPE_ALLOWED_CITIES_NORMALIZED.some((rule) => {
      if (!rule) return false;
      return eventCity === rule || eventCity.includes(rule);
    });

  return Boolean(countryMatch || cityMatch);
}

function buildSearchBlob(event) {
  return [
    cleanText(event?.title),
    cleanText(event?.description),
    cleanText(event?.genre),
    cleanText(event?.category),
    cleanText(event?.artistName),
    cleanText(event?.organizerName),
    cleanText(event?.venue),
    ...(Array.isArray(event?.tags) ? event.tags.map((tag) => cleanText(tag)) : []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function parseSearchTokens(value) {
  const clean = cleanText(value)?.toLowerCase();
  if (!clean) return [];
  return clean
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .slice(0, 8);
}

function matchesKeywordForScraped(event, keyword) {
  const tokens = parseSearchTokens(keyword);
  if (tokens.length === 0) return true;
  const blob = buildSearchBlob(event);
  if (!blob) return false;
  return tokens.every((token) => blob.includes(token));
}

const MUSIC_POSITIVE_TOKENS = [
  "music",
  "musique",
  "muziek",
  "musik",
  "concert",
  "concerten",
  "konzert",
  "koncert",
  "live",
  "dj",
  "festival",
  "fest",
  "fete",
  "feest",
  "soiree",
  "avond",
  "nacht",
  "gig",
  "rave",
  "party",
  "tour",
  "band",
  "singer",
  "orchestra",
  "symphony",
  "opera",
  "choir",
  "karaoke",
  "showcase",
  "album",
  "hip hop",
  "hip-hop",
  "rap",
  "jazz",
  "blues",
  "rock",
  "metal",
  "pop",
  "techno",
  "house",
  "edm",
  "electronic",
  "electro",
  "electronique",
  "elektronisch",
  "dancehall",
  "afrobeat",
  "amapiano",
  "r&b",
  "rnb",
];

const MUSIC_NEGATIVE_TOKENS = [
  "workshop",
  "atelier",
  "werkplaats",
  "webinar",
  "bootcamp",
  "conference",
  "conferentie",
  "summit",
  "career fair",
  "job fair",
  "jobbeurs",
  "networking",
  "hiring",
  "course",
  "opleiding",
  "formation",
  "training",
  "masterclass",
  "real estate",
  "immobilier",
  "vastgoed",
  "book fair",
  "book launch",
  "dental",
  "medical",
  "tech talk",
  "startup",
  "pitch",
  "hackathon",
];

function scoreMusicLikelihood(event) {
  const blob = buildSearchBlob(event);
  if (!blob) return -1;

  let score = 0;
  for (const token of MUSIC_POSITIVE_TOKENS) {
    if (blob.includes(token)) score += 2;
  }
  for (const token of MUSIC_NEGATIVE_TOKENS) {
    if (blob.includes(token)) score -= 2;
  }

  if (cleanText(event?.genre)?.toLowerCase().includes("music")) score += 3;
  if (cleanText(event?.category)?.toLowerCase().includes("music")) score += 2;
  if (cleanText(event?.artistName)) score += 1;

  return score;
}

function hasMusicPathHint(event) {
  const scrapedFrom = cleanText(event?.metadata?.scrapedFrom)?.toLowerCase() || "";
  const sourceListingUrl =
    cleanText(event?.metadata?.sourceListingUrl)?.toLowerCase() || "";
  const eventUrl = cleanText(event?.url)?.toLowerCase() || "";
  const ticketUrl = cleanText(event?.ticketUrl)?.toLowerCase() || "";
  const pathHintRegex = /(music|concert|festival|gig|live|nightlife)/i;
  return (
    pathHintRegex.test(sourceListingUrl) ||
    pathHintRegex.test(scrapedFrom) ||
    pathHintRegex.test(eventUrl) ||
    pathHintRegex.test(ticketUrl)
  );
}

function isMusicClassification(classificationName) {
  const normalized = cleanText(classificationName)?.toLowerCase() || "";
  if (!normalized) return true;
  return /(music|concert|live)/i.test(normalized);
}

function matchesClassificationForScraped(event, classificationName) {
  const normalized = cleanText(classificationName)?.toLowerCase() || "";
  if (!normalized || ["all", "any", "*"].includes(normalized)) return true;

  if (isMusicClassification(normalized)) {
    const musicScore = scoreMusicLikelihood(event);
    if (musicScore > 0) return true;
    if (musicScore < 0) return false;
    return hasMusicPathHint(event);
  }

  const blob = buildSearchBlob(event);
  if (!blob) return false;
  return blob.includes(normalized);
}

// -----------------------------
// Ticketmaster (future/upcoming events)
// -----------------------------
function mapTicketmasterStatus(statusCode) {
  const code = cleanText(statusCode)?.toLowerCase();
  if (!code) return "published";
  if (["cancelled"].includes(code)) return "cancelled";
  if (["offsale", "postponed", "rescheduled", "moved"].includes(code)) {
    return "published";
  }
  return "published";
}

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

function cleanTicketmasterText(value) {
  const clean = cleanText(value);
  if (!clean) return null;
  const noHtml = clean.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return noHtml || null;
}

function buildTicketmasterDescription(event, attraction, venue, promoter) {
  const candidates = [
    cleanTicketmasterText(event?.description),
    cleanTicketmasterText(event?.info),
    cleanTicketmasterText(event?.pleaseNote),
    cleanTicketmasterText(event?.additionalInfo),
    cleanTicketmasterText(event?.accessibility?.info),
    cleanTicketmasterText(attraction?.info),
    cleanTicketmasterText(attraction?.additionalInfo),
    cleanTicketmasterText(attraction?.description),
    cleanTicketmasterText(promoter?.description),
    cleanTicketmasterText(venue?.generalInfo?.generalRule),
    cleanTicketmasterText(venue?.generalInfo?.childRule),
  ].filter(Boolean);

  if (candidates.length === 0) return null;

  const unique = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const key = normalizeKeyPart(candidate);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(candidate);
  }

  if (unique.length === 0) return null;
  const joined = unique.join(" ");
  return joined.length > 900 ? `${joined.slice(0, 897)}...` : joined;
}

function extractTicketmasterPrice(event) {
  const readRangeValues = (ranges) => {
    const values = [];
    let rangeCurrency = null;
    if (!Array.isArray(ranges)) return { values, currency: rangeCurrency };
    for (const range of ranges) {
      const min = toNumberOrNull(range?.min);
      const max = toNumberOrNull(range?.max);
      if (min != null) values.push(min);
      if (max != null) values.push(max);
      if (!rangeCurrency) {
        rangeCurrency = cleanText(
          range?.currency || range?.currencyCode || range?.cur
        );
      }
    }
    return { values, currency: rangeCurrency };
  };

  const summarize = (values, currency) => {
    const positives = values.filter((value) => value > 0);
    if (positives.length > 0) {
      return {
        min: Math.min(...positives),
        max: Math.max(...positives),
        cost: Math.min(...positives),
        currency: currency || null,
        isFree: false,
      };
    }
    return null;
  };

  const topLevel = readRangeValues(event?.priceRanges);
  const topSummary = summarize(topLevel.values, topLevel.currency);
  if (topSummary) return topSummary;

  if (topLevel.values.length > 0 && topLevel.values.every((value) => value === 0)) {
    return {
      min: 0,
      max: 0,
      cost: 0,
      currency: topLevel.currency || null,
      isFree: true,
    };
  }

  const nestedValues = [];
  let nestedCurrency = topLevel.currency || null;
  const feeLikeRegex = /(fee|delivery|shipping|service|handling|order|payment|charge|facility)/i;

  const walkNested = (node, path = []) => {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach((item, index) => walkNested(item, path.concat(String(index))));
      return;
    }
    if (typeof node !== "object") return;

    const pathKey = normalizeKeyPart(path.join("."));
    const metaKey = normalizeKeyPart(
      [
        cleanText(node.type),
        cleanText(node.name),
        cleanText(node.title),
        cleanText(node.description),
        cleanText(node.label),
      ]
        .filter(Boolean)
        .join(" ")
    );
    const feeLike = feeLikeRegex.test(`${pathKey} ${metaKey}`);

    if (!feeLike) {
      const min = toNumberOrNull(node.min);
      const max = toNumberOrNull(node.max);
      if (min != null && min > 0) nestedValues.push(min);
      if (max != null && max > 0) nestedValues.push(max);

      if (node.price && typeof node.price === "object") {
        const amount = toNumberOrNull(
          node.price.amount ??
            node.price.value ??
            node.price.total ??
            node.price.listPrice
        );
        if (amount != null && amount > 0) nestedValues.push(amount);
        if (!nestedCurrency) {
          nestedCurrency = cleanText(
            node.price.currency || node.price.currencyCode
          );
        }
      }

      const directAmount = toNumberOrNull(node.amount ?? node.value ?? node.listPrice);
      if (directAmount != null && directAmount > 0) nestedValues.push(directAmount);
      if (!nestedCurrency) {
        nestedCurrency = cleanText(
          node.currency || node.currencyCode || node.cur
        );
      }
    }

    for (const [key, value] of Object.entries(node)) {
      walkNested(value, path.concat(key));
    }
  };

  walkNested(event?.products, ["products"]);
  walkNested(event?.offers, ["offers"]);

  const nestedSummary = summarize(nestedValues, nestedCurrency);
  if (nestedSummary) return nestedSummary;

  const freeHint = normalizeKeyPart(
    [
      cleanText(event?.name),
      cleanText(event?.info),
      cleanText(event?.description),
      cleanText(event?.pleaseNote),
      cleanText(event?.additionalInfo),
    ]
      .filter(Boolean)
      .join(" ")
  );
  const explicitFree = /\b(free (entry|admission|event|concert|show|ticket)|entry free|admission free|gratis (toegang|inkom|concert|event)|gratuit(e)? (entree|acces|concert|evenement)|kostenlos(e)? (eintritt|ticket)|vrije toegang)\b/i.test(
    freeHint || ""
  );
  if (explicitFree) {
    return {
      min: 0,
      max: 0,
      cost: 0,
      currency: nestedCurrency || null,
      isFree: true,
    };
  }

  return {
    min: null,
    max: null,
    cost: null,
    currency: nestedCurrency || null,
    isFree: false,
  };
}

function mapTicketmasterEvent(e, { classificationName = "music" } = {}) {
  const venue = e?._embedded?.venues?.[0];
  const attraction = e?._embedded?.attractions?.[0];
  const classification = e?.classifications?.[0];
  const promoter = e?.promoter || e?.promoters?.[0];
  const addressLine = [
    cleanText(venue?.address?.line1),
    cleanText(venue?.address?.line2),
  ]
    .filter(Boolean)
    .join(", ");
  const genre =
    classification?.genre?.name ||
    classification?.subGenre?.name ||
    classification?.segment?.name ||
    classificationName ||
    null;
  const category =
    classification?.segment?.name ||
    classification?.genre?.name ||
    classificationName ||
    null;
  const tags = normalizeTags([
    classification?.segment?.name,
    classification?.genre?.name,
    classification?.subGenre?.name,
    attraction?.name,
  ]);
  const priceInfo = extractTicketmasterPrice(e);
  const ticketUrl = cleanText(e.url);
  const start = e.dates?.start?.dateTime || e.dates?.start?.localDate || null;

  return {
    source: "ticketmaster",
    sourceId: String(e.id),
    title: e.name,
    description: buildTicketmasterDescription(e, attraction, venue, promoter),
    start,
    end: e.dates?.end?.dateTime || e.dates?.end?.localDate || null,
    timezone: cleanText(e.dates?.timezone) || "UTC",
    venue: venue?.name || null,
    address: addressLine || cleanText(venue?.name),
    city: venue?.city?.name || null,
    state: venue?.state?.name || null,
    country: venue?.country?.name || null,
    postalCode: venue?.postalCode || null,
    lat: venue?.location?.latitude ? Number(venue.location.latitude) : null,
    lng: venue?.location?.longitude ? Number(venue.location.longitude) : null,
    isVirtual: false,
    virtualLink: null,
    isFree: priceInfo.isFree,
    cost: priceInfo.cost,
    priceMin: priceInfo.min,
    priceMax: priceInfo.max,
    currency: priceInfo.currency,
    url: ticketUrl,
    ticketUrl,
    imageUrl: pickTicketmasterImage(e?.images),
    genre,
    category,
    tags,
    status: mapTicketmasterStatus(e?.dates?.status?.code),
    organizerName: cleanText(promoter?.name),

    // Useful for setlist enrichment:
    artistName: attraction?.name || null,

    metadata: {
      ticketmasterStatus: cleanText(e?.dates?.status?.code),
      priceMin: priceInfo.min,
      priceMax: priceInfo.max,
    },
  };
}

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
  return events.map((e) => mapTicketmasterEvent(e, { classificationName }));
}

async function fetchTicketmasterEventById({
  sourceId,
  classificationName = "music",
}) {
  const cleanId = cleanText(sourceId);
  if (!cleanId) return null;
  const url = `https://app.ticketmaster.com/discovery/v2/events/${encodeURIComponent(
    cleanId
  )}.json`;

  const { data } = await axios.get(url, {
    params: {
      apikey: process.env.TICKETMASTER_API_KEY,
    },
    timeout: 15000,
  });

  if (!data || !data.id) return null;
  return mapTicketmasterEvent(data, { classificationName });
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

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

async function resolveEventsForAi({ events, query = {} } = {}) {
  if (Array.isArray(events) && events.length > 0) {
    return dedupe(events).slice(0, 300);
  }

  const safeQuery = objectOrEmpty(query);
  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  const endpoint = `http://127.0.0.1:${port}/events`;

  const params = {
    keyword: cleanText(safeQuery.keyword) || undefined,
    lat: Number.isFinite(Number(safeQuery.lat))
      ? Number(safeQuery.lat)
      : 50.8503,
    lng: Number.isFinite(Number(safeQuery.lng))
      ? Number(safeQuery.lng)
      : 4.3517,
    radiusKm: Number.isFinite(Number(safeQuery.radiusKm))
      ? Number(safeQuery.radiusKm)
      : 30,
    classificationName: cleanText(safeQuery.classificationName) || "music",
    size: Number.isFinite(Number(safeQuery.size))
      ? Math.max(1, Number(safeQuery.size))
      : 40,
    maxResults: Number.isFinite(Number(safeQuery.maxResults))
      ? Math.max(1, Number(safeQuery.maxResults))
      : 120,
    includeScraped: toBool(safeQuery.includeScraped, true) ? 1 : 0,
    includeSetlists: 0,
  };

  const { data } = await axios.get(endpoint, {
    params,
    timeout: 45000,
  });

  if (!data || data.ok !== true || !Array.isArray(data.events)) {
    throw new Error("Failed to resolve events for AI endpoints.");
  }

  return data.events;
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
      maxResults = "80",
      includeScraped = "1",

      includeSetlists = "0",
      setlistsPerArtist = "3",
      maxArtists = "5",
    } = req.query;

    const latNum = Number(lat);
    const lngNum = Number(lng);
    const radiusNum = Number(radiusKm);
    const sizeNum = Number(size);
    const maxResultsNum = toPositiveInt(maxResults, 80);

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

    const sourceErrors = [];
    const tmPromise = fetchTicketmaster({
      keyword,
      lat: latNum,
      lng: lngNum,
      radiusKm: radiusNum,
      size: sizeNum,
      classificationName,
    }).catch((err) => {
      sourceErrors.push({ source: "ticketmaster", error: String(err.message || err) });
      return [];
    });

    const wantScraped =
      toBool(includeScraped, true) &&
      SCRAPE_CONFIG.enabled &&
      SCRAPE_CONFIG.sourceUrls.length > 0;

    const scrapePromise = wantScraped
      ? getScrapedEventsForRequest().catch((err) => {
          sourceErrors.push({ source: "webscrape", error: String(err.message || err) });
          return {
            events: [],
            cacheMode: "error",
            ageMs: null,
            timedOut: false,
            lastError: String(err.message || err),
          };
        })
      : Promise.resolve({
          events: [],
          cacheMode: "disabled",
          ageMs: null,
          timedOut: false,
          lastError: null,
        });

    const [tmEvents, scrapeResult] = await Promise.all([tmPromise, scrapePromise]);
    const scrapedEventsRaw = scrapeResult.events || [];
    const scrapedLocationFiltered = scrapedEventsRaw.filter(
      matchesScrapeLocationFilters
    );
    const scrapedClassificationFiltered = scrapedLocationFiltered.filter((event) =>
      matchesClassificationForScraped(event, classificationName)
    );
    const scrapedEvents = scrapedClassificationFiltered.filter((event) =>
      matchesKeywordForScraped(event, keyword)
    );
    const scrapeFilteredOut = Math.max(
      0,
      scrapedEventsRaw.length - scrapedEvents.length
    );
    const scrapeFilterStats = {
      raw: scrapedEventsRaw.length,
      afterLocation: scrapedLocationFiltered.length,
      afterClassification: scrapedClassificationFiltered.length,
      afterKeyword: scrapedEvents.length,
    };
    if (scrapeResult.lastError) {
      sourceErrors.push({ source: "webscrape-cache", error: scrapeResult.lastError });
    }
    const combinedEvents = dedupe([...tmEvents, ...scrapedEvents]);
    let events = interleaveBySource(combinedEvents, maxResultsNum);

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

    if (events.length === 0 && sourceErrors.length > 0) {
      return res.status(502).json({
        ok: false,
        error: "All event sources failed. Check API keys and scrape source URLs.",
        sourcesFailed: sourceErrors,
      });
    }

    return res.json({
      ok: true,
      keyword,
      lat: latNum,
      lng: lngNum,
      radiusKm: radiusNum,
      classificationName,
      includeScraped: wantScraped,
      scrapeConfiguredSources: SCRAPE_CONFIG.sourceUrls.length,
      scrapeLocationFilters: {
        allowedCountries: SCRAPE_CONFIG.allowedCountries,
        allowedCities: SCRAPE_CONFIG.allowedCities,
      },
      scrapeFilteredOut,
      scrapeFilterStats,
      scrapeCache: {
        mode: scrapeResult.cacheMode,
        ageMs: scrapeResult.ageMs,
        timedOut: scrapeResult.timedOut,
        ttlMs: SCRAPE_CACHE_CONFIG.ttlMs,
        waitMs: SCRAPE_CACHE_CONFIG.requestWaitMs,
      },
      includeSetlists: wantSetlists,
      sourceCounts: summarizeSources(events),
      sourceWarnings: sourceErrors.length > 0 ? sourceErrors : undefined,
      count: events.length,
      events,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

/**
 * GET /events/enrich
 * Query params:
 * - source=ticketmaster
 * - sourceId=<ticketmaster event id>
 * - classificationName=music (optional)
 */
app.get("/events/enrich", async (req, res) => {
  try {
    const source = cleanText(req.query.source)?.toLowerCase() || "";
    const sourceId = cleanText(req.query.sourceId);
    const classificationName = cleanText(req.query.classificationName) || "music";

    if (!sourceId) {
      return res.status(400).json({
        ok: false,
        error: "Provide sourceId. Example: /events/enrich?source=ticketmaster&sourceId=XYZ",
      });
    }

    if (source !== "ticketmaster") {
      return res.status(400).json({
        ok: false,
        error: "Unsupported source. Currently only source=ticketmaster is supported.",
      });
    }

    const event = await fetchTicketmasterEventById({ sourceId, classificationName });
    if (!event) {
      return res.status(404).json({
        ok: false,
        error: "Ticketmaster event not found for provided sourceId.",
      });
    }

    return res.json({ ok: true, event });
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

/**
 * POST /ai/genre-predict
 * Body:
 * - text?: string
 * - events?: event[]
 * - topK?: number (default 3)
 * - enrichMissingGenres?: boolean (default false)
 */
app.post("/ai/genre-predict", async (req, res) => {
  try {
    const body = objectOrEmpty(req.body);
    const text = cleanText(body.text);
    const events = Array.isArray(body.events) ? body.events : [];
    const topK = toPositiveInt(body.topK, 3);
    const enrichMissingGenres = toBool(body.enrichMissingGenres, false);

    if (!text && events.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "Provide 'text' or a non-empty 'events' array.",
      });
    }

    const result = { ok: true, topK };

    if (text) {
      result.textPrediction = predictGenresFromText(text, { topK });
    }

    if (events.length > 0) {
      result.events = events.map((event, index) => {
        const predictions = predictGenresForEvent(event, { topK });
        const primary = predictions[0] || null;
        const hasExplicitGenre = Boolean(
          cleanText(event?.genre) || cleanText(event?.category)
        );

        const out = {
          index,
          eventId: cleanText(event?.id) || cleanText(event?.sourceId) || null,
          title: cleanText(event?.title) || null,
          predictions,
          primaryGenre: primary?.genre || null,
          primaryConfidence: primary?.confidence || null,
        };

        if (enrichMissingGenres && !hasExplicitGenre && primary) {
          out.suggestedPatch = {
            genre: primary.genre,
            category: primary.genre,
            confidence: primary.confidence,
          };
        }

        return out;
      });
      result.count = result.events.length;
    }

    return res.json(result);
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

/**
 * POST /ai/recommendations
 * Body:
 * - userProfile?: { preferredGenres, likedEvents, lat, lng, maxDistanceKm, peerInterestByEventId }
 * - events?: event[]
 * - query?: /events-style query used if events omitted
 * - limit?: number
 * - weights?: { genreMatch, distance, popularity, similarity }
 */
app.post("/ai/recommendations", async (req, res) => {
  try {
    const body = objectOrEmpty(req.body);
    const userProfile = objectOrEmpty(body.userProfile);
    const limit = toPositiveInt(body.limit, 20);
    const weights = objectOrEmpty(body.weights);

    const events = await resolveEventsForAi({
      events: Array.isArray(body.events) ? body.events : null,
      query: objectOrEmpty(body.query),
    });

    const recommendation = recommendEvents(events, userProfile, {
      limit,
      weights,
    });

    return res.json({
      ok: true,
      count: recommendation.items.length,
      weights: recommendation.weights,
      defaults: DEFAULT_RECOMMENDATION_WEIGHTS,
      inferredProfile: recommendation.inferredProfile,
      events: recommendation.items,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

/**
 * POST /ai/radar
 * Body:
 * - userProfile?: same as /ai/recommendations
 * - events?: event[]
 * - query?: /events-style query used if events omitted
 * - limit?: number
 * - hiddenGemThreshold?: number (0..1)
 * - trendingThreshold?: number (0..1)
 * - includeAll?: boolean
 */
app.post("/ai/radar", async (req, res) => {
  try {
    const body = objectOrEmpty(req.body);
    const userProfile = objectOrEmpty(body.userProfile);

    const events = await resolveEventsForAi({
      events: Array.isArray(body.events) ? body.events : null,
      query: objectOrEmpty(body.query),
    });

    const radar = buildUndergroundRadar(events, userProfile, {
      limit: toPositiveInt(body.limit, 20),
      hiddenGemThreshold: toNumberOrNull(body.hiddenGemThreshold),
      trendingThreshold: toNumberOrNull(body.trendingThreshold),
      includeAll: toBool(body.includeAll, false),
      recommendationWeights: objectOrEmpty(body.weights),
    });

    return res.json({
      ok: true,
      thresholds: radar.thresholds,
      defaults: DEFAULT_RADAR_THRESHOLDS,
      count: radar.items.length,
      events: radar.items,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

/**
 * POST /ai/taste-dna
 * Body:
 * - userProfile?: { likedEvents, preferredGenres, lat, lng, maxDistanceKm }
 * - events?: event[]
 * - likedEventKeys?: string[] (ids/sourceIds/urls)
 * - query?: /events-style query used if events omitted
 * - bootstrapFromFeed?: boolean (default false)
 */
app.post("/ai/taste-dna", async (req, res) => {
  try {
    const body = objectOrEmpty(req.body);
    const userProfile = { ...objectOrEmpty(body.userProfile) };
    const likedEventKeys = Array.isArray(body.likedEventKeys)
      ? body.likedEventKeys.map((value) => cleanText(value)).filter(Boolean)
      : [];

    let feedEvents = [];
    if (Array.isArray(body.events) && body.events.length > 0) {
      feedEvents = body.events;
    } else if (likedEventKeys.length > 0 || toBool(body.bootstrapFromFeed, false)) {
      feedEvents = await resolveEventsForAi({ query: objectOrEmpty(body.query) });
    }

    if (
      (!Array.isArray(userProfile.likedEvents) || userProfile.likedEvents.length === 0) &&
      feedEvents.length > 0
    ) {
      if (likedEventKeys.length > 0) {
        const keySet = new Set(likedEventKeys.map((value) => String(value)));
        userProfile.likedEvents = feedEvents.filter((event) => {
          const candidates = [
            cleanText(event?.id),
            cleanText(event?.sourceId),
            cleanText(event?.url),
            cleanText(event?.ticketUrl),
          ].filter(Boolean);
          return candidates.some((candidate) => keySet.has(candidate));
        });
      } else if (toBool(body.bootstrapFromFeed, false)) {
        userProfile.likedEvents = feedEvents.slice(0, 12);
      }
    }

    const dna = buildTasteDNA(userProfile);
    return res.json({ ok: true, ...dna });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

/**
 * POST /ai/success-predictor
 * Body:
 * - draftEvent: event-like object
 * - historicalEvents?: event[] (optional; auto-fetched if omitted)
 * - query?: /events-style query used for auto-history
 */
app.post("/ai/success-predictor", async (req, res) => {
  try {
    const body = objectOrEmpty(req.body);
    const draftEvent = objectOrEmpty(body.draftEvent);
    if (!draftEvent || Object.keys(draftEvent).length === 0) {
      return res.status(400).json({
        ok: false,
        error: "Provide 'draftEvent' in request body.",
      });
    }

    let historicalEvents = Array.isArray(body.historicalEvents)
      ? body.historicalEvents
      : [];

    if (historicalEvents.length === 0) {
      const query = {
        ...objectOrEmpty(body.query),
        classificationName:
          cleanText(body?.query?.classificationName) ||
          cleanText(draftEvent?.genre) ||
          cleanText(draftEvent?.category) ||
          "music",
        maxResults: toPositiveInt(body?.query?.maxResults, 140),
      };

      historicalEvents = await resolveEventsForAi({ query });
    }

    const prediction = predictEventSuccess(draftEvent, historicalEvents);

    return res.json({
      ok: true,
      prediction,
      historyCount: historicalEvents.length,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

// -----------------------------
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
  console.log(
    `Scraper: ${
      SCRAPE_CONFIG.enabled ? "enabled" : "disabled"
    }, sources=${SCRAPE_CONFIG.sourceUrls.length}, countryFilters=${SCRAPE_CONFIG.allowedCountries.length}, cityFilters=${SCRAPE_CONFIG.allowedCities.length}`
  );
  console.log(
    `Scrape cache: ttl=${SCRAPE_CACHE_CONFIG.ttlMs}ms, wait=${SCRAPE_CACHE_CONFIG.requestWaitMs}ms`
  );

  if (SCRAPE_CONFIG.enabled && SCRAPE_CONFIG.sourceUrls.length > 0) {
    startScrapeRefresh()
      .then((events) => {
        console.log(`Scrape cache warmed with ${events.length} events`);
      })
      .catch((err) => {
        console.warn(`Scrape cache warm-up failed: ${String(err?.message || err)}`);
      });
  }
});
