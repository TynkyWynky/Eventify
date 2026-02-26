export default function LegalNoticePage() {
  return (
    <div className="legalWrap">
      <header className="legalHeader">
        <h1 className="legalTitle">Legal Notice</h1>
        <p className="legalLead">
          Mandatory information + disclaimer for this student project.
        </p>
      </header>

      <div className="legalCard">
        <h2>Project</h2>
        <p><b>Eventify</b> — a hyper-local event discovery app.</p>

        <h2>Responsible / contact</h2>
        <ul className="legalList">
          <li><b>Team</b>: Mehmet Dogan Schepens & Aaron Sengier</li>
          <li><b>Email</b>: atypique.professional@gmail.com</li>
          <li><b>Address</b>: Brussels, Belgium</li>
        </ul>

        <h2>Disclaimer</h2>
        <p>
          Eventify aggregates and displays event information that can originate from public sources.
          We try to keep it correct, but information can change at any time.
          If you are an organizer/rights holder and want content removed or corrected, contact us.
        </p>
      </div>
    </div>
  );
}