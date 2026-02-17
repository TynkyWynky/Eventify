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
  title: string;
  message: string;
  createdAt: string; 
  isRead: boolean;
};

export type AuthState = {
  user: User | null;
  notifications: NotificationItem[];
  unreadCount: number;

  login: (email: string, name?: string) => void;
  loginWithPassword: (email: string, password: string) => void;
  register: (payload: RegisterPayload) => void;
  logout: () => void;

  markAllAsRead: () => void;
  markAsRead: (id: string) => void;

  pushNotification: (
    n: Omit<NotificationItem, "id" | "createdAt" | "isRead">
  ) => void;
};
