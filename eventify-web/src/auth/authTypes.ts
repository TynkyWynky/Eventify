export type Role = "user" | "organizer" | "admin";

export type User = {
  id: string;
  name: string;
  email: string;
  role: Role; // ✅ nouveau
};

export type NotificationItem = {
  id: string;
  title: string;
  message: string;
  createdAt: string; // ISO
  isRead: boolean;
};

export type RegisterPayload = {
  name: string;
  email: string;
  password: string;

  /**
   * Optionnel pour DEV (ex: créer direct un organizer/admin en local).
   * En prod, ce sera décidé côté backend/admin.
   */
  role?: Role;
};

export type AuthState = {
  user: User | null;
  notifications: NotificationItem[];
  unreadCount: number;

  /** Dev helper: sets a session user without checking password. */
  login: (email: string, name?: string) => void;

  /** Local (no DB): validate email + password against localStorage users. */
  loginWithPassword: (email: string, password: string) => void;

  /** Local (no DB): create user in localStorage then log them in. */
  register: (payload: RegisterPayload) => void;

  logout: () => void;

  markAllAsRead: () => void;
  markAsRead: (id: string) => void;

  pushNotification: (
    n: Omit<NotificationItem, "id" | "createdAt" | "isRead">
  ) => void;
};
