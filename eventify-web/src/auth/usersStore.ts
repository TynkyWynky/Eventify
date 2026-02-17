import type { Role } from "./authTypes";

export type StoredUser = {
  id: string;
  name: string;
  email: string; 
  password: string; 
  createdAt: string;
  role: Role;
};

const USERS_STORAGE_KEY = "eventify_users_v1";
const USERS_CHANGED_EVENT = "eventify_users_changed";

function readUsers(): StoredUser[] {
  const raw = localStorage.getItem(USERS_STORAGE_KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as StoredUser[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeUsers(users: StoredUser[]) {
  localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(users));
  window.dispatchEvent(new Event(USERS_CHANGED_EVENT));
}

export function listUsers(): Array<Omit<StoredUser, "password">> {
  return readUsers().map((u) => {
    const { password, ...rest } = u;
    void password; // prevent eslint unused-var
    return rest;
  });
}

export function getUserById(id: string): StoredUser | null {
  return readUsers().find((u) => u.id === id) ?? null;
}

export function setUserRole(userId: string, role: Role) {
  const users = readUsers();
  const idx = users.findIndex((u) => u.id === userId);
  if (idx < 0) return;
  users[idx] = { ...users[idx], role };
  writeUsers(users);
}

export function subscribeUsersChanged(cb: () => void) {
  const handler = () => cb();
  window.addEventListener(USERS_CHANGED_EVENT, handler);
  return () => window.removeEventListener(USERS_CHANGED_EVENT, handler);
}
