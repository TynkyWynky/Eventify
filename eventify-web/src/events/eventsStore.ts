export type EventItem = {
  id: string;
  title: string;
  venue: string;
  city: string;
  dateLabel: string;
  distanceKm: number;
  imageUrl: string;
  tags: string[];
  trending?: boolean;

  // details page
  addressLine: string;
  postalCode: string;
  country: string;
  latitude: number;
  longitude: number;
  description: string;
};

export const MUSIC_STYLES: string[] = [
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


type Style = (typeof MUSIC_STYLES)[number];

type City = {
  name: string;
  postalCode: string;
  lat: number;
  lng: number;
};

const CITIES: City[] = [
  { name: "Brussels", postalCode: "1000", lat: 50.8466, lng: 4.3528 },
  { name: "Ixelles", postalCode: "1050", lat: 50.8333, lng: 4.3667 },
  { name: "Uccle", postalCode: "1180", lat: 50.802, lng: 4.336 },
  { name: "Schaerbeek", postalCode: "1030", lat: 50.867, lng: 4.375 },
  { name: "Anderlecht", postalCode: "1070", lat: 50.836, lng: 4.309 },
  { name: "Antwerp", postalCode: "2000", lat: 51.2194, lng: 4.4025 },
  { name: "Ghent", postalCode: "9000", lat: 51.0543, lng: 3.7174 },
  { name: "Leuven", postalCode: "3000", lat: 50.8798, lng: 4.7005 },
  { name: "Liège", postalCode: "4000", lat: 50.6326, lng: 5.5797 },
  { name: "Namur", postalCode: "5000", lat: 50.4669, lng: 4.8675 },
  { name: "Charleroi", postalCode: "6000", lat: 50.4108, lng: 4.4446 },
  { name: "Mons", postalCode: "7000", lat: 50.4542, lng: 3.9567 },
  { name: "Bruges", postalCode: "8000", lat: 51.2093, lng: 3.2247 },
  { name: "Mechelen", postalCode: "2800", lat: 51.0257, lng: 4.4776 },
  { name: "Hasselt", postalCode: "3500", lat: 50.9307, lng: 5.3325 },
  { name: "Halle", postalCode: "1500", lat: 50.7333, lng: 4.234 },
  { name: "Lessines", postalCode: "7860", lat: 50.712, lng: 3.836 },
  { name: "Tournai", postalCode: "7500", lat: 50.605, lng: 3.389 },
];

const VENUES = [
  "La Botanique",
  "Ancienne Belgique",
  "Fuse",
  "Forest National",
  "KVS",
  "Le Madeleine",
  "C12",
  "Beursschouwburg",
  "De Roma",
  "Sportpaleis",
  "Vooruit",
  "Charlatan",
  "Het Depot",
  "Trix",
  "Recyclart",
  "The Warehouse",
  "Pulse Club",
  "Neon Room",
  "Skyline Rooftop",
  "Blue Note Bar",
];

const ARTISTS = [
  "Andresz",
  "Nova Kicks",
  "Sierra Bloom",
  "Nightdrive",
  "Rina Vale",
  "Kairo Beats",
  "Juno Static",
  "Echo District",
  "Milo & The Shapes",
  "Noir Avenue",
  "Velvet Riot",
  "GigaWave",
  "Lunar Tape",
  "Vanta",
  "Kobalt",
  "Arden",
  "Dahlia",
  "Calyx",
  "Boreal",
  "Mosaic",
];

const EVENT_WORDS = [
  "Warehouse",
  "Session",
  "Showcase",
  "Night",
  "Live",
  "Afterparty",
  "Rooftop",
  "Basement",
  "Club",
  "Festival Warmup",
  "Secret Set",
  "All Night Long",
  "Special Guest",
  "Community Jam",
];

const STREETS = [
  "Rue Royale",
  "Boulevard Anspach",
  "Chaussée d'Ixelles",
  "Avenue Louise",
  "Rue Neuve",
  "Rue du Progrès",
  "Rue de la Loi",
  "Korenmarkt",
  "Stationsplein",
  "Meir",
  "Martelarenplein",
  "Place du Marché",
  "Rue de l'Université",
  "Veldstraat",
  "Ringlaan",
];

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function formatDateLabel(dayOffset: number, rng: () => number) {
  const base = new Date();
  base.setDate(base.getDate() + dayOffset);

  const months = [
    "Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec",
  ];

  const d = String(base.getDate()).padStart(2, "0");
  const m = months[base.getMonth()];
  const hh = clamp(18 + Math.floor(rng() * 7), 18, 23); // 18..23
  const mm = pick(rng, ["00", "30"]);

  return `${d} ${m} ${String(hh).padStart(2, "0")}:${mm}`;
}

function makeImageUrl(rng: () => number, style: Style, idNum: number) {
  // Unsplash seeded-ish images
  const topics: Record<string, string> = {
    Techno: "techno,club,lights",
    Electronic: "concert,edm,crowd",
    Rock: "rock,band,stage",
    Indie: "indie,live,music",
    Pop: "pop,concert,confetti",
    "Hip-Hop": "hiphop,rap,stage",
    Jazz: "jazz,bar,sax",
    House: "house,dj,nightclub",
    "Drum & Bass": "drumandbass,club,crowd",
    "R&B": "rnb,live,stage",
    Metal: "metal,concert,moshpit",
    All: "concert,live,music",
  };

  const q = topics[style] ?? topics.All;
  const sig = Math.floor(rng() * 10_000) + idNum * 7;
  return `https://source.unsplash.com/1400x900/?${encodeURIComponent(q)}&sig=${sig}`;
}

function makeDescription(rng: () => number, style: Style, venue: string, city: string) {
  const vibe = pick(rng, [
    "immersive lighting",
    "a packed crowd",
    "deep selections",
    "heavy basslines",
    "a cozy atmosphere",
    "big sing-alongs",
    "late-night energy",
    "a friendly community vibe",
    "a tight live performance",
    "a sleek, modern stage design",
  ]);

  const extra = pick(rng, [
    "Doors open at 21:00.",
    "Doors open at 22:00.",
    "18+ (ID required).",
    "Limited capacity — arrive early.",
    "Special guest announced on the day.",
    "Afterparty until late.",
    "Cocktails & chill area available.",
    "Merch stand on site.",
  ]);

  return `${style} night at ${venue} in ${city} with ${vibe}. ${extra}`;
}

function makeTags(rng: () => number, primary: Style) {
  const styles = MUSIC_STYLES.filter((s) => s !== "All");
  const other = pick(rng, styles as Style[]);
  const third = rng() < 0.25 ? pick(rng, styles as Style[]) : null;

  const base = [primary];
  if (other !== primary && rng() < 0.45) base.push(other);
  if (third && !base.includes(third) && rng() < 0.35) base.push(third);

  return base;
}

function makeEventTitle(rng: () => number, artist: string, venue: string) {
  const w = pick(rng, EVENT_WORDS);
  const formats = [
    `${artist} @ ${venue}`,
    `${artist} • ${w}`,
    `${w}: ${artist}`,
    `${artist} Presents: ${w}`,
  ];
  return pick(rng, formats);
}

function generateMockEvents(count: number, seed = 1337): EventItem[] {
  const rng = mulberry32(seed);

  const styles = MUSIC_STYLES.filter((s) => s !== "All") as Style[];

  const events: EventItem[] = [];

  for (let i = 0; i < count; i++) {
    const idNum = i + 1;
    const id = String(idNum);

    const city = pick(rng, CITIES);
    const venue = pick(rng, VENUES);
    const artist = pick(rng, ARTISTS);
    const primaryStyle = pick(rng, styles);

    // distance for slider testing: 0..100
    const distanceKm = Math.round((rng() * 100) * 10) / 10;

    // Some trending events (about ~18%)
    const trending = rng() < 0.18;

    // Street + house number
    const street = pick(rng, STREETS);
    const house = 1 + Math.floor(rng() * 260);

    const dateLabel = formatDateLabel(1 + Math.floor(rng() * 90), rng);
    const title = makeEventTitle(rng, artist, venue);

    // Lat/lng with small jitter around the city center
    const latitude = city.lat + (rng() - 0.5) * 0.06;
    const longitude = city.lng + (rng() - 0.5) * 0.08;

    const tags = makeTags(rng, primaryStyle);

    const event: EventItem = {
      id,
      title,
      venue,
      city: city.name,
      dateLabel,
      distanceKm,
      imageUrl: makeImageUrl(rng, primaryStyle, idNum),
      tags,
      trending,
      addressLine: `${street} ${house}`,
      postalCode: city.postalCode,
      country: "Belgium",
      latitude,
      longitude,
      description: makeDescription(rng, primaryStyle, venue, city.name),
    };

    events.push(event);
  }

  // Add a few “hand-crafted” featured events (very realistic)
  events.unshift(
    {
      id: "featured_001",
      title: "Andresz @ La Botanique",
      venue: "La Botanique",
      city: "Brussels",
      dateLabel: "25 Mar 22:30",
      distanceKm: 2.5,
      imageUrl:
        "https://images.unsplash.com/photo-1511379938547-c1f69419868d?w=1400&q=80",
      tags: ["Techno", "Electronic"],
      trending: true,
      addressLine: "Rue Royale 236",
      postalCode: "1210",
      country: "Belgium",
      latitude: 50.8549,
      longitude: 4.3601,
      description:
        "A high-energy night with a stacked lineup, immersive lighting and a packed crowd. Doors open at 21:30. ID required.",
    },
    {
      id: "featured_002",
      title: "Rooftop Grooves: House Edition",
      venue: "Skyline Rooftop",
      city: "Brussels",
      dateLabel: "29 Mar 18:00",
      distanceKm: 4.1,
      imageUrl:
        "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=1400&q=80",
      tags: ["House", "Pop"],
      trending: true,
      addressLine: "Avenue Louise 88",
      postalCode: "1050",
      country: "Belgium",
      latitude: 50.8303,
      longitude: 4.3569,
      description:
        "Golden hour rooftop vibes with a house-heavy lineup, cocktails and a city view. Limited capacity — arrive early.",
    }
  );

  // Ensure no duplicate IDs accidentally
  const seen = new Set<string>();
  return events.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
}

// 🔥 Change this number to test performance & UI
export const MOCK_EVENTS: EventItem[] = generateMockEvents(250, 1337);

export function getEventById(eventId: string) {
  return MOCK_EVENTS.find((e) => e.id === eventId);
}
