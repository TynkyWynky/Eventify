import { useMemo, useState } from "react";
import HeroBanner from "../components/HeroBanner";

type ViewMode = "list" | "map";

type EventItem = {
  id: string;
  title: string;
  venue: string;
  city: string;
  dateLabel: string;
  imageUrl: string;
  tags: string[];
};

const GENRES = ["Techno", "Electronic", "Rock", "Indie", "Pop", "Hip-Hop", "Jazz"];

const MOCK_EVENTS: EventItem[] = [
  {
    id: "1",
    title: "Andresz @ La Botanique",
    venue: "La Botanique",
    city: "Brussels",
    dateLabel: "12 Mar 2026, 22:30",
    imageUrl:
      "https://images.unsplash.com/photo-1511379938547-c1f69419868d?w=1200&q=80",
    tags: ["Techno", "Electronic"],
  },
  {
    id: "2",
    title: "Local Jam Night",
    venue: "Small Venue",
    city: "Brussels",
    dateLabel: "18 Mar 2026, 19:30",
    imageUrl:
      "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=1200&q=80",
    tags: ["Indie", "Rock"],
  },
  {
    id: "3",
    title: "City Pop Session",
    venue: "Club X",
    city: "Brussels",
    dateLabel: "23 Mar 2026, 20:00",
    imageUrl:
      "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=1200&q=80",
    tags: ["Pop"],
  },
];

export default function EventDashboardPage() {
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [activeGenres, setActiveGenres] = useState<string[]>([]);
  const [maxDistanceKm, setMaxDistanceKm] = useState<number>(20);

  const toggleGenre = (genre: string) => {
    setActiveGenres((current) =>
      current.includes(genre) ? current.filter((g) => g !== genre) : [...current, genre]
    );
  };

  const filteredEvents = useMemo(() => {
    if (activeGenres.length === 0) return MOCK_EVENTS;
    return MOCK_EVENTS.filter((e) => e.tags.some((t) => activeGenres.includes(t)));
  }, [activeGenres]);

  return (
    <div>
      <HeroBanner />

      <section className="dashboardPanel">
        <div className="dashboardHeaderRow">
          <div className="filtersBlock">
            <div className="dashboardTitle">Dashboard</div>

            <div className="chipRow">
              {GENRES.map((g) => {
                const active = activeGenres.includes(g);
                return (
                  <button
                    key={g}
                    className={`chip ${active ? "chipActive" : ""}`}
                    onClick={() => toggleGenre(g)}
                  >
                    {g}
                  </button>
                );
              })}
            </div>

            <div className="distanceRow">
              <div className="mutedLabel">Distance</div>
              <input
                type="range"
                min={1}
                max={100}
                value={maxDistanceKm}
                onChange={(e) => setMaxDistanceKm(Number(e.target.value))}
                className="distanceSlider"
              />
              <div className="distanceValue">{maxDistanceKm} km</div>
            </div>
          </div>

          <div className="toggleGroup">
            <button
              className={`toggleBtn ${viewMode === "list" ? "toggleBtnActive" : ""}`}
              onClick={() => setViewMode("list")}
            >
              View List
            </button>
            <button
              className={`toggleBtn ${viewMode === "map" ? "toggleBtnActive" : ""}`}
              onClick={() => setViewMode("map")}
            >
              View Map
            </button>
          </div>
        </div>

        <div className="organizerCTA">
          <div>
            <div className="organizerTitle">Organisator? Make some noise!</div>
            <div className="organizerSubtitle">
              Post your event — it appears after admin approval.
            </div>
          </div>
          <button className="ctaButton">Post an event</button>
        </div>

        {viewMode === "map" ? (
          <div className="mapPlaceholder">
            Map view 
          </div>
        ) : (
          <div className="eventsGrid">
            {filteredEvents.map((e) => (
              <article key={e.id} className="eventCard">
                <div className="eventImageWrap">
                  <img src={e.imageUrl} alt={e.title} className="eventImage" />
                </div>

                <div className="eventBody">
                  <div className="eventHeaderRow">
                    <h3 className="eventTitle">{e.title}</h3>
                  </div>

                  <div className="eventMeta">
                    {e.venue} • {e.city}
                  </div>
                  <div className="eventMetaSmall">{e.dateLabel}</div>

                  <div className="eventTagsRow">
                    {e.tags.map((t) => (
                      <span key={t} className="eventTag">
                        {t}
                      </span>
                    ))}
                  </div>

                  <button className="eventAction">I’m going!</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
