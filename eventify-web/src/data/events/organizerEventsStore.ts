import type { EventItem } from "../../events/eventsStore";
import { getUserById, setUserRole } from "../../auth/usersStore";

/**
 * Organizer-created events live in localStorage.
 * Visibility: only APPROVED events are public.
 * New events start as PENDING and must be approved by an admin.
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

const STORAGE_KEY = "eventify_organizer_events_v1";
const EVENTS_CHANGED_EVENT = "eventify:organizer-events-changed";

const BRUSSELS = { lat: 50.8466, lng: 4.3528 };

type JsonRecord = Record<string, unknown>;
function isRecord(v: unknown): v is JsonRecord {
  return typeof v === "object" && v !== null;
}
function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}
function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
function arrStr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
}

function asStatus(v: unknown): ReviewStatus {
  if (v === "pending" || v === "approved" || v === "rejected") return v;
  return "approved"; 
}

function uid(prefix: string) {
  const c: Crypto | undefined = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return `${prefix}_${c.randomUUID()}`;
  return `${prefix}_${Math.random().toString(16).slice(2)}`;
}

function notifyChanged() {
  window.dispatchEvent(new Event(EVENTS_CHANGED_EVENT));
}

export function subscribeOrganizerEventsChanged(handler: () => void) {
  const h: EventListener = () => handler();
  window.addEventListener(EVENTS_CHANGED_EVENT, h);
  return () => window.removeEventListener(EVENTS_CHANGED_EVENT, h);
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

function distanceFromBrusselsKm(lat: number, lng: number) {
  return haversineKm(BRUSSELS.lat, BRUSSELS.lng, lat, lng);
}

function loadAll(): OrganizerEvent[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const out: OrganizerEvent[] = [];
    for (const item of parsed) {
      if (!isRecord(item)) continue;

      const id = str(item.id);
      const ownerId = str(item.ownerId);
      if (!id || !ownerId) continue;

      const latitude = num(item.latitude, BRUSSELS.lat);
      const longitude = num(item.longitude, BRUSSELS.lng);
      const distanceKm = num(item.distanceKm, distanceFromBrusselsKm(latitude, longitude));

      const status = asStatus(item.status);

      out.push({
        id,
        title: str(item.title, "Untitled"),
        venue: str(item.venue, "Venue"),
        city: str(item.city, "City"),
        dateLabel: str(item.dateLabel, "TBA"),
        distanceKm,
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

        status,
        reviewedAt: str(item.reviewedAt, "") || undefined,
        reviewedBy: str(item.reviewedBy, "") || undefined,

        promotedUntil: str(item.promotedUntil, "") || undefined,
        promotionPlan:
          item.promotionPlan === "24h" || item.promotionPlan === "7d"
            ? item.promotionPlan
            : undefined,
        promotionAmount: num(item.promotionAmount, 0) || undefined,
      });
    }

    return out;
  } catch {
    return [];
  }
}

function saveAll(items: OrganizerEvent[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

function promotionIsActive(e: OrganizerEvent) {
  if (!e.promotedUntil) return false;
  const t = Date.parse(e.promotedUntil);
  if (!Number.isFinite(t)) return false;
  return t > Date.now();
}

/** Public list: what everyone can see on the dashboard (ONLY approved) */
export function listPublicOrganizerEvents(): EventItem[] {
  const items = loadAll().filter((e) => e.status === "approved");

  return items.map((e) => {
    const active = promotionIsActive(e);
    return {
      ...e,
      trending: active ? true : e.trending,
    } satisfies EventItem;
  });
}

export function getPublicOrganizerEventById(eventId: string): EventItem | undefined {
  return listPublicOrganizerEvents().find((e) => e.id === eventId);
}

/** Admin list: everything */
export function listOrganizerEventsAll(): OrganizerEvent[] {
  return loadAll();
}

/** Owner list: includes private fields + status */
export function listOrganizerEventsByOwner(ownerId: string): OrganizerEvent[] {
  return loadAll().filter((e) => e.ownerId === ownerId);
}

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

export function createOrganizerEvent(ownerId: string, input: OrganizerEventInput) {
  const now = new Date().toISOString();
  const id = uid("org_evt");

  const distanceKm = distanceFromBrusselsKm(input.latitude, input.longitude);

  const created: OrganizerEvent = {
    id,
    title: input.title,
    venue: input.venue,
    city: input.city,
    dateLabel: input.dateLabel,
    distanceKm,
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

    status: "pending",
  };

  const all = loadAll();
  saveAll([created, ...all]);
  notifyChanged();
  return created;
}

export function updateOrganizerEvent(
  ownerId: string,
  eventId: string,
  patch: Partial<OrganizerEventInput>
) {
  const all = loadAll();
  const idx = all.findIndex((e) => e.id === eventId);
  if (idx === -1) throw new Error("Event not found.");
  if (all[idx].ownerId !== ownerId) throw new Error("Not allowed.");

  const prev = all[idx];

  const needsReReview = prev.status !== "pending";

  const next: OrganizerEvent = {
    ...prev,
    ...patch,
    imageUrl:
      (patch.imageUrl ?? prev.imageUrl).trim() ||
      "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=1400&q=80",
    updatedAt: new Date().toISOString(),

    status: needsReReview ? "pending" : prev.status,
    reviewedAt: needsReReview ? undefined : prev.reviewedAt,
    reviewedBy: needsReReview ? undefined : prev.reviewedBy,
  };

  const lat = patch.latitude ?? prev.latitude;
  const lng = patch.longitude ?? prev.longitude;
  next.distanceKm = distanceFromBrusselsKm(lat, lng);

  const updated = [...all];
  updated[idx] = next;
  saveAll(updated);
  notifyChanged();
  return next;
}

export function deleteOrganizerEvent(ownerId: string, eventId: string) {
  const all = loadAll();
  const found = all.find((e) => e.id === eventId);
  if (!found) return;
  if (found.ownerId !== ownerId) throw new Error("Not allowed.");
  saveAll(all.filter((e) => e.id !== eventId));
  notifyChanged();
}

export function reviewOrganizerEvent(
  adminId: string,
  eventId: string,
  nextStatus: Exclude<ReviewStatus, "pending">
) {
  const admin = getUserById(adminId);
  if (!admin || admin.role !== "admin") {
    throw new Error("Not allowed.");
  }

  const all = loadAll();
  const idx = all.findIndex((e) => e.id === eventId);
  if (idx === -1) throw new Error("Event not found.");

  const now = new Date().toISOString();
  const prev = all[idx];

  const next: OrganizerEvent = {
    ...prev,
    status: nextStatus,
    reviewedAt: now,
    reviewedBy: adminId,
    updatedAt: now,
  };

  const updated = [...all];
  updated[idx] = next;
  saveAll(updated);
  notifyChanged();

  if (nextStatus === "approved") {
    const owner = getUserById(prev.ownerId);
    if (owner && owner.role === "user") {
      setUserRole(prev.ownerId, "organizer");
    }
  }


  return next;
}

export function setPromotion(ownerId: string, eventId: string, plan: "24h" | "7d" | null) {
  const all = loadAll();
  const idx = all.findIndex((e) => e.id === eventId);
  if (idx === -1) throw new Error("Event not found.");
  if (all[idx].ownerId !== ownerId) throw new Error("Not allowed.");

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

  const updated = [...all];
  updated[idx] = next;
  saveAll(updated);
  notifyChanged();
  return next;
}
