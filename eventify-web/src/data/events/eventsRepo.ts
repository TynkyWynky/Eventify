import type { EventItem } from "../../events/eventsStore";

export type EventsListParams = {
  style?: string;
  maxDistanceKm?: number;
  query?: string;
  trendingOnly?: boolean;
  fetchRadiusKm?: number;
  fetchSize?: number;

  // ✅ NEW: origin for distance calculation
  originLat?: number;
  originLng?: number;
};

export type EventsRepo = {
  list(
    params?: EventsListParams,
    opts?: { signal?: AbortSignal }
  ): Promise<EventItem[]>;

  getById(
    eventId: string,
    opts?: { signal?: AbortSignal }
  ): Promise<EventItem | undefined>;
};
