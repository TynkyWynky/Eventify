/* eslint-disable react-refresh/only-export-components */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type {
  AuthState,
  NotificationItem,
  RegisterPayload,
  Role,
  User,
} from "./authTypes";

/* =========================
   Storage
   ========================= */
const AUTH_STORAGE_KEY = "eventify_auth_v1";
const USERS_STORAGE_KEY = "eventify_users_v1";

type StoredUser = {
  id: string;
  name: string;
  email: string; // normalized (lowercase)
  password: string; // ⚠ demo-only: plain text in localStorage
  role: Role;
  createdAt: string; // ISO
};

type JsonRecord = Record<string, unknown>;

function isRecord(v: unknown): v is JsonRecord {
  return typeof v === "object" && v !== null;
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function normalizeRole(role: unknown): Role {
  if (role === "admin" || role === "organizer" || role === "user") return role;
  return "user";
}

function uid(prefix: string) {
  const c: Crypto | undefined = globalThis.crypto;
  // si randomUUID est dispo, on l’utilise (sinon fallback)
  if (c && typeof c.randomUUID === "function") return `${prefix}_${c.randomUUID()}`;
  return `${prefix}_${Math.random().toString(16).slice(2)}`;
}

function loadUsers(): StoredUser[] {
  try {
    const raw = localStorage.getItem(USERS_STORAGE_KEY);
    if (!raw) return [];

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const users: StoredUser[] = [];

    for (const item of parsed) {
      if (!isRecord(item)) continue;

      const id = str(item.id, uid("u"));
      const name = str(item.name, "User");
      const email = normalizeEmail(str(item.email, ""));
      const password = str(item.password, "");
      const role = normalizeRole(item.role);
      const createdAt = str(item.createdAt, new Date().toISOString());

      if (!email) continue; // skip invalid entries

      users.push({ id, name, email, password, role, createdAt });
    }

    return users;
  } catch {
    return [];
  }
}

function saveUsers(users: StoredUser[]) {
  localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(users));
}

function ensureSeedUsers() {
  // Important: always ensure these 3 demo accounts exist (for testing/presentations)
  const users = loadUsers();
  const emails = new Set(users.map((u) => u.email));
  const now = new Date().toISOString();

  const seedWanted: StoredUser[] = [
    {
      id: uid("u"),
      name: "Demo User",
      email: "demo@eventify.local",
      password: "password123",
      role: "user",
      createdAt: now,
    },
    {
      id: uid("u"),
      name: "Demo Organizer",
      email: "orga@eventify.local",
      password: "password123",
      role: "organizer",
      createdAt: now,
    },
    {
      id: uid("u"),
      name: "Demo Admin",
      email: "admin@eventify.local",
      password: "password123",
      role: "admin",
      createdAt: now,
    },
  ];

  const toAdd = seedWanted.filter((u) => !emails.has(u.email));
  if (toAdd.length === 0) return;

  saveUsers([...toAdd, ...users]);
}


function buildMockNotifications(): NotificationItem[] {
  const now = new Date();
  const iso = (d: Date) => d.toISOString();

  return [
    {
      id: "n1",
      title: "New friend request",
      message: "Alex wants to add you.",
      createdAt: iso(new Date(now.getTime() - 1000 * 60 * 12)),
      isRead: false,
    },
    {
      id: "n2",
      title: "Your friend is going",
      message: "Maya is going to 'Live Session'.",
      createdAt: iso(new Date(now.getTime() - 1000 * 60 * 60 * 2)),
      isRead: false,
    },
    {
      id: "n3",
      title: "Event reminder",
      message: "Don't forget 'Crowd Night' tonight.",
      createdAt: iso(new Date(now.getTime() - 1000 * 60 * 60 * 24)),
      isRead: true,
    },
  ];
}

