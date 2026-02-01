import { Link, useNavigate } from "react-router-dom";

export default function TopNavigationBar() {
  const navigate = useNavigate();

  return (
    <header className="navBar">
      <div className="navInner">
        <Link to="/" className="brand brandTitle">
          Eventify
        </Link>

        <div className="navSearchWrap">
          <input className="searchBar" placeholder="Artist, place, genre…" />
        </div>

        <div className="navActions">
          <button className="btnSecondary" onClick={() => navigate("/login")}>
            Login
          </button>
          <button className="btnPrimary" onClick={() => navigate("/register")}>
            Sign up
          </button>
        </div>
      </div>
    </header>
  );
}
