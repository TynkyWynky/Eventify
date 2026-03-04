import { lazy, type ComponentType } from "react";
import { createBrowserRouter } from "react-router-dom";

import AppShellLayout from "./AppShellLayout";
import RequireAuth from "../auth/RequireAuth";
import RequireRole from "../auth/RequireRole";

import EventDashboardPage from "../pages/EventDashboardPage";

const CHUNK_RELOAD_KEY = "eventify_chunk_reload_once_v1";

function isChunkLoadError(error: unknown) {
  const text = String(error || "").toLowerCase();
  return (
    text.includes("failed to fetch dynamically imported module") ||
    text.includes("error loading dynamically imported module") ||
    text.includes("chunkloaderror")
  );
}

function lazyWithRetry(importer: () => Promise<{ default: ComponentType }>) {
  return lazy(async () => {
    try {
      const loaded = await importer();
      sessionStorage.removeItem(CHUNK_RELOAD_KEY);
      return loaded;
    } catch (error) {
      if (isChunkLoadError(error)) {
        const hasReloaded = sessionStorage.getItem(CHUNK_RELOAD_KEY) === "1";
        if (!hasReloaded) {
          sessionStorage.setItem(CHUNK_RELOAD_KEY, "1");
          window.location.reload();
          return new Promise(() => {});
        }
      }
      throw error;
    }
  });
}

const EventDetailPage = lazyWithRetry(() => import("../pages/EventDetailPage"));
const LoginPage = lazyWithRetry(() => import("../pages/LoginPage"));
const RegisterPage = lazyWithRetry(() => import("../pages/RegisterPage"));
const AccountPage = lazyWithRetry(() => import("../pages/AccountPage"));
const AccountSettingsPage = lazyWithRetry(() => import("../pages/AccountSettingsPage"));
const MyEventsPage = lazyWithRetry(() => import("../pages/MyEventsPage"));
const AdminDashboard = lazyWithRetry(() => import("../pages/AdminDashboard"));
const PrivacyPage = lazyWithRetry(() => import("../pages/PrivacyPage"));
const TermsPage = lazyWithRetry(() => import("../pages/TermsPage"));
const CookiesPage = lazyWithRetry(() => import("../pages/CookiesPage"));
const LegalNoticePage = lazyWithRetry(() => import("../pages/LegalNoticePage"));

export const appRouter = createBrowserRouter([
  {
    path: "/",
    element: <AppShellLayout />,
    children: [
      { index: true, element: <EventDashboardPage /> },
      { path: "events/:eventId", element: <EventDetailPage /> },

      { path: "login", element: <LoginPage /> },
      { path: "register", element: <RegisterPage /> },

      // ✅ allow everyone (page handles auth + organizer/user UI)
      { path: "my-events", element: <MyEventsPage /> },
      { path: "privacy", element: <PrivacyPage /> },
      { path: "terms", element: <TermsPage /> },
      { path: "cookies", element: <CookiesPage /> },
      { path: "legal", element: <LegalNoticePage /> },

      {
        element: <RequireAuth />,
        children: [
          { path: "account", element: <AccountPage /> },
          { path: "account/settings", element: <AccountSettingsPage /> },
        ],
      },

      {
        element: <RequireRole allowed={["admin"]} />,
        children: [{ path: "admin", element: <AdminDashboard /> }],
      },
    ],
  },
]);
