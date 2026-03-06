import { useEffect, useState } from "react";
import { LOCALE_META, type Locale, useI18n } from "../i18n/I18nContext";

const SEEN_KEY = "eventium_lang_modal_seen_v1";

export default function LanguageOnboardingModal() {
  const { setLocale, t } = useI18n();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      const seen = localStorage.getItem(SEEN_KEY);
      if (!seen) setOpen(true);
    } catch {
      setOpen(true);
    }
  }, []);

  if (!open) return null;

  function close() {
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {
      // ignore
    }
    setOpen(false);
  }

  return (
    <div className="langModalBackdrop" role="dialog" aria-modal="true" aria-label={t("langModal.title")}>
      <div className="langModalCard">
        <div className="langModalTitle">{t("langModal.title")}</div>
        <div className="langModalHint">{t("langModal.hint")}</div>

        <div className="langModalGrid">
          {(Object.keys(LOCALE_META) as Locale[]).map((code) => (
            <button
              key={code}
              type="button"
              className="langModalBtn"
              onClick={() => {
                setLocale(code);
                close();
              }}
            >
              <span className={`navLanguageFlag navLanguageFlag${code.toUpperCase()}`} aria-hidden="true" />
              <span>{LOCALE_META[code].label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

