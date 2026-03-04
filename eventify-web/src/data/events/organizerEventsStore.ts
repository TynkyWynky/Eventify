import type { EventItem } from "../../events/eventsStore";
import { apiFetch } from "../../auth/apiClient";

/**
 * Organizer-created events:
 * ✅ API-first (DB-backed)
 * ✅ Fallback to localStorage (so demo still works if API is down / endpoints missing)
 *
 * Visibility:
 * - Public list/details: only APPROVED events
 * - New submissions by normal users start as PENDING
 * - Admin can approve/reject
 */

export type ReviewStatus = "pending" | "approved" | "rejected";

export type OrganizerEvent = EventItem & {
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  status: ReviewStatus;
  reviewedAt?: string;
  reviewedBy?: string;

  promotedUntil?: string;
  promotionPlan?: "24h" | "7d";
  promotionAmount?: number;
};

export type OrganizerEventInput = {
  title: string;
  venue: string;
  city: string;
  dateLabel: string;
  tags: string[];
  imageUrl: string;

  addressLine: string;
  postalCode: string;
  country: string;
  latitude: number;
  longitude: number;
  description: string;
};

const AUTH_STORAGE_KEY = "eventify_auth_v2";

const STORAGE_KEY = "eventify_organizer_events_v1"; // legacy/local fallback + cache
const EVENTS_CHANGED_EVENT = "eventify:organizer-events-changed";
const ORGANIZER_PUBLIC_API_RETRY_MS = 5 * 60 * 1000;

const BRUSSELS = { lat: 50.8466, lng: 4.3528 };
let organizerPublicApiMissing = false;
let organizerPublicApiMissingAt = 0;

type JsonRecord = Record<string, unknown>;
function isRecord(v: unknown): v is JsonRecord {
  return typeof v === "object" && v !== null;
}
function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}
function num(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function arrStr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
}
function asStatus(v: unknown): ReviewStatus {
  if (v === "pending" || v === "approved" || v === "rejected") return v;
  return "pending";
}

function notifyChanged() {
  window.dispatchEvent(new Event(EVENTS_CHANGED_EVENT));
}

export function subscribeOrganizerEventsChanged(handler: () => void) {
  const h: EventListener = () => handler();
  window.addEventListener(EVENTS_CHANGED_EVENT, h);
  return () => window.removeEventListener(EVENTS_CHANGED_EVENT, h);
}

/** ---------- Auth token helper (module-safe) ---------- */
function getAuthFromStorage(): { token: string | null; user: { id: string; role: string } | null } {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return { token: null, user: null };
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return { token: null, user: null };

    const token = typeof parsed.token === "string" ? parsed.token : null;

    let user: { id: string; role: string } | null = null;
    if (isRecord(parsed.user) && typeof parsed.user.id === "string") {
      user = {
        id: parsed.user.id,
        role: typeof parsed.user.role === "string" ? parsed.user.role : "user",
      };
    }

    return { token, user };
  } catch {
    return { token: null, user: null };
  }
}

function requireToken(): string {
  const { token } = getAuthFromStorage();
  if (!token) throw new Error("Not authenticated");
  return token;
}

function shouldTryOrganizerPublicApi() {
  if (!organizerPublicApiMissing) return true;
  return Date.now() - organizerPublicApiMissingAt > ORGANIZER_PUBLIC_API_RETRY_MS;
}

function markOrganizerPublicApiMissing() {
  organizerPublicApiMissing = true;
  organizerPublicApiMissingAt = Date.now();
}

function errorLooksLikeMissingPublicApi(err: unknown) {
  const message = err instanceof Error ? err.message : String(err || "");
  return (
    (message.includes("/organizer/events/public") ||
      message.includes("/organizer/events/")) &&
    (message.includes("(404)") || message.includes("(405)") || message.includes("(501)"))
  );
}

/** ---------- Distance + Promotion helpers ---------- */

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

function promotionIsActive(e: Pick<OrganizerEvent, "promotedUntil">) {
  if (!e.promotedUntil) return false;
  const t = Date.parse(e.promotedUntil);
  if (!Number.isFinite(t)) return false;
  return t > Date.now();
}

/** ---------- Local fallback/cache ---------- */

