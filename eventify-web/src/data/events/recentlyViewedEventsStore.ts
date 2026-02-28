import type { EventItem } from "../../events/eventsStore";

const RECENT_EVENTS_KEY = "eventify_recently_viewed_events_v1";
const RECENT_EVENTS_LIMIT = 24;

export type RecentlyViewedEvent = {
  id: string;
  title: string;
  venue: string;
  city: string;
  dateLabel: string;
  distanceKm: number;
  imageUrl: string;
  tags: string[];
  trending?: boolean;
  artistName?: string;
  viewedAt: number;
};

function safeParse(raw: string | null): RecentlyViewedEvent[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && typeof item.id === "string");
  } catch {
    return [];
  }
}

function read(): RecentlyViewedEvent[] {
  return safeParse(localStorage.getItem(RECENT_EVENTS_KEY));
}

function write(items: RecentlyViewedEvent[]) {
  localStorage.setItem(RECENT_EVENTS_KEY, JSON.stringify(items));
}

export function rememberViewedEvent(event: EventItem) {
  const nextItem: RecentlyViewedEvent = {
    id: event.id,
    title: event.title,
    venue: event.venue,
    city: event.city,
    dateLabel: event.dateLabel,
    distanceKm: Number.isFinite(event.distanceKm) ? event.distanceKm : 0,
    imageUrl: event.imageUrl,
    tags: Array.isArray(event.tags) ? event.tags.slice(0, 4) : [],
    trending: event.trending,
    artistName: event.artistName,
    viewedAt: Date.now(),
  };

  const deduped = read().filter((item) => item.id !== event.id);
  deduped.unshift(nextItem);
  write(deduped.slice(0, RECENT_EVENTS_LIMIT));
}

export function getRecentlyViewedEvents(limit = 8): RecentlyViewedEvent[] {
  const size = Math.max(1, Math.min(RECENT_EVENTS_LIMIT, Math.round(limit)));
  return read().slice(0, size);
}
