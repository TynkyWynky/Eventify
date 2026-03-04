import { apiBaseForUrlConstructor } from "../../auth/apiClient";

export type EventSuggestionsResponse = {
  ok: boolean;
  q?: string;
  count?: number;
  suggestions?: string[];
};

export async function fetchEventSuggestions(
  params: {
    q: string;
    lat: number;
    lng: number;
    radiusKm?: number;
    limit?: number;
  },
  signal?: AbortSignal
): Promise<string[]> {
  const url = new URL("events/suggestions", apiBaseForUrlConstructor());
  url.searchParams.set("q", params.q.trim());
  url.searchParams.set("lat", String(params.lat));
  url.searchParams.set("lng", String(params.lng));
  url.searchParams.set("radiusKm", String(params.radiusKm ?? 1000));
  url.searchParams.set("limit", String(params.limit ?? 10));

  const res = await fetch(url.toString(), { signal });
  if (!res.ok) throw new Error(`Suggestions request failed (${res.status})`);

  const payload = (await res.json()) as EventSuggestionsResponse;
  if (!Array.isArray(payload.suggestions)) return [];
  return payload.suggestions.slice(0, params.limit ?? 10);
}
