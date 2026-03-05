import { MUSIC_STYLES, type EventItem } from "../../events/eventsStore";
import type { EventsListParams, EventsRepo } from "./eventsRepo";
import {
  getPublicOrganizerEventById,
  listPublicOrganizerEvents,
} from "./organizerEventsStore";
import { getGenreFallbackImage } from "./genreImages";
import { apiBaseForUrlConstructor } from "../../auth/apiClient";
import { BELGIUM_CITIES } from "../location/locationStore";

type ApiEvent = {
  source?: string | null;
  sourceId?: string | null;
  title?: string | null;
  description?: string | null;
  start?: string | null;
  venue?: string | null;
  city?: string | null;
  lat?: number | null;
  lng?: number | null;
  url?: string | null;
  artistName?: string | null;
  imageUrl?: string | null;
  genre?: string | null;
  category?: string | null;
  tags?: string[] | null;
  cost?: number | null;
  priceMin?: number | null;
  priceMax?: number | null;
  currency?: string | null;
  isFree?: boolean | null;
  priceTier?: string | null;
  priceLabel?: string | null;
  priceConfidence?: string | null;
  priceSource?: string | null;
  metadata?: {
    priceMin?: number | null;
    priceMax?: number | null;
    priceSource?: string | null;
  } | null;
};

type EventsApiResponse = {
  ok: boolean;
  error?: string;
  events?: ApiEvent[];
};

function normalize(text: string) {
  return text.trim().toLowerCase();
}

function normalizeComparable(text: string) {
  return normalize(text)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const MULTILINGUAL_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bmusique\b|\bmuziek\b|\bmusik\b|\bmusica\b/g, " music "],
  [/\bconcerten\b|\bconcerts\b|\bconcert\b|\bkonzert\b|\bkonzerte\b|\bconcierto\b|\bconciertos\b/g, " concert "],
  [/\belektronisch\b|\belectronique\b|\belectronica\b/g, " electronic "],
  [/\bhiphop\b|\bhip-hop\b/g, " hip hop "],
  [/\bchanson\b|\bvariete\b/g, " pop "],
  [/\bklassiek\b|\bclassique\b/g, " classical "],
  [/\bfiesta latina\b/g, " latin "],
  [/\bauteur-compositeur\b|\bcantautor\b/g, " singer songwriter "],
  [/\bdrum n bass\b/g, " drum and bass "],
];

const STYLE_KEYWORDS: Array<{ style: string; keywords: string[] }> = [
  { style: "Techno", keywords: ["techno", "industrial techno", "hard techno"] },
  { style: "House", keywords: ["house", "deep house", "afro house"] },
  { style: "Drum & Bass", keywords: ["drum and bass", "drum & bass", "dnb", "neurofunk"] },
  { style: "Hip-Hop", keywords: ["hip hop", "rap", "trap", "drill"] },
  { style: "Jazz", keywords: ["jazz", "bebop", "swing"] },
  { style: "Metal", keywords: ["metal", "metalcore", "death metal", "thrash"] },
  { style: "Rock", keywords: ["rock", "punk", "grunge", "garage rock"] },
  { style: "Indie", keywords: ["indie", "alternative", "alternatif", "alternatieve", "shoegaze"] },
  { style: "R&B", keywords: ["r&b", "rnb", "neo soul", "soul"] },
  { style: "Pop", keywords: ["pop", "mainstream", "top 40", "chart"] },
  { style: "Electronic", keywords: ["electronic", "electro", "edm", "trance", "dj set"] },
];

function normalizeMeaning(text: string) {
  let out = normalize(text)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9+&\s-]/g, " ");
  for (const [regex, replacement] of MULTILINGUAL_REPLACEMENTS) {
    out = out.replace(regex, replacement);
  }
  return out.replace(/\s+/g, " ").trim();
}

function findBelgiumCityCoords(cityRaw?: string | null) {
  const city = normalizeComparable(String(cityRaw || ""));
  if (!city) return null;
  const found = BELGIUM_CITIES.find(
    (c) => normalizeComparable(c.name) === city
  );
  return found ? { lat: found.lat, lng: found.lng } : null;
}

