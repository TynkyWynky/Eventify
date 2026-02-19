import { MOCK_EVENTS, type EventItem } from "../../events/eventsStore";
import type { EventsListParams, EventsRepo } from "./eventsRepo";
import {
  getPublicOrganizerEventById,
  listPublicOrganizerEvents,
} from "./organizerEventsStore";

function normalize(text: string) {
  return text.trim().toLowerCase();
}

function matchesQuery(event: EventItem, query: string) {
  const q = normalize(query);
  if (!q) return true;

  const haystack = normalize(
    [
      event.title,
      event.venue,
      event.city,
      event.tags.join(" "),
      event.dateLabel,
    ].join(" ")
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

/** Haversine (straight-line) distance in km */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function getOrigin(params?: EventsListParams) {
  const BRUSSELS = { lat: 50.8466, lng: 4.3528 };
  return {
    lat: typeof params?.originLat === "number" ? params.originLat : BRUSSELS.lat,
    lng: typeof params?.originLng === "number" ? params.originLng : BRUSSELS.lng,
  };
}

function withDistanceFromOrigin(items: EventItem[], params?: EventsListParams) {
  const origin = getOrigin(params);

  return items.map((e) => {
    const d =
      Math.round(
        haversineKm(origin.lat, origin.lng, e.latitude, e.longitude) * 10
      ) / 10;

    return { ...e, distanceKm: d };
  });
}

function getAllPublicEvents(params?: EventsListParams): EventItem[] {
  // ✅ organizer events are public events too (with origin-based distance)
  const organizerEvents = listPublicOrganizerEvents({
    originLat: params?.originLat,
    originLng: params?.originLng,
  });

  // ✅ mock events: recompute distance from origin
  const mockWithDistance = withDistanceFromOrigin(MOCK_EVENTS, params);

  return [...organizerEvents, ...mockWithDistance];
}

async function sleep(ms: number, signal?: AbortSignal) {
  if (ms <= 0) return;

  await new Promise<void>((resolve, reject) => {
    const timer = globalThis.setTimeout(resolve, ms);

    const onAbort = () => {
      globalThis.clearTimeout(timer);
      reject(new DOMException("Request aborted", "AbortError"));
    };

    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

export const mockEventsRepo: EventsRepo = {
  async list(params, opts) {
    await sleep(200, opts?.signal);
    const filtered = applyFilters(getAllPublicEvents(params), params);
    return filtered.map((e) => ({ ...e }));
  },

  async getById(eventId, opts) {
    await sleep(120, opts?.signal);

    const organizerFound = getPublicOrganizerEventById(eventId, {
      originLat: 50.8466,
      originLng: 4.3528,
    });
    if (organizerFound) return { ...organizerFound };

    const found = MOCK_EVENTS.find((e) => e.id === eventId);
    return found ? { ...found } : undefined;
  },
};
