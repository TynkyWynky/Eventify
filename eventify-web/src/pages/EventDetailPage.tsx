import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import type { EventItem } from "../events/eventsStore";
import { eventsRepo } from "../data/events";
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

export default function EventDetailPage() {
  const { eventId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [event, setEvent] = useState<EventItem | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [views, setViews] = useState(0);
  const [goings, setGoings] = useState(0);
  const [isGoing, setIsGoing] = useState(false);

  const [isFav, setIsFav] = useState(false);

  useEffect(() => {
    if (!eventId) return;

    const controller = new AbortController();

    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setIsLoading(true);
      setError(null);
    });

    eventsRepo
      .getById(eventId, { signal: controller.signal })
      .then(setEvent)
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
    if (!eventId) return;

    incrementView(eventId);

    const refresh = () => {
      setViews(getViews(eventId));
      setGoings(countGoings(eventId));
      setIsGoing(user ? isUserGoing(user.id, eventId) : false);
    };

    refresh();
    const unsub = subscribeMetricsChanged(() => refresh());
    return unsub;
  }, [eventId, user]);

  useEffect(() => {
    if (!eventId) return;

    const refreshFav = () => {
      setIsFav(user ? isUserFavorite(user.id, eventId) : false);
    };

    refreshFav();
    const unsub = subscribeFavoritesChanged(() => refreshFav());
    return unsub;
  }, [eventId, user]);

  const mapPos = useMemo(() => {
    if (!event) return [50.8466, 4.3528] as [number, number];
    const lat = safeNum(event.latitude, 50.8466);
    const lng = safeNum(event.longitude, 4.3528);
    return [lat, lng] as [number, number];
  }, [event]);

  if (isLoading) {
    return (
      <div className="eventDetailPage">
        <div className="eventDetailTopRow">
          <Link to="/" className="btn btnSecondary">
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
          <Link to="/" className="btn btnSecondary">
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
          <Link to="/" className="btn btnSecondary">
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

  return (
    <div className="eventDetailPage">
      <div className="eventDetailTopRow">
        <Link to="/" className="btn btnSecondary">
          ← Back
        </Link>

        <div className="eventDetailTopRight">
          <span className="eventDetailMiniMeta">
            {event.venue} • {event.distanceKm.toFixed(1)} km • {views} views •{" "}
            {goings} going
          </span>
        </div>
      </div>

      <section className="eventDetailHero">
        <div
          className="eventDetailHeroImage"
          style={{ backgroundImage: `url(${event.imageUrl})` }}
        />
        <div className="eventDetailHeroShade" />

        <div className="eventDetailHeroContent">
          <div className="eventDetailTitle">{event.title}</div>
          <div className="eventDetailMeta">
            <span>{event.dateLabel}</span>
            <span className="dotSep">•</span>
            <span>{event.city}</span>
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
                  navigate("/login", { state: { from: location.pathname } });
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
                  navigate("/login", { state: { from: location.pathname } });
                  return;
                }
                const next = toggleUserFavorite(user.id, eventId);
                setIsFav(next);
              }}
              type="button"
            >
              {isFav ? "Saved ★" : "Save"}
            </button>

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
        <div className="eventDetailCard">
          <div className="eventDetailCardTitle">About</div>
          <div className="eventDetailText">{event.description}</div>
        </div>

        <div className="eventDetailCard">
          <div className="eventDetailCardTitle">Location</div>
          <div className="eventDetailText">{fullAddress}</div>

          <div className="eventDetailMapWrap">
            <MapContainer
              center={mapPos}
              zoom={14}
              scrollWheelZoom={false}
              className="eventDetailMap"
            >
              <TileLayer
                attribution='&copy; OpenStreetMap contributors'
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
      </section>
    </div>
  );
}