function toNumberOrNull(v: unknown) {
  if (v == null || v === "") return null;
  if (typeof v === "boolean") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeCurrencyCode(value: unknown) {
  const text = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!text) return undefined;
  if (text === "€" || text === "EURO") return "EUR";
  if (/^[A-Z]{3}$/.test(text)) return text;
  return undefined;
}

function normalizePriceTier(value: unknown) {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (["free", "low", "mid", "high", "premium"].includes(text)) {
    return text as "free" | "low" | "mid" | "high" | "premium";
  }
  return null;
}

function formatPriceAmount(value: number | null | undefined, currency?: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Number.isInteger(value)
    ? String(Math.round(value))
    : value.toFixed(2).replace(/\.00$/, "");
  if (!currency || currency === "EUR") return `€${rounded}`;
  return `${currency} ${rounded}`;
}

function formatPriceLabel(opts: {
  priceMin?: number | null;
  priceMax?: number | null;
  cost?: number | null;
  currency?: string;
  isFree?: boolean;
}) {
  if (opts.isFree === true) return "Free";
  const min = typeof opts.priceMin === "number" ? opts.priceMin : null;
  const max = typeof opts.priceMax === "number" ? opts.priceMax : null;
  const cost = typeof opts.cost === "number" ? opts.cost : null;
  if (min != null && max != null) {
    const a = Math.min(min, max);
    const b = Math.max(min, max);
    if (Math.abs(a - b) < 0.01) return formatPriceAmount(a, opts.currency) || "Price unknown";
    const left = formatPriceAmount(a, opts.currency);
    const right = formatPriceAmount(b, opts.currency);
    if (left && right) return `${left}–${right}`;
  }
  if (cost != null) return formatPriceAmount(cost, opts.currency) || "Price unknown";
  if (min != null) return formatPriceAmount(min, opts.currency) || "Price unknown";
  if (max != null) return formatPriceAmount(max, opts.currency) || "Price unknown";
  return "Price unknown";
}

function toEnvNum(raw: string | undefined, fallback: number) {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function toFiniteOrNull(value: unknown) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function hashText(input: string) {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h << 5) - h + input.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function toRouteSafeId(value: string) {
  const safe = value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
  return safe || "event";
}

function formatDateLabel(start: string | null | undefined) {
  if (!start) return "TBA";
  const d = new Date(start);
  if (Number.isNaN(d.getTime())) return String(start);
  return d.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const r = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return r * c;
}

function inferStyle(text: string) {
  const t = normalizeMeaning(text);
  if (!t) return null;

  let best: { style: string; score: number } | null = null;
  for (const entry of STYLE_KEYWORDS) {
    let score = 0;
    for (const rawKeyword of entry.keywords) {
      const keyword = normalizeMeaning(rawKeyword);
      if (!keyword) continue;
      if (t.includes(keyword)) {
        score += keyword.includes(" ") ? 2.2 : 1.2;
      }
    }
    if (!best || score > best.score) best = { style: entry.style, score };
  }

  if (!best || best.score < 1.2) return null;
  return best.style;
}

function cleanImageUrl(url?: string | null) {
  const value = (url || "").trim();
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) return null;
  return value;
}

function sanitizeDescription(description?: string | null, artistName?: string | null) {
  const raw = (description || "").replace(/\s+/g, " ").trim();
  if (!raw) return null;

  const normalized = normalizeComparable(raw);
  const artist = normalizeComparable(artistName || "");

  if (!normalized) return null;
  if (normalized === "tickets available online") return null;
  if (/^starts? /.test(normalized)) return null;

  if (artist) {
    if (normalized === artist) return null;
    const stripped = normalized.replace(/^(artist|featuring|feat|ft|with|avec)\s+/, "").trim();
    if (stripped === artist) return null;
  }

  return raw;
}

function matchesQuery(event: EventItem, query: string) {
  const q = normalize(query);
  if (!q) return true;
  const haystack = normalize(
    [event.title, event.venue, event.city, event.tags.join(" "), event.dateLabel].join(" ")
  );
  return haystack.includes(q);
}