function coerceOrganizerEvent(item: unknown): OrganizerEvent | null {
  if (!isRecord(item)) return null;

  const id = str(item.id);
  const ownerId = str(item.ownerId);
  if (!id || !ownerId) return null;

  const latitude = num(item.latitude, BRUSSELS.lat);
  const longitude = num(item.longitude, BRUSSELS.lng);

  return {
    id,
    title: str(item.title, "Untitled"),
    venue: str(item.venue, "Venue"),
    city: str(item.city, "City"),
    dateLabel: str(item.dateLabel, "TBA"),
    distanceKm: num(item.distanceKm, 0),
    imageUrl: str(
      item.imageUrl,
      "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=1400&q=80"
    ),
    tags: arrStr(item.tags),
    trending: Boolean(item.trending),

    addressLine: str(item.addressLine, "—"),
    postalCode: str(item.postalCode, "—"),
    country: str(item.country, "Belgium"),
    latitude,
    longitude,
    description: str(item.description, "—"),

    ownerId,
    createdAt: str(item.createdAt, new Date().toISOString()),
    updatedAt: str(item.updatedAt, new Date().toISOString()),

    status: asStatus(item.status),
    reviewedAt: str(item.reviewedAt, "") || undefined,
    reviewedBy: str(item.reviewedBy, "") || undefined,

    promotedUntil: str(item.promotedUntil, "") || undefined,
    promotionPlan:
      item.promotionPlan === "24h" || item.promotionPlan === "7d"
        ? item.promotionPlan
        : undefined,
    promotionAmount: num(item.promotionAmount, 0) || undefined,
  };
}

function loadAllLocal(): OrganizerEvent[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(coerceOrganizerEvent).filter(Boolean) as OrganizerEvent[];
  } catch {
    return [];
  }
}

