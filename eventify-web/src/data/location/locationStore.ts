export type OriginSource = "geolocation" | "city";

export type Origin = {
  label: string;
  lat: number;
  lng: number;
  source: OriginSource;
  cityName?: string;
};

export type CityOption = {
  name: string;
  lat: number;
  lng: number;
};

// Grote Belgische steden (kort voor UX)
export const BELGIUM_CITIES: CityOption[] = [
  { name: "Brussels", lat: 50.8466, lng: 4.3528 },
  { name: "Antwerp", lat: 51.2194, lng: 4.4025 },
  { name: "Ghent", lat: 51.0543, lng: 3.7174 },
  { name: "Liège", lat: 50.6326, lng: 5.5797 },
  { name: "Charleroi", lat: 50.4108, lng: 4.4446 },
  { name: "Bruges", lat: 51.2093, lng: 3.2247 },
  { name: "Namur", lat: 50.4669, lng: 4.8675 },
  { name: "Leuven", lat: 50.8798, lng: 4.7005 },
  { name: "Hasselt", lat: 50.9307, lng: 5.3325 },
  { name: "Mons", lat: 50.4542, lng: 3.9567 },
  { name: "Mechelen", lat: 51.0257, lng: 4.4776 },
];

const STORAGE_KEY = "eventify_origin_v1";
const CHANGED_EVENT = "eventify:origin-changed";

const DEFAULT_ORIGIN: Origin = {
  label: "Brussels",
  lat: 50.8466,
  lng: 4.3528,
  source: "city",
  cityName: "Brussels",
};

type JsonRecord = Record<string, unknown>;
function isRecord(v: unknown): v is JsonRecord {
  return typeof v === "object" && v !== null;
}
function num(v: unknown, fallback: number) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function str(v: unknown, fallback = "") {
  return typeof v === "string" ? v : fallback;
}

function notifyChanged() {
  window.dispatchEvent(new Event(CHANGED_EVENT));
}

export function subscribeOriginChanged(cb: () => void) {
  const h: EventListener = () => cb();
  window.addEventListener(CHANGED_EVENT, h);
  return () => window.removeEventListener(CHANGED_EVENT, h);
}

export function getOrigin(): Origin {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_ORIGIN;

    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return DEFAULT_ORIGIN;

    const lat = num(parsed.lat, DEFAULT_ORIGIN.lat);
    const lng = num(parsed.lng, DEFAULT_ORIGIN.lng);
    const source = parsed.source === "geolocation" ? "geolocation" : "city";
    const cityName = str(parsed.cityName, "") || undefined;
    const label =
      str(parsed.label, cityName || DEFAULT_ORIGIN.label) || DEFAULT_ORIGIN.label;

    return { lat, lng, source, label, cityName };
  } catch {
    return DEFAULT_ORIGIN;
  }
}

export function setCityOrigin(cityName: string) {
  const found = BELGIUM_CITIES.find((c) => c.name === cityName);

  const next: Origin = found
    ? { label: found.name, lat: found.lat, lng: found.lng, source: "city", cityName: found.name }
    : DEFAULT_ORIGIN;

  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  notifyChanged();
  return next;
}

export async function requestGeolocationOrigin(opts?: { timeoutMs?: number }): Promise<Origin> {
  const timeoutMs = opts?.timeoutMs ?? 10_000;

  if (!("geolocation" in navigator)) {
    throw new Error("Geolocation is not supported by this browser.");
  }

  const origin = await new Promise<Origin>((resolve, reject) => {
    let done = false;

    const t = window.setTimeout(() => {
      if (done) return;
      done = true;
      reject(new Error("Geolocation timed out."));
    }, timeoutMs);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (done) return;
        done = true;
        window.clearTimeout(t);
        resolve({
          label: "My location",
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          source: "geolocation",
        });
      },
      (err) => {
        if (done) return;
        done = true;
        window.clearTimeout(t);
        reject(new Error(err.message || "Geolocation was blocked."));
      },
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: timeoutMs }
    );
  });

  localStorage.setItem(STORAGE_KEY, JSON.stringify(origin));
  notifyChanged();
  return origin;
}

/**
 * Vraagt locatie 1x per sessie (best-effort).
 * Als user weigert -> we laten de huidige origin staan (default = Brussels of gekozen stad).
 */
export function ensureOriginOnFirstVisit() {
  const flagKey = "eventify_origin_requested_v1";
  if (sessionStorage.getItem(flagKey) === "1") return;

  sessionStorage.setItem(flagKey, "1");
  requestGeolocationOrigin({ timeoutMs: 6000 }).catch(() => {
    // ignore: denied / not available
  });
}
