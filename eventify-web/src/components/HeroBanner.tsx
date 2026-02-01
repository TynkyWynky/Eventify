export default function HeroBanner() {
  return (
    <section className="heroBanner">
      <div
        className="heroImage"
        style={{
          backgroundImage:
            "url(https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=1800&q=80)",
        }}
      />
      <div className="heroShade" />
      <div className="heroCurves" />

      <div className="heroContent">
        <h1 className="heroTitle">Your local scene awaits.</h1>
        <p className="heroSubtitle">
          Discover all the concerts around you — in one place.
        </p>
      </div>
    </section>
  );
}
