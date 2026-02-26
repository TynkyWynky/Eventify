import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import SelectField from "../components/SelectField";
import { MUSIC_STYLES, type EventItem } from "../events/eventsStore";
import { eventsRepo } from "../data/events";
import { getGenreFallbackImage } from "../data/events/genreImages";
import {
  subscribeOrganizerEventsChanged,
} from "../data/events/organizerEventsStore";
import { useAuth } from "../auth/AuthContext";
import {
  countGoingsForEvents,
  getUserGoingEventIds,
  subscribeMetricsChanged,
} from "../data/events/eventMetricsStore";
import {
  getUserFavoriteEventIds,
  subscribeFavoritesChanged,
} from "../data/events/eventFavoritesStore";
import {
  DEFAULT_USER_LAT,
  DEFAULT_USER_LNG,
  fetchAiRecommendations,
  toAiEventPayload,
} from "../data/events/aiClient";
import {
  BELGIUM_CITIES,
  getOrigin,
  requestGeolocationOrigin,
  setCityOrigin,
  subscribeOriginChanged,
} from "../data/location/locationStore";
import EventsMap from "../components/EventsMap";

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function parseKm(raw: string | null, fallback: number) {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return clamp(n, 1, 100);
}

function dedupeIds(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function EventCard({ event, search }: { event: EventItem; search: string }) {
  const reasonList = Array.isArray(event.aiRecommendation?.reasons)
    ? event.aiRecommendation?.reasons
    : [];
  const aiReason =
    reasonList.find((reason) => !/\bkm\b/i.test(reason)) || reasonList[0] || null;
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
            {aiReason ? (
              <div className="eventCardAiReason" title={aiReason}>
                {aiReason}
              </div>
            ) : null}
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

  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  const q = (searchParams.get("q") ?? "").trim();
  const styleRaw = (searchParams.get("style") ?? "All").trim();
  const selectedStyle = MUSIC_STYLES.includes(styleRaw) ? styleRaw : "All";
  const maxDistanceKm = parseKm(searchParams.get("km"), 20);

  const viewRaw = (searchParams.get("view") ?? "list").trim().toLowerCase();
  const viewMode: "list" | "map" | "split" =
    viewRaw === "map" ? "map" : viewRaw === "split" ? "split" : "list";

  // shareable location param
  const locRaw = (searchParams.get("loc") ?? "").trim();

  const styleOptions = useMemo(() => [...MUSIC_STYLES], []);
  const locationOptions = useMemo(
    () => ["My location", ...BELGIUM_CITIES.map((c) => c.name)],
    []
  );

  // origin state (lat/lng)
  const [origin, setOriginState] = useState(() => getOrigin());

  useEffect(() => {
    return subscribeOriginChanged(() => setOriginState(getOrigin()));
  }, []);

  useEffect(() => {
    if (!locRaw) return;

    const lower = locRaw.toLowerCase();

    if (lower === "me" || lower === "my" || locRaw === "My location") {
      requestGeolocationOrigin({ timeoutMs: 6000 }).catch(() => {});
      return;
    }

    const city = BELGIUM_CITIES.find((c) => c.name === locRaw);
    if (!city) return;

    setCityOrigin(city.name);
  }, [locRaw]);

  function updateParams(next: {
    style?: string;
    km?: number;
    loc?: string;
    view?: "list" | "map" | "split";
  }) {
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

    if (next.loc !== undefined) {
      const clean = next.loc.trim();

      if (!clean || clean === "Brussels") sp.delete("loc");
      else if (clean === "My location") sp.set("loc", "me");
      else sp.set("loc", clean);
    }

    if (next.view !== undefined) {
      if (!next.view || next.view === "list") sp.delete("view");
      else sp.set("view", next.view);
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

  // list events (with origin)
  useEffect(() => {
    const controller = new AbortController();

    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setIsLoading(true);
      setError(null);
    });

    eventsRepo
      .list(
        {
          style: selectedStyle,
          maxDistanceKm,
          query: q,
          originLat: origin.lat,
          originLng: origin.lng,
        },
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
  }, [maxDistanceKm, q, selectedStyle, reloadTick, origin.lat, origin.lng]);

  // signals for personalization
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

  // ✅ derive ids using signalsTick (avoid eslint warning by consuming it)
  const favIds = useMemo(() => {
    void signalsTick;
    return userId ? getUserFavoriteEventIds(userId) : [];
  }, [userId, signalsTick]);

  const goingIds = useMemo(() => {
    void signalsTick;
    return userId ? getUserGoingEventIds(userId) : [];
  }, [userId, signalsTick]);

  const [prefTags, setPrefTags] = useState<string[]>([]);
  useEffect(() => {
    if (!userId) {
      Promise.resolve().then(() => setPrefTags([]));
      return;
    }

    const controller = new AbortController();

    const refreshTags = async () => {
      try {
        const ids = Array.from(new Set([...favIds, ...goingIds])).slice(0, 30);
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
          const weight = goingIds.includes(e.id) ? 2 : 1;
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
  }, [userId, favIds, goingIds]);

  const fallbackRecommendedEvents = useMemo(() => {
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

    if (!userId || prefTags.length === 0) return [];

    const sorted = [...base].sort((a, b) => score(b) - score(a));
    return sorted.filter((e) => score(e) > 0).slice(0, 8);
  }, [events, prefTags, userId, favIds, goingIds]);

  const [aiRecommendedEvents, setAiRecommendedEvents] = useState<EventItem[]>([]);

  useEffect(() => {
    const controller = new AbortController();

    if (events.length === 0) {
      Promise.resolve().then(() => {
        if (controller.signal.aborted) return;
        setAiRecommendedEvents([]);
      });
      return () => controller.abort();
    }

    (async () => {
      const goingsMap = countGoingsForEvents(events.map((event) => event.id));
      const eventsPayload = events.map((event) =>
        toAiEventPayload(event, {
          interestedCount: goingsMap[event.id] ?? 0,
          peerInterestedCount: goingsMap[event.id] ?? 0,
        })
      );

      const favoriteIds = userId ? getUserFavoriteEventIds(userId) : [];
      const goingIds = userId ? getUserGoingEventIds(userId) : [];
      const favoriteSet = new Set(favoriteIds);
      const goingSet = new Set(goingIds);
      const likedIds = dedupeIds([...favoriteIds, ...goingIds]).slice(0, 20);

      const localEventById = new Map(events.map((event) => [event.id, event]));
      const likedItems: EventItem[] = [];
      for (const id of likedIds) {
        if (controller.signal.aborted) return;
        const local = localEventById.get(id);
        if (local) {
          likedItems.push(local);
          continue;
        }
        const resolved = await eventsRepo.getById(id, { signal: controller.signal });
        if (resolved) likedItems.push(resolved);
      }

      const likedPayload = likedItems.map((event) =>
        toAiEventPayload(event, {
          interestedCount: goingsMap[event.id] ?? 0,
          peerInterestedCount: goingsMap[event.id] ?? 0,
          preferenceWeight:
            (favoriteSet.has(event.id) ? 1.7 : 0) + (goingSet.has(event.id) ? 1.3 : 0) || 1,
        })
      );

      const derivedGenres =
        prefTags.length > 0
          ? prefTags
          : selectedStyle !== "All"
          ? [selectedStyle]
          : [];

      const userProfile = {
        preferredGenres: derivedGenres,
        likedEvents: likedPayload,
        lat: DEFAULT_USER_LAT,
        lng: DEFAULT_USER_LNG,
        maxDistanceKm,
        peerInterestByEventId: goingsMap,
      };

      const recRes = await fetchAiRecommendations(
        {
          events: eventsPayload,
          userProfile,
          limit: 8,
        },
        controller.signal
      );

      if (controller.signal.aborted) return;

      if (!recRes.ok) {
        const msg = recRes.error || "AI endpoints returned an error.";
        throw new Error(msg);
      }

      const byId = new Map(events.map((event) => [event.id, event]));
      const toUiEvent = (raw: EventItem): EventItem | null => {
        const id = String(raw?.id || "");
        const base = byId.get(id);
        if (!base) return null;
        return {
          ...base,
          aiRecommendation: raw.aiRecommendation || base.aiRecommendation,
          aiGenrePredictions: raw.aiGenrePredictions || base.aiGenrePredictions,
        };
      };

      const recommended = (recRes.events || [])
        .map((item) => toUiEvent(item))
        .filter((item): item is EventItem => item !== null)
        .slice(0, 8);

      setAiRecommendedEvents(recommended);
    })()
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setAiRecommendedEvents([]);
        console.warn(
          "AI recommendations unavailable on dashboard:",
          err instanceof Error ? err.message : String(err)
        );
      });

    return () => controller.abort();
  }, [events, maxDistanceKm, prefTags, selectedStyle, signalsTick, userId]);

  const eventsWithAi = useMemo(() => {
    const overlay = new Map<string, Partial<EventItem>>();

    for (const event of aiRecommendedEvents) {
      overlay.set(event.id, {
        ...(overlay.get(event.id) || {}),
        aiRecommendation: event.aiRecommendation,
      });
    }

    return events.map((event) => ({
      ...event,
      ...(overlay.get(event.id) || {}),
    }));
  }, [aiRecommendedEvents, events]);

  const recommendedEvents = useMemo(() => {
    if (aiRecommendedEvents.length > 0) return aiRecommendedEvents;
    return fallbackRecommendedEvents;
  }, [aiRecommendedEvents, fallbackRecommendedEvents]);

  const recommendedIds = useMemo(
    () => new Set(recommendedEvents.map((event) => event.id)),
    [recommendedEvents]
  );

  const trendingEvents = useMemo(
    () =>
      eventsWithAi.filter(
        (event) =>
          Boolean(event.trending) &&
          !recommendedIds.has(event.id)
      ),
    [eventsWithAi, recommendedIds]
  );

  const filterLabel = [
    selectedStyle !== "All" ? selectedStyle : null,
    `≤ ${maxDistanceKm} km`,
    origin.label ? `${origin.label}` : null,
    q ? `“${q}”` : null,
  ]
    .filter(Boolean)
    .join(" • ");

  const showRecommended =
    Boolean(userId) && prefTags.length > 0 && recommendedEvents.length > 0;

  return (
    <div>
      {/* HERO */}
      <section className="heroBanner heroBannerDashboard">
        <div className="heroImage heroImageDashboard" />
        <div className="heroShade" />

        <div className="heroCenter">
          <div>
            <h1 className="heroTitle">Your local scene awaits.</h1>
            <p className="heroSubtitle">
              Discover concerts around you — fast, local, personal.
            </p>

            <div className="heroFilterBar">
              <SelectField
                value={selectedStyle}
                options={styleOptions}
                onChange={(v) => updateParams({ style: v })}
                placeholder="All"
                searchPlaceholder="Search a style…"
              />

              <SelectField
                value={
                  origin.source === "geolocation"
                    ? "My location"
                    : origin.cityName || origin.label
                }
                options={locationOptions}
                onChange={async (v) => {
                  if (v === "My location") {
                    try {
                      const next = await requestGeolocationOrigin({
                        timeoutMs: 10_000,
                      });
                      setOriginState(next);
                      updateParams({ loc: "My location" });
                    } catch {
                      updateParams({ loc: origin.cityName || origin.label });
                    }
                    return;
                  }

                  setOriginState(setCityOrigin(v));
                  updateParams({ loc: v });
                }}
                placeholder="Location"
                searchPlaceholder="Search a city…"
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
            {error ? (
              <div className="authError" style={{ marginTop: 10 }}>
                {error}
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {/* RECOMMENDED (only when useful) */}
      {showRecommended ? (
        <>
          <div id="dash-recommended" className="sectionTitleRow">
            <div>
              <div className="sectionTitle">Recommended for you</div>
              <div className="sectionHint">
                Based on:
                {prefTags.slice(0, 3).map((t) => (
                  <span key={t} className="tagPill" style={{ marginLeft: 8 }}>
                    {t}
                  </span>
                ))}
              </div>
            </div>
            <div className="sectionHint">{filterLabel || "Personalized"}</div>
          </div>

          <div className="trendingRow">
            {recommendedEvents.map((e) => (
              <EventCard key={e.id} event={e} search={location.search} />
            ))}
          </div>
        </>
      ) : null}

      {/* TRENDING */}
      <div id="dash-trending" className="sectionTitleRow">
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
      <div id="dash-all" className="sectionTitleRow">
        <div>
          <div className="sectionTitle">All events</div>
          <div className="sectionHint">Everything that matches your filters</div>
        </div>
      </div>

      <div className="resultsViewBar">
        <div className="viewToggle" role="tablist" aria-label="Results view">
          <button
            type="button"
            className={`viewToggleBtn ${viewMode === "list" ? "isActive" : ""}`}
            onClick={() => updateParams({ view: "list" })}
          >
            List
          </button>
          <button
            type="button"
            className={`viewToggleBtn ${viewMode === "map" ? "isActive" : ""}`}
            onClick={() => updateParams({ view: "map" })}
          >
            Map
          </button>
          <button
            type="button"
            className={`viewToggleBtn ${viewMode === "split" ? "isActive" : ""}`}
            onClick={() => updateParams({ view: "split" })}
          >
            Split
          </button>
        </div>

        {viewMode !== "list" ? (
          <div className="sectionHint">
            Hover a dot to see the event name • Click a dot to open the details
          </div>
        ) : null}
      </div>

      {viewMode === "map" ? (
        <div className="eventsMapPanel">
          {isLoading && events.length === 0 ? (
            <div className="sectionHint">Loading events on the map…</div>
          ) : eventsWithAi.length === 0 ? (
            <div className="sectionHint">No events match your filters.</div>
          ) : (
            <EventsMap
              events={eventsWithAi}
              origin={{ lat: origin.lat, lng: origin.lng, label: origin.label }}
              search={location.search}
              className="leafletMap leafletMapDashboard"
            />
          )}
        </div>
      ) : viewMode === "split" ? (
        <div className="dashSplit">
          <div className="dashSplitList">
            <div className="eventsGrid eventsGridSplit">
              {isLoading && events.length === 0 ? (
                <div className="sectionHint">Loading events list…</div>
              ) : eventsWithAi.length === 0 ? (
                <div className="sectionHint">No events match your filters.</div>
              ) : (
                eventsWithAi.map((e) => (
                  <EventCard key={e.id} event={e} search={location.search} />
                ))
              )}
            </div>
          </div>

          <div className="dashSplitMap">
            {isLoading && events.length === 0 ? (
              <div className="sectionHint">Loading events on the map…</div>
            ) : eventsWithAi.length === 0 ? null : (
              <EventsMap
                events={eventsWithAi}
                origin={{ lat: origin.lat, lng: origin.lng, label: origin.label }}
                search={location.search}
                className="leafletMap leafletMapDashboard"
              />
            )}
          </div>
        </div>
      ) : (
        <div className="eventsGrid">
          {isLoading && events.length === 0 ? (
            <div className="sectionHint">Loading events list…</div>
          ) : eventsWithAi.length === 0 ? (
            <div className="sectionHint">No events match your filters.</div>
          ) : (
            eventsWithAi.map((e) => (
              <EventCard key={e.id} event={e} search={location.search} />
            ))
          )}
        </div>
      )}
    </div>
  );
}