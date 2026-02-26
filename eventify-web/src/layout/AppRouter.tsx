import { createBrowserRouter } from "react-router-dom";

import AppShellLayout from "./AppShellLayout";
import RequireAuth from "../auth/RequireAuth";
import RequireRole from "../auth/RequireRole";

import EventDashboardPage from "../pages/EventDashboardPage";
import EventDetailPage from "../pages/EventDetailPage";
import LoginPage from "../pages/LoginPage";
import RegisterPage from "../pages/RegisterPage";

import AccountPage from "../pages/AccountPage";
import AccountSettingsPage from "../pages/AccountSettingsPage";
import MyEventsPage from "../pages/MyEventsPage";

import AdminDashboard from "../pages/AdminDashboard";

import PrivacyPage from "../pages/PrivacyPage";
import TermsPage from "../pages/TermsPage";
import CookiesPage from "../pages/CookiesPage";
import LegalNoticePage from "../pages/LegalNoticePage";

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