function loadInitial(): { user: User | null; notifications: NotificationItem[] } {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return { user: null, notifications: buildMockNotifications() };

    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return { user: null, notifications: buildMockNotifications() };
    }

    const rawUser = parsed.user;
    const rawNotifs = parsed.notifications;

    let user: User | null = null;
    if (isRecord(rawUser)) {
      user = {
        id: str(rawUser.id, uid("u")),
        name: str(rawUser.name, "Me"),
        email: normalizeEmail(str(rawUser.email, "")),
        role: normalizeRole(rawUser.role),
      };
      if (!user.email) user = null;
    }

    const notifications = Array.isArray(rawNotifs)
      ? (rawNotifs as NotificationItem[])
      : buildMockNotifications();

    return { user, notifications };
  } catch {
    return { user: null, notifications: buildMockNotifications() };
  }
}

/* =========================
   Context
   ========================= */
const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const initial = useMemo(() => loadInitial(), []);

  const [user, setUser] = useState<User | null>(initial.user);
  const [notifications, setNotifications] = useState<NotificationItem[]>(
    initial.notifications
  );

  // Seed demo users once
  useEffect(() => {
    ensureSeedUsers();
  }, []);

  // Persist auth state
  useEffect(() => {
    localStorage.setItem(
      AUTH_STORAGE_KEY,
      JSON.stringify({ user, notifications })
    );
  }, [user, notifications]);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.isRead).length,
    [notifications]
  );

  /** Dev helper: quick login (no password check) */
  function login(email: string, name?: string) {
    const emailNorm = normalizeEmail(email);

    // if user exists, keep role
    const users = loadUsers();
    const found = users.find((u) => u.email === emailNorm);

    const nextUser: User = found
      ? { id: found.id, name: found.name, email: found.email, role: found.role }
      : {
          id: uid("u"),
          name: name?.trim() || "Me",
          email: emailNorm,
          role: "user",
        };

    setUser(nextUser);
    setNotifications(buildMockNotifications());
  }

  /** Local login: checks localStorage users */
  function loginWithPassword(email: string, password: string) {
    const emailNorm = normalizeEmail(email);
    const users = loadUsers();
    const found = users.find((u) => u.email === emailNorm);

    if (!found || found.password !== password) {
      throw new Error("Invalid email or password.");
    }

    setUser({
      id: found.id,
      name: found.name,
      email: found.email,
      role: found.role,
    });
    setNotifications(buildMockNotifications());
  }

 function register(payload: RegisterPayload) {
  const name = payload.name.trim() || "Me";
  const emailNorm = normalizeEmail(payload.email);

  if (!emailNorm) throw new Error("Email is required.");
  if (payload.password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }

  const users = loadUsers();
  const exists = users.some((u) => u.email === emailNorm);
  if (exists) throw new Error("An account with this email already exists.");

  const created: StoredUser = {
    id: uid("u"),
    name,
    email: emailNorm,
    password: payload.password,
    role: "user", // ✅ forced
    createdAt: new Date().toISOString(),
  };

  saveUsers([created, ...users]);

  setUser({
    id: created.id,
    name: created.name,
    email: created.email,
    role: created.role,
  });
  setNotifications(buildMockNotifications());
}


  function logout() {
    setUser(null);
    setNotifications(buildMockNotifications());
  }

  function markAllAsRead() {
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
  }

  function markAsRead(id: string) {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, isRead: true } : n))
    );
  }

  function pushNotification(
    n: Omit<NotificationItem, "id" | "createdAt" | "isRead">
  ) {
    setNotifications((prev) => [
      {
        id: `n_${Math.random().toString(16).slice(2)}`,
        title: n.title,
        message: n.message,
        createdAt: new Date().toISOString(),
        isRead: false,
      },
      ...prev,
    ]);
  }

  const value: AuthState = {
    user,
    notifications,
    unreadCount,
    login,
    loginWithPassword,
    register,
    logout,
    markAllAsRead,
    markAsRead,
    pushNotification,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
