import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import SelectField from "../components/SelectField";
import { MUSIC_STYLES, type EventItem } from "../events/eventsStore";
import { eventsRepo } from "../data/events";
import { getGenreFallbackImage } from "../data/events/genreImages";
import {
  listOrganizerEventsByOwner,
  subscribeOrganizerEventsChanged,
} from "../data/events/organizerEventsStore";
import { useAuth } from "../auth/AuthContext";
import {
  getUserGoingEventIds,
  subscribeMetricsChanged,
} from "../data/events/eventMetricsStore";
import {
  getUserFavoriteEventIds,
  subscribeFavoritesChanged,
} from "../data/events/eventFavoritesStore";

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function parseKm(raw: string | null, fallback: number) {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return clamp(n, 1, 100);
}

function EventCard({ event, search }: { event: EventItem; search: string }) {
  const metaParts = [
    event.artistName || null,
    event.venue,
    `${event.distanceKm.toFixed(1)} km`,
  ].filter(Boolean);

  return (
    <Link to={`/events/${event.id}${search}`} className="eventCardLink">
      <article className="eventCard">
        <div className="eventImageWrap">
          <img
            className="eventImage"
            src={event.imageUrl}
            alt={event.title}
            onError={(e) => {
              const next = getGenreFallbackImage(event.tags[0]);
              if (e.currentTarget.src === next) return;
              e.currentTarget.src = next;
            }}
          />
        </div>

        <div className="eventFooter">
          <div className="eventCardTextWrap">
            <div className="eventCardTitle" title={event.title}>
              {event.title}
            </div>
            <div className="eventCardMeta">{metaParts.join(" • ")}</div>
          </div>
          <div className="eventFooterRight">{event.dateLabel}</div>
        </div>
      </article>
    </Link>
  );
}

