import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { EventItem } from "../events/eventsStore";
import { eventsRepo } from "../data/events";
import { useAuth } from "../auth/AuthContext";
import {
  countGoingsForEvents,
} from "../data/events/eventMetricsStore";
import {
  DEFAULT_USER_LAT,
  DEFAULT_USER_LNG,
  fetchAiTasteDna,
  toAiEventPayload,
  type AiTasteDnaResponse,
} from "../data/events/aiClient";

//type Friend = { id: string; name: string; status: string };


import { apiFetch } from "../auth/apiClient";
import { getUserFavoriteEventIds, subscribeFavoritesChanged } from "../data/events/eventFavoritesStore";

type PublicUser = { id: string; username: string; name: string; email: string };

type IncomingRequest = {
  id: string;
  status: string;
  createdAt: string;
  from: PublicUser;
};

type OutgoingRequest = {
  id: string;
  status: string;
  createdAt: string;
  to: PublicUser;
};

type InviteItem = {
  id: string;
  eventKey: string;
  status: string;
  createdAt: string;
  inviter: PublicUser;
};

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

function FriendRow({
  u,
  actionLabel,
  onAction,
  actionDisabled,
  meta,
}: {
  u: PublicUser;
  meta?: string;
  actionLabel?: string;
  onAction?: () => void;
  actionDisabled?: boolean;
}) {
  const initial = (u.name || u.username || "U").slice(0, 1).toUpperCase();

  return (
    <div className="accountFriendRow">
      <div className="accountAvatar">{initial}</div>
      <div className="accountFriendInfo">
        <div className="accountFriendName">{u.name}</div>
        <div className="accountFriendMeta">
          {meta ? meta : u.username ? `@${u.username}` : u.email}
        </div>
      </div>

      {actionLabel ? (
        <button
          className="accountFriendAction"
          type="button"
          onClick={onAction}
          disabled={actionDisabled}
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

function RequestRow({
  title,
  u,
  onAccept,
  onDecline,
  busy,
}: {
  title: string;
  u: PublicUser;
  onAccept: () => void;
  onDecline: () => void;
  busy: boolean;
}) {
  const initial = (u.name || u.username || "U").slice(0, 1).toUpperCase();
  return (
    <div className="accountFriendRow">
      <div className="accountAvatar">{initial}</div>
      <div className="accountFriendInfo">
        <div className="accountFriendName">{title}</div>
        <div className="accountFriendMeta">
          {u.name} {u.username ? `(@${u.username})` : ""}
        </div>
      </div>

      <div className="accountFriendActionGroup">
        <button className="accountFriendAction" type="button" onClick={onAccept} disabled={busy}>
          Accept
        </button>
        <button className="accountFriendAction" type="button" onClick={onDecline} disabled={busy}>
          Decline
        </button>
      </div>
    </div>
  );
}

async function fetchEventsByIds(ids: string[], signal: AbortSignal) {
  if (ids.length === 0) return [];

  const results = await Promise.all(ids.map((id) => eventsRepo.getById(id, { signal })));

  const map = new Map<string, EventItem>();
  for (const e of results) if (e) map.set(e.id, e);

  return ids.map((id) => map.get(id)).filter(Boolean) as EventItem[];
}

function dedupeEventsById(items: EventItem[]) {
  const map = new Map<string, EventItem>();
  for (const item of items) {
    map.set(item.id, item);
  }
  return [...map.values()];
}

function labelGenre(genre: string) {
  const g = genre.trim().toLowerCase();
  if (!g) return "Unknown";

  const map: Record<string, string> = {
    electronic: "Electronic",
    "hip-hop": "Hip-Hop",
    "singer-songwriter": "Singer-Songwriter",
    indie: "Indie",
    rock: "Rock",
    pop: "Pop",
    jazz: "Jazz",
    blues: "Blues",
    folk: "Folk",
    metal: "Metal",
    soul: "R&B",
    classical: "Classical",
    latin: "Latin",
    world: "World",
  };

  return map[g] || genre;
}

export default function AccountPage() {
  const { user, token } = useAuth();
  const userId = user?.id ?? null;
  const canManage = user?.role === "organizer" || user?.role === "admin";

  // ----------------------------
  // Favorites (local as before)
  // ----------------------------
  const [favoriteEvents, setFavoriteEvents] = useState<EventItem[]>([]);
  const [favLoading, setFavLoading] = useState(false);
  const [favError, setFavError] = useState<string | null>(null);

  // ----------------------------
  // Going (SERVER)
  // ----------------------------
  const [goingEvents, setGoingEvents] = useState<EventItem[]>([]);
  const [goingLoading, setGoingLoading] = useState(false);
  const [goingError, setGoingError] = useState<string | null>(null);

  // ----------------------------
  // Friends (SERVER)
  // ----------------------------
  const [friends, setFriends] = useState<PublicUser[]>([]);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [friendsError, setFriendsError] = useState<string | null>(null);

  const [incomingRequests, setIncomingRequests] = useState<IncomingRequest[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<OutgoingRequest[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [requestsError, setRequestsError] = useState<string | null>(null);

  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<PublicUser[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [friendActionBusyId, setFriendActionBusyId] = useState<string | null>(null);

  // ----------------------------
  // Invites (SERVER)
  // ----------------------------
  const [invites, setInvites] = useState<InviteItem[]>([]);
  const [invitesLoading, setInvitesLoading] = useState(false);
  const [invitesError, setInvitesError] = useState<string | null>(null);
  const [inviteEventCache, setInviteEventCache] = useState<Record<string, EventItem | null>>({});

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

  const likedEvents = useMemo(
    () => dedupeEventsById([...favoriteEvents, ...goingEvents]),
    [favoriteEvents, goingEvents]
  );

  const [taste, setTaste] = useState<AiTasteDnaResponse | null>(null);
  const [tasteLoading, setTasteLoading] = useState(false);
  const [tasteError, setTasteError] = useState<string | null>(null);

  const tasteSampleSize = taste?.inferredPreferences?.sampleSize ?? 0;
  const hasStrongTasteSignal = tasteSampleSize >= 3;
  const topTasteGenres = Array.from(
    new Set(
      (taste?.inferredPreferences?.topGenres || [])
        .slice(0, 4)
        .map((genre) => labelGenre(genre))
        .filter(Boolean)
    )
  );

  // ============================
  // Favorites loader
  // ============================
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

  // ============================
  // Going loader (SERVER)
  // ============================
  const refreshGoing = async (signal?: AbortSignal) => {
    if (!token) return;
    try {
      setGoingLoading(true);
      setGoingError(null);

      const data = await apiFetch<{ ok: boolean; eventKeys: string[] }>("/me/going", {
        token,
        signal,
      });

      const ids = Array.isArray(data.eventKeys) ? data.eventKeys : [];
      const evts = await fetchEventsByIds(ids, signal ?? new AbortController().signal);
      setGoingEvents(evts);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setGoingError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!signal?.aborted) setGoingLoading(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    void refreshGoing(controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // ============================
  // Friends + Requests loader (SERVER)
  // ============================
  const refreshFriends = async (signal?: AbortSignal) => {
    if (!token) return;
    try {
      setFriendsLoading(true);
      setFriendsError(null);
      const data = await apiFetch<{ ok: boolean; friends: PublicUser[] }>("/friends", {
        token,
        signal,
      });
      setFriends(Array.isArray(data.friends) ? data.friends : []);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setFriendsError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!signal?.aborted) setFriendsLoading(false);
    }
  };

  const refreshRequests = async (signal?: AbortSignal) => {
    if (!token) return;
    try {
      setRequestsLoading(true);
      setRequestsError(null);

      const [inc, out] = await Promise.all([
        apiFetch<{ ok: boolean; requests: IncomingRequest[] }>("/friends/requests/incoming", {
          token,
          signal,
        }),
        apiFetch<{ ok: boolean; requests: OutgoingRequest[] }>("/friends/requests/outgoing", {
          token,
          signal,
        }),
      ]);

      setIncomingRequests(Array.isArray(inc.requests) ? inc.requests : []);
      setOutgoingRequests(Array.isArray(out.requests) ? out.requests : []);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setRequestsError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!signal?.aborted) setRequestsLoading(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    void refreshFriends(controller.signal);
    void refreshRequests(controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // ============================
  // Invites loader (SERVER)
  // ============================
  const refreshInvites = async (signal?: AbortSignal) => {
    if (!token) return;
    try {
      setInvitesLoading(true);
      setInvitesError(null);

      const data = await apiFetch<{ ok: boolean; invites: InviteItem[] }>("/invites", {
        token,
        signal,
      });

      const list = Array.isArray(data.invites) ? data.invites : [];
      setInvites(list);

      // fetch event info for nicer display
      const keys = [...new Set(list.map((i) => i.eventKey))];
      const nextCache: Record<string, EventItem | null> = {};
      await Promise.all(
        keys.map(async (k) => {
          if (inviteEventCache[k] !== undefined) {
            nextCache[k] = inviteEventCache[k];
            return;
          }
          try {
            const e = await eventsRepo.getById(k, { signal: signal ?? new AbortController().signal });
            nextCache[k] = e ?? null;
          } catch {
            nextCache[k] = null;
          }
        })
      );

      if (Object.keys(nextCache).length > 0) {
        setInviteEventCache((prev) => ({ ...prev, ...nextCache }));
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setInvitesError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!signal?.aborted) setInvitesLoading(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    void refreshInvites(controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // ============================
  // Search users (SERVER)
  // ============================
  useEffect(() => {
    if (!token) return;

    const q = searchQ.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setSearchError(null);
      setSearchLoading(false);
      return;
    }

    const controller = new AbortController();
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          setSearchLoading(true);
          setSearchError(null);
          const data = await apiFetch<{ ok: boolean; users: PublicUser[] }>(
            `/users/search?q=${encodeURIComponent(q)}`,
            { token, signal: controller.signal }
          );
          setSearchResults(Array.isArray(data.users) ? data.users : []);
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setSearchError(err instanceof Error ? err.message : String(err));
        } finally {
          if (!controller.signal.aborted) setSearchLoading(false);
        }
      })();
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(t);
    };
  }, [searchQ, token]);

  const friendIdSet = useMemo(() => new Set(friends.map((f) => f.id)), [friends]);
  const outgoingToSet = useMemo(() => new Set(outgoingRequests.map((r) => r.to.id)), [outgoingRequests]);

  // ============================
  // Actions
  // ============================
  const sendRequest = async (toUserId: string) => {
    if (!token) return;
    try {
      setFriendActionBusyId(toUserId);
      await apiFetch<{ ok: boolean; requestId: string }>("/friends/requests", {
        method: "POST",
        token,
        body: { toUserId },
      });
      await refreshRequests();
    } catch (err: unknown) {
      setRequestsError(err instanceof Error ? err.message : String(err));
    } finally {
      setFriendActionBusyId(null);
    }
  };

  const acceptRequest = async (requestId: string) => {
    if (!token) return;
    try {
      setFriendActionBusyId(requestId);
      await apiFetch<{ ok: boolean }>(`/friends/requests/${encodeURIComponent(requestId)}/accept`, {
        method: "POST",
        token,
      });
      await Promise.all([refreshFriends(), refreshRequests()]);
    } catch (err: unknown) {
      setRequestsError(err instanceof Error ? err.message : String(err));
    } finally {
      setFriendActionBusyId(null);
    }
  };

  const declineRequest = async (requestId: string) => {
    if (!token) return;
    try {
      setFriendActionBusyId(requestId);
      await apiFetch<{ ok: boolean }>(`/friends/requests/${encodeURIComponent(requestId)}/decline`, {
        method: "POST",
        token,
      });
      await refreshRequests();
    } catch (err: unknown) {
      setRequestsError(err instanceof Error ? err.message : String(err));
    } finally {
      setFriendActionBusyId(null);
    }
  };

  const removeFriend = async (friendId: string) => {
    if (!token) return;
    try {
      setFriendActionBusyId(friendId);
      await apiFetch<{ ok: boolean }>(`/friends/${encodeURIComponent(friendId)}`, {
        method: "DELETE",
        token,
      });
      await refreshFriends();
    } catch (err: unknown) {
      setFriendsError(err instanceof Error ? err.message : String(err));
    } finally {
      setFriendActionBusyId(null);
    }
  };

  const respondInvite = async (inviteId: string, status: "accepted" | "declined") => {
    if (!token) return;
    try {
      setFriendActionBusyId(inviteId);
      await apiFetch<{ ok: boolean; status: string }>(`/invites/${encodeURIComponent(inviteId)}/respond`, {
        method: "POST",
        token,
        body: { status },
      });
      await Promise.all([refreshInvites(), refreshGoing()]);
    } catch (err: unknown) {
      setInvitesError(err instanceof Error ? err.message : String(err));
    } finally {
      setFriendActionBusyId(null);
    }
  };

  useEffect(() => {
    if (!userId) {
      setTaste(null);
      setTasteLoading(false);
      setTasteError(null);
      return;
    }

    const controller = new AbortController();

    const refreshTaste = async () => {
      if (likedEvents.length === 0) {
        setTaste(null);
        setTasteError(null);
        setTasteLoading(false);
        return;
      }

      try {
        setTasteLoading(true);
        setTasteError(null);

        const favoriteSet = new Set(favoriteEvents.map((event) => event.id));
        const goingSet = new Set(goingEvents.map((event) => event.id));
        const goingsMap = countGoingsForEvents(likedEvents.map((event) => event.id));

        const likedPayload = likedEvents.map((event) =>
          toAiEventPayload(event, {
            interestedCount: goingsMap[event.id] ?? 0,
            peerInterestedCount: goingsMap[event.id] ?? 0,
            preferenceWeight:
              (favoriteSet.has(event.id) ? 1.7 : 0) +
                (goingSet.has(event.id) ? 1.3 : 0) ||
              1,
          })
        );

        const response = await fetchAiTasteDna(
          {
            userProfile: {
              preferredGenres: preferredTags,
              likedEvents: likedPayload,
              lat: DEFAULT_USER_LAT,
              lng: DEFAULT_USER_LNG,
              maxDistanceKm: 35,
              peerInterestByEventId: goingsMap,
            },
            likedEventKeys: likedEvents.map((event) => event.id),
            bootstrapFromFeed: false,
          },
          controller.signal
        );

        if (controller.signal.aborted) return;
        if (!response.ok) {
          throw new Error(response.error || "Taste request failed.");
        }

        setTaste(response);
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setTaste(null);
        setTasteError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!controller.signal.aborted) setTasteLoading(false);
      }
    };

    refreshTaste();
    return () => controller.abort();
  }, [favoriteEvents, goingEvents, likedEvents, preferredTags, userId]);

  if (!user) return null;

  return (
    <div>
      <div className="accountHeader">
        <div>
          <div className="accountTitle">Account</div>
          <div className="accountHint">
            Signed in as <b>{user.name}</b> • {user.email} • role: <b>{user.role}</b>
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
            {favLoading ? <div className="accountSectionHint">Loading…</div> : null}
            {favError ? <div className="accountSectionHint">Error: {favError}</div> : null}

            {!favLoading && !favError && favoriteEvents.length === 0 ? (
              <div className="accountSectionHint">No favorites yet. Use “Save” on an event.</div>
            ) : (
              favoriteEvents.map((e) => <EventRow key={e.id} e={e} />)
            )}
          </div>
        </section>

        <section className="accountSection">
          <div className="accountSectionHeader">
            <div className="accountSectionTitle">Going</div>
            <div className="accountSectionHint">Events you plan to attend • {goingCount}</div>
          </div>

          <div className="accountList">
            <div className="accountSectionHint">
              <button
                className="accountSettingsBtn"
                type="button"
                onClick={() => void refreshGoing()}
                disabled={goingLoading}
              >
                Refresh
              </button>
            </div>

            {goingLoading ? <div className="accountSectionHint">Loading…</div> : null}
            {goingError ? <div className="accountSectionHint">Error: {goingError}</div> : null}

            {!goingLoading && !goingError && goingEvents.length === 0 ? (
              <div className="accountSectionHint">No events yet. Click “I’m going” on an event.</div>
            ) : (
              goingEvents.map((e) => <EventRow key={e.id} e={e} />)
            )}
          </div>
        </section>

        <section className="accountSection">
          <div className="accountSectionHeader">
            <div className="accountSectionTitle">Taste</div>
            <div className="accountSectionHint">
              AI profile based on your Save + Going behavior
            </div>
          </div>

          <div className="accountList">
            {tasteLoading ? (
              <div className="accountSectionHint">Building your Taste…</div>
            ) : null}

            {tasteError ? (
              <div className="accountSectionHint">Error: {tasteError}</div>
            ) : null}

            {!tasteLoading && !tasteError && taste?.summary && hasStrongTasteSignal ? (
              <>
                <div className="aiTasteSummary">{taste.summary}</div>
                <div className="aiTasteMeta">
                  Top genres: {topTasteGenres.join(", ") || "—"}
                </div>
                <div className="accountChips">
                  {(taste.archetypes || []).slice(0, 3).map((entry) => (
                    <span key={entry.label} className="accountChip">
                      {entry.percentage}% {entry.label}
                    </span>
                  ))}
                </div>
              </>
            ) : null}

            {!tasteLoading && !tasteError && (!taste?.summary || !hasStrongTasteSignal) ? (
              <div className="accountChips">
                {preferredTags.length > 0 ? (
                  preferredTags.map((tag) => (
                    <span key={tag} className="accountChip">
                      {tag}
                    </span>
                  ))
                ) : null}
              </div>
            ) : null}

            {!tasteLoading && !tasteError && preferredTags.length === 0 && !taste?.summary ? (
              <div className="accountSectionHint">
                No signal yet. Save / Join events to build your taste.
              </div>
            ) : null}

            {!tasteLoading && !tasteError && tasteSampleSize > 0 && tasteSampleSize < 3 ? (
              <div className="accountSectionHint">
                Add a few more saved/going events for a stronger Taste signal.
              </div>
            ) : null}
          </div>
        </section>

        {/* ===========================
            FRIENDS / REQUESTS / INVITES
            =========================== */}
        <section className="accountSection accountSectionFull">
          <div className="accountSectionHeader">
            <div className="accountSectionTitle">Friends</div>
            <div className="accountSectionHint">Add friends, accept requests, handle invites</div>
          </div>

          {/* Search */}
          <div className="accountList">
            <div className="accountSectionHint">
              Search users (min 2 chars):{" "}
              <input
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                placeholder="username, email, first name…"
                className="input"
              />
            </div>

            {searchLoading ? <div className="accountSectionHint">Searching…</div> : null}
            {searchError ? <div className="accountSectionHint">Search error: {searchError}</div> : null}

            {searchQ.trim().length >= 2 && !searchLoading && searchResults.length === 0 ? (
              <div className="accountSectionHint">No users found.</div>
            ) : null}

            {searchResults.map((u) => {
              const isFriend = friendIdSet.has(u.id);
              const isRequested = outgoingToSet.has(u.id);

              const label = isFriend ? "Friends" : isRequested ? "Requested" : "Add";
              const disabled = isFriend || isRequested || friendActionBusyId === u.id;

              return (
                <FriendRow
                  key={u.id}
                  u={u}
                  meta={u.username ? `@${u.username}` : u.email}
                  actionLabel={disabled ? (friendActionBusyId === u.id ? "..." : label) : label}
                  actionDisabled={disabled}
                  onAction={() => void sendRequest(u.id)}
                />
              );
            })}
          </div>

          {/* Incoming requests */}
          <div className="accountList">
            <div className="accountSectionHeader">
              <div className="accountSectionTitle">Requests</div>
              <div className="accountSectionHint">Incoming & outgoing</div>
            </div>

            {requestsLoading ? <div className="accountSectionHint">Loading requests…</div> : null}
            {requestsError ? <div className="accountSectionHint">Error: {requestsError}</div> : null}

            {incomingRequests.length === 0 ? (
              <div className="accountSectionHint">No incoming requests.</div>
            ) : (
              incomingRequests.map((r) => (
                <RequestRow
                  key={r.id}
                  title="Incoming request"
                  u={r.from}
                  busy={friendActionBusyId === r.id}
                  onAccept={() => void acceptRequest(r.id)}
                  onDecline={() => void declineRequest(r.id)}
                />
              ))
            )}

            {outgoingRequests.length > 0 ? (
              <>
                <div className="accountSectionHint" style={{ marginTop: 12 }}>
                  Outgoing:
                </div>
                {outgoingRequests.map((r) => (
                  <FriendRow
                    key={r.id}
                    u={r.to}
                    meta="Pending request"
                    actionLabel={friendActionBusyId === r.to.id ? "..." : "Pending"}
                    actionDisabled={true}
                  />
                ))}
              </>
            ) : null}
          </div>

          {/* Friends list */}
          <div className="accountList">
            <div className="accountSectionHeader">
              <div className="accountSectionTitle">Your friends</div>
              <div className="accountSectionHint">{friends.length} total</div>
            </div>

            {friendsLoading ? <div className="accountSectionHint">Loading friends…</div> : null}
            {friendsError ? <div className="accountSectionHint">Error: {friendsError}</div> : null}

            {!friendsLoading && !friendsError && friends.length === 0 ? (
              <div className="accountSectionHint">No friends yet. Add someone above.</div>
            ) : (
              friends.map((f) => (
                <FriendRow
                  key={f.id}
                  u={f}
                  meta={f.username ? `@${f.username}` : f.email}
                  actionLabel={friendActionBusyId === f.id ? "..." : "Remove"}
                  actionDisabled={friendActionBusyId === f.id}
                  onAction={() => void removeFriend(f.id)}
                />
              ))
            )}
          </div>

          {/* Invites */}
          <div className="accountList">
            <div className="accountSectionHeader">
              <div className="accountSectionTitle">Event invites</div>
              <div className="accountSectionHint">Pending invites you received</div>
            </div>

            {invitesLoading ? <div className="accountSectionHint">Loading invites…</div> : null}
            {invitesError ? <div className="accountSectionHint">Error: {invitesError}</div> : null}

            {!invitesLoading && !invitesError && invites.length === 0 ? (
              <div className="accountSectionHint">No invites right now.</div>
            ) : (
              invites.map((inv) => {
                const e = inviteEventCache[inv.eventKey];
                const title = e?.title || "Event";
                const city = e?.city || "";
                const meta = city ? `${title} • ${city}` : title;

                return (
                  <div key={inv.id} className="accountFriendRow">
                    <div className="accountAvatar">🎟️</div>
                    <div className="accountFriendInfo">
                      <div className="accountFriendName">Invite from {inv.inviter.name}</div>
                      <div className="accountFriendMeta">{meta}</div>
                    </div>

                    <div className="accountFriendActionGroup">
                      <Link to={`/events/${inv.eventKey}`} className="accountFriendAction">
                        View
                      </Link>

                      <button
                        className="accountFriendAction"
                        type="button"
                        onClick={() => void respondInvite(inv.id, "accepted")}
                        disabled={friendActionBusyId === inv.id}
                      >
                        Accept
                      </button>
                      <button
                        className="accountFriendAction"
                        type="button"
                        onClick={() => void respondInvite(inv.id, "declined")}
                        disabled={friendActionBusyId === inv.id}
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Manual refresh controls */}
          <div className="accountList">
            <div className="accountSectionHint">
              <button
                className="accountSettingsBtn"
                type="button"
                onClick={() => {
                  void refreshFriends();
                  void refreshRequests();
                  void refreshInvites();
                }}
                disabled={friendsLoading || requestsLoading || invitesLoading}
              >
                Refresh friends / requests / invites
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