function saveAllLocal(items: OrganizerEvent[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

function upsertLocalCache(items: OrganizerEvent[]) {
  if (items.length === 0) return;
  const all = loadAllLocal();
  const byId = new Map(all.map((e) => [e.id, e]));
  for (const e of items) byId.set(e.id, e);
  saveAllLocal(Array.from(byId.values()));
}

function removeFromLocalCache(id: string) {
  const all = loadAllLocal();
  saveAllLocal(all.filter((e) => e.id !== id));
}

/** ---------- API mapping helpers ---------- */

function toOrigin(opts?: { originLat?: number; originLng?: number }) {
  return {
    lat: typeof opts?.originLat === "number" ? opts.originLat : BRUSSELS.lat,
    lng: typeof opts?.originLng === "number" ? opts.originLng : BRUSSELS.lng,
  };
}

function applyOriginDistanceAndTrending(
  items: OrganizerEvent[],
  origin: { lat: number; lng: number }
): EventItem[] {
  return items.map((e) => {
    const d =
      Math.round(haversineKm(origin.lat, origin.lng, e.latitude, e.longitude) * 10) /
      10;

    const activePromo = promotionIsActive(e);

    return {
      ...e,
      distanceKm: Number.isFinite(e.distanceKm) && e.distanceKm > 0 ? e.distanceKm : d,
      trending: activePromo ? true : e.trending,
    } satisfies EventItem;
  });
}

function buildQuery(params: Record<string, string>) {
  const qs = new URLSearchParams(params);
  const s = qs.toString();
  return s ? `?${s}` : "";
}

/** ---------- Public (approved-only) ---------- */

export async function listPublicOrganizerEvents(opts?: {
  originLat?: number;
  originLng?: number;
}): Promise<EventItem[]> {
  const origin = toOrigin(opts);
  if (!shouldTryOrganizerPublicApi()) {
    const local = loadAllLocal().filter((e) => e.status === "approved");
    return applyOriginDistanceAndTrending(local, origin);
  }

  // Try API first
  try {
    const q = buildQuery({
      originLat: String(origin.lat),
      originLng: String(origin.lng),
    });

    const data = await apiFetch<{ ok: boolean; events?: unknown[] }>(
      `/organizer/events/public${q}`
    );

    const raw = Array.isArray(data.events) ? data.events : [];
    const items = raw.map(coerceOrganizerEvent).filter(Boolean) as OrganizerEvent[];

    // Cache for offline fallback
    upsertLocalCache(items);

    // Ensure public-only in case server returns more
    const approvedOnly = items.filter((e) => e.status === "approved");
    return applyOriginDistanceAndTrending(approvedOnly, origin);
  } catch (err: unknown) {
    if (errorLooksLikeMissingPublicApi(err)) {
      markOrganizerPublicApiMissing();
    }
    // Fallback: local storage
    const local = loadAllLocal().filter((e) => e.status === "approved");
    return applyOriginDistanceAndTrending(local, origin);
  }
}

export async function getPublicOrganizerEventById(
  eventId: string,
  opts?: { originLat?: number; originLng?: number }
): Promise<EventItem | undefined> {
  const origin = toOrigin(opts);
  if (!shouldTryOrganizerPublicApi()) {
    const local = loadAllLocal().find((e) => e.id === eventId && e.status === "approved");
    if (!local) return undefined;
    return applyOriginDistanceAndTrending([local], origin)[0];
  }

  // Try API first (faster than fetching whole list)
  try {
    const q = buildQuery({
      originLat: String(origin.lat),
      originLng: String(origin.lng),
    });

    const data = await apiFetch<{ ok: boolean; event?: unknown }>(
      `/organizer/events/${encodeURIComponent(eventId)}/public${q}`
    );

    const coerced = coerceOrganizerEvent(data.event);
    if (!coerced || coerced.status !== "approved") return undefined;

    upsertLocalCache([coerced]);

    const withFix = applyOriginDistanceAndTrending([coerced], origin);
    return withFix[0];
  } catch (err: unknown) {
    if (errorLooksLikeMissingPublicApi(err)) {
      markOrganizerPublicApiMissing();
    }
    const local = loadAllLocal().find((e) => e.id === eventId && e.status === "approved");
    if (!local) return undefined;
    return applyOriginDistanceAndTrending([local], origin)[0];
  }
}

/** ---------- Owner/Admin lists ---------- */

export async function listOrganizerEventsByOwner(ownerId: string): Promise<OrganizerEvent[]> {
  // API first (server should infer owner from token)
  try {
    const token = requireToken();
    const data = await apiFetch<{ ok: boolean; events?: unknown[] }>(`/organizer/events/mine`, {
      token,
    });

    const raw = Array.isArray(data.events) ? data.events : [];
    const items = raw.map(coerceOrganizerEvent).filter(Boolean) as OrganizerEvent[];

    upsertLocalCache(items);
    return items;
  } catch {
    // Fallback: local storage
    return loadAllLocal().filter((e) => e.ownerId === ownerId);
  }
}

export async function listOrganizerEventsAll(): Promise<OrganizerEvent[]> {
  // API first (admin only)
  try {
    const token = requireToken();
    const data = await apiFetch<{ ok: boolean; events?: unknown[] }>(`/admin/organizer-events`, {
      token,
    });

    const raw = Array.isArray(data.events) ? data.events : [];
    const items = raw.map(coerceOrganizerEvent).filter(Boolean) as OrganizerEvent[];

    upsertLocalCache(items);
    return items;
  } catch {
    // Fallback: local storage (demo)
    return loadAllLocal();
  }
}

/** ---------- Mutations ---------- */

export async function createOrganizerEvent(
  ownerId: string,
  input: OrganizerEventInput
): Promise<OrganizerEvent> {
  // API first
  try {
    const token = requireToken();
    const data = await apiFetch<{ ok: boolean; event?: unknown }>(`/organizer/events`, {
      method: "POST",
      token,
      body: input,
    });

    const created = coerceOrganizerEvent(data.event);
    if (!created) throw new Error("Invalid server response (event).");

    upsertLocalCache([created]);
    notifyChanged();
    return created;
  } catch {
    // Fallback: local storage create
    const now = new Date().toISOString();
    const id =
      globalThis.crypto && typeof globalThis.crypto.randomUUID === "function"
        ? `org_evt_${globalThis.crypto.randomUUID()}`
        : `org_evt_${Math.random().toString(16).slice(2)}`;

    const { user } = getAuthFromStorage();
    const isOrganizer = user?.role === "organizer" || user?.role === "admin";

    const created: OrganizerEvent = {
      id,
      title: input.title,
      venue: input.venue,
      city: input.city,
      dateLabel: input.dateLabel,
      distanceKm: 0,
      imageUrl:
        input.imageUrl.trim() ||
        "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=1400&q=80",
      tags: input.tags,
      trending: false,

      addressLine: input.addressLine,
      postalCode: input.postalCode,
      country: input.country,
      latitude: input.latitude,
      longitude: input.longitude,
      description: input.description,

      ownerId,
      createdAt: now,
      updatedAt: now,

      status: isOrganizer ? "approved" : "pending",
    };

    const all = loadAllLocal();
    saveAllLocal([created, ...all]);
    notifyChanged();
    return created;
  }
}

export async function updateOrganizerEvent(
  ownerId: string,
  eventId: string,
  input: OrganizerEventInput
): Promise<OrganizerEvent> {
  // API first
  try {
    const token = requireToken();
    const data = await apiFetch<{ ok: boolean; event?: unknown }>(
      `/organizer/events/${encodeURIComponent(eventId)}`,
      {
        method: "PATCH",
        token,
        body: input,
      }
    );

    const updated = coerceOrganizerEvent(data.event);
    if (!updated) throw new Error("Invalid server response (event).");

    upsertLocalCache([updated]);
    notifyChanged();
    return updated;
  } catch {
    // Fallback: local storage update
    const all = loadAllLocal();
    const idx = all.findIndex((e) => e.id === eventId);
    if (idx < 0) throw new Error("Event not found");
    if (all[idx].ownerId !== ownerId) throw new Error("Not allowed");

    const now = new Date().toISOString();
    const updated: OrganizerEvent = {
      ...all[idx],
      ...input,
      updatedAt: now,
    };

    all[idx] = updated;
    saveAllLocal(all);
    notifyChanged();
    return updated;
  }
}

export async function deleteOrganizerEvent(ownerId: string, eventId: string): Promise<boolean> {
  // API first
  try {
    const token = requireToken();
    await apiFetch<{ ok: boolean }>(`/organizer/events/${encodeURIComponent(eventId)}`, {
      method: "DELETE",
      token,
    });

    removeFromLocalCache(eventId);
    notifyChanged();
    return true;
  } catch {
    // Fallback: local storage delete
    const all = loadAllLocal();
    const found = all.find((e) => e.id === eventId);
    if (!found) return false;
    if (found.ownerId !== ownerId) throw new Error("Not allowed");

    saveAllLocal(all.filter((e) => e.id !== eventId));
    notifyChanged();
    return true;
  }
}

export async function reviewOrganizerEvent(
  reviewerId: string,
  eventId: string,
  nextStatus: ReviewStatus
): Promise<OrganizerEvent> {
  // API first (admin)
  try {
    const token = requireToken();
    const data = await apiFetch<{ ok: boolean; event?: unknown }>(
      `/admin/organizer-events/${encodeURIComponent(eventId)}/review`,
      {
        method: "PATCH",
        token,
        body: { status: nextStatus },
      }
    );

    const updated = coerceOrganizerEvent(data.event);
    if (!updated) throw new Error("Invalid server response (event).");

    upsertLocalCache([updated]);
    notifyChanged();
    return updated;
  } catch {
    // Fallback: local storage review
    const all = loadAllLocal();
    const idx = all.findIndex((e) => e.id === eventId);
    if (idx < 0) throw new Error("Event not found");

    const now = new Date().toISOString();
    all[idx] = {
      ...all[idx],
      status: nextStatus,
      reviewedAt: now,
      reviewedBy: reviewerId,
      updatedAt: now,
    };

    saveAllLocal(all);
    notifyChanged();
    return all[idx];
  }
}

/**
 * MyEventsPage uses setPromotion(plan | null)
 * API endpoint: PATCH /organizer/events/:id/promotion { plan }
 */
export async function setPromotion(
  ownerId: string,
  eventId: string,
  plan: "24h" | "7d" | null
): Promise<OrganizerEvent> {
  // API first
  try {
    const token = requireToken();
    const data = await apiFetch<{ ok: boolean; event?: unknown }>(
      `/organizer/events/${encodeURIComponent(eventId)}/promotion`,
      {
        method: "PATCH",
        token,
        body: { plan },
      }
    );

    const updated = coerceOrganizerEvent(data.event);
    if (!updated) throw new Error("Invalid server response (event).");

    upsertLocalCache([updated]);
    notifyChanged();
    return updated;
  } catch {
    // Fallback: local storage promotion
    const all = loadAllLocal();
    const idx = all.findIndex((e) => e.id === eventId);
    if (idx === -1) throw new Error("Event not found");
    if (all[idx].ownerId !== ownerId) throw new Error("Not allowed");

    const prev = all[idx];
    if (prev.status !== "approved") {
      throw new Error("Event must be approved before promotion.");
    }

    const next: OrganizerEvent = {
      ...prev,
      updatedAt: new Date().toISOString(),
    };

    if (!plan) {
      delete next.promotedUntil;
      delete next.promotionPlan;
      delete next.promotionAmount;
    } else {
      const ms = plan === "24h" ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
      next.promotedUntil = new Date(Date.now() + ms).toISOString();
      next.promotionPlan = plan;
      next.promotionAmount = plan === "24h" ? 9.99 : 24.99;
    }

    const updatedAll = [...all];
    updatedAll[idx] = next;
    saveAllLocal(updatedAll);
    notifyChanged();
    return next;
  }
}
