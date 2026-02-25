import type { EventItem } from "../../events/eventsStore";

type JsonRecord = Record<string, unknown>;

export type AiUserProfile = {
  preferredGenres?: string[];
  likedEvents?: JsonRecord[];
  lat?: number;
  lng?: number;
  maxDistanceKm?: number;
  peerInterestByEventId?: Record<string, number>;
};

export type AiRecommendationsResponse = {
  ok: boolean;
  count?: number;
  weights?: {
    genreMatch?: number;
    distance?: number;
    popularity?: number;
    similarity?: number;
  };
  inferredProfile?: {
    topGenres?: string[];
    likedEventsCount?: number;
  };
  events?: Array<EventItem & { aiRecommendation?: EventItem["aiRecommendation"] }>;
  error?: string;
};

export type AiRadarResponse = {
  ok: boolean;
  count?: number;
  thresholds?: {
    hiddenGem?: number;
    trendingLocal?: number;
  };
  events?: Array<EventItem & { aiRadar?: EventItem["aiRadar"] }>;
  error?: string;
};

export type AiTasteDnaResponse = {
  ok: boolean;
  summary?: string | null;
  archetypes?: Array<{ label: string; percentage: number }>;
  inferredPreferences?: {
    topGenres?: string[];
    avgDistanceKm?: number | null;
    eveningRatio?: number;
    nightRatio?: number;
    festivalRatio?: number;
    sampleSize?: number;
  };
  generatedAt?: string;
  error?: string;
};

export type AiGenrePredictResponse = {
  ok: boolean;
  topK?: number;
  textPrediction?: Array<{ genre: string; confidence: number; score?: number }>;
  events?: Array<{
    index: number;
    eventId?: string | null;
    title?: string | null;
    predictions: Array<{ genre: string; confidence: number; score?: number }>;
    primaryGenre?: string | null;
    primaryConfidence?: number | null;
    suggestedPatch?: {
      genre?: string;
      category?: string;
      confidence?: number;
    };
  }>;
  count?: number;
  error?: string;
};

export type AiSuccessPredictorResponse = {
  ok: boolean;
  historyCount?: number;
  prediction?: {
    probabilityHighAttendance?: number;
    expectedAttendance?: number;
    bestPromotionDay?: string;
    targetAudienceAgeRange?: string;
    primaryGenre?: string;
    components?: Record<string, number>;
    sampleContext?: Record<string, unknown>;
    notes?: string[];
    generatedAt?: string;
  };
  error?: string;
};

function toEnvNum(raw: string | undefined, fallback: number) {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function getApiBaseUrl() {
  const raw = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
  return raw || "http://localhost:3000";
}

export const DEFAULT_USER_LAT = toEnvNum(import.meta.env.VITE_DEFAULT_LAT, 50.8503);
export const DEFAULT_USER_LNG = toEnvNum(import.meta.env.VITE_DEFAULT_LNG, 4.3517);

async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const base = getApiBaseUrl();
  const endpoint = `${base.replace(/\/$/, "")}${path}`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
    signal,
  });

  if (!res.ok) {
    throw new Error(`AI endpoint failed (${res.status})`);
  }

  return (await res.json()) as T;
}

export function toAiEventPayload(
  event: EventItem,
  opts?: {
    interestedCount?: number;
    peerInterestedCount?: number;
    preferenceWeight?: number;
  }
): JsonRecord {
  const firstTag = event.tags[0] || null;
  const rawTags = Array.isArray(event.rawTags) ? event.rawTags.filter(Boolean) : [];
  const mergedTags = Array.from(new Set([...rawTags, ...event.tags].filter(Boolean)));
  const genre = event.rawGenre || firstTag;
  const category = event.rawCategory || genre;
  return {
    ...event,
    start: event.startIso ?? null,
    lat: event.latitude,
    lng: event.longitude,
    genre,
    category,
    tags: mergedTags,
    url: event.sourceUrl ?? null,
    ticketUrl: event.sourceUrl ?? null,
    interestedCount: opts?.interestedCount ?? 0,
    peerInterestedCount: opts?.peerInterestedCount ?? 0,
    preferenceWeight: opts?.preferenceWeight ?? 1,
  };
}

export async function fetchAiRecommendations(
  payload: {
    events: JsonRecord[];
    userProfile?: AiUserProfile;
    limit?: number;
    weights?: {
      genreMatch?: number;
      distance?: number;
      popularity?: number;
      similarity?: number;
    };
  },
  signal?: AbortSignal
) {
  return postJson<AiRecommendationsResponse>("/ai/recommendations", payload, signal);
}

export async function fetchAiRadar(
  payload: {
    events: JsonRecord[];
    userProfile?: AiUserProfile;
    limit?: number;
    hiddenGemThreshold?: number;
    trendingThreshold?: number;
    includeAll?: boolean;
    weights?: {
      genreMatch?: number;
      distance?: number;
      popularity?: number;
      similarity?: number;
    };
  },
  signal?: AbortSignal
) {
  return postJson<AiRadarResponse>("/ai/radar", payload, signal);
}

export async function fetchAiTasteDna(
  payload: {
    userProfile?: AiUserProfile;
    events?: JsonRecord[];
    likedEventKeys?: string[];
    bootstrapFromFeed?: boolean;
  },
  signal?: AbortSignal
) {
  return postJson<AiTasteDnaResponse>("/ai/taste-dna", payload, signal);
}

export async function fetchAiGenrePredict(
  payload: {
    text?: string;
    events?: JsonRecord[];
    topK?: number;
    enrichMissingGenres?: boolean;
  },
  signal?: AbortSignal
) {
  return postJson<AiGenrePredictResponse>("/ai/genre-predict", payload, signal);
}

export async function fetchAiSuccessPredictor(
  payload: {
    draftEvent: JsonRecord;
    historicalEvents?: JsonRecord[];
  },
  signal?: AbortSignal
) {
  return postJson<AiSuccessPredictorResponse>("/ai/success-predictor", payload, signal);
}
