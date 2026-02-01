import { createBrowserRouter } from "react-router-dom";
import AppShellLayout from "./AppShellLayout";
import EventDashboardPage from "../pages/EventDashboardPage";
import LoginPage from "../pages/LoginPage";
import RegisterPage from "../pages/RegisterPage";

export const appRouter = createBrowserRouter([
  {
    path: "/",
    element: <AppShellLayout />,
    children: [
      { index: true, element: <EventDashboardPage /> },
      { path: "login", element: <LoginPage /> },
      { path: "register", element: <RegisterPage /> },
    ],
  },
]);
