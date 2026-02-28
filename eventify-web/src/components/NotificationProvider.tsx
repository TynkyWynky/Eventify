/* eslint-disable react-refresh/only-export-components */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type NotificationTone = "success" | "error" | "info";

type NotificationItem = {
  id: string;
  message: string;
  tone: NotificationTone;
};

type NotificationApi = {
  notify: (message: string, tone?: NotificationTone) => void;
};

const NotificationContext = createContext<NotificationApi | undefined>(undefined);

function makeNotificationId() {
  return `notification_${Math.random().toString(16).slice(2)}`;
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<NotificationItem[]>([]);

  const notify = useCallback((message: string, tone: NotificationTone = "info") => {
    const id = makeNotificationId();
    setItems((prev) => [...prev, { id, message, tone }]);

    window.setTimeout(() => {
      setItems((prev) => prev.filter((x) => x.id !== id));
    }, 3200);
  }, []);

  const removeNotification = useCallback((id: string) => {
    setItems((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const value = useMemo<NotificationApi>(() => ({ notify }), [notify]);

  return (
    <NotificationContext.Provider value={value}>
      {children}
      <div className="notificationViewport" aria-live="polite" aria-atomic="true">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`notificationItem notification${item.tone[0].toUpperCase()}${item.tone.slice(1)}`}
            onClick={() => removeNotification(item.id)}
            title="Dismiss"
          >
            {item.message}
          </button>
        ))}
      </div>
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error("useNotifications must be used inside <NotificationProvider>");
  return ctx;
}
