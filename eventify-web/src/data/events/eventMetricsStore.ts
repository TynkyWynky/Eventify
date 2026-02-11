/**
 * Very small metrics store in localStorage.
 * Used for organizer dashboard graphs (views, goings).
 */

const VIEWS_KEY = "eventify_event_views_v1";
const USER_GOINGS_KEY = "eventify_user_goings_v1"; // { [userId]: string[] }

const METRICS_CHANGED_EVENT = "eventify:metrics-changed";

type ViewsMap = Record<string, number>;
type GoingsMap = Record<string, string[]>;

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed as T;
  } catch {
    return fallback;
  }
}

function notifyChanged() {
  window.dispatchEvent(new Event(METRICS_CHANGED_EVENT));
}

export function subscribeMetricsChanged(handler: () => void) {
  const h: EventListener = () => handler();
  window.addEventListener(METRICS_CHANGED_EVENT, h);
  return () => window.removeEventListener(METRICS_CHANGED_EVENT, h);
}

function loadViews(): ViewsMap {
  const parsed = safeParse<ViewsMap>(localStorage.getItem(VIEWS_KEY), {});
  return typeof parsed === "object" && parsed !== null ? parsed : {};
}

function saveViews(map: ViewsMap) {
  localStorage.setItem(VIEWS_KEY, JSON.stringify(map));
}

function loadGoings(): GoingsMap {
  const parsed = safeParse<GoingsMap>(localStorage.getItem(USER_GOINGS_KEY), {});
  return typeof parsed === "object" && parsed !== null ? parsed : {};
}

function saveGoings(map: GoingsMap) {
  localStorage.setItem(USER_GOINGS_KEY, JSON.stringify(map));
}

export function incrementView(eventId: string) {
  const map = loadViews();
  map[eventId] = (map[eventId] ?? 0) + 1;
  saveViews(map);
  notifyChanged();
  return map[eventId];
}

export function getViews(eventId: string) {
  const map = loadViews();
  return map[eventId] ?? 0;
}

export function isUserGoing(userId: string, eventId: string) {
  const goings = loadGoings();
  const list = Array.isArray(goings[userId]) ? goings[userId] : [];
  return list.includes(eventId);
}

export function toggleGoing(userId: string, eventId: string) {
  const goings = loadGoings();
  const list = Array.isArray(goings[userId]) ? [...goings[userId]] : [];
  const idx = list.indexOf(eventId);
  let next = false;

  if (idx >= 0) {
    list.splice(idx, 1);
    next = false;
  } else {
    list.unshift(eventId);
    next = true;
  }

  goings[userId] = list;
  saveGoings(goings);
  notifyChanged();
  return next;
}

export function countGoings(eventId: string) {
  const goings = loadGoings();
  let count = 0;
  for (const userId of Object.keys(goings)) {
    const list = goings[userId];
    if (Array.isArray(list) && list.includes(eventId)) count += 1;
  }
  return count;
}

export function countGoingsForEvents(eventIds: string[]) {
  const set = new Set(eventIds);
  const goings = loadGoings();
  const out: Record<string, number> = {};
  for (const id of eventIds) out[id] = 0;

  for (const userId of Object.keys(goings)) {
    const list = goings[userId];
    if (!Array.isArray(list)) continue;
    for (const eventId of list) {
      if (!set.has(eventId)) continue;
      out[eventId] = (out[eventId] ?? 0) + 1;
    }
  }

  return out;
}

export function getUserGoingEventIds(userId: string) {
  const goings = loadGoings();
  const list = Array.isArray(goings[userId]) ? goings[userId] : [];
  return list.filter((x) => typeof x === "string");
}
