export default function LoginPage() {
  return (
    <div className="authPage">
      <div className="authBackdrop" />
      <div className="authCard">
        <h2 className="authTitle">Login</h2>

        <div className="authForm">
          <label className="authLabel">Email</label>
          <input className="authInput" placeholder="you@email.com" />

          <label className="authLabel">Password</label>
          <input className="authInput" type="password" placeholder="••••••••" />

          <button className="authPrimaryButton">Login</button>
        </div>
      </div>
    </div>
  );
}
