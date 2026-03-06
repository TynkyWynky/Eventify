import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { LOCALE_META, type Locale, useI18n } from "../i18n/I18nContext";

function ExternalIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M14 5h5v5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10 14 19 5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M19 14v5H5V5h5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function Footer() {
  const { t, locale, setLocale } = useI18n();
  const { user } = useAuth();
  const year = new Date().getFullYear();
  const [openSection, setOpenSection] = useState<"explore" | "legal" | "contact" | null>(null);

  function toggleSection(section: "explore" | "legal" | "contact") {
    setOpenSection((prev) => (prev === section ? null : section));
  }

  function handleFooterLinkClick() {
    if (typeof window === "undefined") return;
    if (!window.matchMedia("(max-width: 760px)").matches) return;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <footer className="siteFooter" role="contentinfo">
      <div className="footerInner">
        <div className="footerGrid">
          <div className="footerBrand">
            <Link to="/" className="footerLogo" aria-label="Eventium home" onClick={handleFooterLinkClick}>
              Eventium
            </Link>

            <p className="footerTagline">
              {t("footer.tagline")}
            </p>

            <div className="footerMeta">
              <span className="footerMetaItem">{t("footer.location")}</span>
              <span className="footerMetaDot">•</span>
              <span className="footerMetaItem">{t("footer.studentProject")}</span>
            </div>
          </div>

          <div className="footerCol footerLangMobile" aria-label={t("footer.language")}>
            <div className="footerHeading footerHeadingDesktop">{t("footer.language")}</div>
            <div className="footerLangRow">
              {(Object.keys(LOCALE_META) as Locale[]).map((code) => (
                <button
                  key={code}
                  type="button"
                  className={`footerLangBtn ${locale === code ? "isActive" : ""}`}
                  onClick={() => setLocale(code)}
                >
                  <span className={`navLanguageFlag navLanguageFlag${code.toUpperCase()}`} aria-hidden="true" />
                  <span>{LOCALE_META[code].label}</span>
                </button>
              ))}
            </div>
          </div>

          <nav className="footerCol footerAccordionCol" aria-label={t("footer.explore")}>
            <div className="footerHeading footerHeadingDesktop">{t("footer.explore")}</div>
            <button
              type="button"
              className={`footerAccordionToggle ${openSection === "explore" ? "isOpen" : ""}`}
              onClick={() => toggleSection("explore")}
              aria-expanded={openSection === "explore"}
              aria-controls="footer-explore-links"
            >
              <span>{t("footer.explore")}</span>
              <span aria-hidden="true">{openSection === "explore" ? "−" : "+"}</span>
            </button>

            <ul
              id="footer-explore-links"
              className={`footerLinkList ${openSection === "explore" ? "isOpen" : ""}`}
            >
              <li><Link className="footerLink" to="/" onClick={handleFooterLinkClick}>{t("footer.discover")}</Link></li>
              <li><Link className="footerLink" to="/my-events" onClick={handleFooterLinkClick}>{t("footer.myEvents")}</Link></li>
              <li>
                {user ? (
                  <Link className="footerLink" to="/account" onClick={handleFooterLinkClick}>{t("footer.account")}</Link>
                ) : (
                  <div className="footerAuthStack">
                    <Link className="footerLink" to="/login" onClick={handleFooterLinkClick}>{t("footer.login")}</Link>
                    <Link className="footerLink" to="/register" onClick={handleFooterLinkClick}>{t("footer.signup")}</Link>
                  </div>
                )}
              </li>
              {user?.role === "admin" ? (
                <li><Link className="footerLink" to="/admin" onClick={handleFooterLinkClick}>{t("footer.admin")}</Link></li>
              ) : null}
            </ul>
          </nav>

          <nav className="footerCol footerAccordionCol" aria-label={t("footer.legal")}>
            <div className="footerHeading footerHeadingDesktop">{t("footer.legal")}</div>
            <button
              type="button"
              className={`footerAccordionToggle ${openSection === "legal" ? "isOpen" : ""}`}
              onClick={() => toggleSection("legal")}
              aria-expanded={openSection === "legal"}
              aria-controls="footer-legal-links"
            >
              <span>{t("footer.legal")}</span>
              <span aria-hidden="true">{openSection === "legal" ? "−" : "+"}</span>
            </button>

            <ul
              id="footer-legal-links"
              className={`footerLinkList ${openSection === "legal" ? "isOpen" : ""}`}
            >
              <li><Link className="footerLink" to="/privacy" onClick={handleFooterLinkClick}>{t("footer.privacy")}</Link></li>
              <li><Link className="footerLink" to="/terms" onClick={handleFooterLinkClick}>{t("footer.terms")}</Link></li>
              <li><Link className="footerLink" to="/cookies" onClick={handleFooterLinkClick}>{t("footer.cookies")}</Link></li>
              <li><Link className="footerLink" to="/legal" onClick={handleFooterLinkClick}>{t("footer.legalNotice")}</Link></li>
            </ul>
          </nav>

          <div className="footerCol footerAccordionCol" aria-label={t("footer.contact")}>
            <div className="footerHeading footerHeadingDesktop">{t("footer.contact")}</div>
            <button
              type="button"
              className={`footerAccordionToggle ${openSection === "contact" ? "isOpen" : ""}`}
              onClick={() => toggleSection("contact")}
              aria-expanded={openSection === "contact"}
              aria-controls="footer-contact-links"
            >
              <span>{t("footer.contact")}</span>
              <span aria-hidden="true">{openSection === "contact" ? "−" : "+"}</span>
            </button>

            <div
              id="footer-contact-links"
              className={`footerLinkList ${openSection === "contact" ? "isOpen" : ""}`}
            >
              <a className="footerLink" href="mailto:atypique.professional@gmail.com">
                atypique.professional@gmail.com
              </a>

              <a
                className="footerLink footerLinkExternal"
                href="https://www.instagram.com/atypique.enterprise/"
                target="_blank"
                rel="noreferrer"
              >
                Instagram <ExternalIcon />
              </a>
            </div>
          </div>
        </div>

        <div className="footerBottom">
          <div className="footerFineprint">
            © {year} Eventium. {t("footer.fineprint")}
          </div>

          <div className="footerTinyLinks" aria-label="Footer shortcuts">
            <Link className="footerTinyLink" to="/privacy" onClick={handleFooterLinkClick}>{t("footer.privacy")}</Link>
            <span className="footerTinyDot">•</span>
            <Link className="footerTinyLink" to="/terms" onClick={handleFooterLinkClick}>{t("footer.terms")}</Link>
            <span className="footerTinyDot">•</span>
            <Link className="footerTinyLink" to="/cookies" onClick={handleFooterLinkClick}>{t("footer.cookies")}</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
