import { useMemo, useState } from "react";

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function CheckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M9.0 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"
      />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7 2.9 18.3 9.2 12 2.9 5.7 4.3 4.3l6.3 6.3 6.3-6.3z"
      />
    </svg>
  );
}

function ValidationIcon({
  show,
  valid,
}: {
  show: boolean;
  valid: boolean;
}) {
  if (!show) return null;
  return (
    <span
      className={`inputStatus ${valid ? "inputStatusOk" : "inputStatusBad"}`}
      title={valid ? "Looks good" : "Not valid yet"}
    >
      {valid ? <CheckIcon /> : <CrossIcon />}
    </span>
  );
}

export default function RegisterPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [error, setError] = useState<string | null>(null);

  const emailOk = useMemo(() => isValidEmail(email), [email]);
  const passwordOk = useMemo(() => password.length >= 8, [password]);
  const confirmOk = useMemo(
    () => confirmPassword.length > 0 && confirmPassword === password,
    [confirmPassword, password]
  );

  const showEmailStatus = email.trim().length > 0;
  const showPasswordStatus = password.length > 0;
  const showConfirmStatus = confirmPassword.length > 0;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!emailOk) {
      setError("Please enter a valid email.");
      return;
    }

    if (!passwordOk) {
      setError("Password must be at least 8 characters.");
      return;
    }

    if (!confirmOk) {
      setError("Passwords do not match.");
      return;
    }

    console.log("REGISTER OK", { name, email, password });
  }

  return (
    <div className="authPage">
      <div className="authCard">
        <h2 className="authTitle">Register</h2>

        {error && (
          <div className="authError">
            {error}
          </div>
        )}

        <form className="authForm" onSubmit={handleSubmit}>
          <label className="authLabel" htmlFor="register-name">
            Name
          </label>
          <div className="inputWithStatus">
            <input
              id="register-name"
              className="authInput"
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
            />
          </div>

          <label className="authLabel" htmlFor="register-email">
            Email
          </label>
          <div className="inputWithStatus">
            <input
              id="register-email"
              className="authInput"
              placeholder="you@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              aria-invalid={showEmailStatus && !emailOk}
            />
            <ValidationIcon show={showEmailStatus} valid={emailOk} />
          </div>

          <label className="authLabel" htmlFor="register-password">
            Password
          </label>
          <div className="inputWithStatus">
            <input
              id="register-password"
              className="authInput"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              aria-invalid={showPasswordStatus && !passwordOk}
            />
            <ValidationIcon show={showPasswordStatus} valid={passwordOk} />
          </div>

          <div className="authHint">
            Password must be at least 8 characters.
          </div>

          <label className="authLabel" htmlFor="register-confirm-password">
            Confirm password
          </label>
          <div className="inputWithStatus">
            <input
              id="register-confirm-password"
              className="authInput"
              type="password"
              placeholder="••••••••"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              aria-invalid={showConfirmStatus && !confirmOk}
            />
            <ValidationIcon show={showConfirmStatus} valid={confirmOk} />
          </div>

          <button className="authPrimaryButton" type="submit">
            Create account
          </button>
        </form>
      </div>
    </div>
  );
}