function applyFilters(items: EventItem[], params?: EventsListParams) {
  const style = params?.style ?? "All";
  const maxDistanceKm = params?.maxDistanceKm;
  const query = params?.query ?? "";
  const trendingOnly = params?.trendingOnly ?? false;

  return items.filter((e) => {
    const matchesStyle = style === "All" || e.tags.includes(style);
    const matchesDistance =
      typeof maxDistanceKm === "number" ? e.distanceKm <= maxDistanceKm : true;
    const matchesText = matchesQuery(e, query);
    const matchesTrending = trendingOnly ? Boolean(e.trending) : true;
    return matchesStyle && matchesDistance && matchesText && matchesTrending;
  });
}

const DEFAULT_LAT = toEnvNum(import.meta.env.VITE_DEFAULT_LAT, 50.8503);
const DEFAULT_LNG = toEnvNum(import.meta.env.VITE_DEFAULT_LNG, 4.3517);
const DEFAULT_RADIUS_KM = 50;
const DEFAULT_FETCH_SIZE = Math.max(
  1,
  Math.floor(toEnvNum(import.meta.env.VITE_EVENTS_FETCH_SIZE, 40))
);
const EVENTS_FETCH_TIMEOUT_MS = Math.max(
  1200,
  Math.floor(toEnvNum(import.meta.env.VITE_EVENTS_FETCH_TIMEOUT_MS, 15000))
);
const EVENTS_CACHE_TTL_MS = Math.max(
  3000,
  Math.floor(toEnvNum(import.meta.env.VITE_EVENTS_CACHE_TTL_MS, 60000))
);
const INCLUDE_SCRAPED = !["0", "false", "no", "off"].includes(
  String(import.meta.env.VITE_EVENTS_INCLUDE_SCRAPED ?? "1")
    .trim()
    .toLowerCase()
);
const EVENTS_PREFER_DB_FIRST = !["0", "false", "no", "off"].includes(
  String(import.meta.env.VITE_EVENTS_PREFER_DB_FIRST ?? "1")
    .trim()
    .toLowerCase()
);
const EVENTS_ALLOW_LIVE_FETCH = !["0", "false", "no", "off"].includes(
  String(import.meta.env.VITE_EVENTS_ALLOW_LIVE_FETCH ?? "1")
    .trim()
    .toLowerCase()
);

function resolveOrigin(params?: EventsListParams) {
  const originLat = toFiniteOrNull(params?.originLat);
  const originLng = toFiniteOrNull(params?.originLng);
  return {
    lat: originLat ?? DEFAULT_LAT,
    lng: originLng ?? DEFAULT_LNG,
  };
}

const remoteById = new Map<string, EventItem>();
let lastRemoteListCache: { at: number; items: EventItem[] } | null = null;

function remember(items: EventItem[]) {
  for (const item of items) {
    remoteById.set(item.id, item);
  }
  lastRemoteListCache = { at: Date.now(), items: items.map((item) => ({ ...item })) };
}

function mergeUnique(organizerEvents: EventItem[], remoteEvents: EventItem[]) {
  const seen = new Set<string>();
  const out: EventItem[] = [];

  for (const e of [...organizerEvents, ...remoteEvents]) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(e);
  }

  return out;
}

function withDistanceFromCurrentOrigin(items: EventItem[], origin: { lat: number; lng: number }) {
  return items.map((item) => {
    const latRaw = toFiniteOrNull(item.latitude);
    const lngRaw = toFiniteOrNull(item.longitude);
    const cityCoords = findBelgiumCityCoords(item.city);
    const hasCoords = latRaw != null && lngRaw != null;
    const hasCityCoords = cityCoords != null;

    const lat = latRaw ?? (hasCityCoords ? cityCoords.lat : origin.lat);
    const lng = lngRaw ?? (hasCityCoords ? cityCoords.lng : origin.lng);
    const distanceKm = hasCoords || hasCityCoords
      ? Math.round(haversineKm(origin.lat, origin.lng, lat, lng) * 10) / 10
      : 9_999;

    return {
      ...item,
      latitude: lat,
      longitude: lng,
      distanceKm,
    };
  });
}

