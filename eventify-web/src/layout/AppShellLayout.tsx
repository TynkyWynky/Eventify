import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import TopNavigationBar from "../components/TopNavigationBar";
import CopilotWidget from "../components/CopilotWidget";
import { ensureOriginOnFirstVisit } from "../data/location/locationStore";

export default function AppShellLayout() {
  useEffect(() => {
    ensureOriginOnFirstVisit();
  }, []);

  return (
    <div className="appShell">
      <TopNavigationBar />
      <main className="appPage">
        <Outlet />
      </main>

      {/* Global floating assistant (available on every page) */}
      <CopilotWidget />
    </div>
  );
}