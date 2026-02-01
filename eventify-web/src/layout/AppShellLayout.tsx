import { Outlet } from "react-router-dom";
import TopNavigationBar from "../components/TopNavigationBar";

export default function AppShellLayout() {
  return (
    <div className="appShell">
      <TopNavigationBar />
      <main className="appPage">
        <Outlet />
      </main>
    </div>
  );
}
