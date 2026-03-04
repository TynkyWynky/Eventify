import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { appRouter } from "../layout/AppRouter";
import { AuthProvider } from "../auth/AuthContext";
import { NotificationProvider } from "../components/NotificationProvider";
import AppLoadingScreen from "../components/AppLoadingScreen";
import "leaflet/dist/leaflet.css";
import "../styles/ui.css";

async function clearEventifyCaches() {
  if (!("caches" in window)) return;
  try {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.toLowerCase().startsWith("eventify-"))
        .map((key) => caches.delete(key))
    );
  } catch {
    // Ignore cache cleanup issues in unsupported/private contexts.
  }
}

if ("serviceWorker" in navigator) {
  const swEnabled = import.meta.env.PROD && String(import.meta.env.VITE_ENABLE_SW || "").toLowerCase() === "true";

  if (!swEnabled) {
    navigator.serviceWorker
      .getRegistrations()
      .then(async (registrations) => {
        await Promise.all(registrations.map((registration) => registration.unregister()));
        await clearEventifyCaches();
      })
      .catch(() => {});
  } else {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch((err: unknown) => {
        console.warn(
          "Service worker registration failed:",
          err instanceof Error ? err.message : String(err)
        );
      });
    });
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <NotificationProvider>
      <AuthProvider>
        <Suspense fallback={<AppLoadingScreen />}>
          <RouterProvider router={appRouter} />
        </Suspense>
      </AuthProvider>
    </NotificationProvider>
  </StrictMode>
);
