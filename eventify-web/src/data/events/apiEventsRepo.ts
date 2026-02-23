import { MUSIC_STYLES, type EventItem } from "../../events/eventsStore";
import type { EventsListParams, EventsRepo } from "./eventsRepo";
import {
  getPublicOrganizerEventById,
  listPublicOrganizerEvents,
} from "./organizerEventsStore";
import { getGenreFallbackImage } from "./genreImages";

type ApiEvent = {
  source?: string | null;
  sourceId?: string | null;
  title?: string | null;
  start?: string | null;
  venue?: string | null;
  city?: string | null;
  lat?: number | null;
  lng?: number | null;
  url?: string | null;
  artistName?: string | null;
  imageUrl?: string | null;
  genre?: string | null;
};

type EventsApiResponse = {
  ok: boolean;
  error?: string;
  events?: ApiEvent[];
};

function normalize(text: string) {
  return text.trim().toLowerCase();
}

function safeNum(v: unknown, fallback: number) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function toEnvNum(raw: string | undefined, fallback: number) {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
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

function formatReadableStart(start: string | null | undefined) {
  if (!start) return null;
  const d = new Date(start);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
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
  const t = normalize(text);
  if (!t) return "Electronic";

  if (t.includes("techno")) return "Techno";
  if (t.includes("house")) return "House";
  if (t.includes("drum") || t.includes("dnb")) return "Drum & Bass";
  if (t.includes("hip hop") || t.includes("hip-hop") || t.includes("rap")) {
    return "Hip-Hop";
  }
  if (t.includes("jazz")) return "Jazz";
  if (t.includes("metal")) return "Metal";
  if (t.includes("rock")) return "Rock";
  if (t.includes("indie")) return "Indie";
  if (t.includes("r&b") || t.includes("rnb")) return "R&B";
  if (t.includes("pop")) return "Pop";
  return "Electronic";
}

function cleanImageUrl(url?: string | null) {
  const value = (url || "").trim();
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) return null;
  return value;
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

const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ||
  "http://localhost:3000";
const DEFAULT_LAT = toEnvNum(import.meta.env.VITE_DEFAULT_LAT, 50.8503);
const DEFAULT_LNG = toEnvNum(import.meta.env.VITE_DEFAULT_LNG, 4.3517);
const DEFAULT_RADIUS_KM = 50;
const DEFAULT_FETCH_SIZE = Math.max(
  1,
  Math.floor(toEnvNum(import.meta.env.VITE_EVENTS_FETCH_SIZE, 60))
);

const remoteById = new Map<string, EventItem>();

function remember(items: EventItem[]) {
  for (const item of items) {
    remoteById.set(item.id, item);
  }
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

  const lat = safeNum(apiEvent.lat, opts.originLat);
  const lng = safeNum(apiEvent.lng, opts.originLng);
  const distanceKm =
    Math.round(haversineKm(opts.originLat, opts.originLng, lat, lng) * 10) / 10;

  const inferred = inferStyle(`${title} ${apiEvent.artistName || ""}`);
  const inferredFromGenre = inferStyle(apiEvent.genre || "");
  const style =
    opts.forcedStyle &&
    opts.forcedStyle !== "All" &&
    MUSIC_STYLES.includes(opts.forcedStyle)
      ? opts.forcedStyle
      : inferredFromGenre !== "Electronic"
      ? inferredFromGenre
      : inferred;

  const imageUrl = cleanImageUrl(apiEvent.imageUrl) || getGenreFallbackImage(style);

  const readableStart = formatReadableStart(apiEvent.start);
  const descriptionParts = [
    apiEvent.artistName ? `Artist: ${apiEvent.artistName}.` : null,
    readableStart ? `Starts: ${readableStart}.` : null,
    apiEvent.url ? `Tickets available online.` : null,
  ].filter(Boolean);

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
    description: descriptionParts.join(" ") || "Live music event.",
    source,
    sourceId: apiEvent.sourceId || undefined,
    sourceUrl: apiEvent.url || undefined,
    artistName: apiEvent.artistName || undefined,
    startIso: apiEvent.start || null,
  };
}

async function fetchRemoteEvents(
  params?: EventsListParams,
  opts?: { signal?: AbortSignal; sizeOverride?: number }
) {
  const base = API_BASE_URL.endsWith("/") ? API_BASE_URL : `${API_BASE_URL}/`;
  const url = new URL("events", base);

  const radiusKm =
    typeof params?.maxDistanceKm === "number"
      ? Math.max(1, Math.round(params.maxDistanceKm))
      : DEFAULT_RADIUS_KM;

  const style = params?.style && params.style !== "All" ? params.style : "";
  const query = params?.query?.trim() || "";
  const keyword = [query, style].filter(Boolean).join(" ").trim();

  const size = opts?.sizeOverride ?? DEFAULT_FETCH_SIZE;
  url.searchParams.set("lat", String(DEFAULT_LAT));
  url.searchParams.set("lng", String(DEFAULT_LNG));
  url.searchParams.set("radiusKm", String(radiusKm));
  url.searchParams.set("size", String(size));
  if (keyword) url.searchParams.set("keyword", keyword);

  const res = await fetch(url.toString(), { signal: opts?.signal });
  if (!res.ok) {
    throw new Error(`Events API request failed (${res.status})`);
  }

  const payload = (await res.json()) as EventsApiResponse;
  if (!payload.ok) {
    throw new Error(payload.error || "Events API returned an error");
  }

  const items = (payload.events || []).map((e, i) =>
    mapApiEventToItem(e, i, {
      originLat: DEFAULT_LAT,
      originLng: DEFAULT_LNG,
      forcedStyle: style || undefined,
    })
  );

  remember(items);
  return items;
}

export const apiEventsRepo: EventsRepo = {
  async list(params, opts) {
    const organizerEvents = await listPublicOrganizerEvents({
      originLat: DEFAULT_LAT,
      originLng: DEFAULT_LNG,
    });

    const remoteEvents = await fetchRemoteEvents(params, { signal: opts?.signal });

    const merged = mergeUnique(organizerEvents, remoteEvents);
    return applyFilters(merged, params);
  },

  async getById(eventId, opts) {
    const organizerEvent = await getPublicOrganizerEventById(eventId, {
      originLat: DEFAULT_LAT,
      originLng: DEFAULT_LNG,
    });
    if (organizerEvent) return { ...organizerEvent };

    const cached = remoteById.get(eventId);
    if (cached) return { ...cached };

    const remoteEvents = await fetchRemoteEvents(
      { maxDistanceKm: 100 },
      { signal: opts?.signal, sizeOverride: 100 }
    );

    const found = remoteEvents.find((e) => e.id === eventId);
    return found ? { ...found } : undefined;
  },
};