export default function AppLoadingScreen() {
  return (
    <div className="appLoadingScreen" role="status" aria-live="polite" aria-label="Loading">
      <div className="appLoadingAura" />
      <div className="appLoadingCard">
        <div className="appLoadingBrand">Eventify</div>
        <div className="appLoadingTitle">Preparing your events</div>
        <div className="appLoadingHint">Loading local scene, maps, and recommendations.</div>
        <div className="appLoadingBar" aria-hidden="true">
          <span className="appLoadingBarFill" />
        </div>
      </div>
    </div>
  );
}
