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
import { LOCALE_META, type Locale, useI18n } from "../i18n/I18nContext";

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
  const { locale, setLocale, t } = useI18n();
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
  const [isLangOpen, setLangOpen] = useState(false);

  const notifWrapRef = useRef<HTMLDivElement | null>(null);
  const profileWrapRef = useRef<HTMLDivElement | null>(null);
  const searchWrapRef = useRef<HTMLDivElement | null>(null);
  const langWrapRef = useRef<HTMLDivElement | null>(null);

  const navigate = useNavigate();

  const latest = useMemo(() => notifications.slice(0, 6), [notifications]);

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

      if (isLangOpen) {
        const wrap = langWrapRef.current;
        if (wrap && !wrap.contains(target)) setLangOpen(false);
      }
    }

    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [isNotifOpen, isProfileOpen, isSearchOpen, isLangOpen, setSearchOpen]);

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
          Eventium
        </Link>

        <div className="navSearchWrap" ref={searchWrapRef}>
          <input
            className="searchBar"
            placeholder={t("nav.searchPlaceholder")}
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
            aria-label={t("nav.search")}
          >
            {t("nav.search")}
          </button>
          {isSearchOpen && searchSuggestions.length > 0 && (
            <div className="searchSuggest" role="listbox" aria-label={t("nav.suggestions")}>
              <div className="searchSuggestHeader">
                <div className="searchSuggestHeaderTitle">{t("nav.suggestions")}</div>
                {recentSearches.length > 0 ? (
                  <button type="button" className="searchSuggestClear" onClick={clearHistory}>
                    {t("nav.clearHistory")}
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
                    {item.source === "recent" ? t("nav.recent") : t("nav.suggestion")}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className={`navActions ${user ? "navActionsAuthed" : "navActionsGuest"}`}>
          {!isStandalone && isInstallReady ? (
            <button type="button" className="navInstallBtn" onClick={promptInstall}>
              {t("nav.installApp")}
            </button>
          ) : null}

          <div className="navPopoverWrap" ref={langWrapRef}>
            <button
              className="navLanguageBtn"
              onClick={() => {
                setLangOpen((v) => !v);
                setNotifOpen(false);
                setProfileOpen(false);
              }}
              aria-label={t("nav.language")}
              title={t("nav.language")}
            >
              <span className={`navLanguageFlag navLanguageFlag${locale.toUpperCase()}`} aria-hidden="true" />
            </button>

            {isLangOpen && (
              <div className="popover navLanguagePopover">
                <div className="popoverHeader">
                  <div className="popoverTitle">{t("nav.language")}</div>
                </div>
                <div className="popoverList">
                  {(Object.keys(LOCALE_META) as Locale[]).map((code) => (
                    <button
                      key={code}
                      type="button"
                      className={`popoverItem ${code === locale ? "popoverItemUnread" : ""}`}
                      onClick={() => {
                        setLocale(code);
                        setLangOpen(false);
                      }}
                    >
                      <div className="popoverItemTitle">
                        <span className={`navLanguageFlag navLanguageFlag${code.toUpperCase()}`} aria-hidden="true" />{" "}
                        {LOCALE_META[code].label}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {!user ? (
            <>
              <NavLink
                className={({ isActive }) => `navPill ${isActive ? "active" : ""}`}
                to="/login"
              >
                {t("nav.login")}
              </NavLink>
              <NavLink
                className={({ isActive }) =>
                  `navPill navPillPrimary ${isActive ? "active" : ""}`
                }
                to="/register"
              >
                {t("nav.signup")}
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
                    setLangOpen(false);
                  }}
                  aria-label={t("nav.notifications")}
                >
                  <BellIcon />
                  {unreadCount > 0 && <span className="navBadge">{unreadCount}</span>}
                </button>

                {isNotifOpen && (
                  <div className="popover">
                    <div className="popoverHeader">
                      <div>
                        <div className="popoverTitle">{t("nav.notifications")}</div>
                        <div className="popoverHint">{unreadCount} {t("nav.unread")}</div>
                      </div>
                      <button className="popoverAction" onClick={markAllAsRead}>
                        {t("nav.markAllRead")}
                      </button>
                    </div>

                    <div className="popoverList">
                      {latest.length === 0 ? (
                        <div className="popoverEmpty">{t("nav.noNotifications")}</div>
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
                    setLangOpen(false);
                  }}
                  aria-label={t("nav.account")}
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
                        {t("nav.account")}
                      </Link>

                      {(user.role === "organizer" || user.role === "admin") && (
                        <Link
                          className="popoverLink"
                          to="/my-events"
                          onClick={() => setProfileOpen(false)}
                        >
                          {t("nav.myEvents")}
                        </Link>
                      )}

                      {user.role === "admin" && (
                        <Link className="popoverLink" to="/admin" onClick={() => setProfileOpen(false)}>
                          {t("nav.adminDashboard")}
                        </Link>
                      )}

                      <Link
                        className="popoverLink"
                        to="/account/settings"
                        onClick={() => setProfileOpen(false)}
                      >
                        {t("nav.settings")}
                      </Link>

                      <button className="popoverLink danger" onClick={logout}>
                        {t("nav.logout")}
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
