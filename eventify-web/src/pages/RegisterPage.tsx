export default function RegisterPage() {
  return (
    <div className="authPage">
      <div className="authBackdrop" />
      <div className="authCard">
        <h2 className="authTitle">Register</h2>

        <div className="authForm">
          <label className="authLabel">Name</label>
          <input className="authInput" placeholder="Your name" />

          <label className="authLabel">Email</label>
          <input className="authInput" placeholder="you@email.com" />

          <label className="authLabel">Password</label>
          <input className="authInput" type="password" placeholder="••••••••" />

          <button className="authPrimaryButton">Create account</button>
        </div>
      </div>
    </div>
  );
}
