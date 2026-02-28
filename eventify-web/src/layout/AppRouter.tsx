import { lazy } from "react";
import { createBrowserRouter } from "react-router-dom";

import AppShellLayout from "./AppShellLayout";
import RequireAuth from "../auth/RequireAuth";
import RequireRole from "../auth/RequireRole";

import EventDashboardPage from "../pages/EventDashboardPage";

const EventDetailPage = lazy(() => import("../pages/EventDetailPage"));
const LoginPage = lazy(() => import("../pages/LoginPage"));
const RegisterPage = lazy(() => import("../pages/RegisterPage"));
const AccountPage = lazy(() => import("../pages/AccountPage"));
const AccountSettingsPage = lazy(() => import("../pages/AccountSettingsPage"));
const MyEventsPage = lazy(() => import("../pages/MyEventsPage"));
const AdminDashboard = lazy(() => import("../pages/AdminDashboard"));
const PrivacyPage = lazy(() => import("../pages/PrivacyPage"));
const TermsPage = lazy(() => import("../pages/TermsPage"));
const CookiesPage = lazy(() => import("../pages/CookiesPage"));
const LegalNoticePage = lazy(() => import("../pages/LegalNoticePage"));

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
