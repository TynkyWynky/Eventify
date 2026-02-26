export default function CookiesPage() {
  return (
    <div className="legalWrap">
      <header className="legalHeader">
        <h1 className="legalTitle">Cookies & Local Storage</h1>
        <p className="legalLead">
          Eventify mainly uses browser storage to keep you logged in and save preferences.
        </p>
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