import { useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../auth/apiClient";
import { useI18n } from "../i18n/I18nContext";

type ForgotPasswordResponse = {
  ok: boolean;
  message?: string;
  resetUrl?: string | null;
};

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export default function ForgotPasswordPage() {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [debugResetUrl, setDebugResetUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setDebugResetUrl(null);

    if (!isValidEmail(email)) {
      setError(t("auth.error.validEmail"));
      return;
    }

    try {
      setLoading(true);
      const result = await apiFetch<ForgotPasswordResponse>("/auth/forgot-password", {
        method: "POST",
        body: { email: email.trim().toLowerCase() },
      });
      setSuccess(result.message || t("auth.forgotPasswordSuccess"));
      setDebugResetUrl(typeof result.resetUrl === "string" ? result.resetUrl : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.error.resetRequestFailed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="authPage">
      <div className="authCard">
        <h2 className="authTitle">{t("auth.forgotPasswordTitle")}</h2>
        <p className="authHint authHintTop">{t("auth.forgotPasswordHint")}</p>

        {error ? <div className="authError">{error}</div> : null}
        {success ? <div className="authSuccess">{success}</div> : null}

        <form className="authForm" onSubmit={handleSubmit}>
          <label className="authLabel" htmlFor="forgot-password-email">
            {t("auth.email")}
          </label>
          <input
            id="forgot-password-email"
            className="authInput"
            placeholder={t("auth.placeholderEmail")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />

          <button className="authPrimaryButton" type="submit" disabled={loading}>
            {loading ? t("auth.forgotPasswordLoading") : t("auth.forgotPasswordAction")}
          </button>

          {debugResetUrl ? (
            <div className="authHint">
              {t("auth.resetDebugLabel")} <a href={debugResetUrl}>{debugResetUrl}</a>
            </div>
          ) : null}

          <div className="authHint">
            <Link to="/login">{t("auth.backToLogin")}</Link>
          </div>
        </form>
      </div>
    </div>
  );
}
