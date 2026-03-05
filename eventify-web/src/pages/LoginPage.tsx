import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useI18n } from "../i18n/I18nContext";

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export default function LoginPage() {
  const { t } = useI18n();
  const { loginWithPassword } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const from = (location.state as { from?: string } | null)?.from ?? "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!isValidEmail(email)) {
      setError(t("auth.error.validEmail"));
      return;
    }
    if (!password) {
      setError(t("auth.error.passwordRequired"));
      return;
    }

    try {
      setLoading(true);
      await loginWithPassword(email, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.error.loginFailed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="authPage">
      <div className="authCard">
        <h2 className="authTitle">{t("auth.login")}</h2>

        {error && <div className="authError">{error}</div>}

        <form className="authForm" onSubmit={handleSubmit}>
          <label className="authLabel" htmlFor="login-email">
            {t("auth.email")}
          </label>
          <input
            id="login-email"
            className="authInput"
            placeholder={t("auth.placeholderEmail")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />

          <label className="authLabel" htmlFor="login-password">
            {t("auth.password")}
          </label>
          <input
            id="login-password"
            className="authInput"
            type="password"
            placeholder={t("auth.placeholderPassword")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />

          <button className="authPrimaryButton" type="submit" disabled={loading}>
            {loading ? t("auth.loginLoading") : t("auth.loginAction")}
          </button>

          <div className="authHint">
            {t("auth.noAccount")} <Link to="/register">{t("auth.createOne")}</Link>
          </div>
        </form>
      </div>
    </div>
  );
}
