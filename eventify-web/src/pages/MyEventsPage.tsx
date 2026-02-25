import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { MUSIC_STYLES } from "../events/eventsStore";
import { geocodeAddress } from "../data/maps/geocode";

import {
  createOrganizerEvent,
  deleteOrganizerEvent,
  listOrganizerEventsByOwner,
  setPromotion,
  subscribeOrganizerEventsChanged,
  updateOrganizerEvent,
  type OrganizerEvent,
} from "../data/events/organizerEventsStore";
import {
  countGoingsForEvents,
  getViews,
  subscribeMetricsChanged,
} from "../data/events/eventMetricsStore";
import {
  fetchAiSuccessPredictor,
  toAiEventPayload,
} from "../data/events/aiClient";

const DEFAULT_IMAGE =
  "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=1400&q=80";

const DEFAULT_LAT = 50.8466;
const DEFAULT_LNG = 4.3528;

type CSSVars = CSSProperties & Record<`--${string}`, string | number>;

function isPromotionActive(e: OrganizerEvent) {
  if (!e.promotedUntil) return false;
  const t = Date.parse(e.promotedUntil);
  if (!Number.isFinite(t)) return false;
  return t > Date.now();
}

function safeNum(n: number, fallback: number) {
  return Number.isFinite(n) ? n : fallback;
}

function StatusPill({ status }: { status: OrganizerEvent["status"] }) {
  return <span className={`adminStatusPill adminStatus_${status}`}>{status}</span>;
}

