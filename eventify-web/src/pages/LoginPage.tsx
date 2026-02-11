import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export default function LoginPage() {
  const { loginWithPassword } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const from = (location.state as { from?: string } | null)?.from ?? "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!isValidEmail(email)) {
      setError("Please enter a valid email.");
      return;
    }
    if (!password) {
      setError("Please enter your password.");
      return;
    }

    try {
      loginWithPassword(email, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    }
  }

  return (
    <div className="authPage">
      <div className="authCard">
        <h2 className="authTitle">Login</h2>

        {error && <div className="authError">{error}</div>}

        <form className="authForm" onSubmit={handleSubmit}>
          <label className="authLabel" htmlFor="login-email">
            Email
          </label>
          <input
            id="login-email"
            className="authInput"
            placeholder="you@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />

          <label className="authLabel" htmlFor="login-password">
            Password
          </label>
          <input
            id="login-password"
            className="authInput"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />

          <button className="authPrimaryButton" type="submit">
            Login
          </button>

          <div className="authHint">
            No account yet? <Link to="/register">Create one</Link>
          </div>
        </form>
      </div>
    </div>
  );
}
