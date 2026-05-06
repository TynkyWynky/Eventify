type RepoMode = "auto" | "api" | "mock";

const env = import.meta.env;

function readString(name: string): string | undefined {
  const value = env[name as keyof ImportMetaEnv];
  return typeof value === "string" ? value.trim() || undefined : undefined;
}

function readNumber(name: string, fallback: number): number {
  const value = readString(name);
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const value = readString(name);
  if (!value) return fallback;
  return !["0", "false", "no", "off"].includes(value.toLowerCase());
}

function readRepoMode(name: string, fallback: RepoMode): RepoMode {
  const value = readString(name)?.toLowerCase();
  if (value === "auto" || value === "api" || value === "mock") {
    return value;
  }
  return fallback;
}

export const appConfig = {
  apiBaseUrl: readString("VITE_API_BASE_URL"),
  allowCrossOriginApiBase: readBoolean("VITE_API_BASE_URL_ALLOW_CROSS_ORIGIN", false),
  eventsRepoMode: readRepoMode("VITE_EVENTS_REPO_MODE", "api"),
  defaultLocation: {
    lat: readNumber("VITE_DEFAULT_LAT", 50.8503),
    lng: readNumber("VITE_DEFAULT_LNG", 4.3517),
  },
  events: {
    fetchSize: Math.max(1, Math.floor(readNumber("VITE_EVENTS_FETCH_SIZE", 240))),
    fetchTimeoutMs: Math.max(1200, Math.floor(readNumber("VITE_EVENTS_FETCH_TIMEOUT_MS", 15000))),
    cacheTtlMs: Math.max(3000, Math.floor(readNumber("VITE_EVENTS_CACHE_TTL_MS", 60000))),
    includeScraped: readBoolean("VITE_EVENTS_INCLUDE_SCRAPED", true),
    preferDbFirst: readBoolean("VITE_EVENTS_PREFER_DB_FIRST", true),
    allowLiveFetch: readBoolean("VITE_EVENTS_ALLOW_LIVE_FETCH", true),
  },
  serviceWorkerEnabled: readBoolean("VITE_ENABLE_SW", false),
} as const;
