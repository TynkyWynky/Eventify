import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { appRouter } from "../layout/AppRouter";
import { AuthProvider } from "../auth/AuthContext";
import { NotificationProvider } from "../components/NotificationProvider";
import "leaflet/dist/leaflet.css";
import "../styles/ui.css";

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err: unknown) => {
      console.warn(
        "Service worker registration failed:",
        err instanceof Error ? err.message : String(err)
      );
    });
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <NotificationProvider>
      <AuthProvider>
        <Suspense
          fallback={
            <div className="appPage" style={{ paddingTop: 24 }}>
              <div className="sectionHint">Loading page…</div>
            </div>
          }
        >
          <RouterProvider router={appRouter} />
        </Suspense>
      </AuthProvider>
    </NotificationProvider>
  </StrictMode>
);
