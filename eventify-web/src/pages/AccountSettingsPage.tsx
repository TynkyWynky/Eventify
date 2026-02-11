export default function AccountSettingsPage() {
  return (
    <div className="settingsPage">
      <div className="settingsHeader">
        <div>
          <div className="settingsTitle">Account settings</div>
          <div className="settingsHint">Profile, privacy, notifications…</div>
        </div>
      </div>

      <div className="settingsGrid">
        <section className="settingsCard">
          <div className="settingsCardTitle">Profile</div>
          <div className="settingsCardHint">Name, email, avatar</div>
          <div className="settingsForm">
            <label className="authLabel">Display name</label>
            <input className="authInput" placeholder="Your name" />

            <label className="authLabel">Email</label>
            <input className="authInput" placeholder="you@email.com" />

            <button className="authPrimaryButton">Save</button>
          </div>
        </section>

        <section className="settingsCard">
          <div className="settingsCardTitle">Notifications</div>
          <div className="settingsCardHint">Friend activity, recommendations</div>
          <div className="settingsToggles">
            <label className="settingsToggle">
              <input type="checkbox" defaultChecked />
              Friend activity
            </label>
            <label className="settingsToggle">
              <input type="checkbox" defaultChecked />
              New events near me
            </label>
            <label className="settingsToggle">
              <input type="checkbox" />
              Marketing emails
            </label>
          </div>
        </section>
      </div>
    </div>
  );
}
