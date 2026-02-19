import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import TopNavigationBar from "../components/TopNavigationBar";
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
    </div>
  );
}
