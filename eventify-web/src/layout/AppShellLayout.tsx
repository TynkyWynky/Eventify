import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import TopNavigationBar from "../components/TopNavigationBar";
import CopilotWidget from "../components/CopilotWidget";
import Footer from "../components/Footer";
import LanguageOnboardingModal from "../components/LanguageOnboardingModal";
import RouteSeo from "../components/RouteSeo";
import { ensureOriginOnFirstVisit } from "../data/location/locationStore";

export default function AppShellLayout() {
  useEffect(() => {
    ensureOriginOnFirstVisit();
  }, []);

  return (
    <div className="appShell">
      <RouteSeo />
      <TopNavigationBar />
      <main className="appPage">
        <Outlet />
      </main>

      <Footer />
      <LanguageOnboardingModal />

      {/* Global floating assistant (available on every page) */}
      <CopilotWidget />
    </div>
  );
}
