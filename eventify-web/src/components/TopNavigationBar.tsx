import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Link,
  NavLink,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

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

  const [isNotifOpen, setNotifOpen] = useState(false);
  const [isProfileOpen, setProfileOpen] = useState(false);

  const notifWrapRef = useRef<HTMLDivElement | null>(null);
  const profileWrapRef = useRef<HTMLDivElement | null>(null);

  const latest = useMemo(() => notifications.slice(0, 6), [notifications]);

  // ✅ URL-driven search (q=...)
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();

  const qFromUrl = searchParams.get("q") ?? "";
  const [query, setQuery] = useState(qFromUrl);

  // Close popovers when clicking outside
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
    }

    // capture=true zodat het ook werkt als ergens stopPropagation gebeurt
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [isNotifOpen, isProfileOpen]);

  // Sync input when URL changes (back/forward, clicks, etc.)
  useEffect(() => {
    setQuery(qFromUrl);
  }, [qFromUrl]);

  const commitQuery = useCallback(
    (nextValue: string) => {
      const trimmed = nextValue.trim();

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
    [location.pathname, navigate, searchParams, setSearchParams]
  );

  // Debounce: avoid updating URL on every single keystroke instantly
  useEffect(() => {
    if (query.trim() === qFromUrl) return;

    const id = window.setTimeout(() => {
      commitQuery(query);
    }, 300);

    return () => window.clearTimeout(id);
  }, [commitQuery, qFromUrl, query]);

  return (
    <header className="navBar">
      <div className="navInner">
        <Link className="brandTitle" to="/">
          Eventify
        </Link>

        <div className="navSearchWrap">
          <input
            className="searchBar"
            placeholder="Artist, Place, Genre, ..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitQuery(query);
              }
              if (e.key === "Escape") {
                setQuery("");
                commitQuery("");
              }
            }}
          />
        </div>

        <div className="navActions">
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
              {/* Notifications */}
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
                  {unreadCount > 0 && (
                    <span className="navBadge">{unreadCount}</span>
                  )}
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
                            className={`popoverItem ${
                              n.isRead ? "" : "popoverItemUnread"
                            }`}
                            onClick={() => markAsRead(n.id)}
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

              {/* Profile */}
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
                      <Link
                        className="popoverLink"
                        to="/account"
                        onClick={() => setProfileOpen(false)}
                      >
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
                        <Link
                          className="popoverLink"
                          to="/admin"
                          onClick={() => setProfileOpen(false)}
                        >
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
