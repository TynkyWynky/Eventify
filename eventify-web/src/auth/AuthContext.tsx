/* eslint-disable react-refresh/only-export-components */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { AuthState, NotificationItem, RegisterPayload, User } from "./authTypes";
import {
  apiFetch,
  buildSseUrl,
  type ApiAuthResponse,
  type ApiMeResponse,
} from "./apiClient";

const AUTH_STORAGE_KEY = "eventify_auth_v2";

type JsonRecord = Record<string, unknown>;
function isRecord(v: unknown): v is JsonRecord {
  return typeof v === "object" && v !== null;
}

function readString(obj: JsonRecord, key: string): string | null {
  const v = obj[key];
  return typeof v === "string" ? v : null;
}

function readBool(obj: JsonRecord, key: string): boolean | null {
  const v = obj[key];
  return typeof v === "boolean" ? v : null;
}

function mapNotification(raw: unknown): NotificationItem {
  if (!isRecord(raw)) {
    return {
      id: `n_${Math.random().toString(16).slice(2)}`,
      type: "system",
      title: "Notification",
      message: "",
      payload: null,
      createdAt: new Date().toISOString(),
      isRead: false,
    };
  }

  const id = readString(raw, "id") ?? `n_${Math.random().toString(16).slice(2)}`;
  const type = readString(raw, "type") ?? "system";
  const title = readString(raw, "title") ?? "Notification";
  const message = readString(raw, "message") ?? "";
  const payloadRaw = raw.payload;
  const payload = isRecord(payloadRaw) ? payloadRaw : null;
  const createdAt =
    readString(raw, "createdAt") ??
    readString(raw, "created_at") ??
    new Date().toISOString();

  const isRead =
    readBool(raw, "isRead") ??
    readBool(raw, "is_read") ??
    false;

  return { id, type, title, message, payload, createdAt, isRead };
}

function loadInitial(): {
  user: User | null;
  token: string | null;
  notifications: NotificationItem[];
} {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return { user: null, token: null, notifications: [] };

    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return { user: null, token: null, notifications: [] };

    const token = typeof parsed.token === "string" ? parsed.token : null;

    let user: User | null = null;
    if (isRecord(parsed.user)) {
      const u = parsed.user;
      if (typeof u.id === "string" && typeof u.email === "string" && typeof u.name === "string") {
        const role =
          u.role === "admin" || u.role === "organizer" || u.role === "user" ? u.role : "user";
        user = { id: u.id, name: u.name, email: u.email, role };
      }
    }

    const notifications = Array.isArray(parsed.notifications)
      ? (parsed.notifications as NotificationItem[])
      : [];

    return { user, token, notifications };
  } catch {
    return { user: null, token: null, notifications: [] };
  }
}

/* =========================
   Context
   ========================= */
const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const initial = useMemo(() => loadInitial(), []);

  const [user, setUser] = useState<User | null>(initial.user);
  const [token, setToken] = useState<string | null>(initial.token);
  const [notifications, setNotifications] = useState<NotificationItem[]>(initial.notifications);

  useEffect(() => {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ user, token, notifications }));
  }, [user, token, notifications]);

  useEffect(() => {
    if (!token) return;

    const controller = new AbortController();

    (async () => {
      try {
        const data = await apiFetch<ApiMeResponse>("/auth/me", {
          token,
          signal: controller.signal,
        });

        if (!data.ok || !data.user) throw new Error("Not authenticated");
        setUser(data.user);
      } catch {
        if (!controller.signal.aborted) {
          setToken(null);
          setUser(null);
          setNotifications([]);
        }
      }
    })();

    return () => controller.abort();
  }, [token]);

  useEffect(() => {
    if (!token) return;

    const controller = new AbortController();

    (async () => {
      try {
        const data = await apiFetch<{ ok: boolean; notifications?: unknown[] }>(
          "/notifications?limit=30",
          { token, signal: controller.signal }
        );

        const list = Array.isArray(data.notifications) ? data.notifications : [];
        setNotifications(list.map(mapNotification));
      } catch {
        // ignore
      }
    })();

    return () => controller.abort();
  }, [token]);

  useEffect(() => {
    if (!token) return;

    const url = buildSseUrl("/notifications/stream", { token });
    const es = new EventSource(url);

    const onNotification = (e: MessageEvent) => {
      try {
        const raw: unknown = JSON.parse(e.data);
        const item = mapNotification(raw);

        setNotifications((prev) => {
          const filtered = prev.filter((x) => x.id !== item.id);
          return [item, ...filtered];
        });
      } catch {
        // ignore
      }
    };

    es.addEventListener("notification", onNotification as EventListener);

    return () => {
      es.removeEventListener("notification", onNotification as EventListener);
      es.close();
    };
  }, [token]);

  const unreadCount = useMemo(() => notifications.filter((n) => !n.isRead).length, [notifications]);

  async function loginWithPassword(emailOrUsername: string, password: string) {
    const data = await apiFetch<ApiAuthResponse>("/auth/login", {
      method: "POST",
      body: { emailOrUsername, password },
    });

    if (!data.ok || !data.token || !data.user) throw new Error("Login failed.");

    setToken(data.token);
    setUser(data.user);
    setNotifications([]); 
  }

  async function register(payload: RegisterPayload) {
    const data = await apiFetch<ApiAuthResponse>("/auth/register", {
      method: "POST",
      body: payload,
    });

    if (!data.ok || !data.token || !data.user) throw new Error("Register failed.");

    setToken(data.token);
    setUser(data.user);
    setNotifications([]); 
  }

  function logout() {
    setToken(null);
    setUser(null);
    setNotifications([]);
  }

  function markAllAsRead() {
    if (token) {
      void (async () => {
        try {
          await apiFetch<{ ok: boolean }>("/notifications/read-all", {
            method: "POST",
            token,
          });
        } catch {
          // ignore
        }
      })();
    }

    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
  }

  function markAsRead(id: string) {
    if (token) {
      void (async () => {
        try {
          await apiFetch<{ ok: boolean }>(`/notifications/${encodeURIComponent(id)}/read`, {
            method: "POST",
            token,
          });
        } catch {
          // ignore
        }
      })();
    }

    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
  }

  function setCurrentUser(nextUser: User) {
    setUser(nextUser);
  }

  function pushNotification(n: Omit<NotificationItem, "id" | "createdAt" | "isRead">) {
    setNotifications((prev) => [
      {
        id: `n_${Math.random().toString(16).slice(2)}`,
        type: n.type || "system",
        title: n.title,
        message: n.message,
        payload: n.payload || null,
        createdAt: new Date().toISOString(),
        isRead: false,
      },
      ...prev,
    ]);
  }

  const value: AuthState = {
    user,
    token,
    notifications,
    unreadCount,
    loginWithPassword,
    register,
    logout,
    markAllAsRead,
    markAsRead,
    setCurrentUser,
    pushNotification,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
