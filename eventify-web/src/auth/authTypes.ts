export type Role = "user" | "organizer" | "admin";

export type User = {
  id: string;
  name: string;
  email: string;
  role: Role;
};

export type RegisterPayload = {
  name: string;
  email: string;
  password: string;
};

export type NotificationItem = {
  id: string;
  type?: string;
  title: string;
  message: string;
  payload?: Record<string, unknown> | null;
  createdAt: string;
  isRead: boolean;
};

export type AuthState = {
  user: User | null;
  token: string | null;
  notifications: NotificationItem[];
  unreadCount: number;

  loginWithPassword: (emailOrUsername: string, password: string) => Promise<void>;
  register: (payload: RegisterPayload) => Promise<void>;
  logout: () => void;

  markAllAsRead: () => void;
  markAsRead: (id: string) => void;
  setCurrentUser: (nextUser: User) => void;

  pushNotification: (
    n: Omit<NotificationItem, "id" | "createdAt" | "isRead">
  ) => void;
};