export default function EventDashboardPage() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const isOrganizer = user?.role === "organizer" || user?.role === "admin";

  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  const q = (searchParams.get("q") ?? "").trim();
  const styleRaw = (searchParams.get("style") ?? "All").trim();
  const selectedStyle = MUSIC_STYLES.includes(styleRaw) ? styleRaw : "All";
  const maxDistanceKm = parseKm(searchParams.get("km"), 20);

  const styleOptions = useMemo(() => [...MUSIC_STYLES], []);

  function updateParams(next: { style?: string; km?: number }) {
    const sp = new URLSearchParams(searchParams);

    if (next.style !== undefined) {
      const clean = next.style.trim();
      if (clean === "All") sp.delete("style");
      else sp.set("style", clean);
    }

    if (next.km !== undefined) {
      if (next.km === 20) sp.delete("km");
      else sp.set("km", String(next.km));
    }

    setSearchParams(sp, { replace: true });
  }

  const [events, setEvents] = useState<EventItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [reloadTick, setReloadTick] = useState(0);
  useEffect(() => {
    return subscribeOrganizerEventsChanged(() => setReloadTick((t) => t + 1));
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setIsLoading(true);
      setError(null);
    });

    eventsRepo
      .list(
        { style: selectedStyle, maxDistanceKm, query: q },
        { signal: controller.signal }
      )
      .then(setEvents)
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
  }, [maxDistanceKm, q, selectedStyle, reloadTick]);

  const trendingEvents = useMemo(
    () => events.filter((e) => Boolean(e.trending)),
    [events]
  );

  const [signalsTick, setSignalsTick] = useState(0);
  useEffect(() => {
    if (!userId) return;

    const bump = () => setSignalsTick((t) => t + 1);

    const unsubFav = subscribeFavoritesChanged(bump);
    const unsubGoing = subscribeMetricsChanged(bump);

    return () => {
      unsubFav();
      unsubGoing();
    };
  }, [userId]);

  const [prefTags, setPrefTags] = useState<string[]>([]);
  useEffect(() => {
    if (!userId) return;

    const controller = new AbortController();

    const refreshTags = async () => {
      try {
        const f = getUserFavoriteEventIds(userId);
        const g = getUserGoingEventIds(userId);

        const ids = Array.from(new Set([...f, ...g])).slice(0, 30);
        if (ids.length === 0) {
          setPrefTags([]);
          return;
        }

        const results = await Promise.all(
          ids.map((id) => eventsRepo.getById(id, { signal: controller.signal }))
        );

        const counts = new Map<string, number>();
        for (const e of results) {
          if (!e) continue;
          const weight = g.includes(e.id) ? 2 : 1;
          for (const t of e.tags) {
            if (!t || t === "All") continue;
            counts.set(t, (counts.get(t) ?? 0) + weight);
          }
        }

        const top = [...counts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([t]) => t);

        setPrefTags(top);
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    };

    refreshTags();
    return () => controller.abort();
  }, [userId, signalsTick]);

  const recommendedEvents = useMemo(() => {
    const _tick = signalsTick; 
    void _tick;

    const favIds = userId ? getUserFavoriteEventIds(userId) : [];
    const goingIds = userId ? getUserGoingEventIds(userId) : [];

    const exclude = new Set([...favIds, ...goingIds]);
    const base = events.filter((e) => !exclude.has(e.id));

    const score = (e: EventItem) => {
      let s = 0;
      for (const t of e.tags) {
        const idx = prefTags.indexOf(t);
        if (idx >= 0) s += 10 - idx * 2;
      }
      if (e.trending) s += 2;
      s += Math.max(0, 3 - e.distanceKm / 10);
      return s;
    };

    if (!userId || prefTags.length === 0) {
      return base.filter((e) => !e.trending).slice(0, 8);
    }

    const sorted = [...base].sort((a, b) => score(b) - score(a));
    return sorted.filter((e) => score(e) > 0).slice(0, 8);
  }, [events, prefTags, userId, signalsTick]);

  const filterLabel = [
    selectedStyle !== "All" ? selectedStyle : null,
    `≤ ${maxDistanceKm} km`,
    q ? `“${q}”` : null,
  ]
    .filter(Boolean)
    .join(" • ");

  const myPendingSubmissions = useMemo(() => {
    const _tick = reloadTick; 
    void _tick;

    if (!userId) return 0;
    return listOrganizerEventsByOwner(userId).filter((e) => e.status === "pending")
      .length;
  }, [userId, reloadTick]);

  const cta = useMemo(() => {
    if (!user) {
      return {
        title: "Organisator? Make some noise!",
        hint: "Login om je eerste aanvraag te doen en events in te dienen.",
        to: "/login",
        label: "Login",
      };
    }

    if (isOrganizer) {
      return {
        title: "Organisator? Make some noise!",
        hint: "Create, edit en boost je events.",
        to: "/my-events",
        label: "Promote my event!",
      };
    }

    return {
      title: "Organisator? Make some noise!",
      hint:
        myPendingSubmissions > 0
          ? `Je aanvraag is in review (${myPendingSubmissions}). Admin moet goedkeuren.`
          : "Dien je eerste event in voor review. Na approval word je organizer.",
      to: "/my-events",
      label: myPendingSubmissions > 0 ? "Request pending…" : "Request approval",
    };
  }, [user, isOrganizer, myPendingSubmissions]);

  return (
    <div>
      {/* HERO */}
      <section className="heroBanner">
        <div
          className="heroImage"
          style={{
            backgroundImage:
              "url(https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=1800&q=80)",
          }}
        />
        <div className="heroShade" />

        <div className="heroCenter">
          <div>
            <h1 className="heroTitle">Your local scene awaits.</h1>
            <p className="heroSubtitle">Discover all the concerts around you.</p>

            <div className="heroFilterBar">
              <SelectField
                value={selectedStyle}
                options={styleOptions}
                onChange={(v) => updateParams({ style: v })}
                placeholder="All"
                searchPlaceholder="Search a style…"
              />

              <div className="sliderGroup">
                <div className="sliderHeader">
                  <span className="sliderLabel">Distance (Km)</span>
                  <span className="sliderValue">{maxDistanceKm} Km</span>
                </div>

                <input
                  className="rangeSlider"
                  type="range"
                  min={1}
                  max={100}
                  value={maxDistanceKm}
                  onChange={(e) => updateParams({ km: Number(e.target.value) })}
                />
              </div>
            </div>

            {isLoading ? <div className="sectionHint">Loading…</div> : null}
            {error ? <div className="sectionHint">Error: {error}</div> : null}
          </div>
        </div>
      </section>

      {/* RECOMMENDED */}
      <div className="sectionTitleRow">
        <div>
          <div className="sectionTitle">Recommended for you</div>
          <div className="sectionHint">
            {userId && prefTags.length > 0
              ? `Based on: ${prefTags.slice(0, 3).join(", ")}`
              : "Login + Save/Going to personalize"}
          </div>
        </div>
        <div className="sectionHint">{filterLabel || "No filters"}</div>
      </div>

      <div className="trendingRow">
        {isLoading && events.length === 0 ? (
          <div className="sectionHint">Loading recommendations…</div>
        ) : recommendedEvents.length === 0 ? (
          <div className="sectionHint">
            No recommendations yet. Save or join a few events.
          </div>
        ) : (
          recommendedEvents.map((e) => (
            <EventCard key={e.id} event={e} search={location.search} />
          ))
        )}
      </div>

      {/* TRENDING */}
      <div className="sectionTitleRow">
        <div>
          <div className="sectionTitle">Trending</div>
          <div className="sectionHint">Hot events around you</div>
        </div>
        <div className="sectionHint">{filterLabel || "No filters"}</div>
      </div>

      <div className="trendingRow">
        {isLoading && events.length === 0 ? (
          <div className="sectionHint">Loading trending…</div>
        ) : trendingEvents.length === 0 ? (
          <div className="sectionHint">No trending events for this filter.</div>
        ) : (
          trendingEvents.map((e) => (
            <EventCard key={e.id} event={e} search={location.search} />
          ))
        )}
      </div>

      {/* ALL EVENTS */}
      <div className="sectionTitleRow">
        <div>
          <div className="sectionTitle">Dashboard</div>
          <div className="sectionHint">All events</div>
        </div>
      </div>

      <div className="eventsGrid">
        {isLoading && events.length === 0 ? (
          <div className="sectionHint">Loading events list…</div>
        ) : events.length === 0 ? (
          <div className="sectionHint">No events match your filters.</div>
        ) : (
          events.map((e) => (
            <EventCard key={e.id} event={e} search={location.search} />
          ))
        )}
      </div>

      {/* CTA */}
      <div className="organizerCTA">
        <div>
          <div className="ctaTitle">{cta.title}</div>
          <div className="ctaHint">{cta.hint}</div>
        </div>

        <Link className="ctaButton" to={cta.to}>
          {cta.label}
        </Link>
      </div>
    </div>
  );
}
