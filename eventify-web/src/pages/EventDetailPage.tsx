import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import type { EventItem } from "../events/eventsStore";
import { eventsRepo } from "../data/events";
import { getGenreFallbackImage } from "../data/events/genreImages";
import { useAuth } from "../auth/AuthContext";
import {
  countGoings,
  getViews,
  incrementView,
  isUserGoing,
  subscribeMetricsChanged,
  toggleGoing,
} from "../data/events/eventMetricsStore";
import {
  isFavorite as isUserFavorite,
  subscribeFavoritesChanged,
  toggleFavorite as toggleUserFavorite,
} from "../data/events/eventFavoritesStore";

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

function getApiBaseUrl() {
  const raw = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
  return raw || "http://localhost:3000";
}

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

export default function EventDetailPage() {
  const { eventId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Terug naar dashboard met dezelfde filters (querystring)
  const backTo = "/" + (location.search || "");

  const [event, setEvent] = useState<EventItem | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [views, setViews] = useState(0);
  const [goings, setGoings] = useState(0);
  const [isGoing, setIsGoing] = useState(false);

  const [isFav, setIsFav] = useState(false);
  const [setlists, setSetlists] = useState<SetlistItem[]>([]);
  const [setlistsLoading, setSetlistsLoading] = useState(false);
  const [setlistsError, setSetlistsError] = useState<string | null>(null);
  const [heroImageUrl, setHeroImageUrl] = useState<string>("");

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

  // Views + Going metrics
  useEffect(() => {
    if (!eventId) return;

    incrementView(eventId);

    const refresh = () => {
      setViews(getViews(eventId));
      setGoings(countGoings(eventId));
      setIsGoing(user ? isUserGoing(user.id, eventId) : false);
    };

    refresh();
    return subscribeMetricsChanged(refresh);
  }, [eventId, user]);

  // Favorites
  useEffect(() => {
    if (!eventId) return;

    const refreshFav = () => {
      setIsFav(user ? isUserFavorite(user.id, eventId) : false);
    };

    refreshFav();
    return subscribeFavoritesChanged(refreshFav);
  }, [eventId, user]);

  // Setlists
  useEffect(() => {
    const artist = event?.artistName?.trim();

    if (!artist) {
      Promise.resolve().then(() => {
        setSetlists([]);
        setSetlistsError(null);
        setSetlistsLoading(false);
      });
      return;
    }

    const controller = new AbortController();
    const base = getApiBaseUrl();
    const url = new URL("setlists", base.endsWith("/") ? base : `${base}/`);
    url.searchParams.set("artistName", artist);

    Promise.resolve().then(() => {
      if (controller.signal.aborted) return;
      setSetlistsLoading(true);
      setSetlistsError(null);
    });

    fetch(url.toString(), { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Setlists request failed (${res.status})`);
        const data = (await res.json()) as SetlistsResponse;
        if (!data.ok) throw new Error(data.error || "Could not fetch setlists");
        setSetlists((data.items || []).slice(0, 5));
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setSetlists([]);
        setSetlistsError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setSetlistsLoading(false);
      });

    return () => controller.abort();
  }, [event?.artistName]);

  // Hero image (preload + fallback)
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

  const mapPos = useMemo(() => {
    if (!event) return [50.8466, 4.3528] as [number, number];
    const lat = safeNum(event.latitude, 50.8466);
    const lng = safeNum(event.longitude, 4.3528);
    return [lat, lng] as [number, number];
  }, [event]);

  // ✅ distance computed from origin (NOT from stored event.distanceKm)
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
          <div className="eventDetailMissingTitle">Loading…</div>
          <div className="eventDetailMissingHint">Fetching event details.</div>
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
          <div className="eventDetailMissingHint">
            This event doesn’t exist (yet) or was removed.
          </div>
        </div>
      </div>
    );
  }

  const fullAddress = `${event.addressLine}, ${event.postalCode} ${event.city}, ${event.country}`;
  const googleMapsUrl = `https://www.google.com/maps?q=${event.latitude},${event.longitude}`;
  const startLabel = formatStartIso(event.startIso) || event.dateLabel;

  return (
    <div className="eventDetailPage">
      <div className="eventDetailTopRow">
        <Link to={backTo} className="btn btnSecondary">
          ← Back
        </Link>

        <div className="eventDetailTopRight">
          <span className="eventDetailMiniMeta">
            {event.venue} • {distanceFromOrigin.toFixed(1)} km from {origin.label} •{" "}
            {views} views • {goings} going
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
            {event.source ? (
              <>
                <span className="dotSep">•</span>
                <span>{event.source}</span>
              </>
            ) : null}
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
              onClick={() => {
                if (!eventId) return;
                if (!user) {
                  navigate("/login", {
                    state: { from: location.pathname + location.search },
                  });
                  return;
                }
                const next = toggleGoing(user.id, eventId);
                setIsGoing(next);
              }}
              type="button"
            >
              {isGoing ? "Going ✓" : "I'm going"}
            </button>

            <button
              className={`btn ${isFav ? "btnPrimary" : "btnSecondary"}`}
              onClick={() => {
                if (!eventId) return;
                if (!user) {
                  navigate("/login", {
                    state: { from: location.pathname + location.search },
                  });
                  return;
                }
                const next = toggleUserFavorite(user.id, eventId);
                setIsFav(next);
              }}
              type="button"
            >
              {isFav ? "Saved ★" : "Save"}
            </button>

            {event.sourceUrl ? (
              <a
                className="btn btnPrimary"
                href={event.sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                Tickets
              </a>
            ) : null}

            <a
              className="btn btnSecondary"
              href={googleMapsUrl}
              target="_blank"
              rel="noreferrer"
            >
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

          {event.source ? (
            <div className="eventDetailText">
              <b>Source:</b> {event.source}
            </div>
          ) : null}

          <div className="eventDetailText">{event.description}</div>

          {event.sourceUrl ? (
            <div className="eventDetailText">
              <a href={event.sourceUrl} target="_blank" rel="noreferrer">
                Open official event page
              </a>
            </div>
          ) : null}
        </div>

        <div className="eventDetailCard eventDetailCardLocation">
          <div className="eventDetailCardTitle">Location</div>
          <div className="eventDetailText">{fullAddress}</div>

          <div className="leafletMapWrap">
            <MapContainer
              center={mapPos}
              zoom={14}
              scrollWheelZoom={false}
              className="leafletMap"
            >
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

        {event.artistName ? (
          <div className="eventDetailCard eventDetailCardSetlists">
            <div className="eventDetailCardTitle">Recent Setlists</div>
            <div className="eventDetailText">
              Last known shows for <b>{event.artistName}</b>.
            </div>

            {setlistsLoading ? (
              <div className="sectionHint">Loading setlists…</div>
            ) : null}

            {setlistsError ? (
              <div className="sectionHint">
                Setlists unavailable: {setlistsError}
              </div>
            ) : null}

            {!setlistsLoading && !setlistsError && setlists.length === 0 ? (
              <div className="sectionHint">No recent setlists found.</div>
            ) : (
              setlists.map((s) => (
                <div
                  key={s.id || `${s.eventDate}-${s.venue}`}
                  className="eventDetailText"
                >
                  <b>{s.eventDate || "Date unknown"}</b> •{" "}
                  {s.venue || "Unknown venue"} • {s.city || "Unknown city"}
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
