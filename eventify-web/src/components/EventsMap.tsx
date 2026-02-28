import { useEffect, useMemo, useState } from "react";
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

function MapActions({
  bounds,
  focus,
  fitRequest,
}: {
  bounds: L.LatLngBounds | null;
  focus: { lat: number; lng: number } | null;
  fitRequest: number;
}) {
  const map = useMap();

  useEffect(() => {
    if (!focus) return;
    map.flyTo([focus.lat, focus.lng], Math.max(map.getZoom(), 12), { duration: 0.4 });
  }, [focus, map]);

  useEffect(() => {
    if (!bounds) return;
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
  }, [bounds, fitRequest, map]);

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

  const cityFocusOptions = useMemo(() => {
    const grouped = new Map<string, { sumLat: number; sumLng: number; count: number }>();

    for (const item of mappable) {
      const prev = grouped.get(item.city) ?? { sumLat: 0, sumLng: 0, count: 0 };
      prev.sumLat += item.lat;
      prev.sumLng += item.lng;
      prev.count += 1;
      grouped.set(item.city, prev);
    }

    return [...grouped.entries()]
      .map(([city, value]) => ({
        city,
        count: value.count,
        lat: value.sumLat / value.count,
        lng: value.sumLng / value.count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }, [mappable]);

  const [focus, setFocus] = useState<{ lat: number; lng: number } | null>(null);
  const [fitRequest, setFitRequest] = useState(0);

  const fallbackCenter: [number, number] = useMemo(() => {
    if (isFiniteNumber(origin.lat) && isFiniteNumber(origin.lng)) {
      return [origin.lat, origin.lng];
    }
    // Brussels fallback
    return [50.8466, 4.3528];
  }, [origin.lat, origin.lng]);

  return (
    <div className="leafletMapWrap">
      <div className="mapActionBar">
        <button
          type="button"
          className="mapActionBtn mapActionBtnPrimary"
          onClick={() => {
            setFocus(null);
            setFitRequest((x) => x + 1);
          }}
        >
          Fit all
        </button>
        {cityFocusOptions.map((item) => (
          <button
            key={item.city}
            type="button"
            className="mapActionBtn"
            onClick={() => setFocus({ lat: item.lat, lng: item.lng })}
            title={`Zoom to ${item.city}`}
          >
            {item.city} ({item.count})
          </button>
        ))}
      </div>
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
        <MapActions bounds={bounds} focus={focus} fitRequest={fitRequest} />

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
