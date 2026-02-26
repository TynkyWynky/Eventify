import { Link } from "react-router-dom";

export default function PrivacyPage() {
  return (
    <div className="legalWrap">
      <header className="legalHeader">
        <h1 className="legalTitle">Privacy Policy</h1>
        <p className="legalLead">
          This page explains what data Eventify collects, why we collect it, and your rights under GDPR.
        </p>
      </header>

      <div className="legalCard">
        <h2>1) Who we are</h2>
        <p>
          Eventify is a student project. See the <Link to="/legal">Legal notice</Link> for contact details.
        </p>

        <h2>2) Data we collect</h2>
        <ul className="legalList">
          <li><b>Account data</b>: name, username, email, password (stored hashed).</li>
          <li><b>Usage & preferences</b>: likes/favorites, “Going”, invites and basic interaction logs.</li>
          <li><b>Approximate location</b>: your chosen origin (city / coordinates) used to calculate distance.</li>
          <li><b>Device storage</b>: localStorage items (e.g. session token, vibe-chat history) to keep the app usable.</li>
        </ul>

        <h2>3) Why we use your data (legal bases)</h2>
        <ul className="legalList">
          <li><b>To provide the service</b> (contract): login, account features, “Going”, invitations.</li>
          <li><b>Legitimate interests</b>: improve recommendations, prevent abuse, keep the platform secure.</li>
          <li><b>Consent</b> where applicable: optional cookies/analytics (if you add them later).</li>
        </ul>

        <h2>4) Sharing</h2>
        <p>
          We don’t sell your data. We may share minimal data with service providers used to run the app (hosting/database).
          Friends may see your public profile and when you mark “Going”.
        </p>

        <h2>5) Retention</h2>
        <p>
          We keep your account data while your account exists. You can request deletion and we will remove or anonymize your
          personal data unless we must keep something for legal/security reasons.
        </p>

        <h2>6) Your rights</h2>
        <ul className="legalList">
          <li>Access, correction, deletion</li>
          <li>Objection and restriction of processing</li>
          <li>Data portability (where applicable)</li>
          <li>Withdraw consent (where applicable)</li>
        </ul>

        <h2>7) Contact</h2>
        <p>For privacy requests, email us via the address shown in the footer.</p>
      </div>
    </div>
  );
}