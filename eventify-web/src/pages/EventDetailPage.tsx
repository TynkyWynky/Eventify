import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import type { EventItem } from "../events/eventsStore";
import { eventsRepo } from "../data/events";
import { getGenreFallbackImage } from "../data/events/genreImages";
import { rememberViewedEvent } from "../data/events/recentlyViewedEventsStore";
import { useAuth } from "../auth/AuthContext";
import { apiBaseForUrlConstructor, apiFetch } from "../auth/apiClient";
import { useNotifications } from "../components/NotificationProvider";
import GroupPlansPanel from "./eventDetail/GroupPlansPanel";

import {
  countGoings,
  getUserGoingEventIds,
  getViews,
  incrementView,
  subscribeMetricsChanged,
} from "../data/events/eventMetricsStore";
import {
  getUserFavoriteEventIds,
  isFavorite as isUserFavorite,
  subscribeFavoritesChanged,
  toggleFavorite as toggleUserFavorite,
} from "../data/events/eventFavoritesStore";
import {
  DEFAULT_USER_LAT,
  DEFAULT_USER_LNG,
  fetchAiGenrePredict,
  fetchAiRecommendations,
  toAiEventPayload,
} from "../data/events/aiClient";

import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

import { getOrigin, subscribeOriginChanged } from "../data/location/locationStore";

delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

function safeNum(n: unknown, fallback: number) {
  const v = typeof n === "number" ? n : Number(n);
  return Number.isFinite(v) ? v : fallback;
}