export default function MyEventsPage() {
  const { user } = useAuth();
  const isOrganizer = user?.role === "organizer" || user?.role === "admin";
  const userId = user?.id ?? null;

  const styleOptions = useMemo(
    () => MUSIC_STYLES.filter((s) => s !== "All"),
    []
  );

  const [events, setEvents] = useState<OrganizerEvent[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);

  const editing = useMemo(
    () => events.find((e) => e.id === editingId) ?? null,
    [editingId, events]
  );

  const [title, setTitle] = useState("");
  const [venue, setVenue] = useState("");
  const [city, setCity] = useState("Brussels");
  const [dateLabel, setDateLabel] = useState("TBA");
  const [style, setStyle] = useState(styleOptions[0] ?? "Techno");

  const [imageUrl, setImageUrl] = useState(DEFAULT_IMAGE);
  const [description, setDescription] = useState("");

  const [addressLine, setAddressLine] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [country, setCountry] = useState("Belgium");

  const [latitude, setLatitude] = useState(String(DEFAULT_LAT));
  const [longitude, setLongitude] = useState(String(DEFAULT_LNG));

  const [geoStatus, setGeoStatus] = useState<string | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [isGeocoding, setIsGeocoding] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [goingsMap, setGoingsMap] = useState<Record<string, number>>({});
  const [successPredictLoading, setSuccessPredictLoading] = useState(false);
  const [successPredictError, setSuccessPredictError] = useState<string | null>(null);
  const [successPredict, setSuccessPredict] = useState<{
    probabilityHighAttendance?: number;
    expectedAttendance?: number;
    bestPromotionDay?: string;
    targetAudienceAgeRange?: string;
    primaryGenre?: string;
    notes?: string[];
  } | null>(null);

  function resetForm() {
    setEditingId(null);
    setTitle("");
    setVenue("");
    setCity("Brussels");
    setDateLabel("TBA");
    setStyle(styleOptions[0] ?? "Techno");
    setImageUrl(DEFAULT_IMAGE);
    setDescription("");
    setAddressLine("");
    setPostalCode("");
    setCountry("Belgium");

    setLatitude(String(DEFAULT_LAT));
    setLongitude(String(DEFAULT_LNG));

    setError(null);
    setGeoStatus(null);
    setGeoError(null);
    setIsGeocoding(false);
    setSuccessPredict(null);
    setSuccessPredictError(null);
    setSuccessPredictLoading(false);
  }

  function startEdit(e: OrganizerEvent) {
    if (!isOrganizer) return;

    setEditingId(e.id);
    setTitle(e.title);
    setVenue(e.venue);
    setCity(e.city);
    setDateLabel(e.dateLabel);
    setStyle(e.tags[0] ?? (styleOptions[0] ?? "Techno"));
    setImageUrl(e.imageUrl || DEFAULT_IMAGE);
    setDescription(e.description);

    setAddressLine(e.addressLine);
    setPostalCode(e.postalCode);
    setCountry(e.country);

    setLatitude(String(e.latitude));
    setLongitude(String(e.longitude));

    setError(null);
    setGeoError(null);
    setGeoStatus("Coordinates loaded from saved event.");

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function refresh(ownerId: string) {
    try {
      const mine = await listOrganizerEventsByOwner(ownerId);
      setEvents(mine);
      setGoingsMap(countGoingsForEvents(mine.map((e) => e.id)));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setEvents([]);
      setGoingsMap({});
    }
  }

  useEffect(() => {
    if (!userId) return;

    const doRefresh = () => {
      void refresh(userId);
    };

    doRefresh();
    const unsubEvents = subscribeOrganizerEventsChanged(doRefresh);
    const unsubMetrics = subscribeMetricsChanged(doRefresh);

    return () => {
      unsubEvents();
      unsubMetrics();
    };
  }, [userId]);

  function buildGeoQuery() {
    return [addressLine, postalCode, city, country]
      .map((s) => s.trim())
      .filter(Boolean)
      .join(", ");
  }

  async function geocodeFromForm() {
    const q = buildGeoQuery();
    if (!q) throw new Error("Fill in address fields first.");
    return geocodeAddress(q);
  }

  async function handleAutoLocate() {
    setGeoError(null);
    setGeoStatus(null);
    setError(null);

    setIsGeocoding(true);
    try {
      const r = await geocodeFromForm();
      setLatitude(String(r.lat));
      setLongitude(String(r.lng));
      setGeoStatus(`Found: ${r.displayName}`);
    } catch (e: unknown) {
      setGeoError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsGeocoding(false);
    }
  }

  async function handlePredictSuccess() {
    setSuccessPredictError(null);
    setSuccessPredictLoading(true);

    try {
      const t = title.trim();
      const c = city.trim();
      const v = venue.trim();
      if (!t || !c || !v) {
        throw new Error("Fill in at least title, venue and city before prediction.");
      }

      const lat = safeNum(Number(latitude), DEFAULT_LAT);
      const lng = safeNum(Number(longitude), DEFAULT_LNG);
      const start = dateLabel.trim();

      const draftEvent = {
        title: t,
        description: description.trim() || `${style} event at ${v} in ${c}.`,
        genre: style,
        category: style,
        tags: [style],
        venue: v,
        city: c,
        start,
        lat,
        lng,
        isFree: false,
      };

      const historicalEvents = events.map((event) =>
        toAiEventPayload(event, {
          interestedCount: goingsMap[event.id] ?? 0,
          peerInterestedCount: goingsMap[event.id] ?? 0,
        })
      );

      const response = await fetchAiSuccessPredictor({
        draftEvent,
        historicalEvents,
      });

      if (!response.ok || !response.prediction) {
        throw new Error(response.error || "Predictor returned no prediction.");
      }

      setSuccessPredict({
        probabilityHighAttendance: response.prediction.probabilityHighAttendance,
        expectedAttendance: response.prediction.expectedAttendance,
        bestPromotionDay: response.prediction.bestPromotionDay,
        targetAudienceAgeRange: response.prediction.targetAudienceAgeRange,
        primaryGenre: response.prediction.primaryGenre,
        notes: response.prediction.notes || [],
      });
    } catch (err: unknown) {
      setSuccessPredict(null);
      setSuccessPredictError(err instanceof Error ? err.message : String(err));
    } finally {
      setSuccessPredictLoading(false);
    }
  }

  async function handleSave() {
    setError(null);
    setGeoError(null);

    if (!userId) {
      setError("You must be logged in.");
      return;
    }

    if (editingId && !isOrganizer) {
      setError("Only organizers can edit events. Submit a new request instead.");
      return;
    }

    const t = title.trim();
    const v = venue.trim();
    const c = city.trim();

    if (!t) return setError("Title is required.");
    if (!v) return setError("Venue is required.");
    if (!c) return setError("City is required.");

    const latNum = Number(latitude);
    const lngNum = Number(longitude);

    const hasAddressInfo =
      addressLine.trim() !== "" ||
      postalCode.trim() !== "" ||
      city.trim() !== "" ||
      country.trim() !== "";

    const coordsInvalid = !Number.isFinite(latNum) || !Number.isFinite(lngNum);
    const coordsAreDefaults =
      safeNum(latNum, DEFAULT_LAT) === DEFAULT_LAT &&
      safeNum(lngNum, DEFAULT_LNG) === DEFAULT_LNG;

    if (hasAddressInfo && (coordsInvalid || coordsAreDefaults)) {
      setIsGeocoding(true);
      try {
        const r = await geocodeFromForm();
        setLatitude(String(r.lat));
        setLongitude(String(r.lng));
        setGeoStatus(`Found: ${r.displayName}`);
      } catch (e: unknown) {
        setGeoError(e instanceof Error ? e.message : String(e));
        setError(
          "Could not locate this address. Please check it and click Auto-locate."
        );
        setIsGeocoding(false);
        return;
      } finally {
        setIsGeocoding(false);
      }
    }

    const lat = safeNum(Number(latitude), DEFAULT_LAT);
    const lng = safeNum(Number(longitude), DEFAULT_LNG);

    const payload = {
      title: t,
      venue: v,
      city: c,
      dateLabel: dateLabel.trim() || "TBA",
      tags: [style],
      imageUrl: imageUrl.trim() || DEFAULT_IMAGE,

      addressLine: addressLine.trim() || "—",
      postalCode: postalCode.trim() || "—",
      country: country.trim() || "Belgium",
      latitude: lat,
      longitude: lng,

      description: description.trim() || "—",
    };

    try {
      if (editingId) {
        await updateOrganizerEvent(userId, editingId, payload);
      } else {
        await createOrganizerEvent(userId, payload);
      }
      resetForm();
      await refresh(userId);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const totalViews = useMemo(() => {
    return events.reduce((sum, e) => sum + getViews(e.id), 0);
  }, [events]);

  const totalGoings = useMemo(() => {
    return events.reduce((sum, e) => sum + (goingsMap[e.id] ?? 0), 0);
  }, [events, goingsMap]);

  const activePromos = useMemo(() => {
    return events.filter((e) => isPromotionActive(e)).length;
  }, [events]);

  const topByViews = useMemo(() => {
    const copy = [...events];
    copy.sort((a, b) => getViews(b.id) - getViews(a.id));
    return copy.slice(0, 5);
  }, [events]);

  const maxTopViews = useMemo(() => {
    return Math.max(1, ...topByViews.map((e) => getViews(e.id)));
  }, [topByViews]);

  if (!user) {
    return (
      <div className="authPage">
        <div className="authCard">
          <h2 className="authTitle">My Events</h2>

          <p className="authHint myEventsAuthHintTop">
            Login to submit your first <b>organizer event request</b>. Once approved,
            you’ll automatically get organizer access.
          </p>

          <div className="myEventsAuthButtons">
            <Link className="btn btnPrimary" to="/login">
              Login
            </Link>
            <Link className="btn btnSecondary" to="/register">
              Create account
            </Link>
          </div>

          <p className="authHint myEventsAuthHintBottom">
            Demo admin: <b>admin@eventify.local</b> / <b>password123</b>
          </p>
        </div>
      </div>
    );
  }

  // NORMAL USER: request flow
  if (!isOrganizer) {
    const pendingCount = events.filter((e) => e.status === "pending").length;

    return (
      <div className="myEventsPage">
        <div className="myEventsHeader">
          <div>
            <div className="sectionTitle">Become an Organizer</div>
            <div className="sectionHint">
              Submit an event request. When an admin approves it, your account becomes{" "}
              <b>organizer</b> automatically.
            </div>
          </div>

          <div className="myEventsHeaderActions">
            <Link className="btn btnSecondary" to="/">
              ← Dashboard
            </Link>
            <button className="btn btnSecondary" onClick={resetForm} type="button">
              New request
            </button>
          </div>
        </div>

        {pendingCount > 0 ? (
          <div className="myEventsPanel">
            <div className="sectionHint">
              You currently have <b>{pendingCount}</b> pending request(s).
            </div>
          </div>
        ) : null}

        <div className="myEventsPanel">
          <div className="myEventsPanelHeader">
            <div className="myEventsStrongTitle">Submit your first event request</div>
          </div>

          {error ? <div className="authError myEventsError">{error}</div> : null}
          {geoError ? <div className="authError myEventsError">{geoError}</div> : null}

          <div className="myEventsFormGrid">
            <div className="myEventsGrid2_1">
              <div>
                <div className="authLabel">Title</div>
                <input
                  className="authInput"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Techno Night @ Mons"
                />
              </div>

              <div>
                <div className="authLabel">Style</div>
                <select
                  className="authInput"
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
                >
                  {styleOptions.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="myEventsGrid3">
              <div>
                <div className="authLabel">Venue</div>
                <input
                  className="authInput"
                  value={venue}
                  onChange={(e) => setVenue(e.target.value)}
                  placeholder="e.g. WayRoad"
                />
              </div>

              <div>
                <div className="authLabel">City</div>
                <input
                  className="authInput"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="e.g. Mons"
                />
              </div>

              <div>
                <div className="authLabel">Date label</div>
                <input
                  className="authInput"
                  value={dateLabel}
                  onChange={(e) => setDateLabel(e.target.value)}
                  placeholder="e.g. 2026-03-12 • 21:00"
                />
              </div>
            </div>

            <div>
              <div className="authLabel">Image URL</div>
              <input
                className="authInput"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="https://images.unsplash.com/..."
              />
            </div>

            <div className="myEventsGrid2_1_1">
              <div>
                <div className="authLabel">Address line</div>
                <input
                  className="authInput"
                  value={addressLine}
                  onChange={(e) => {
                    setAddressLine(e.target.value);
                    setGeoStatus(null);
                  }}
                  placeholder="e.g. WayRoad 7"
                />
              </div>

              <div>
                <div className="authLabel">Postal code</div>
                <input
                  className="authInput"
                  value={postalCode}
                  onChange={(e) => {
                    setPostalCode(e.target.value);
                    setGeoStatus(null);
                  }}
                  placeholder="e.g. 7860"
                />
              </div>

              <div>
                <div className="authLabel">Country</div>
                <input
                  className="authInput"
                  value={country}
                  onChange={(e) => {
                    setCountry(e.target.value);
                    setGeoStatus(null);
                  }}
                  placeholder="e.g. Belgium"
                />
              </div>
            </div>

            <div className="myEventsActionsRow">
              <button
                className="btn btnSecondary"
                type="button"
                onClick={handleAutoLocate}
                disabled={isGeocoding}
              >
                {isGeocoding ? "Locating…" : "Auto-locate from address"}
              </button>

              {geoStatus ? (
                <div className="sectionHint myEventsPromoHint">
                  {geoStatus} (lat: {Number(latitude).toFixed(5)}, lng:{" "}
                  {Number(longitude).toFixed(5)})
                </div>
              ) : (
                <div className="sectionHint myEventsPromoHint">
                  Tip: use “Street + number” (e.g. “WayRoad 7”), then click Auto-locate.
                </div>
              )}
            </div>

            <div>
              <div className="authLabel">Description</div>
              <textarea
                className="authInput"
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What should people expect? Line-up, vibe, tickets…"
              />
            </div>

            <div className="myEventsActionsRow">
              <button
                className="btn btnSecondary"
                type="button"
                onClick={handlePredictSuccess}
                disabled={isGeocoding || successPredictLoading}
              >
                {successPredictLoading ? "Predicting…" : "AI predict success"}
              </button>

              <button
                className="btn btnPrimary"
                type="button"
                onClick={handleSave}
                disabled={isGeocoding}
              >
                Submit request
              </button>

              <button
                className="btn btnSecondary"
                type="button"
                onClick={resetForm}
                disabled={isGeocoding}
              >
                Reset
              </button>
            </div>

            {successPredictError ? (
              <div className="sectionHint myEventsAiError">
                Predictor unavailable: {successPredictError}
              </div>
            ) : null}
            {successPredict ? (
              <div className="myEventsAiCard">
                <div className="myEventsStrongTitle">AI Success Predictor</div>
                <div className="myEventsAiStats">
                  <span>
                    Chance of high turnout: <b>{successPredict.probabilityHighAttendance ?? "?"}%</b>
                  </span>
                  <span>
                    Expected attendance: <b>{successPredict.expectedAttendance ?? "?"}</b>
                  </span>
                  <span>
                    Best promo day: <b>{successPredict.bestPromotionDay ?? "—"}</b>
                  </span>
                  <span>
                    Target audience: <b>{successPredict.targetAudienceAgeRange ?? "—"}</b>
                  </span>
                </div>
                {successPredict.notes && successPredict.notes.length > 0 ? (
                  <ul className="myEventsAiNotes">
                    {successPredict.notes.slice(0, 4).map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        <div className="myEventsListWrap">
          <div className="sectionTitle">Your requests</div>
          <div className="sectionHint">
            Only <b>approved</b> events become visible to everyone. If approved, you’ll
            automatically become organizer.
          </div>

          <div className="myEventsListGrid">
            {events.length === 0 ? (
              <div className="sectionHint">No requests yet.</div>
            ) : (
              events.map((e) => (
                <div key={e.id} className="myEventsEventCard">
                  <div className="myEventsEventHeader">
                    <div>
                      <div className="myEventsEventTitle">
                        {e.title}{" "}
                        <span style={{ marginLeft: 8 }}>
                          <StatusPill status={e.status} />
                        </span>
                      </div>
                      <div className="sectionHint">
                        {e.venue} • {e.city} • {e.dateLabel}
                      </div>
                      <div className="sectionHint myEventsEventStats">
                        {e.status === "approved"
                          ? "Approved: visible to everyone."
                          : e.status === "pending"
                          ? "Pending: waiting for admin review."
                          : "Rejected: you can submit a new request."}
                      </div>
                    </div>

                    <div className="myEventsEventButtons">
                      <Link
                        className="btn btnSecondary"
                        to={e.status === "approved" ? `/events/${e.id}` : "#"}
                        onClick={(ev) => {
                          if (e.status !== "approved") ev.preventDefault();
                        }}
                      >
                        Open
                      </Link>
                    </div>
                  </div>

                  <div className="sectionHint" style={{ marginTop: 10 }}>
                    {e.description}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    );
  }

  // ORGANIZER/ADMIN: full management view
  return (
    <div className="myEventsPage">
      <div className="myEventsHeader">
        <div>
          <div className="sectionTitle">My Events</div>
          <div className="sectionHint">
            Create, edit, boost & track performance of your events.
          </div>
        </div>

        <div className="myEventsHeaderActions">
          <Link className="btn btnSecondary" to="/">
            ← Dashboard
          </Link>
          <button className="btn btnSecondary" onClick={resetForm} type="button">
            New event
          </button>
        </div>
      </div>

      <div className="myEventsKpiGrid">
        {[
          ["Events", String(events.length)],
          ["Views", String(totalViews)],
          ["Goings", String(totalGoings)],
          ["Active boosts", String(activePromos)],
        ].map(([k, v]) => (
          <div key={k} className="myEventsKpiCard">
            <div className="sectionHint">{k}</div>
            <div className="myEventsKpiValue">{v}</div>
          </div>
        ))}
      </div>

      <div className="myEventsPanel">
        <div className="myEventsPanelHeader">
          <div>
            <div className="myEventsStrongTitle">Top events by views</div>
            <div className="sectionHint">Opens of detail page = views</div>
          </div>
          <div className="sectionHint">Max: {maxTopViews}</div>
        </div>

        <div className="myEventsTopList">
          {topByViews.length === 0 ? (
            <div className="sectionHint">No events yet.</div>
          ) : (
            topByViews.map((e) => {
              const v = getViews(e.id);
              const pct = Math.round((v / maxTopViews) * 100);
              const fillStyle: CSSVars = { "--pct": `${pct}%` };

              return (
                <div key={e.id} className="myEventsTopRow">
                  <div className="myEventsTopRowHeader">
                    <div className="myEventsTopTitle">{e.title}</div>
                    <div className="sectionHint">
                      {v} views • {goingsMap[e.id] ?? 0} going
                    </div>
                  </div>

                  <div className="myEventsTopBar">
                    <div className="myEventsTopBarFill" style={fillStyle} />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="myEventsPanel">
        <div className="myEventsPanelHeader">
          <div className="myEventsStrongTitle">
            {editing ? "Edit event" : "Create new event"}
          </div>

          {editing ? (
            <button className="btn btnSecondary" type="button" onClick={resetForm}>
              Cancel edit
            </button>
          ) : null}
        </div>

        {error ? <div className="authError myEventsError">{error}</div> : null}
        {geoError ? <div className="authError myEventsError">{geoError}</div> : null}

        <div className="myEventsFormGrid">
          <div className="myEventsGrid2_1">
            <div>
              <div className="authLabel">Title</div>
              <input
                className="authInput"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Techno Night @ Mons"
              />
            </div>

            <div>
              <div className="authLabel">Style</div>
              <select
                className="authInput"
                value={style}
                onChange={(e) => setStyle(e.target.value)}
              >
                {styleOptions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="myEventsGrid3">
            <div>
              <div className="authLabel">Venue</div>
              <input
                className="authInput"
                value={venue}
                onChange={(e) => setVenue(e.target.value)}
                placeholder="e.g. WayRoad"
              />
            </div>

            <div>
              <div className="authLabel">City</div>
              <input
                className="authInput"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="e.g. Mons"
              />
            </div>

            <div>
              <div className="authLabel">Date label</div>
              <input
                className="authInput"
                value={dateLabel}
                onChange={(e) => setDateLabel(e.target.value)}
                placeholder="e.g. 2026-03-12 • 21:00"
              />
            </div>
          </div>

          <div>
            <div className="authLabel">Image URL</div>
            <input
              className="authInput"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://images.unsplash.com/..."
            />
          </div>

          <div className="myEventsGrid2_1_1">
            <div>
              <div className="authLabel">Address line</div>
              <input
                className="authInput"
                value={addressLine}
                onChange={(e) => {
                  setAddressLine(e.target.value);
                  setGeoStatus(null);
                }}
                placeholder="e.g. WayRoad 7"
              />
            </div>

            <div>
              <div className="authLabel">Postal code</div>
              <input
                className="authInput"
                value={postalCode}
                onChange={(e) => {
                  setPostalCode(e.target.value);
                  setGeoStatus(null);
                }}
                placeholder="e.g. 7860"
              />
            </div>

            <div>
              <div className="authLabel">Country</div>
              <input
                className="authInput"
                value={country}
                onChange={(e) => {
                  setCountry(e.target.value);
                  setGeoStatus(null);
                }}
                placeholder="e.g. Belgium"
              />
            </div>
          </div>

          <div className="myEventsActionsRow">
            <button
              className="btn btnSecondary"
              type="button"
              onClick={handleAutoLocate}
              disabled={isGeocoding}
            >
              {isGeocoding ? "Locating…" : "Auto-locate from address"}
            </button>

            {geoStatus ? (
              <div className="sectionHint myEventsPromoHint">
                {geoStatus} (lat: {Number(latitude).toFixed(5)}, lng:{" "}
                {Number(longitude).toFixed(5)})
              </div>
            ) : (
              <div className="sectionHint myEventsPromoHint">
                Tip: use “Street + number” (e.g. “WayRoad 7”), then click Auto-locate.
              </div>
            )}
          </div>

          <div>
            <div className="authLabel">Description</div>
            <textarea
              className="authInput"
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What should people expect? Line-up, vibe, tickets…"
            />
          </div>

          <div className="myEventsActionsRow">
            <button
              className="btn btnSecondary"
              type="button"
              onClick={handlePredictSuccess}
              disabled={isGeocoding || successPredictLoading}
            >
              {successPredictLoading ? "Predicting…" : "AI predict success"}
            </button>

            <button
              className="btn btnPrimary"
              type="button"
              onClick={handleSave}
              disabled={isGeocoding}
            >
              {editing ? "Save changes" : "Create event"}
            </button>

            <button
              className="btn btnSecondary"
              type="button"
              onClick={resetForm}
              disabled={isGeocoding}
            >
              Reset
            </button>
          </div>

          {successPredictError ? (
            <div className="sectionHint myEventsAiError">
              Predictor unavailable: {successPredictError}
            </div>
          ) : null}
          {successPredict ? (
            <div className="myEventsAiCard">
              <div className="myEventsStrongTitle">AI Success Predictor</div>
              <div className="myEventsAiStats">
                <span>
                  Chance of high turnout: <b>{successPredict.probabilityHighAttendance ?? "?"}%</b>
                </span>
                <span>
                  Expected attendance: <b>{successPredict.expectedAttendance ?? "?"}</b>
                </span>
                <span>
                  Best promo day: <b>{successPredict.bestPromotionDay ?? "—"}</b>
                </span>
                <span>
                  Target audience: <b>{successPredict.targetAudienceAgeRange ?? "—"}</b>
                </span>
              </div>
              {successPredict.notes && successPredict.notes.length > 0 ? (
                <ul className="myEventsAiNotes">
                  {successPredict.notes.slice(0, 4).map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="myEventsListWrap">
        <div className="sectionTitle">Your events</div>
        <div className="sectionHint">
          Only <b>approved</b> events are visible for everyone.
        </div>

        <div className="myEventsListGrid">
          {events.length === 0 ? (
            <div className="sectionHint">No events yet.</div>
          ) : (
            events.map((e) => {
              const active = isPromotionActive(e);
              const views = getViews(e.id);
              const goings = goingsMap[e.id] ?? 0;

              return (
                <div key={e.id} className="myEventsEventCard">
                  <div className="myEventsEventHeader">
                    <div>
                      <div className="myEventsEventTitle">
                        {e.title}{" "}
                        <span style={{ marginLeft: 8 }}>
                          <StatusPill status={e.status} />
                        </span>
                      </div>
                      <div className="sectionHint">
                        {e.venue} • {e.city} • {e.dateLabel}
                      </div>
                      <div className="sectionHint myEventsEventStats">
                        {views} views • {goings} going
                        {active ? " • BOOSTED (Trending)" : ""}
                      </div>
                    </div>

                    <div className="myEventsEventButtons">
                      <Link
                        className="btn btnSecondary"
                        to={e.status === "approved" ? `/events/${e.id}` : "#"}
                        onClick={(ev) => {
                          if (e.status !== "approved") ev.preventDefault();
                        }}
                      >
                        Open
                      </Link>

                      <button
                        className="btn btnSecondary"
                        type="button"
                        onClick={() => startEdit(e)}
                        disabled={e.status !== "approved"}
                        title={e.status !== "approved" ? "Only approved events can be edited" : ""}
                      >
                        Edit
                      </button>

                      <button
                        className="btn btnSecondary"
                        type="button"
                        onClick={async () => {
                          if (!userId) return;
                          if (!confirm("Delete this event?")) return;

                          try {
                            await deleteOrganizerEvent(userId, e.id);
                            if (editingId === e.id) resetForm();
                            await refresh(userId);
                          } catch (err: unknown) {
                            setError(err instanceof Error ? err.message : String(err));
                          }
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  <div className="myEventsPromotionRow">
                    <button
                      className={`btn ${
                        active && e.promotionPlan === "24h" ? "btnPrimary" : "btnSecondary"
                      }`}
                      type="button"
                      onClick={async () => {
                        if (!userId) return;
                        try {
                          await setPromotion(userId, e.id, "24h");
                          await refresh(userId);
                        } catch (err: unknown) {
                          setError(err instanceof Error ? err.message : String(err));
                        }
                      }}
                      disabled={e.status !== "approved"}
                    >
                      Boost 24h (€9.99)
                    </button>

                    <button
                      className={`btn ${
                        active && e.promotionPlan === "7d" ? "btnPrimary" : "btnSecondary"
                      }`}
                      type="button"
                      onClick={async () => {
                        if (!userId) return;
                        try {
                          await setPromotion(userId, e.id, "7d");
                          await refresh(userId);
                        } catch (err: unknown) {
                          setError(err instanceof Error ? err.message : String(err));
                        }
                      }}
                      disabled={e.status !== "approved"}
                    >
                      Boost 7d (€24.99)
                    </button>

                    <button
                      className="btn btnSecondary"
                      type="button"
                      onClick={async () => {
                        if (!userId) return;
                        try {
                          await setPromotion(userId, e.id, null);
                          await refresh(userId);
                        } catch (err: unknown) {
                          setError(err instanceof Error ? err.message : String(err));
                        }
                      }}
                      disabled={e.status !== "approved"}
                    >
                      Remove boost
                    </button>

                    {active && e.promotedUntil ? (
                      <div className="sectionHint myEventsPromoHint">
                        Active until {new Date(e.promotedUntil).toLocaleString()}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}