import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Link,
  NavLink,
  type To,
  useNavigate,
} from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import type { NotificationItem } from "../auth/authTypes";
import { useInstallPrompt } from "../hooks/useInstallPrompt";
import { useNavSearch } from "../hooks/useNavSearch";
import { getOrigin, subscribeOriginChanged } from "../data/location/locationStore";

const MAX_RECENT_SEARCHES = 8;

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

function normalizeSearchText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clearRecentSearches() {
  return [] as string[];
}

function rememberRecentSearch(term: string, current: string[]) {
  const clean = term.trim();
  if (!clean) return current.slice(0, MAX_RECENT_SEARCHES);
  const deduped = current.filter(
    (item) => normalizeSearchText(item) !== normalizeSearchText(clean)
  );
  deduped.unshift(clean);
  return deduped.slice(0, MAX_RECENT_SEARCHES);
}

function levenshtein(a: string, b: string) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const dp: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = i - 1;
    dp[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = dp[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return dp[b.length];
}

function isFuzzyMatch(query: string, candidate: string) {
  const q = normalizeSearchText(query);
  const c = normalizeSearchText(candidate);
  if (!q || !c) return false;
  if (c.includes(q)) return true;

  const qWords = q.split(" ").filter(Boolean);
  const cWords = c.split(" ").filter(Boolean);

  return qWords.every((qWord) =>
    cWords.some((cWord) => {
      if (cWord.startsWith(qWord)) return true;
      const maxDistance = qWord.length <= 4 ? 1 : 2;
      return levenshtein(qWord, cWord.slice(0, qWord.length)) <= maxDistance;
    })
  );
}

function BellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 22a2.2 2.2 0 0 0 2.2-2.2H9.8A2.2 2.2 0 0 0 12 22Zm7-6V11a7 7 0 1 0-14 0v5l-2 2v1h18v-1l-2-2Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 12a4.2 4.2 0 1 0-4.2-4.2A4.2 4.2 0 0 0 12 12Zm0 2.2c-4.3 0-7.8 2.3-7.8 5.2V21h15.6v-1.6c0-2.9-3.5-5.2-7.8-5.2Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function TopNavigationBar() {
  const { user, notifications, unreadCount, markAllAsRead, markAsRead, logout } =
    useAuth();

  const {
    query,
    setQuery,
    isSearchOpen,
    setSearchOpen,
    recentSearches,
    searchSuggestions,
    submitSearch,
    clearQuery,
    applySuggestion,
    clearHistory,
  } = useNavSearch();

  const { isInstallReady, isStandalone, promptInstall } = useInstallPrompt();

  const [isNotifOpen, setNotifOpen] = useState(false);
  const [isProfileOpen, setProfileOpen] = useState(false);

  const notifWrapRef = useRef<HTMLDivElement | null>(null);
  const profileWrapRef = useRef<HTMLDivElement | null>(null);
  const searchWrapRef = useRef<HTMLDivElement | null>(null);

  const navigate = useNavigate();

  const latest = useMemo(() => notifications.slice(0, 6), [notifications]);
  const qFromUrl = searchParams.get("q") ?? "";
  const [query, setQuery] = useState(qFromUrl);
  const [isSearchOpen, setSearchOpen] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [serverSuggestions, setServerSuggestions] = useState<string[]>([]);
  const [installPromptEvent, setInstallPromptEvent] = useState<InstallPromptEvent | null>(null);
  const [isInstallReady, setInstallReady] = useState(false);
  const [isStandalone, setStandalone] = useState(() =>
    window.matchMedia("(display-mode: standalone)").matches
  );
  const [origin, setOrigin] = useState(() => getOrigin());

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node | null;
      if (!target) return;

      if (isNotifOpen) {
        const wrap = notifWrapRef.current;
        if (wrap && !wrap.contains(target)) setNotifOpen(false);
      }

      if (isProfileOpen) {
        const wrap = profileWrapRef.current;
        if (wrap && !wrap.contains(target)) setProfileOpen(false);
      }

      if (isSearchOpen) {
        const wrap = searchWrapRef.current;
        if (wrap && !wrap.contains(target)) setSearchOpen(false);
      }
    }

    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [isNotifOpen, isProfileOpen, isSearchOpen, setSearchOpen]);
  }, [isNotifOpen, isProfileOpen, isSearchOpen]);

  // Sync input when URL changes (back/forward, clicks, etc.)
  useEffect(() => {
    setQuery(qFromUrl);
  }, [qFromUrl]);

  useEffect(() => {
    return subscribeOriginChanged(() => setOrigin(getOrigin()));
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setServerSuggestions([]);
      return;
    }

    const controller = new AbortController();
    const base = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() || "http://localhost:3000";
    const url = new URL("/events/suggestions", base.endsWith("/") ? base : `${base}/`);
    url.searchParams.set("q", q);
    url.searchParams.set("lat", String(origin.lat));
    url.searchParams.set("lng", String(origin.lng));
    url.searchParams.set("radiusKm", "1000");
    url.searchParams.set("limit", "10");

    const id = window.setTimeout(() => {
      fetch(url.toString(), { signal: controller.signal })
        .then(async (res) => {
          if (!res.ok) throw new Error(`Suggestions request failed (${res.status})`);
          const payload = (await res.json()) as { ok?: boolean; suggestions?: string[] };
          const list = Array.isArray(payload.suggestions) ? payload.suggestions : [];
          setServerSuggestions(list.slice(0, 10));
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setServerSuggestions([]);
        });
    }, 220);

    return () => {
      window.clearTimeout(id);
      controller.abort();
    };
  }, [origin.lat, origin.lng, query]);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPromptEvent(event as InstallPromptEvent);
      setInstallReady(true);
    };
    const onInstalled = () => {
      setInstallPromptEvent(null);
      setInstallReady(false);
      setStandalone(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const commitQuery = useCallback(
    (nextValue: string, opts?: { persistHistory?: boolean }) => {
      const trimmed = nextValue.trim();
      if (trimmed && opts?.persistHistory) {
        setRecentSearches(rememberRecentSearch(trimmed, recentSearches));
      }

      const next = new URLSearchParams(searchParams);
      if (trimmed) next.set("q", trimmed);
      else next.delete("q");

      const nextSearch = next.toString();
      const searchStr = nextSearch ? `?${nextSearch}` : "";

      // If user is not on dashboard and they start searching, send them to dashboard
      if (location.pathname !== "/" && trimmed) {
        navigate({ pathname: "/", search: searchStr }, { replace: true });
        return;
      }

      setSearchParams(next, { replace: true });
    },
    [location.pathname, navigate, recentSearches, searchParams, setSearchParams]
  );

  const searchSuggestions = useMemo(() => {
    const qNorm = normalizeSearchText(query);
    if (!qNorm) {
      return recentSearches.map((item) => ({ label: item, source: "recent" as const })).slice(0, 8);
    }

    const fromRecent = recentSearches
      .filter((item) => isFuzzyMatch(qNorm, item))
      .map((item) => ({ label: item, source: "recent" as const }));

    const seen = new Set(fromRecent.map((item) => normalizeSearchText(item.label)));
    const fromCatalog = serverSuggestions
      .filter((item) => !seen.has(normalizeSearchText(item)) && isFuzzyMatch(qNorm, item))
      .slice(0, 8)
      .map((item) => ({ label: item, source: "catalog" as const }));

    return [...fromRecent, ...fromCatalog].slice(0, 8);
  }, [query, recentSearches, serverSuggestions]);

  const handleInstallClick = useCallback(async () => {
    if (!installPromptEvent) return;
    await installPromptEvent.prompt();
    const choice = await installPromptEvent.userChoice;
    if (choice.outcome === "accepted") {
      setInstallReady(false);
    }
  }, [installPromptEvent]);

  // Debounce: avoid updating URL on every single keystroke instantly
  useEffect(() => {
    if (query.trim() === qFromUrl) return;

    const id = window.setTimeout(() => {
      commitQuery(query, { persistHistory: false });
    }, 300);

    return () => window.clearTimeout(id);
  }, [commitQuery, qFromUrl, query]);

  const resolveNotificationTarget = useCallback((n: NotificationItem): To | null => {
    const payload = n.payload && typeof n.payload === "object" ? n.payload : null;
    const eventKey = payload && typeof payload.eventKey === "string" ? payload.eventKey : null;
    const planId = payload && typeof payload.planId === "string" ? payload.planId : null;

    if (n.type === "event_invite" || n.type === "invite_response") {
      return "/account?focus=invites";
    }

    if (n.type === "friend_request" || n.type === "friend_accept") {
      return "/account?focus=requests";
    }

    if (n.type === "group_plan_invite") {
      if (eventKey && planId) return `/events/${eventKey}?plan=${encodeURIComponent(planId)}`;
      if (eventKey) return `/events/${eventKey}`;
      return "/account?focus=invites";
    }

    if (n.type === "friend_going" && eventKey) {
      return `/events/${eventKey}`;
    }

    if (eventKey) {
      return `/events/${eventKey}`;
    }

    if (n.type === "friend_going") {
      return "/account?focus=going";
    }

    return null;
  }, []);

  const handleNotificationClick = useCallback(
    (n: NotificationItem) => {
      markAsRead(n.id);
      setNotifOpen(false);

      const target = resolveNotificationTarget(n);
      if (!target) return;
      navigate(target);
    },
    [markAsRead, navigate, resolveNotificationTarget]
  );

  return (
    <header className="navBar">
      <div className="navInner">
        <Link className="brandTitle" to="/">
          Eventify
        </Link>

        <div className="navSearchWrap" ref={searchWrapRef}>
          <input
            className="searchBar"
            placeholder="Artist, Place, Genre, ..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setSearchOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submitSearch();
              }
              if (e.key === "Escape") {
                clearQuery();
              }
            }}
          />
          <button
            type="button"
            className="searchCommitBtn"
            onClick={submitSearch}
            aria-label="Search"
          >
            Search
          </button>
          {isSearchOpen && searchSuggestions.length > 0 && (
            <div className="searchSuggest" role="listbox" aria-label="Search suggestions">
              <div className="searchSuggestHeader">
                <div className="searchSuggestHeaderTitle">Suggestions</div>
                {recentSearches.length > 0 ? (
                  <button type="button" className="searchSuggestClear" onClick={clearHistory}>
                    Clear history
                  </button>
                ) : null}
              </div>
              {searchSuggestions.map((item) => (
                <button
                  key={`${item.source}-${item.label}`}
                  className="searchSuggestItem"
                  onClick={() => applySuggestion(item.label)}
                >
                  <span className="searchSuggestLabel">{item.label}</span>
                  <span className="searchSuggestMeta">
                    {item.source === "recent" ? "Recent" : "Suggestion"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="navActions">
          {!isStandalone && isInstallReady ? (
            <button type="button" className="navInstallBtn" onClick={promptInstall}>
              Install app
            </button>
          ) : null}
          {!user ? (
            <>
              <NavLink className="navPill" to="/login">
                Login
              </NavLink>
              <NavLink className="navPill navPillPrimary" to="/register">
                Sign up
              </NavLink>
            </>
          ) : (
            <>
              <div className="navPopoverWrap" ref={notifWrapRef}>
                <button
                  className="navIconBtn"
                  onClick={() => {
                    setNotifOpen((v) => !v);
                    setProfileOpen(false);
                  }}
                  aria-label="Notifications"
                >
                  <BellIcon />
                  {unreadCount > 0 && <span className="navBadge">{unreadCount}</span>}
                </button>

                {isNotifOpen && (
                  <div className="popover">
                    <div className="popoverHeader">
                      <div>
                        <div className="popoverTitle">Notifications</div>
                        <div className="popoverHint">{unreadCount} unread</div>
                      </div>
                      <button className="popoverAction" onClick={markAllAsRead}>
                        Mark all read
                      </button>
                    </div>

                    <div className="popoverList">
                      {latest.length === 0 ? (
                        <div className="popoverEmpty">No notifications.</div>
                      ) : (
                        latest.map((n) => (
                          <button
                            key={n.id}
                            className={`popoverItem ${n.isRead ? "" : "popoverItemUnread"}`}
                            onClick={() => handleNotificationClick(n)}
                          >
                            <div className="popoverItemTitle">{n.title}</div>
                            <div className="popoverItemText">{n.message}</div>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="navPopoverWrap" ref={profileWrapRef}>
                <button
                  className="navIconBtn"
                  onClick={() => {
                    setProfileOpen((v) => !v);
                    setNotifOpen(false);
                  }}
                  aria-label="Account"
                >
                  <UserIcon />
                </button>

                {isProfileOpen && (
                  <div className="popover">
                    <div className="popoverHeader">
                      <div>
                        <div className="popoverTitle">{user.name}</div>
                        <div className="popoverHint">{user.email}</div>
                      </div>
                    </div>

                    <div className="popoverList">
                      <Link className="popoverLink" to="/account" onClick={() => setProfileOpen(false)}>
                        Account
                      </Link>

                      {(user.role === "organizer" || user.role === "admin") && (
                        <Link
                          className="popoverLink"
                          to="/my-events"
                          onClick={() => setProfileOpen(false)}
                        >
                          My Events
                        </Link>
                      )}

                      {user.role === "admin" && (
                        <Link className="popoverLink" to="/admin" onClick={() => setProfileOpen(false)}>
                          Admin Dashboard
                        </Link>
                      )}

                      <Link
                        className="popoverLink"
                        to="/account/settings"
                        onClick={() => setProfileOpen(false)}
                      >
                        Settings
                      </Link>

                      <button className="popoverLink danger" onClick={logout}>
                        Logout
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