function dedupeIds(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function parseEventStartDate(event: EventItem): Date | null {
  if (event.startIso) {
    const start = new Date(event.startIso);
    if (!Number.isNaN(start.getTime())) return start;
  }

  const fallback = new Date(event.dateLabel);
  if (!Number.isNaN(fallback.getTime())) return fallback;
  return null;
}

function toIcsUtcStamp(date: Date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function buildGoogleCalendarUrl(input: {
  title: string;
  start: Date;
  end: Date;
  details: string;
  location: string;
}) {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: input.title,
    dates: `${toIcsUtcStamp(input.start)}/${toIcsUtcStamp(input.end)}`,
    details: input.details,
    location: input.location,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function buildOutlookCalendarUrl(input: {
  title: string;
  start: Date;
  end: Date;
  details: string;
  location: string;
}) {
  const params = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: input.title,
    startdt: input.start.toISOString(),
    enddt: input.end.toISOString(),
    body: input.details,
    location: input.location,
  });
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`;
}

function escapeIcsText(value: string) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function foldIcsLine(line: string) {
  const maxLen = 74;
  if (line.length <= maxLen) return line;
  const parts: string[] = [];
  let start = 0;
  while (start < line.length) {
    const end = Math.min(start + maxLen, line.length);
    const chunk = line.slice(start, end);
    parts.push(start === 0 ? chunk : ` ${chunk}`);
    start = end;
  }
  return parts.join("\r\n");
}

function buildIcsContent(input: {
  title: string;
  start: Date;
  end: Date;
  details: string;
  location: string;
  url?: string;
  uidSeed?: string;
}) {
  const uid = `${input.uidSeed || "eventium-event"}-${toIcsUtcStamp(input.start)}@eventium.app`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    "PRODID:-//Eventium//Events//EN",
    "BEGIN:VEVENT",
    `UID:${escapeIcsText(uid)}`,
    `DTSTAMP:${toIcsUtcStamp(new Date())}`,
    `DTSTART:${toIcsUtcStamp(input.start)}`,
    `DTEND:${toIcsUtcStamp(input.end)}`,
    `SUMMARY:${escapeIcsText(input.title)}`,
    `DESCRIPTION:${escapeIcsText(input.details)}`,
    `LOCATION:${escapeIcsText(input.location)}`,
    input.url ? `URL:${escapeIcsText(input.url)}` : null,
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean) as string[];

  return lines.map((line) => foldIcsLine(line)).join("\r\n");
}

function toSafeFileName(value: string) {
  const cleaned = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return cleaned || "eventium-event";
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

type SetlistItem = {
  id?: string | null;
  eventDate?: string | null;
  tour?: string | null;
  venue?: string | null;
  city?: string | null;
  country?: string | null;
  url?: string | null;
};

type SetlistsResponse = {
  ok: boolean;
  error?: string;
  items?: SetlistItem[];
};

type EnrichResponse = {
  ok: boolean;
  error?: string;
  event?: {
    description?: string | null;
    url?: string | null;
    ticketUrl?: string | null;
    artistName?: string | null;
    start?: string | null;
    cost?: number | null;
    priceMin?: number | null;
    priceMax?: number | null;
    currency?: string | null;
    isFree?: boolean | null;
    metadata?: {
      priceMin?: number | null;
      priceMax?: number | null;
    } | null;
  };
};

type HttpStatusError = Error & { status?: number };
type PublicUser = {
  id: string;
  username: string;
  name: string;
  email: string;
};

type EventSocialResponse = {
  ok: boolean;
  eventKey: string;
  goingCount: number;
  myGoing: boolean;
  friendsGoing: PublicUser[];
  myInvite: unknown | null;
};

type FriendsResponse = {
  ok: boolean;
  friends: PublicUser[];
};

type GroupPlanItem = {
  id: string;
  eventKey: string;
  title: string;
  note: string;
  status: "open" | "closed";
  options: string[];
  createdAt: string;
  updatedAt: string;
  creator: PublicUser;
  members: Array<{ role: "creator" | "invited"; user: PublicUser; joinedAt: string }>;
  voteCounts: Record<string, number>;
  myVote: number | null;
};

type GroupPlansResponse = {
  ok: boolean;
  plans: GroupPlanItem[];
};

function formatStartIso(startIso?: string | null) {
  if (!startIso) return null;
  const d = new Date(startIso);
  if (Number.isNaN(d.getTime())) return startIso;
  return d.toLocaleString(undefined, {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatPriceRangeLabel(event: EventItem) {
  if (event.isFree === true) return "Free";

  const toNum = (value: unknown) => {
    if (value == null || value === "") return null;
    if (typeof value === "boolean") return null;
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : null;
  };

  const min = toNum(event.priceMin);
  const max = toNum(event.priceMax);
  const cost = toNum(event.cost);
  const currency = String(event.currency || "").trim().toUpperCase();
  const fmtAmount = (value: number) => {
    const rounded = Number.isInteger(value)
      ? String(Math.round(value))
      : value.toFixed(2).replace(/\.00$/, "");
    return !currency || currency === "EUR" ? `€${rounded}` : `${currency} ${rounded}`;
  };

  if (min != null && max != null) {
    const a = Math.min(min, max);
    const b = Math.max(min, max);
    return Math.abs(a - b) < 0.01 ? fmtAmount(a) : `${fmtAmount(a)}–${fmtAmount(b)}`;
  }
  if (cost != null) return fmtAmount(cost);
  if (min != null) return fmtAmount(min);
  if (max != null) return fmtAmount(max);
  return "Price unknown";
}

function normalizeComparable(text: string) {
  return text
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function sanitizeDetailDescription(
  description: string,
  options: { artistName?: string; startLabel?: string }
) {
  const raw = (description || "").replace(/\s+/g, " ").trim();
  if (!raw) return null;

  const artist = normalizeComparable(options.artistName || "");
  const start = normalizeComparable(options.startLabel || "");
  const parts = raw
    .split(/(?<=[.!?])\s+|[\r\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  const filtered = parts.filter((part) => {
    const norm = normalizeComparable(part);
    if (!norm) return false;
    if (norm === "tickets available online") return false;
    if (/^starts? /.test(norm)) return false;
    if (start && norm === start) return false;

    if (artist) {
      if (norm === artist) return false;
      const stripped = norm.replace(/^(artist|featuring|feat|ft|with|avec)\s+/, "").trim();
      if (stripped === artist) return false;
    }

    return true;
  });

  const cleaned = filtered.join(" ").trim();
  return cleaned || null;
}

function toPercentLabel(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return `${Math.round(value * 100)}%`;
}

function getMatchLevel(score: number | null) {
  if (typeof score !== "number" || !Number.isFinite(score)) return null;
  if (score >= 0.75) return "strong";
  if (score >= 0.55) return "decent";
  return "weak";
}

export default function EventDetailPage() {
  const { eventId } = useParams();
  const { user, token } = useAuth();
  const { notify } = useNotifications();
  const isAdmin = user?.role === "admin";
  const navigate = useNavigate();
  const location = useLocation();

  // Terug naar dashboard met dezelfde filters (querystring)
  const backTo = "/" + (location.search || "");

  const [event, setEvent] = useState<EventItem | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [views, setViews] = useState(0);

  // ✅ SERVER social state
  const [isGoing, setIsGoing] = useState(false);
  const [friendsGoing, setFriendsGoing] = useState<PublicUser[]>([]);
  const [socialLoading, setSocialLoading] = useState(false);
  const [socialError, setSocialError] = useState<string | null>(null);
  const [goingSaving, setGoingSaving] = useState(false);

  // ✅ Friends list (for dropdown invite)
  const [friendsAll, setFriendsAll] = useState<PublicUser[]>([]);
  const [friendsAllLoading, setFriendsAllLoading] = useState(false);
  const [friendsAllError, setFriendsAllError] = useState<string | null>(null);

  const [inviteeId, setInviteeId] = useState<string>("");
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteMsg, setInviteMsg] = useState<string | null>(null);
  const [inviteErr, setInviteErr] = useState<string | null>(null);
  const [plans, setPlans] = useState<GroupPlanItem[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);
  const [plansError, setPlansError] = useState<string | null>(null);
  const [planTitle, setPlanTitle] = useState("");
  const [planNote, setPlanNote] = useState("");
  const [planOptionDraft, setPlanOptionDraft] = useState("");
  const [planOptions, setPlanOptions] = useState<string[]>([
    "Friday 19:30",
    "Saturday 20:00",
  ]);
  const [selectedPlanInviteeIds, setSelectedPlanInviteeIds] = useState<string[]>([]);
  const [planCreating, setPlanCreating] = useState(false);
  const [planActionMsg, setPlanActionMsg] = useState<string | null>(null);
  const [socialPanelOpen, setSocialPanelOpen] = useState(false);
  const [calendarMenuOpen, setCalendarMenuOpen] = useState(false);
  const calendarMenuRef = useRef<HTMLDivElement | null>(null);

  const [isFav, setIsFav] = useState(false);
  const [setlists, setSetlists] = useState<SetlistItem[]>([]);
  const [setlistsLoading, setSetlistsLoading] = useState(false);
  const [setlistsError, setSetlistsError] = useState<string | null>(null);
  const [hideSetlistsSection, setHideSetlistsSection] = useState(false);
  const [heroImageUrl, setHeroImageUrl] = useState<string>("");
  const [tmEnrichAttemptedSourceId, setTmEnrichAttemptedSourceId] = useState<string | null>(null);
  const [aiInsightsLoading, setAiInsightsLoading] = useState(false);
  const [aiInsightsError, setAiInsightsError] = useState<string | null>(null);
  const [aiReasons, setAiReasons] = useState<string[]>([]);
  const [aiScore, setAiScore] = useState<number | null>(null);
  const [aiComponents, setAiComponents] = useState<{
    genreMatch?: number;
    distance?: number;
    popularity?: number;
    similarity?: number;
  } | null>(null);
  const [aiGenrePredictions, setAiGenrePredictions] = useState<
    Array<{ genre: string; confidence: number }>
  >([]);

  useEffect(() => {
    if (!calendarMenuOpen) return;

    const closeIfOutside = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (calendarMenuRef.current?.contains(target)) return;
      setCalendarMenuOpen(false);
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCalendarMenuOpen(false);
    };

    document.addEventListener("mousedown", closeIfOutside);
    document.addEventListener("touchstart", closeIfOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeIfOutside);
      document.removeEventListener("touchstart", closeIfOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [calendarMenuOpen]);

  // ✅ origin (My location / city)
  const [origin, setOriginState] = useState(() => getOrigin());
  useEffect(() => subscribeOriginChanged(() => setOriginState(getOrigin())), []);

  // Load event details
  useEffect(() => {
    if (!eventId) return;

    const controller = new AbortController();

    Promise.resolve().then(() => {
      if (controller.signal.aborted) return;
      setIsLoading(true);
      setError(null);
    });

    eventsRepo
      .getById(eventId, { signal: controller.signal })
      .then((e) => setEvent(e))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
  }, [eventId]);

  useEffect(() => {
    if (!event) return;
    rememberViewedEvent(event);
  }, [event]);

  // Views metrics (local)
  useEffect(() => {
    if (!eventId) return;

    incrementView(eventId);

    const refresh = () => {
      setViews(getViews(eventId));
    };

    refresh();
    return subscribeMetricsChanged(refresh);
  }, [eventId]);

  // Favorites
  useEffect(() => {
    if (!eventId) return;

    const refreshFav = () => {
      setIsFav(user ? isUserFavorite(user.id, eventId) : false);
    };

    refreshFav();
    return subscribeFavoritesChanged(refreshFav);
  }, [eventId, user]);

  // ✅ Load SERVER social data (going count, myGoing, friendsGoing)
  const refreshSocial = async (signal?: AbortSignal) => {
    if (!eventId) return;
    try {
      const data = await apiFetch<EventSocialResponse>(`/events/${encodeURIComponent(eventId)}/social`, {
        token: token || null,
        signal,
      });
      if (!data?.ok) throw new Error("Could not load social info");
      setIsGoing(Boolean(data.myGoing));
      setFriendsGoing(Array.isArray(data.friendsGoing) ? data.friendsGoing : []);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setSocialError(err instanceof Error ? err.message : String(err));
    }
  };

  const refreshPlans = async (signal?: AbortSignal) => {
    if (!eventId || !token) {
      setPlans([]);
      setPlansError(null);
      return;
    }
    try {
      const data = await apiFetch<GroupPlansResponse>(
        `/events/${encodeURIComponent(eventId)}/plans`,
        { token, signal }
      );
      setPlans(Array.isArray(data.plans) ? data.plans : []);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setPlansError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    if (!eventId) return;

    const controller = new AbortController();

    Promise.resolve().then(() => {
      if (controller.signal.aborted) return;
      setSocialLoading(true);
      setSocialError(null);
    });

    refreshSocial(controller.signal)
      .finally(() => {
        if (!controller.signal.aborted) setSocialLoading(false);
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, token]);

  // ✅ Load friends for dropdown
  useEffect(() => {
    if (!token) {
      setFriendsAll([]);
      setFriendsAllError(null);
      setFriendsAllLoading(false);
      setInviteeId("");
      return;
    }

    const controller = new AbortController();

    Promise.resolve().then(() => {
      if (controller.signal.aborted) return;
      setFriendsAllLoading(true);
      setFriendsAllError(null);
    });

    apiFetch<FriendsResponse>("/friends", { token, signal: controller.signal })
      .then((data) => {
        setFriendsAll(Array.isArray(data.friends) ? data.friends : []);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setFriendsAllError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setFriendsAllLoading(false);
      });

    return () => controller.abort();
  }, [token]);

  useEffect(() => {
    if (!eventId || !token) {
      setPlans([]);
      setPlansLoading(false);
      setPlansError(null);
      return;
    }

    const controller = new AbortController();
    Promise.resolve().then(() => {
      if (controller.signal.aborted) return;
      setPlansLoading(true);
      setPlansError(null);
    });

    refreshPlans(controller.signal).finally(() => {
      if (!controller.signal.aborted) setPlansLoading(false);
    });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, token]);

  useEffect(() => {
    const sp = new URLSearchParams(location.search);
    if (!sp.get("plan")) return;
    if (plansLoading) return;

    const el = document.getElementById("event-group-plans");
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [location.search, plansLoading]);

  // Setlists
  useEffect(() => {
    setTmEnrichAttemptedSourceId(null);
  }, [eventId]);

  useEffect(() => {
    const artist = event?.artistName?.trim();

    if (!artist) {
      setSetlists([]);
      setSetlistsError(null);
      setSetlistsLoading(false);
      setHideSetlistsSection(false);
      return;
    }

    const controller = new AbortController();
    const url = new URL("setlists", apiBaseForUrlConstructor());
    url.searchParams.set("artistName", artist);

    setSetlistsLoading(true);
    setSetlistsError(null);
    setHideSetlistsSection(false);

    fetch(url.toString(), { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          const statusError = new Error(
            `Setlists request failed (${res.status})`
          ) as HttpStatusError;
          statusError.status = res.status;
          throw statusError;
        }
        const data = (await res.json()) as SetlistsResponse;
        if (!data.ok) throw new Error(data.error || "Could not fetch setlists");
        setSetlists((data.items || []).slice(0, 5));
        setHideSetlistsSection(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;

        const maybeStatus =
          typeof err === "object" &&
          err != null &&
          "status" in err &&
          typeof (err as { status?: unknown }).status === "number"
            ? Number((err as { status?: number }).status)
            : null;

        if (maybeStatus === 500) {
          setSetlists([]);
          setSetlistsError(null);
          setHideSetlistsSection(true);
          return;
        }

        setSetlists([]);
        setHideSetlistsSection(false);
        setSetlistsError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setSetlistsLoading(false);
      });

    return () => controller.abort();
  }, [event?.artistName]);

  // Hero image (preload + fallback)
  useEffect(() => {
    if (!event || !eventId) {
      setAiInsightsLoading(false);
      setAiInsightsError(null);
      setAiReasons([]);
      setAiScore(null);
      setAiComponents(null);
      setAiGenrePredictions([]);
      return;
    }

    const controller = new AbortController();
    setAiInsightsLoading(true);
    setAiInsightsError(null);

    (async () => {
      const interestedCount = countGoings(eventId);
      const eventPayload = toAiEventPayload(event, {
        interestedCount,
        peerInterestedCount: interestedCount,
      });

      const likedPayload: Array<Record<string, unknown>> = [];
      const preferredGenreCounts = new Map<string, number>();
      for (const tag of event.tags) {
        if (!tag || tag === "All") continue;
        preferredGenreCounts.set(tag, (preferredGenreCounts.get(tag) ?? 0) + 1);
      }

      if (user) {
        const favoriteIds = getUserFavoriteEventIds(user.id);
        const goingIds = getUserGoingEventIds(user.id);
        const favoriteSet = new Set(favoriteIds);
        const goingSet = new Set(goingIds);
        const ids = dedupeIds([...favoriteIds, ...goingIds]).slice(0, 16);

        for (const id of ids) {
          if (controller.signal.aborted) return;
          const liked = await eventsRepo.getById(id, { signal: controller.signal });
          if (!liked || liked.id === event.id) continue;

          likedPayload.push(
            toAiEventPayload(liked, {
              interestedCount: countGoings(liked.id),
              peerInterestedCount: countGoings(liked.id),
              preferenceWeight:
                (favoriteSet.has(liked.id) ? 1.7 : 0) +
                  (goingSet.has(liked.id) ? 1.3 : 0) || 1,
            })
          );

          for (const tag of liked.tags) {
            if (!tag || tag === "All") continue;
            preferredGenreCounts.set(tag, (preferredGenreCounts.get(tag) ?? 0) + 2);
          }
        }
      }

      const preferredGenres = [...preferredGenreCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([genre]) => genre);

      const userProfile = {
        preferredGenres,
        likedEvents: likedPayload,
        lat: DEFAULT_USER_LAT,
        lng: DEFAULT_USER_LNG,
        maxDistanceKm: 30,
        peerInterestByEventId: { [eventId]: interestedCount },
      };

      const [genreRes, recRes] = await Promise.all([
        fetchAiGenrePredict(
          {
            events: [eventPayload],
            topK: 3,
            enrichMissingGenres: true,
          },
          controller.signal
        ),
        fetchAiRecommendations(
          {
            events: [eventPayload],
            userProfile,
            limit: 1,
          },
          controller.signal
        ),
      ]);

      if (controller.signal.aborted) return;
      if (!genreRes.ok || !recRes.ok) {
        throw new Error(
          genreRes.error || recRes.error || "AI insights endpoints failed."
        );
      }

      const predictions = genreRes.events?.[0]?.predictions || [];
      const rec = recRes.events?.[0]?.aiRecommendation;

      setAiGenrePredictions(
        predictions.map((entry) => ({
          genre: entry.genre,
          confidence: entry.confidence,
        }))
      );
      setAiReasons(Array.isArray(rec?.reasons) ? rec.reasons.slice(0, 4) : []);
      setAiScore(typeof rec?.score === "number" ? rec.score : null);
      setAiComponents(
        rec?.components && typeof rec.components === "object"
          ? {
              genreMatch: rec.components.genreMatch,
              distance: rec.components.distance,
              popularity: rec.components.popularity,
              similarity: rec.components.similarity,
            }
          : null
      );
    })()
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setAiInsightsError(err instanceof Error ? err.message : String(err));
        setAiReasons([]);
        setAiScore(null);
        setAiComponents(null);
        setAiGenrePredictions([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setAiInsightsLoading(false);
      });

    return () => controller.abort();
  }, [event, eventId, user]);

  useEffect(() => {
    if (!event) {
      Promise.resolve().then(() => setHeroImageUrl(""));
      return;
    }

    const fallback = getGenreFallbackImage(event.tags[0]);
    const primary = (event.imageUrl || "").trim();

    if (!primary || primary === fallback) {
      Promise.resolve().then(() => setHeroImageUrl(fallback));
      return;
    }

    let active = true;
    const img = new Image();

    img.onload = () => {
      if (active) setHeroImageUrl(primary);
    };
    img.onerror = () => {
      if (active) setHeroImageUrl(fallback);
    };

    img.src = primary;

    return () => {
      active = false;
    };
  }, [event]);

  useEffect(() => {
    if (!event) return;
    if ((event.source || "").toLowerCase() !== "ticketmaster") return;
    const sourceId = (event.sourceId || "").trim();
    if (!sourceId) return;
    if (tmEnrichAttemptedSourceId === sourceId) return;

    const startLabelForCheck = formatStartIso(event.startIso) || event.dateLabel;
    const hasMeaningfulDescription = Boolean(
      sanitizeDetailDescription(event.description || "", {
        artistName: event.artistName,
        startLabel: startLabelForCheck,
      })
    );
    const hasPriceData =
      event.isFree === true ||
      typeof event.priceMin === "number" ||
      typeof event.priceMax === "number" ||
      typeof event.cost === "number";

    if (hasMeaningfulDescription && hasPriceData) return;

    setTmEnrichAttemptedSourceId(sourceId);
    const controller = new AbortController();
    const url = new URL("events/enrich", apiBaseForUrlConstructor());
    url.searchParams.set("source", "ticketmaster");
    url.searchParams.set("sourceId", sourceId);

    fetch(url.toString(), { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Enrichment request failed (${res.status})`);
        const payload = (await res.json()) as EnrichResponse;
        if (!payload.ok) throw new Error(payload.error || "Enrichment failed");
        const enriched = payload.event || {};

        setEvent((prev) => {
          if (!prev || prev.id !== event.id) return prev;

          const priceMin =
            typeof enriched.priceMin === "number"
              ? enriched.priceMin
              : typeof enriched.metadata?.priceMin === "number"
              ? enriched.metadata.priceMin
              : prev.priceMin ?? null;
          const priceMax =
            typeof enriched.priceMax === "number"
              ? enriched.priceMax
              : typeof enriched.metadata?.priceMax === "number"
              ? enriched.metadata.priceMax
              : prev.priceMax ?? null;
          const cost =
            typeof enriched.cost === "number" ? enriched.cost : prev.cost ?? null;
          const enrichedPriceMin =
            typeof enriched.priceMin === "number"
              ? enriched.priceMin
              : typeof enriched.metadata?.priceMin === "number"
              ? enriched.metadata.priceMin
              : null;
          const enrichedPriceMax =
            typeof enriched.priceMax === "number"
              ? enriched.priceMax
              : typeof enriched.metadata?.priceMax === "number"
              ? enriched.metadata.priceMax
              : null;
          const enrichedHasPaidPrice =
            (typeof enriched.cost === "number" && enriched.cost > 0) ||
            (typeof enrichedPriceMin === "number" && enrichedPriceMin > 0) ||
            (typeof enrichedPriceMax === "number" && enrichedPriceMax > 0);
          const nextIsFree = enrichedHasPaidPrice
            ? false
            : enriched.isFree === true
            ? true
            : enriched.isFree === false
            ? false
            : prev.isFree;

          return {
            ...prev,
            description:
              typeof enriched.description === "string" &&
              enriched.description.trim().length > 0
                ? enriched.description.trim()
                : prev.description,
            sourceUrl:
              (typeof enriched.ticketUrl === "string" && enriched.ticketUrl.trim()) ||
              (typeof enriched.url === "string" && enriched.url.trim()) ||
              prev.sourceUrl,
            artistName:
              (typeof enriched.artistName === "string" && enriched.artistName.trim()) ||
              prev.artistName,
            startIso:
              (typeof enriched.start === "string" && enriched.start.trim()) ||
              prev.startIso,
            cost,
            currency:
              (typeof enriched.currency === "string" && enriched.currency.trim()) ||
              prev.currency,
            isFree: nextIsFree,
            priceMin,
            priceMax,
          };
        });
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
      });

    return () => controller.abort();
  }, [event, tmEnrichAttemptedSourceId]);

  const mapPos = useMemo(() => {
    if (!event) return [50.8466, 4.3528] as [number, number];
    const lat = safeNum(event.latitude, 50.8466);
    const lng = safeNum(event.longitude, 4.3528);
    return [lat, lng] as [number, number];
  }, [event]);

  // ✅ distance computed from origin
  const distanceFromOrigin = useMemo(() => {
    if (!event) return 0;
    const lat = safeNum(event.latitude, 50.8466);
    const lng = safeNum(event.longitude, 4.3528);
    const d = haversineKm(origin.lat, origin.lng, lat, lng);
    return Math.round(d * 10) / 10;
  }, [event, origin.lat, origin.lng]);

  if (isLoading) {
    return (
      <div className="eventDetailPage">
        <div className="eventDetailTopRow">
          <Link to={backTo} className="btn btnSecondary">
            ← Back
          </Link>
        </div>

        <div className="eventDetailMissing">
          <div className="skeleton skeletonLine skeletonLineLg" style={{ height: 18 }} />
          <div className="skeleton skeletonLine skeletonLineMd" style={{ marginTop: 10 }} />
          <div className="skeleton skeletonLine skeletonLineLg" style={{ marginTop: 14 }} />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="eventDetailPage">
        <div className="eventDetailTopRow">
          <Link to={backTo} className="btn btnSecondary">
            ← Back
          </Link>
        </div>

        <div className="eventDetailMissing">
          <div className="eventDetailMissingTitle">Error</div>
          <div className="eventDetailMissingHint">{error}</div>
        </div>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="eventDetailPage">
        <div className="eventDetailTopRow">
          <Link to={backTo} className="btn btnSecondary">
            ← Back
          </Link>
        </div>

        <div className="eventDetailMissing">
          <div className="eventDetailMissingTitle">Event not found</div>
          <div className="eventDetailMissingHint">This event doesn’t exist (yet) or was removed.</div>
        </div>
      </div>
    );
  }

  const fullAddress = `${event.addressLine}, ${event.postalCode} ${event.city}, ${event.country}`;
  const googleMapsUrl = `https://www.google.com/maps?q=${event.latitude},${event.longitude}`;
  const startLabel = formatStartIso(event.startIso) || event.dateLabel;
  const priceRangeLabel = formatPriceRangeLabel(event);
  const cleanDescription = sanitizeDetailDescription(event.description, {
    artistName: event.artistName,
    startLabel,
  });
  const matchLevel = getMatchLevel(aiScore);
  const componentSummary = [
    aiComponents?.genreMatch != null
      ? `Genre ${toPercentLabel(aiComponents.genreMatch)}`
      : null,
    aiComponents?.distance != null
      ? `Distance ${toPercentLabel(aiComponents.distance)}`
      : null,
    aiComponents?.similarity != null
      ? `Similarity ${toPercentLabel(aiComponents.similarity)}`
      : null,
    aiComponents?.popularity != null
      ? `Popularity ${toPercentLabel(aiComponents.popularity)}`
      : null,
  ]
    .filter(Boolean)
    .join(" • ");

  const inviteDisabled =
    !user ||
    !token ||
    inviteSending ||
    friendsAllLoading ||
    friendsAll.length === 0 ||
    !inviteeId;
  const planOptionLines = planOptions
    .map((line) => line.trim())
    .filter(Boolean);

  const calendarStart = parseEventStartDate(event);
  const calendarEnd = calendarStart
    ? new Date(calendarStart.getTime() + 2 * 60 * 60 * 1000)
    : null;
  const detailUrl = `${window.location.origin}/events/${event.id}${location.search || ""}`;
  const calendarLocationLine = `${event.venue}, ${event.city}, ${event.country}`;
  const calendarDescription = [
    event.description?.trim() || null,
    `Event page: ${detailUrl}`,
    event.sourceUrl ? `Tickets: ${event.sourceUrl}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
  const googleCalendarUrl =
    calendarStart && calendarEnd
      ? buildGoogleCalendarUrl({
          title: event.title,
          start: calendarStart,
          end: calendarEnd,
          details: calendarDescription,
          location: calendarLocationLine,
        })
      : null;
  const outlookCalendarUrl =
    calendarStart && calendarEnd
      ? buildOutlookCalendarUrl({
          title: event.title,
          start: calendarStart,
          end: calendarEnd,
          details: calendarDescription,
          location: calendarLocationLine,
        })
      : null;

  const downloadIcsFile = () => {
    if (!calendarStart || !calendarEnd) return;
    const ics = buildIcsContent({
      title: event.title,
      start: calendarStart,
      end: calendarEnd,
      details: calendarDescription,
      location: calendarLocationLine,
      url: detailUrl,
      uidSeed: event.id,
    });
    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${toSafeFileName(event.title)}.ics`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const shareEvent = async () => {
    const shareUrl = detailUrl;
    const shareText = `${event.title} • ${startLabel} • ${event.city}`;

    try {
      if (navigator.share) {
        await navigator.share({
          title: event.title,
          text: shareText,
          url: shareUrl,
        });
        return;
      }

      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        notify("Event link copied to clipboard.", "success");
        return;
      }

      window.prompt("Copy this event link:", shareUrl);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      notify("Could not share this event right now.", "error");
    }
  };

  const togglePlanInvitee = (friendId: string) => {
    setSelectedPlanInviteeIds((prev) =>
      prev.includes(friendId) ? prev.filter((id) => id !== friendId) : [...prev, friendId]
    );
  };

  const addPlanOption = () => {
    const clean = planOptionDraft.trim();
    if (!clean) return;
    setPlanOptions((prev) => {
      if (prev.some((option) => option.toLowerCase() === clean.toLowerCase())) return prev;
      return [...prev, clean];
    });
    setPlanOptionDraft("");
  };

  const removePlanOption = (index: number) => {
    setPlanOptions((prev) => prev.filter((_, idx) => idx !== index));
  };

  const createGroupPlan = async () => {
    if (!eventId || !token || !user) {
      navigate("/login", { state: { from: location.pathname + location.search } });
      return;
    }
    if (planCreating) return;
    if (!planTitle.trim()) {
      setPlanActionMsg("Plan title is required.");
      return;
    }
    if (planOptionLines.length < 2) {
      setPlanActionMsg("Add at least 2 options.");
      return;
    }

    try {
      setPlanCreating(true);
      setPlanActionMsg(null);
      await apiFetch<{ ok: boolean; plan: GroupPlanItem }>(
        `/events/${encodeURIComponent(eventId)}/plans`,
        {
          method: "POST",
          token,
          body: {
            title: planTitle.trim(),
            note: planNote.trim(),
            options: planOptionLines,
            inviteeIds: selectedPlanInviteeIds.map((id) => Number(id)),
          },
        }
      );
      setPlanTitle("");
      setPlanNote("");
      setPlanOptionDraft("");
      setPlanOptions(["Friday 19:30", "Saturday 20:00"]);
      setSelectedPlanInviteeIds([]);
      setPlanActionMsg("Plan created.");
      await refreshPlans();
    } catch (err: unknown) {
      setPlanActionMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setPlanCreating(false);
    }
  };

  const voteOnPlan = async (planId: string, optionIndex: number) => {
    if (!token) return;
    try {
      setPlanActionMsg(null);
      await apiFetch<{ ok: boolean; plan: GroupPlanItem }>(`/plans/${encodeURIComponent(planId)}/vote`, {
        method: "POST",
        token,
        body: { optionIndex },
      });
      await refreshPlans();
    } catch (err: unknown) {
      setPlanActionMsg(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="eventDetailPage">
      <div className="eventDetailTopRow">
        <Link to={backTo} className="btn btnSecondary">
          ← Back
        </Link>

        <div className="eventDetailTopRight">
          <span className="eventDetailMiniMeta">
            {event.venue} • {distanceFromOrigin.toFixed(1)} km from {origin.label} • {views} views
          </span>
        </div>
      </div>

      <section className="eventDetailHero">
        <div
          className="eventDetailHeroImage"
          style={{ backgroundImage: `url(${heroImageUrl || event.imageUrl})` }}
        />
        <div className="eventDetailHeroShade" />

        <div className="eventDetailHeroContent">
          <div className="eventDetailTitle">{event.title}</div>

          <div className="eventDetailMeta">
            <span>{startLabel}</span>
            <span className="dotSep">•</span>
            <span>{event.city}</span>
            <span className="dotSep">•</span>
            <span>{distanceFromOrigin.toFixed(1)} km</span>
          </div>

          <div className="eventDetailTags">
            {event.tags.map((t) => (
              <span key={t} className="tagPill">
                {t}
              </span>
            ))}
          </div>

          <div className="eventDetailActions">
            <button
              className={`btn ${isGoing ? "btnPrimary" : "btnSecondary"}`}
              onClick={async () => {
                if (!eventId) return;
                if (!user || !token) {
                  navigate("/login", { state: { from: location.pathname + location.search } });
                  return;
                }
                if (goingSaving) return;

                const nextGoing = !isGoing;

                try {
                  setGoingSaving(true);

                  await apiFetch<{ ok: boolean; going: boolean }>(
                    `/events/${encodeURIComponent(eventId)}/going`,
                    {
                      method: "PUT",
                      token,
                      body: {
                        going: nextGoing,
                        event: {
                          title: event.title,
                          city: event.city,
                          startIso: event.startIso || null,
                        },
                      },
                    }
                  );

                  await refreshSocial();
                } catch (err: unknown) {
                  setSocialError(err instanceof Error ? err.message : String(err));
                } finally {
                  setGoingSaving(false);
                }
              }}
              type="button"
            >
              {goingSaving ? "Saving…" : isGoing ? "Going ✓" : "I'm going"}
            </button>

            <button
              className={`btn ${isFav ? "btnPrimary" : "btnSecondary"}`}
              onClick={() => {
                if (!eventId) return;
                if (!user) {
                  navigate("/login", { state: { from: location.pathname + location.search } });
                  return;
                }
                const next = toggleUserFavorite(user.id, eventId);
                setIsFav(next);
              }}
              type="button"
            >
              {isFav ? "Saved ★" : "Save"}
            </button>

            {googleCalendarUrl ? (
              <div className="eventCalendarMenu" ref={calendarMenuRef}>
                <button
                  className="btn btnSecondary eventCalendarMenuTrigger"
                  type="button"
                  aria-expanded={calendarMenuOpen}
                  aria-haspopup="menu"
                  onClick={() => setCalendarMenuOpen((open) => !open)}
                >
                  Add to calendar
                </button>
                {calendarMenuOpen ? (
                  <div className="eventCalendarMenuList" role="menu">
                    <a
                      className="eventCalendarMenuItem"
                      href={googleCalendarUrl}
                      target="_blank"
                      rel="noreferrer"
                      role="menuitem"
                      onClick={() => setCalendarMenuOpen(false)}
                    >
                      Google Calendar
                    </a>
                    {outlookCalendarUrl ? (
                      <a
                        className="eventCalendarMenuItem"
                        href={outlookCalendarUrl}
                        target="_blank"
                        rel="noreferrer"
                        role="menuitem"
                        onClick={() => setCalendarMenuOpen(false)}
                      >
                        Outlook Calendar
                      </a>
                    ) : null}
                    <button
                      className="eventCalendarMenuItem"
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setCalendarMenuOpen(false);
                        downloadIcsFile();
                      }}
                    >
                      Apple Calendar
                    </button>
                    <button
                      className="eventCalendarMenuItem"
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setCalendarMenuOpen(false);
                        downloadIcsFile();
                      }}
                    >
                      Download .ics
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}

            <button className="btn btnSecondary" type="button" onClick={shareEvent}>
              Share
            </button>

            {event.sourceUrl ? (
              <a className="btn btnPrimary" href={event.sourceUrl} target="_blank" rel="noreferrer">
                Tickets
              </a>
            ) : null}

            {isAdmin && token ? (
              <button
                className="btn btnSecondary"
                type="button"
                title="Admin: disable this event (it will disappear from the feed)"
                onClick={async () => {
                  if (!eventId) return;
                  const ok = confirm(
                    "Disable this event? It will be hidden for everyone (because it can be re-fetched from the external API)."
                  );
                  if (!ok) return;

                  const reason = window.prompt("Reason (optional)", "") || "";

                  try {
                    await apiFetch<{ ok: boolean }>(
                      `/admin/events/${encodeURIComponent(eventId)}/disabled`,
                      {
                        method: "PATCH",
                        token,
                        body: {
                          disabled: true,
                          reason: reason.trim() || null,
                          snapshot: {
                            title: event.title,
                            city: event.city,
                            startIso: event.startIso || null,
                            source: event.source || null,
                            sourceId: event.sourceId || null,
                            url: event.sourceUrl || null,
                          },
                        },
                      }
                    );

                    notify("Event disabled.", "success");
                    navigate(backTo);
                  } catch (err: unknown) {
                    notify(err instanceof Error ? err.message : String(err), "error");
                  }
                }}
              >
                Disable (admin)
              </button>
            ) : null}

            <a className="btn btnSecondary" href={googleMapsUrl} target="_blank" rel="noreferrer">
              Open in Maps
            </a>
          </div>
        </div>
      </section>

      <section className="eventDetailGrid">
        <div className="eventDetailCard eventDetailCardAbout">
          <div className="eventDetailCardTitle">About</div>

          {event.artistName ? (
            <div className="eventDetailText">
              <b>Artist:</b> {event.artistName}
            </div>
          ) : null}

          <div className="eventDetailText">
            <b>Starts:</b> {startLabel}
          </div>
          <div className="eventDetailText">
            <b>Price:</b> {priceRangeLabel}
          </div>
          {cleanDescription ? (
            <div className="eventDetailText">{cleanDescription}</div>
          ) : null}
        </div>

        <div className="eventDetailCard">
          <div className="eventDetailCardTitle">AI Insights</div>
          {aiInsightsLoading ? (
            <div className="sectionHint">Building explainability…</div>
          ) : null}
          {aiInsightsError ? (
            <div className="sectionHint">AI unavailable: {aiInsightsError}</div>
          ) : null}
          {!aiInsightsLoading && !aiInsightsError ? (
            <>
              {typeof aiScore === "number" ? (
                <div className="eventDetailText">
                  <b>Match score:</b> {Math.round(aiScore * 100)}%
                  {matchLevel ? ` (${matchLevel} match)` : ""}
                </div>
              ) : null}
              {componentSummary ? (
                <div className="eventDetailText">
                  <b>Signal breakdown:</b> {componentSummary}
                </div>
              ) : null}
              {aiReasons.length > 0 ? (
                <div className="eventDetailText">
                  <b>Why this score?</b>
                  <ul className="eventAiReasonList">
                    {aiReasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="eventDetailText">
                  AI recommendation reasons are not available for this event yet.
                </div>
              )}
              {aiGenrePredictions.length > 0 ? (
                <div className="eventDetailText">
                  <b>Predicted genres:</b>{" "}
                  {aiGenrePredictions
                    .slice(0, 3)
                    .map(
                      (item) =>
                        `${item.genre} (${Math.round(item.confidence * 100)}%)`
                    )
                    .join(" • ")}
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        {/* ✅ Social / Friends + Invite dropdown */}
        <div className="eventDetailCard eventDetailCardSocial">
          <div className="eventDetailCardHeader">
            <div className="eventDetailCardTitle" style={{ marginBottom: 0 }}>
              Social & plans
            </div>
            <button
              type="button"
              className="btn btnSecondary eventDetailCardToggle"
              aria-expanded={socialPanelOpen}
              aria-controls="event-social-content"
              onClick={() => setSocialPanelOpen((v) => !v)}
            >
              {socialPanelOpen ? "Hide" : "Show"}
            </button>
          </div>
          <div className="sectionHint">Friends going, invites and group plans.</div>

          {socialPanelOpen ? (
            <div id="event-social-content" className="eventDetailCardBody">
          {!user ? (
            <div className="sectionHint">Login to see friends going and invite them.</div>
          ) : socialLoading ? (
            <div className="sectionHint">Loading friends…</div>
          ) : socialError ? (
            <div className="sectionHint">Social unavailable: {socialError}</div>
          ) : friendsGoing.length === 0 ? (
            <div className="sectionHint">No friends going yet.</div>
          ) : (
            <>
              <div className="eventDetailText">
                <b>Friends going:</b>
              </div>

              <div className="friendsGoingList">
                {friendsGoing.map((f) => (
                  <div key={f.id} className="friendsGoingRow">
                    <span className="friendsGoingName">{f.name}</span>
                    {f.username ? <span className="friendsGoingUsername">@{f.username}</span> : null}
                  </div>
                ))}
              </div>
            </>
          )}

          <div style={{ height: 12 }} />

          <div className="eventDetailText">
            <b>Invite a friend</b>
          </div>

          {!user ? (
            <div className="sectionHint">Login to invite friends.</div>
          ) : friendsAllLoading ? (
            <div className="sectionHint">Loading your friends…</div>
          ) : friendsAllError ? (
            <div className="sectionHint">Friends unavailable: {friendsAllError}</div>
          ) : friendsAll.length === 0 ? (
            <div className="sectionHint">You have no friends yet. Add someone on your Account page.</div>
          ) : (
            <>
              <div className="eventDetailInviteRow">
                <select
                  className="input"
                  value={inviteeId}
                  onChange={(e) => {
                    setInviteeId(e.target.value);
                    setInviteMsg(null);
                    setInviteErr(null);
                  }}
                >
                  <option value="">Select a friend…</option>
                  {friendsAll.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}{f.username ? ` (@${f.username})` : ""}
                    </option>
                  ))}
                </select>

                <button
                  className="btn btnPrimary"
                  type="button"
                  disabled={inviteDisabled}
                  onClick={async () => {
                    if (!eventId || !token || !inviteeId) return;

                    try {
                      setInviteSending(true);
                      setInviteMsg(null);
                      setInviteErr(null);

                      await apiFetch<{ ok: boolean; inviteId: string }>(
                        `/events/${encodeURIComponent(eventId)}/invite`,
                        {
                          method: "POST",
                          token,
                          body: {
                            inviteeId,
                            event: {
                              title: event.title,
                              city: event.city,
                              startIso: event.startIso || null,
                            },
                          },
                        }
                      );

                      const friend = friendsAll.find((x) => x.id === inviteeId);
                      setInviteMsg(`Invite sent${friend ? ` to ${friend.name}` : ""}!`);
                      setInviteeId("");
                    } catch (err: unknown) {
                      setInviteErr(err instanceof Error ? err.message : String(err));
                    } finally {
                      setInviteSending(false);
                    }
                  }}
                >
                  {inviteSending ? "Sending…" : "Invite"}
                </button>
              </div>

              {inviteMsg ? <div className="sectionHint">{inviteMsg}</div> : null}
              {inviteErr ? <div className="sectionHint">Invite error: {inviteErr}</div> : null}
            </>
          )}
          <GroupPlansPanel
            isLoggedIn={Boolean(user)}
            friendsAll={friendsAll}
            plans={plans}
            plansLoading={plansLoading}
            plansError={plansError}
            planActionMsg={planActionMsg}
            planTitle={planTitle}
            planNote={planNote}
            planOptionDraft={planOptionDraft}
            planOptions={planOptions}
            selectedPlanInviteeIds={selectedPlanInviteeIds}
            planCreating={planCreating}
            onPlanTitleChange={setPlanTitle}
            onPlanNoteChange={setPlanNote}
            onPlanOptionDraftChange={setPlanOptionDraft}
            onAddPlanOption={addPlanOption}
            onRemovePlanOption={removePlanOption}
            onToggleInvitee={togglePlanInvitee}
            onCreate={createGroupPlan}
            onVote={voteOnPlan}
          />
            </div>
          ) : null}
        </div>

        <div className="eventDetailCard eventDetailCardLocation">
          <div className="eventDetailCardTitle">Location</div>
          <div className="eventDetailText">{fullAddress}</div>

          <div className="leafletMapWrap">
            <MapContainer center={mapPos} zoom={14} scrollWheelZoom={false} className="leafletMap">
              <TileLayer
                attribution="&copy; OpenStreetMap contributors"
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <Marker position={mapPos}>
                <Popup>
                  <b>{event.title}</b>
                  <br />
                  {event.venue} — {event.city}
                </Popup>
              </Marker>
            </MapContainer>
          </div>
        </div>

        {event.artistName && !hideSetlistsSection ? (
          <div className="eventDetailCard eventDetailCardSetlists">
            <div className="eventDetailCardTitle">Recent Setlists</div>
            <div className="eventDetailText">
              Last known shows for <b>{event.artistName}</b>.
            </div>

            {setlistsLoading ? <div className="sectionHint">Loading setlists…</div> : null}
            {setlistsError ? (
              <div className="sectionHint">Setlists unavailable: {setlistsError}</div>
            ) : null}

            {!setlistsLoading && !setlistsError && setlists.length === 0 ? (
              <div className="sectionHint">No recent setlists found.</div>
            ) : (
              setlists.map((s) => (
                <div key={s.id || `${s.eventDate}-${s.venue}`} className="eventDetailText">
                  <b>{s.eventDate || "Date unknown"}</b> • {s.venue || "Unknown venue"} •{" "}
                  {s.city || "Unknown city"}
                  {s.country ? `, ${s.country}` : ""}
                  {s.url ? (
                    <>
                      {" "}
                      •{" "}
                      <a href={s.url} target="_blank" rel="noreferrer">
                        Setlist
                      </a>
                    </>
                  ) : null}
                </div>
              ))
            )}
          </div>
        ) : null}
      </section>
    </div>
  );
}
