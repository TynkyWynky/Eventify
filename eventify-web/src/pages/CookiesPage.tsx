import { useI18n } from "../i18n/I18nContext";

export default function CookiesPage() {
  const { t } = useI18n();
  return (
    <div className="legalWrap">
      <header className="legalHeader">
        <h1 className="legalTitle">{t("legal.cookies.title")}</h1>
        <p className="legalLead">{t("legal.cookies.lead")}</p>
      </header>

      <div className="legalCard">
        <h2>1) What we use</h2>
        <ul className="legalList">
          <li><b>Essential storage</b>: session token, basic UI state (e.g. selected origin).</li>
          <li><b>Preferences</b>: favorites and vibe-chat history (per user) for a smoother experience.</li>
        </ul>

        <h2>2) Analytics / marketing cookies</h2>
        <p>
          By default, we don’t set marketing cookies.
        </p>

        <h2>3) How to manage</h2>
        <p>
          You can clear cookies/local storage in your browser settings. This may log you out and reset saved preferences.
        </p>
      </div>
    </div>
  );
}
