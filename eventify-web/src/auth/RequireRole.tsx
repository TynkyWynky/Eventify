import { Navigate, Outlet, useLocation } from "react-router-dom";
import type { Role } from "./authTypes";
import { useAuth } from "./AuthContext";

export default function RequireRole({ allowed }: { allowed: Role[] }) {
  const { user } = useAuth();
  const location = useLocation();

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (!allowed.includes(user.role)) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
