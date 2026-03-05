import { useI18n } from "../i18n/I18nContext";

export default function HeroBanner() {
  const { t } = useI18n();
  return (
    <section className="heroBanner">
      <div
        className="heroImage"
        style={{
          backgroundImage:
            "url(https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=1800&q=80)",
        }}
      />
      <div className="heroShade" />

      <div className="heroContent">
        <h1 className="heroTitle">{t("hero.title")}</h1>
        <p className="heroSubtitle">
          {t("hero.subtitle")}
        </p>
      </div>
    </section>
  );
}
