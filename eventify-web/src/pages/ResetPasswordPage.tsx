import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiFetch } from "../auth/apiClient";
import { isStrongPassword } from "../auth/passwordRules";
import { useI18n } from "../i18n/I18nContext";

type ResetPasswordResponse = {
  ok: boolean;
  message?: string;
};

export default function ResetPasswordPage() {
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const token = (searchParams.get("token") || "").trim();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const passwordOk = useMemo(() => isStrongPassword(password), [password]);
  const confirmOk = useMemo(
    () => confirmPassword.length > 0 && confirmPassword === password,
    [confirmPassword, password]
  );

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!token) {
      setError(t("auth.resetPasswordMissingToken"));
      return;
    }
    if (!passwordOk) {
      setError(t("auth.error.passwordMin"));
      return;
    }
    if (!confirmOk) {
      setError(t("auth.error.passwordMatch"));
      return;
    }

    try {
      setLoading(true);
      const result = await apiFetch<ResetPasswordResponse>("/auth/reset-password", {
        method: "POST",
        body: { token, password },
      });
      setSuccess(result.message || t("auth.resetPasswordSuccess"));
      setPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.error.resetPasswordFailed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="authPage">
      <div className="authCard">
        <h2 className="authTitle">{t("auth.resetPasswordTitle")}</h2>
        <p className="authHint authHintTop">{t("auth.resetPasswordHint")}</p>

        {error ? <div className="authError">{error}</div> : null}
        {success ? <div className="authSuccess">{success}</div> : null}

        <form className="authForm" onSubmit={handleSubmit}>
          <label className="authLabel" htmlFor="reset-password">
            {t("auth.password")}
          </label>
          <input
            id="reset-password"
            className="authInput"
            type="password"
            placeholder={t("auth.placeholderPassword")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />

          <div className="authHint">{t("auth.passwordMin")}</div>

          <label className="authLabel" htmlFor="reset-password-confirm">
            {t("auth.confirmPassword")}
          </label>
          <input
            id="reset-password-confirm"
            className="authInput"
            type="password"
            placeholder={t("auth.placeholderPassword")}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
          />

          <button className="authPrimaryButton" type="submit" disabled={loading || !token}>
            {loading ? t("auth.resetPasswordLoading") : t("auth.resetPasswordAction")}
          </button>

          <div className="authHint">
            <Link to="/login">{t("auth.backToLogin")}</Link>
          </div>
        </form>
      </div>
    </div>
  );
}
