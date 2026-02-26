import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  MapContainer,
  Marker,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import type { EventItem } from "../events/eventsStore";
import { getGenreFallbackImage } from "../data/events/genreImages";

type Origin = {
  lat: number;
  lng: number;
  label?: string | null;
};

const eventDotIcon = L.divIcon({
  className: "eventDotIcon",
  html: '<span class="eventDot" aria-hidden="true"></span>',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

const originDotIcon = L.divIcon({
  className: "originDotIcon",
  html: '<span class="originDot" aria-hidden="true"></span>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

function FitBounds({ bounds }: { bounds: L.LatLngBounds | null }) {
  const map = useMap();

  useEffect(() => {
    if (!bounds) return;
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
  }, [bounds, map]);

  return null;
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

export default function EventsMap({
  events,
  origin,
  search,
  className,
}: {
  events: EventItem[];
  origin: Origin;
  search: string;
  className?: string;
}) {
  const navigate = useNavigate();

  const mappable = useMemo(() => {
    return events
      .filter((e) => isFiniteNumber(e.latitude) && isFiniteNumber(e.longitude))
      .map((e) => {
        const tag0 = e.tags?.[0] || "All";
        const fallback = getGenreFallbackImage(tag0);

        return {
          id: e.id,
          title: e.title,
          venue: e.venue,
          city: e.city,
          lat: e.latitude,
          lng: e.longitude,
          tag0,
          fallback,
          imageUrl: (e.imageUrl || "").trim(),
        };
      });
  }, [events]);

  const bounds = useMemo(() => {
    const points: [number, number][] = [];

    if (isFiniteNumber(origin.lat) && isFiniteNumber(origin.lng)) {
      points.push([origin.lat, origin.lng]);
    }
    for (const e of mappable) points.push([e.lat, e.lng]);

    if (points.length === 0) return null;
    return L.latLngBounds(points.map((p) => L.latLng(p[0], p[1])));
  }, [mappable, origin.lat, origin.lng]);

  const fallbackCenter: [number, number] = useMemo(() => {
    if (isFiniteNumber(origin.lat) && isFiniteNumber(origin.lng)) {
      return [origin.lat, origin.lng];
    }
    // Brussels fallback
    return [50.8466, 4.3528];
  }, [origin.lat, origin.lng]);

  return (
    <div className="leafletMapWrap">
      <MapContainer
        center={fallbackCenter}
        zoom={12}
        scrollWheelZoom={false}
        className={className || "leafletMap"}
      >
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <FitBounds bounds={bounds} />

        {isFiniteNumber(origin.lat) && isFiniteNumber(origin.lng) ? (
          <Marker position={[origin.lat, origin.lng]} icon={originDotIcon}>
            <Tooltip
              direction="top"
              offset={[0, -10]}
              opacity={1}
              className="eventMapTooltip"
            >
              {origin.label || "Origin"}
            </Tooltip>
          </Marker>
        ) : null}

        {mappable.map((e) => (
          <Marker
            key={e.id}
            position={[e.lat, e.lng]}
            icon={eventDotIcon}
            eventHandlers={{
              click: () => navigate(`/events/${e.id}${search}`),
            }}
          >
            <Tooltip
              direction="top"
              offset={[0, -10]}
              opacity={1}
              className="eventMapTooltip"
            >
              <div className="eventMapTipCard">
                <img
                  className="eventMapTipImg"
                  src={e.imageUrl || e.fallback}
                  alt={e.title}
                  loading="lazy"
                  decoding="async"
                  onError={(ev) => {
                    const img = ev.currentTarget;
                    if (img.src === e.fallback) return;
                    img.src = e.fallback;
                  }}
                />
                <div className="eventMapTipText">
                  <div className="eventMapTipTitle">{e.title}</div>
                  <div className="eventMapTipMeta">
                    {e.venue} — {e.city}
                  </div>
                </div>
              </div>
            </Tooltip>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}