function mapApiEventToItem(
  apiEvent: ApiEvent,
  rank: number,
  opts: { originLat: number; originLng: number; forcedStyle?: string }
): EventItem {
  const source = (apiEvent.source || "remote").toLowerCase();
  const rawSourceId = String(apiEvent.sourceId || apiEvent.title || `evt_${rank}`);
  const stableHash = hashText(rawSourceId).toString(36);
  const sourceId = `${toRouteSafeId(rawSourceId)}_${stableHash}`;
  const id = `${source}:${sourceId}`;

  const title = apiEvent.title?.trim() || "Untitled event";
  const venue = apiEvent.venue?.trim() || "Unknown venue";
  const city = apiEvent.city?.trim() || "Unknown city";

  const latRaw = toFiniteOrNull(apiEvent.lat);
  const lngRaw = toFiniteOrNull(apiEvent.lng);
  const cityCoords = findBelgiumCityCoords(apiEvent.city);
  const hasApiCoords = latRaw != null && lngRaw != null;
  const hasCityCoords = cityCoords != null;

  const lat = latRaw ?? (hasCityCoords ? cityCoords.lat : opts.originLat);
  const lng = lngRaw ?? (hasCityCoords ? cityCoords.lng : opts.originLng);
  const distanceKm = hasApiCoords || hasCityCoords
    ? Math.round(haversineKm(opts.originLat, opts.originLng, lat, lng) * 10) / 10
    : 9_999;

  const inferred = inferStyle(
    [title, apiEvent.artistName || "", apiEvent.description || ""].filter(Boolean).join(" ")
  );
  const inferredFromGenre = inferStyle(
    [apiEvent.genre, apiEvent.category, ...(apiEvent.tags || [])].filter(Boolean).join(" ")
  );
  const style =
    opts.forcedStyle &&
    opts.forcedStyle !== "All" &&
    MUSIC_STYLES.includes(opts.forcedStyle)
      ? opts.forcedStyle
      : inferredFromGenre || inferred || "Electronic";

  const imageUrl = cleanImageUrl(apiEvent.imageUrl) || getGenreFallbackImage(style);

  const remoteDescription = sanitizeDescription(apiEvent.description, apiEvent.artistName);
  const fallbackDescription = apiEvent.url ? "" : "Event details coming soon.";
  const priceMin = toNumberOrNull(
    apiEvent.priceMin ?? apiEvent.metadata?.priceMin
  );
  const priceMax = toNumberOrNull(
    apiEvent.priceMax ?? apiEvent.metadata?.priceMax
  );
  const cost = toNumberOrNull(apiEvent.cost);
  const normalizedPriceMin = priceMin ?? cost;
  const normalizedPriceMax = priceMax ?? cost;
  const currency = normalizeCurrencyCode(apiEvent.currency);
  const hasPaidPrice =
    (typeof normalizedPriceMin === "number" && normalizedPriceMin > 0) ||
    (typeof normalizedPriceMax === "number" && normalizedPriceMax > 0) ||
    (typeof cost === "number" && cost > 0);
  const hasZeroPriceSignal =
    normalizedPriceMin === 0 || normalizedPriceMax === 0 || cost === 0;
  const isFree = !hasPaidPrice && (apiEvent.isFree === true || hasZeroPriceSignal);
  const priceTier = normalizePriceTier(apiEvent.priceTier);
  const priceLabel =
    (typeof apiEvent.priceLabel === "string" && apiEvent.priceLabel.trim()) ||
    formatPriceLabel({
      priceMin: normalizedPriceMin,
      priceMax: normalizedPriceMax,
      cost,
      currency,
      isFree,
    });
  const priceConfidence =
    typeof apiEvent.priceConfidence === "string" && apiEvent.priceConfidence.trim()
      ? apiEvent.priceConfidence.trim()
      : null;
  const priceSource =
    (typeof apiEvent.priceSource === "string" && apiEvent.priceSource.trim()) ||
    (typeof apiEvent.metadata?.priceSource === "string" && apiEvent.metadata.priceSource.trim()) ||
    null;

  const rawTags = (apiEvent.tags || [])
    .map((tag) => (typeof tag === "string" ? tag.trim() : ""))
    .filter(Boolean);

  return {
    id,
    title,
    venue,
    city,
    dateLabel: formatDateLabel(apiEvent.start),
    distanceKm,
    imageUrl,
    tags: [style],
    trending: rank < 8,
    addressLine: venue,
    postalCode: "—",
    country: "—",
    latitude: lat,
    longitude: lng,
    description: remoteDescription || fallbackDescription,
    source,
    sourceId: apiEvent.sourceId || undefined,
    sourceUrl: apiEvent.url || undefined,
    artistName: apiEvent.artistName || undefined,
    startIso: apiEvent.start || null,
    cost,
    currency,
    isFree,
    priceMin: normalizedPriceMin,
    priceMax: normalizedPriceMax,
    priceTier,
    priceLabel,
    priceConfidence,
    priceSource,
    rawGenre: apiEvent.genre?.trim() || undefined,
    rawCategory: apiEvent.category?.trim() || undefined,
    rawTags: rawTags.length > 0 ? rawTags : undefined,
  };
}

