import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

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
              Hyper-local event discovery for your next night out — fast filters,
              social proof, and smart recommendations.
            </p>

            <div className="footerMeta">
              <span className="footerMetaItem">Brussels • Belgium</span>
              <span className="footerMetaDot">•</span>
              <span className="footerMetaItem">Student project</span>
            </div>
          </div>

          <nav className="footerCol footerAccordionCol" aria-label="Explore">
            <div className="footerHeading footerHeadingDesktop">Explore</div>
            <button
              type="button"
              className={`footerAccordionToggle ${openSection === "explore" ? "isOpen" : ""}`}
              onClick={() => toggleSection("explore")}
              aria-expanded={openSection === "explore"}
              aria-controls="footer-explore-links"
            >
              <span>Explore</span>
              <span aria-hidden="true">{openSection === "explore" ? "−" : "+"}</span>
            </button>

            <ul
              id="footer-explore-links"
              className={`footerLinkList ${openSection === "explore" ? "isOpen" : ""}`}
            >
              <li><Link className="footerLink" to="/" onClick={handleFooterLinkClick}>Discover</Link></li>
              <li><Link className="footerLink" to="/my-events" onClick={handleFooterLinkClick}>My events</Link></li>
              <li>
                {user ? (
                  <Link className="footerLink" to="/account" onClick={handleFooterLinkClick}>Account</Link>
                ) : (
                  <div className="footerAuthStack">
                    <Link className="footerLink" to="/login" onClick={handleFooterLinkClick}>Login</Link>
                    <Link className="footerLink" to="/register" onClick={handleFooterLinkClick}>Sign up</Link>
                  </div>
                )}
              </li>
              {user?.role === "admin" ? (
                <li><Link className="footerLink" to="/admin" onClick={handleFooterLinkClick}>Admin</Link></li>
              ) : null}
            </ul>
          </nav>

          <nav className="footerCol footerAccordionCol" aria-label="Legal">
            <div className="footerHeading footerHeadingDesktop">Legal</div>
            <button
              type="button"
              className={`footerAccordionToggle ${openSection === "legal" ? "isOpen" : ""}`}
              onClick={() => toggleSection("legal")}
              aria-expanded={openSection === "legal"}
              aria-controls="footer-legal-links"
            >
              <span>Legal</span>
              <span aria-hidden="true">{openSection === "legal" ? "−" : "+"}</span>
            </button>

            <ul
              id="footer-legal-links"
              className={`footerLinkList ${openSection === "legal" ? "isOpen" : ""}`}
            >
              <li><Link className="footerLink" to="/privacy" onClick={handleFooterLinkClick}>Privacy (GDPR)</Link></li>
              <li><Link className="footerLink" to="/terms" onClick={handleFooterLinkClick}>Terms</Link></li>
              <li><Link className="footerLink" to="/cookies" onClick={handleFooterLinkClick}>Cookies</Link></li>
              <li><Link className="footerLink" to="/legal" onClick={handleFooterLinkClick}>Legal notice</Link></li>
            </ul>
          </nav>

          <div className="footerCol footerAccordionCol" aria-label="Contact">
            <div className="footerHeading footerHeadingDesktop">Contact</div>
            <button
              type="button"
              className={`footerAccordionToggle ${openSection === "contact" ? "isOpen" : ""}`}
              onClick={() => toggleSection("contact")}
              aria-expanded={openSection === "contact"}
              aria-controls="footer-contact-links"
            >
              <span>Contact</span>
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
            © {year} Eventium. Event data and images may come from public sources
            and remain the property of their respective owners. If you want an
            event or image removed/updated, contact us.
          </div>

          <div className="footerTinyLinks" aria-label="Footer shortcuts">
            <Link className="footerTinyLink" to="/privacy" onClick={handleFooterLinkClick}>Privacy</Link>
            <span className="footerTinyDot">•</span>
            <Link className="footerTinyLink" to="/terms" onClick={handleFooterLinkClick}>Terms</Link>
            <span className="footerTinyDot">•</span>
            <Link className="footerTinyLink" to="/cookies" onClick={handleFooterLinkClick}>Cookies</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
