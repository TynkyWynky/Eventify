import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { Outlet } from "react-router-dom";
import TopNavigationBar from "../components/TopNavigationBar";
import CopilotWidget from "../components/CopilotWidget";
import Footer from "../components/Footer";
import { ensureOriginOnFirstVisit } from "../data/location/locationStore";

export default function AppShellLayout() {
  const location = useLocation();

  useEffect(() => {
    ensureOriginOnFirstVisit();
  }, []);

  const isWidePage =
    location.pathname === "/account" ||
    location.pathname === "/account/settings" ||
    location.pathname === "/login" ||
    location.pathname === "/register";
  const isExtraWidePage = location.pathname === "/my-events";

  return (
    <div className="appShell">
      <TopNavigationBar />
      <main
        className={`appPage ${isWidePage ? "appPageWide" : ""} ${isExtraWidePage ? "appPageXWide" : ""}`}
      >
        <Outlet />
      </main>

      <Footer />

      {/* Global floating assistant (available on every page) */}
      <CopilotWidget />
    </div>
  );
}
