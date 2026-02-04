import { useMemo, useState } from "react";
import SelectField from "../components/SelectField";


type EventItem = {
  id: string;
  title: string;
  venue: string;
  city: string;
  dateLabel: string;
  distanceKm: number;
  imageUrl: string;
  tags: string[];
  trending?: boolean;
};

const MUSIC_STYLES = [
  "All",
  "Techno",
  "Electronic",
  "Rock",
  "Indie",
  "Pop",
  "Hip-Hop",
  "Jazz",
  "House",
  "Drum & Bass",
  "R&B",
  "Metal",
];

const MOCK_EVENTS: EventItem[] = [
  {
    id: "1",
    title: "Andresz @ La Botanique",
    venue: "La Botanique",
    city: "Brussels",
    dateLabel: "25 Mar 22:30",
    distanceKm: 2.5,
    imageUrl:
      "https://images.unsplash.com/photo-1511379938547-c1f69419868d?w=1200&q=80",
    tags: ["Techno", "Electronic"],
    trending: true,
  },
  {
    id: "2",
    title: "Live Session",
    venue: "La Botanique",
    city: "Brussels",
    dateLabel: "25 Mar 22:30",
    distanceKm: 2.5,
    imageUrl:
      "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=1200&q=80",
    tags: ["Rock"],
    trending: true,
  },
  {
    id: "3",
    title: "Crowd Night",
    venue: "La Botanique",
    city: "Brussels",
    dateLabel: "25 Mar 22:30",
    distanceKm: 2.5,
    imageUrl:
      "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=1200&q=80",
    tags: ["Jazz"],
    trending: true,
  },
  {
    id: "4",
    title: "Night Club Set",
    venue: "La Botanique",
    city: "Brussels",
    dateLabel: "25 Mar 22:30",
    distanceKm: 3.2,
    imageUrl:
      "https://images.unsplash.com/photo-1540039155733-5bb30b53aa14?w=1200&q=80",
    tags: ["Electronic"],
  },
  {
    id: "5",
    title: "Bass Drop",
    venue: "La Botanique",
    city: "Brussels",
    dateLabel: "25 Mar 22:30",
    distanceKm: 8.1,
    imageUrl:
      "https://images.unsplash.com/photo-1459749411175-04bf5292ceea?w=1200&q=80",
    tags: ["Techno"],
  },
  {
    id: "6",
    title: "Laser Show",
    venue: "La Botanique",
    city: "Brussels",
    dateLabel: "25 Mar 22:30",
    distanceKm: 15.4,
    imageUrl:
      "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=1200&q=80",
    tags: ["Rock"],
  },
];

function EventCard({ event }: { event: EventItem }) {
  return (
    <article className="eventCard">
      <div className="eventImageWrap">
        <img className="eventImage" src={event.imageUrl} alt={event.title} />
      </div>
      <div className="eventFooter">
        <div className="eventFooterLeft">
          {event.venue} - {event.distanceKm.toFixed(1)}Km
        </div>
        <div className="eventFooterRight">{event.dateLabel}</div>
      </div>
    </article>
  );
}

export default function EventDashboardPage() {
  const [selectedStyle, setSelectedStyle] = useState<string>("All");
  const [maxDistanceKm, setMaxDistanceKm] = useState<number>(20);

  const filteredEvents = useMemo(() => {
    return MOCK_EVENTS.filter((e) => {
      const matchesDistance = e.distanceKm <= maxDistanceKm;
      const matchesStyle =
        selectedStyle === "All" || e.tags.includes(selectedStyle);
      return matchesDistance && matchesStyle;
    });
  }, [selectedStyle, maxDistanceKm]);

  const trendingEvents = filteredEvents.filter((e) => e.trending);
  const allEvents = filteredEvents;

  return (
    <div>

      <section className="heroBanner">
        <div
          className="heroImage"
          style={{
            backgroundImage:
              "url(https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=1800&q=80)",
          }}
        />
        <div className="heroShade" />

        <div className="heroCenter">
          <div>
            <h1 className="heroTitle">Your local scene awaits.</h1>
            <p className="heroSubtitle">
              Discover all the concerts around you.
            </p>

            <div className="heroFilterBar">
              {/* Dropdown */}
              <SelectField
              value={selectedStyle}
              options={MUSIC_STYLES}
              onChange={setSelectedStyle}
              placeholder="All"
              searchPlaceholder="Search a style…"
              />



              {/* Slider */}
              <div className="sliderGroup">
                <div className="sliderHeader">
                  <span className="sliderLabel">Distance (Km)</span>
                  <span className="sliderValue">{maxDistanceKm} Km</span>
                </div>
                <input
                  className="rangeSlider"
                  type="range"
                  min={1}
                  max={100}
                  value={maxDistanceKm}
                  onChange={(e) => setMaxDistanceKm(Number(e.target.value))}
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* TRENDING */}
      <div className="sectionTitleRow">
        <div>
          <div className="sectionTitle">Trending</div>
          <div className="sectionHint">Hot events around you</div>
        </div>
        <div className="sectionHint">
          Filter: {selectedStyle} • ≤ {maxDistanceKm} km
        </div>
      </div>

      <div className="trendingRow">
        {trendingEvents.map((e) => (
          <EventCard key={e.id} event={e} />
        ))}
      </div>

      {/* DASHBOARD / ALL EVENTS */}
      <div className="sectionTitleRow">
        <div>
          <div className="sectionTitle">Dashboard</div>
          <div className="sectionHint">All events (filtered)</div>
        </div>
      </div>

      {/* Grid all events */}
      <div className="eventsGrid">
        {allEvents.map((e) => (
          <EventCard key={e.id} event={e} />
        ))}
      </div>

      {/* CTA */}
      <div className="organizerCTA">
        <div className="ctaTitle">Organisator? Make some noise!</div>
        <button className="ctaButton">Promote my event!</button>
      </div>
    </div>
  );
}