async function fetchRemoteEvents(
  params?: EventsListParams,
  opts?: { signal?: AbortSignal; sizeOverride?: number }
) {
  const url = new URL("events", apiBaseForUrlConstructor());

  const origin = resolveOrigin(params);
  const radiusKm =
    typeof params?.maxDistanceKm === "number"
      ? Math.max(1, Math.round(params.maxDistanceKm))
      : DEFAULT_RADIUS_KM;

  const style = params?.style && params.style !== "All" ? params.style : "";
  const query = params?.query?.trim() || "";
  const keyword = [query, style].filter(Boolean).join(" ").trim();

  const size = opts?.sizeOverride ?? DEFAULT_FETCH_SIZE;
  url.searchParams.set("lat", String(origin.lat));
  url.searchParams.set("lng", String(origin.lng));
  url.searchParams.set("radiusKm", String(radiusKm));
  url.searchParams.set("size", String(size));
  url.searchParams.set("maxResults", String(size));
  url.searchParams.set("includeScraped", INCLUDE_SCRAPED ? "1" : "0");
  url.searchParams.set("includeSetlists", "0");
  url.searchParams.set("preferDb", EVENTS_PREFER_DB_FIRST ? "1" : "0");
  url.searchParams.set("allowLiveFetch", EVENTS_ALLOW_LIVE_FETCH ? "1" : "0");
  if (keyword) url.searchParams.set("keyword", keyword);

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), EVENTS_FETCH_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  opts?.signal?.addEventListener("abort", onAbort, { once: true });

  let res: Response;
  try {
    res = await fetch(url.toString(), { signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
    opts?.signal?.removeEventListener("abort", onAbort);
  }
  if (!res.ok) {
    throw new Error(`Events API request failed (${res.status})`);
  }

  const payload = (await res.json()) as EventsApiResponse;
  if (!payload.ok) {
    throw new Error(payload.error || "Events API returned an error");
  }

  const items = (payload.events || []).map((e, i) =>
    mapApiEventToItem(e, i, {
      originLat: origin.lat,
      originLng: origin.lng,
      forcedStyle: style || undefined,
    })
  );

  remember(items);
  return items;
}

export const apiEventsRepo: EventsRepo = {
  async list(params, opts) {
    const origin = resolveOrigin(params);
    const [organizerEvents, remoteEvents] = await Promise.all([
      listPublicOrganizerEvents({
        originLat: origin.lat,
        originLng: origin.lng,
      }),
      fetchRemoteEvents(params, { signal: opts?.signal }).catch((err) => {
        if (
          lastRemoteListCache &&
          Date.now() - lastRemoteListCache.at <= EVENTS_CACHE_TTL_MS
        ) {
          return withDistanceFromCurrentOrigin(lastRemoteListCache.items, origin);
        }
        throw err;
      }),
    ]);

    const merged = mergeUnique(organizerEvents, remoteEvents);
    return applyFilters(merged, params);
  },

  async getById(eventId, opts) {
    const origin = resolveOrigin();
    const organizerEvent = await getPublicOrganizerEventById(eventId, {
      originLat: origin.lat,
      originLng: origin.lng,
    });
    if (organizerEvent) return { ...organizerEvent };

    const cached = remoteById.get(eventId);
    if (cached) return { ...cached };

    const remoteEvents = await fetchRemoteEvents(
      { maxDistanceKm: 100, originLat: origin.lat, originLng: origin.lng },
      { signal: opts?.signal, sizeOverride: 100 }
    );

    const found = remoteEvents.find((e) => e.id === eventId);
    return found ? { ...found } : undefined;
  },
};
