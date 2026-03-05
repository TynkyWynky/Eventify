import { useI18n } from "../i18n/I18nContext";

export default function AppLoadingScreen() {
  const { t } = useI18n();
  return (
    <div className="appLoadingScreen" role="status" aria-live="polite" aria-label={t("loading.aria")}>
      <div className="appLoadingAura" />
      <div className="appLoadingCard">
        <div className="appLoadingBrand">Eventium</div>
        <div className="appLoadingTitle">{t("loading.title")}</div>
        <div className="appLoadingHint">{t("loading.hint")}</div>
        <div className="appLoadingBar" aria-hidden="true">
          <span className="appLoadingBarFill" />
        </div>
      </div>
    </div>
  );
}
