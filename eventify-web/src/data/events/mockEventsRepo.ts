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

function getAllPublicEvents(): EventItem[] {
  // ✅ organizer events are public events too
  const organizerEvents = listPublicOrganizerEvents();
  return [...organizerEvents, ...MOCK_EVENTS];
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
    const filtered = applyFilters(getAllPublicEvents(), params);
    return filtered.map((e) => ({ ...e }));
  },

  async getById(eventId, opts) {
    await sleep(120, opts?.signal);

    const organizerFound = getPublicOrganizerEventById(eventId);
    if (organizerFound) return { ...organizerFound };

    const found = MOCK_EVENTS.find((e) => e.id === eventId);
    return found ? { ...found } : undefined;
  },
};
