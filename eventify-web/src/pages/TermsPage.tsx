export default function TermsPage() {
  return (
    <div className="legalWrap">
      <header className="legalHeader">
        <h1 className="legalTitle">Terms of Service</h1>
        <p className="legalLead">
          Basic rules for using Eventium. This is a student project and provided “as is”.
        </p>
      </header>

      <div className="legalCard">
        <h2>1) Using the service</h2>
        <ul className="legalList">
          <li>Don’t abuse, scrape, or attempt to break the platform.</li>
          <li>Don’t upload illegal, hateful, or harmful content.</li>
          <li>Keep your account secure and don’t share credentials.</li>
        </ul>

        <h2>2) Event information</h2>
        <p>
          Event listings can change or be inaccurate. Always verify details with the organizer/venue.
          Eventium is not responsible for cancellations, changes, or third-party content.
        </p>

        <h2>3) Intellectual property</h2>
        <p>
          Names, logos, posters and images shown in event cards may belong to their respective owners.
          If something should be removed, contact us.
        </p>

        <h2>4) Limitation of liability</h2>
        <p>
          To the maximum extent permitted by law, Eventium is provided without warranties.
          We are not liable for indirect damages, loss of data, or issues caused by third-party links.
        </p>

        <h2>5) Termination</h2>
        <p>
          We may suspend accounts that violate these terms. You can stop using the service at any time and request account deletion.
        </p>

        <h2>6) Governing law</h2>
        <p>These terms are governed by Belgian law (as applicable to this student project).</p>
      </div>
    </div>
  );
}
