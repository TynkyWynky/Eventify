/**
 * Favorites store in localStorage.
 * Keeps a per-user list of saved eventIds.
 */

const USER_FAVORITES_KEY = "eventify_user_favorites_v1"; // { [userId]: string[] }
const FAVORITES_CHANGED_EVENT = "eventify:favorites-changed";

type FavoritesMap = Record<string, string[]>;

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed as T;
  } catch {
    return fallback;
  }
}

function loadFavorites(): FavoritesMap {
  const parsed = safeParse<FavoritesMap>(localStorage.getItem(USER_FAVORITES_KEY), {});
  return typeof parsed === "object" && parsed !== null ? parsed : {};
}

function saveFavorites(map: FavoritesMap) {
  localStorage.setItem(USER_FAVORITES_KEY, JSON.stringify(map));
}

function notifyChanged() {
  window.dispatchEvent(new Event(FAVORITES_CHANGED_EVENT));
}

export function subscribeFavoritesChanged(handler: () => void) {
  const h: EventListener = () => handler();
  window.addEventListener(FAVORITES_CHANGED_EVENT, h);
  return () => window.removeEventListener(FAVORITES_CHANGED_EVENT, h);
}

export function getUserFavoriteEventIds(userId: string) {
  const fav = loadFavorites();
  const list = Array.isArray(fav[userId]) ? fav[userId] : [];
  return list.filter((x) => typeof x === "string");
}

export function isFavorite(userId: string, eventId: string) {
  const list = getUserFavoriteEventIds(userId);
  return list.includes(eventId);
}

export function toggleFavorite(userId: string, eventId: string) {
  const fav = loadFavorites();
  const list = Array.isArray(fav[userId]) ? [...fav[userId]] : [];
  const idx = list.indexOf(eventId);

  let next = false;
  if (idx >= 0) {
    list.splice(idx, 1);
    next = false;
  } else {
    list.unshift(eventId);
    next = true;
  }

  fav[userId] = list;
  saveFavorites(fav);
  notifyChanged();
  return next;
}
