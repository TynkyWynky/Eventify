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

  return (
    <footer className="siteFooter" role="contentinfo">
      <div className="footerInner">
        <div className="footerGrid">
          <div className="footerBrand">
            <Link to="/" className="footerLogo" aria-label="Eventify home">
              Eventify
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

          <nav className="footerCol" aria-label="Explore">
            <div className="footerHeading">Explore</div>
            <li><Link className="footerLink" to="/">Discover</Link></li>
            <li><Link className="footerLink" to="/my-events">My events</Link></li>
            <li>{user ? (
              <Link className="footerLink" to="/account">Account</Link>
            ) : (
              <>
                <Link className="footerLink" to="/login">Login</Link>
                <Link className="footerLink" to="/register">Sign up</Link>
              </>
            )}</li>
            {user?.role === "admin" ? (
              <li> <Link className="footerLink" to="/admin">Admin</Link> </li>
            ) : null}             
          </nav>

          <nav className="footerCol" aria-label="Legal">
            <div className="footerHeading">Legal</div>
            <li><Link className="footerLink" to="/privacy">Privacy (GDPR)</Link></li>
            <li><Link className="footerLink" to="/terms">Terms</Link></li>
            <li><Link className="footerLink" to="/cookies">Cookies</Link></li>
            <li><Link className="footerLink" to="/legal">Legal notice</Link></li>        
          </nav>

          <div className="footerCol" aria-label="Contact">
            <div className="footerHeading">Contact</div>
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

        <div className="footerBottom">
          <div className="footerFineprint">
            © {year} Eventify. Event data and images may come from public sources
            and remain the property of their respective owners. If you want an
            event or image removed/updated, contact us.
          </div>

          <div className="footerTinyLinks" aria-label="Footer shortcuts">
            <Link className="footerTinyLink" to="/privacy">Privacy</Link>
            <span className="footerTinyDot">•</span>
            <Link className="footerTinyLink" to="/terms">Terms</Link>
            <span className="footerTinyDot">•</span>
            <Link className="footerTinyLink" to="/cookies">Cookies</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}