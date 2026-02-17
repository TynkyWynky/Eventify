import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { EventItem } from "../events/eventsStore";
import { eventsRepo } from "../data/events";
import { useAuth } from "../auth/AuthContext";
import {
  getUserGoingEventIds,
  subscribeMetricsChanged,
} from "../data/events/eventMetricsStore";
import {
  getUserFavoriteEventIds,
  subscribeFavoritesChanged,
} from "../data/events/eventFavoritesStore";

//type Friend = { id: string; name: string; status: string };



function EventRow({ e }: { e: EventItem }) {
  return (
    <Link to={`/events/${e.id}`} className="accountEventRow">
      <img className="accountEventThumb" src={e.imageUrl} alt={e.title} />
      <div className="accountEventInfo">
        <div className="accountEventTitle">{e.title}</div>
        <div className="accountEventMeta">
          {e.venue} • {e.dateLabel} • {e.city}
        </div>
      </div>
      <div className="accountEventAction">Open</div>
    </Link>
  );
}

/*function FriendRow({ f }: { f: Friend }) {
  return (
    <div className="accountFriendRow">
      <div className="accountAvatar">{f.name.slice(0, 1).toUpperCase()}</div>
      <div className="accountFriendInfo">
        <div className="accountFriendName">{f.name}</div>
        <div className="accountFriendMeta">{f.status}</div>
      </div>
      <div className="accountFriendAction">View</div>
    </div>
  );
}*/

async function fetchEventsByIds(ids: string[], signal: AbortSignal) {
  if (ids.length === 0) return [];

  const results = await Promise.all(
    ids.map((id) => eventsRepo.getById(id, { signal }))
  );

  const map = new Map<string, EventItem>();
  for (const e of results) if (e) map.set(e.id, e);

  return ids.map((id) => map.get(id)).filter(Boolean) as EventItem[];
}

export default function AccountPage() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const canManage = user?.role === "organizer" || user?.role === "admin";

  const [favoriteEvents, setFavoriteEvents] = useState<EventItem[]>([]);
  const [favLoading, setFavLoading] = useState(false);
  const [favError, setFavError] = useState<string | null>(null);

  const [goingEvents, setGoingEvents] = useState<EventItem[]>([]);
  const [goingLoading, setGoingLoading] = useState(false);
  const [goingError, setGoingError] = useState<string | null>(null);

  const favCount = useMemo(() => favoriteEvents.length, [favoriteEvents]);
  const goingCount = useMemo(() => goingEvents.length, [goingEvents]);

  const preferredTags = useMemo(() => {
    const counts = new Map<string, number>();

    const add = (tags: string[], weight: number) => {
      for (const t of tags) {
        if (!t || t === "All") continue;
        counts.set(t, (counts.get(t) ?? 0) + weight);
      }
    };

    for (const e of favoriteEvents) add(e.tags, 1);
    for (const e of goingEvents) add(e.tags, 2);

    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    return sorted.slice(0, 8).map(([tag]) => tag);
  }, [favoriteEvents, goingEvents]);

  useEffect(() => {
    if (!userId) return;

    const controller = new AbortController();

    const refreshFav = async () => {
      try {
        setFavLoading(true);
        setFavError(null);
        const ids = getUserFavoriteEventIds(userId);
        const evts = await fetchEventsByIds(ids, controller.signal);
        setFavoriteEvents(evts);
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setFavError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!controller.signal.aborted) setFavLoading(false);
      }
    };

    refreshFav();
    const unsub = subscribeFavoritesChanged(() => refreshFav());

    return () => {
      controller.abort();
      unsub();
    };
  }, [userId]);

  useEffect(() => {
    if (!userId) return;

    const controller = new AbortController();

    const refreshGoing = async () => {
      try {
        setGoingLoading(true);
        setGoingError(null);
        const ids = getUserGoingEventIds(userId);
        const evts = await fetchEventsByIds(ids, controller.signal);
        setGoingEvents(evts);
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setGoingError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!controller.signal.aborted) setGoingLoading(false);
      }
    };

    refreshGoing();
    const unsub = subscribeMetricsChanged(() => refreshGoing());

    return () => {
      controller.abort();
      unsub();
    };
  }, [userId]);

  if (!user) return null;

  return (
    <div>
      <div className="accountHeader">
        <div>
          <div className="accountTitle">Account</div>
          <div className="accountHint">
            Signed in as <b>{user.name}</b> • {user.email} • role:{" "}
            <b>{user.role}</b>
          </div>
        </div>

        <div className="accountHeaderActions">
          {canManage ? (
            <Link className="accountSettingsBtn" to="/my-events">
              My Events
            </Link>
          ) : null}

          <Link className="accountSettingsBtn" to="/account/settings">
            Settings
          </Link>
        </div>
      </div>

      <div className="accountGrid">
        <section className="accountSection">
          <div className="accountSectionHeader">
            <div className="accountSectionTitle">Favorites</div>
            <div className="accountSectionHint">Saved events • {favCount}</div>
          </div>

          <div className="accountList">
            {favLoading ? (
              <div className="accountSectionHint">Loading…</div>
            ) : null}
            {favError ? (
              <div className="accountSectionHint">Error: {favError}</div>
            ) : null}

            {!favLoading && !favError && favoriteEvents.length === 0 ? (
              <div className="accountSectionHint">
                No favorites yet. Use “Save” on an event.
              </div>
            ) : (
              favoriteEvents.map((e) => <EventRow key={e.id} e={e} />)
            )}
          </div>
        </section>

        <section className="accountSection">
          <div className="accountSectionHeader">
            <div className="accountSectionTitle">Going</div>
            <div className="accountSectionHint">
              Events you plan to attend • {goingCount}
            </div>
          </div>

          <div className="accountList">
            {goingLoading ? (
              <div className="accountSectionHint">Loading…</div>
            ) : null}
            {goingError ? (
              <div className="accountSectionHint">Error: {goingError}</div>
            ) : null}

            {!goingLoading && !goingError && goingEvents.length === 0 ? (
              <div className="accountSectionHint">
                No events yet. Click “I’m going” on an event.
              </div>
            ) : (
              goingEvents.map((e) => <EventRow key={e.id} e={e} />)
            )}
          </div>
        </section>

        <section className="accountSection">
          <div className="accountSectionHeader">
            <div className="accountSectionTitle">Type preferences</div>
            <div className="accountSectionHint">
              Based on your Save + Going behavior
            </div>
          </div>

          <div className="accountChips">
            {preferredTags.length === 0 ? (
              <div className="accountSectionHint">
                No signal yet. Save / Join events to build your taste profile.
              </div>
            ) : (
              preferredTags.map((p) => (
                <span key={p} className="accountChip">
                  {p}
                </span>
              ))
            )}
          </div>
        </section>

        <section className="accountSection accountSectionFull">
          <div className="accountSectionHeader">
            <div className="accountSectionTitle">Friends</div>
            <div className="accountSectionHint">See activity and updates</div>
          </div>
          <div className="accountList">

          </div>
        </section>
      </div>
    </div>
  );
}
