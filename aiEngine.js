const DEFAULT_RECOMMENDATION_WEIGHTS = {
  genreMatch: 0.35,
  distance: 0.25,
  popularity: 0.2,
  similarity: 0.2,
};

const DEFAULT_RADAR_THRESHOLDS = {
  hiddenGem: 0.62,
  trendingLocal: 0.66,
};

const GENRE_KEYWORDS = {
  indie: ["indie", "alternative", "alternatif", "alternatieve", "lo-fi", "shoegaze"],
  rock: ["rock", "punk", "grunge", "garage"],
  pop: ["pop", "chanson", "variete", "chart", "mainstream", "top 40"],
  "hip-hop": ["hip hop", "hip-hop", "rap", "trap", "drill"],
  electronic: [
    "electronic",
    "electro",
    "electronique",
    "elektronisch",
    "edm",
    "techno",
    "house",
    "trance",
    "dj set",
  ],
  jazz: ["jazz", "swing", "bebop", "fusion"],
  blues: ["blues", "blues rock"],
  folk: ["folk", "folklore", "acoustic", "americana"],
  "singer-songwriter": ["singer-songwriter", "songwriter", "acoustic set"],
  metal: ["metal", "metalcore", "thrash", "death metal"],
  soul: ["soul", "r&b", "rnb", "neo soul"],
  classical: ["classical", "classique", "klassiek", "orchestra", "symphony", "opera"],
  latin: ["latin", "latino", "salsa", "bachata", "reggaeton"],
  world: ["world music", "wereldmuziek", "afrobeat", "amapiano"],
};

const ARCHETYPE_CONFIG = [
  {
    label: "Indie Explorer",
    genreWeights: { indie: 1, folk: 0.8, "singer-songwriter": 0.8, rock: 0.4 },
    localBias: 0.4,
    eveningBias: 0.3,
  },
  {
    label: "Mainstage Fan",
    genreWeights: { pop: 1, electronic: 0.9, "hip-hop": 0.8, latin: 0.4 },
    distanceBias: 0.45,
    festivalBias: 0.45,
  },
  {
    label: "Jazz Drifter",
    genreWeights: { jazz: 1, blues: 0.9, soul: 0.7, classical: 0.5 },
    localBias: 0.2,
    nightBias: 0.4,
  },
  {
    label: "Electronic Night Owl",
    genreWeights: { electronic: 1, "hip-hop": 0.5, pop: 0.3, world: 0.4 },
    distanceBias: 0.3,
    nightBias: 0.55,
  },
];

const MULTILINGUAL_TERM_REPLACEMENTS = [
  [/\bmusique\b|\bmuziek\b|\bmusik\b|\bmusica\b/g, " music "],
  [/\bconcerten\b|\bconcerts\b|\bconcert\b|\bkonzert\b|\bkonzerte\b|\bconcierto\b|\bconciertos\b/g, " concert "],
  [/\bspectacle\b|\bvoorstelling\b|\bshow\b/g, " show "],
  [/\bsoiree\b|\bnacht\b|\bavond\b|\bfiesta\b|\bfete\b|\bfeest\b|\bparty\b|\bparties\b/g, " party "],
  [/\belektronisch\b|\belectronique\b|\belectronica\b|\belectro\b/g, " electronic "],
  [/\bhiphop\b|\bhip-hop\b/g, " hip hop "],
  [/\brap\b|\btrap\b/g, " rap "],
  [/\bchanson\b|\bvariete\b|\bhitparade\b/g, " pop "],
  [/\bklassiek\b|\bclassique\b/g, " classical "],
  [/\bwereldmuziek\b|\bmusique du monde\b/g, " world music "],
  [/\bmusica en vivo\b|\ben vivo\b|\blive musik\b|\blive muziek\b/g, " live music "],
  [/\bauteur-compositeur\b|\bcantautor\b/g, " singer songwriter "],
  [/\bmetal pesado\b/g, " metal "],
  [/\bmusica latina\b/g, " latin music "],
  [/\bfiesta latina\b/g, " latin party "],
  [/\bgratis\b|\bgratuit\b|\bgratuite\b/g, " free "],
  [/\batelier\b|\bwerkplaats\b/g, " workshop "],
  [/\bconference\b|\bconferentie\b|\bkongress\b|\bconferencia\b/g, " conference "],
  [/\bvacaturebeurs\b|\bjobbeurs\b/g, " job fair "],
  [/\bimmobilier\b|\bvastgoed\b/g, " real estate "],
  [/\bnetworking\b|\breseau\b|\bnetwerken\b|\bredes\b/g, " networking "],
  [/\bbooklaunch\b|\bboekvoorstelling\b/g, " book launch "],
];

const GENERIC_GENRE_TOKENS = new Set([
  "music",
  "live",
  "show",
  "concert",
  "festival",
  "party",
  "set",
  "night",
  "club",
]);

function cleanText(value) {
  if (value == null) return null;
  const text = String(value).replace(/\s+/g, " ").trim();
  return text || null;
}

function clamp(value, min = 0, max = 1) {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function normalizeText(value) {
  const clean = cleanText(value);
  if (!clean) return "";
  let normalized = clean
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9+&\s-]/g, " ")
    .replace(/\s+/g, " ");

  // Lightweight cross-language meaning normalization for common event terms.
  for (const [regex, replacement] of MULTILINGUAL_TERM_REPLACEMENTS) {
    normalized = normalized.replace(regex, replacement);
  }

  return normalized.replace(/\s+/g, " ").trim();
}

function tokenize(value) {
  const text = normalizeText(value);
  if (!text) return [];
  return text.split(" ").filter((token) => token.length > 1);
}

function buildTokenSet(value) {
  return new Set(tokenize(value));
}

function buildEventText(event) {
  return [
    cleanText(event?.title),
    cleanText(event?.description),
    cleanText(event?.genre),
    cleanText(event?.category),
    cleanText(event?.artistName),
    cleanText(event?.organizerName),
    cleanText(event?.venue),
    cleanText(event?.city),
    ...(Array.isArray(event?.tags) ? event.tags : []),
  ]
    .map((entry) => cleanText(entry))
    .filter(Boolean)
    .join(" ");
}

function scoreKeywordMatch(normalizedText, textTokens, keyword) {
  const k = normalizeText(keyword);
  if (!k) return 0;

  if (normalizedText.includes(k)) {
    return k.includes(" ") ? 2.6 : 1.25;
  }

  const keywordTokens = tokenize(k).filter((token) => !GENERIC_GENRE_TOKENS.has(token));
  if (keywordTokens.length < 2) return 0;

  let partialHits = 0;
  for (const token of keywordTokens) {
    if (textTokens.has(token)) partialHits++;
  }
  if (partialHits === 0) return 0;

  const ratio = partialHits / keywordTokens.length;
  if (ratio >= 0.85) return 1.35 * ratio;
  if (ratio >= 0.67 && partialHits >= 2) return 0.9 * ratio;
  return 0;
}

function getEventKeys(event) {
  const out = [];
  const push = (value) => {
    const clean = cleanText(value);
    if (!clean) return;
    out.push(clean);
  };
  push(event?.id);
  push(event?.sourceId);
  push(event?.url);
  push(event?.ticketUrl);
  const fallback = [
    cleanText(event?.title),
    cleanText(event?.start),
    cleanText(event?.city),
    cleanText(event?.venue),
  ]
    .filter(Boolean)
    .join("|");
  push(fallback);
  return out;
}

function predictGenresFromText(text, { topK = 3 } = {}) {
  const normalized = normalizeText(text);
  if (!normalized) return [{ genre: "music", confidence: 0.2, score: 0.1 }];

  const textTokens = new Set(tokenize(normalized));
  const scored = [];
  for (const [genre, keywords] of Object.entries(GENRE_KEYWORDS)) {
    let score = 0;
    for (const keyword of keywords) {
      score += scoreKeywordMatch(normalized, textTokens, keyword);
    }
    if (score > 0) scored.push({ genre, score });
  }

  if (scored.length === 0) return [{ genre: "music", confidence: 0.25, score: 0.2 }];

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, Math.max(1, Number(topK) || 3));
  const total = top.reduce((sum, item) => sum + item.score, 0) || 1;
  return top.map((item) => ({
    genre: item.genre,
    score: Number(item.score.toFixed(3)),
    confidence: Number(clamp(item.score / total, 0.05, 0.99).toFixed(3)),
  }));
}

function predictGenresForEvent(event, options = {}) {
  return predictGenresFromText(buildEventText(event), options);
}

function extractEventGenres(event) {
  const explicit = [
    cleanText(event?.genre),
    cleanText(event?.category),
    ...(Array.isArray(event?.tags) ? event.tags : []),
  ]
    .map((entry) => normalizeText(entry))
    .filter(Boolean);

  const genres = new Set();
  for (const entry of explicit) {
    for (const [genre, keywords] of Object.entries(GENRE_KEYWORDS)) {
      if (entry === genre || entry.includes(genre)) genres.add(genre);
      if (keywords.some((keyword) => entry.includes(normalizeText(keyword)))) genres.add(genre);
    }
  }

  if (genres.size === 0) {
    for (const item of predictGenresForEvent(event, { topK: 2 })) genres.add(item.genre);
  }
  return [...genres];
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const aLat = toNumber(lat1);
  const aLng = toNumber(lng1);
  const bLat = toNumber(lat2);
  const bLng = toNumber(lng2);
  if (aLat == null || aLng == null || bLat == null || bLng == null) return null;

  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const rLat1 = toRad(aLat);
  const rLat2 = toRad(bLat);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rLat1) * Math.cos(rLat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return 6371 * c;
}

function normalizeWeights(weights) {
  const source = { ...DEFAULT_RECOMMENDATION_WEIGHTS, ...(weights || {}) };
  const out = {
    genreMatch: Math.max(0, Number(source.genreMatch) || 0),
    distance: Math.max(0, Number(source.distance) || 0),
    popularity: Math.max(0, Number(source.popularity) || 0),
    similarity: Math.max(0, Number(source.similarity) || 0),
  };
  const total = out.genreMatch + out.distance + out.popularity + out.similarity;
  if (total <= 0) return { ...DEFAULT_RECOMMENDATION_WEIGHTS };
  out.genreMatch /= total;
  out.distance /= total;
  out.popularity /= total;
  out.similarity /= total;
  return out;
}

function getPreferredGenreWeights(profile = {}) {
  const map = new Map();
  const add = (genre, weight) => {
    const key = normalizeText(genre);
    if (!key) return;
    map.set(key, (map.get(key) || 0) + weight);
  };

  for (const genre of toArray(profile.preferredGenres)) add(genre, 2);
  for (const event of toArray(profile.likedEvents)) {
    const eventWeight = clamp(toNumber(event?.preferenceWeight) || 1, 0.35, 3);
    const predicted = predictGenresForEvent(event, { topK: 3 });
    for (const item of predicted) {
      add(item.genre, eventWeight * clamp(item.confidence, 0.15, 1));
    }
    for (const genre of extractEventGenres(event)) add(genre, eventWeight * 0.7);
  }

  let max = 0;
  for (const value of map.values()) max = Math.max(max, value);
  if (max > 0) {
    for (const [key, value] of map.entries()) map.set(key, clamp(value / max, 0.05, 1));
  }
  return map;
}

function computeGenreMatch(event, preferredGenres) {
  if (!preferredGenres || preferredGenres.size === 0) return { score: 0.5, matchedGenres: [] };
  const genres = extractEventGenres(event);
  if (genres.length === 0) return { score: 0.1, matchedGenres: [] };

  let best = 0;
  const matched = [];
  for (const genre of genres) {
    const value = preferredGenres.get(normalizeText(genre)) || 0;
    if (value > 0) matched.push(genre);
    best = Math.max(best, value);
  }
  return { score: clamp(best), matchedGenres: matched.slice(0, 3) };
}

function findNumber(event, paths) {
  for (const path of paths) {
    let cursor = event;
    let failed = false;
    for (const key of path) {
      if (!cursor || typeof cursor !== "object" || !(key in cursor)) {
        failed = true;
        break;
      }
      cursor = cursor[key];
    }
    if (failed) continue;
    const value = toNumber(cursor);
    if (value != null) return value;
  }
  return null;
}

function extractPopularitySignals(event, profile = {}) {
  const interestedCount = findNumber(event, [
    ["interestedCount"],
    ["interested"],
    ["popularity"],
    ["metadata", "interestedCount"],
    ["metadata", "raw", "interestedCount"],
  ]) || 0;

  const attendingCount = findNumber(event, [
    ["attendingCount"],
    ["attendees"],
    ["metadata", "attendingCount"],
    ["metadata", "raw", "attendingCount"],
  ]) || 0;

  const velocity24h = findNumber(event, [
    ["interestDelta24h"],
    ["velocityScore"],
    ["metadata", "interestDelta24h"],
    ["metadata", "raw", "interestDelta24h"],
  ]) || 0;

  const peerMap =
    profile && typeof profile.peerInterestByEventId === "object"
      ? profile.peerInterestByEventId
      : {};

  let peerInterestedCount = 0;
  for (const key of getEventKeys(event)) {
    if (key in peerMap) {
      peerInterestedCount = Math.max(peerInterestedCount, toNumber(peerMap[key]) || 0);
    }
  }
  peerInterestedCount = Math.max(
    peerInterestedCount,
    findNumber(event, [["peerInterestedCount"], ["metadata", "peerInterestedCount"]]) || 0
  );

  return { interestedCount, attendingCount, peerInterestedCount, velocity24h };
}

function computePopularityScore(event, profile = {}) {
  const signals = extractPopularitySignals(event, profile);
  const combinedInterest = Math.max(signals.interestedCount, signals.attendingCount);
  const countScore = clamp(Math.log1p(combinedInterest) / Math.log1p(250));
  const peerScore = clamp(Math.log1p(signals.peerInterestedCount) / Math.log1p(30));
  const velocityScore = clamp(Math.log1p(signals.velocity24h) / Math.log1p(60));
  const score = clamp(countScore * 0.65 + peerScore * 0.25 + velocityScore * 0.1);
  return { score, combinedInterest, ...signals };
}

function jaccard(setA, setB) {
  if (!setA || !setB || setA.size === 0 || setB.size === 0) return 0;
  let inter = 0;
  for (const value of setA) if (setB.has(value)) inter++;
  const union = setA.size + setB.size - inter;
  return union > 0 ? inter / union : 0;
}

function computeSimilarityScore(event, likedEvents = []) {
  const liked = toArray(likedEvents).filter(Boolean);
  if (liked.length === 0) return { score: 0.35, similarLikedCount: 0 };

  const candidate = buildTokenSet(buildEventText(event));
  if (candidate.size === 0) return { score: 0.05, similarLikedCount: 0 };

  const sims = liked
    .map((item) => jaccard(candidate, buildTokenSet(buildEventText(item))))
    .filter((value) => Number.isFinite(value));

  if (sims.length === 0) return { score: 0.05, similarLikedCount: 0 };

  sims.sort((a, b) => b - a);
  const top = sims.slice(0, Math.min(3, sims.length));
  const avg = top.reduce((sum, value) => sum + value, 0) / top.length;
  const similarLikedCount = sims.filter((value) => value >= 0.2).length;
  return { score: clamp(avg * 2.6), similarLikedCount };
}

function computeDistanceScore(event, profile = {}) {
  if (event?.isVirtual) return { score: 0.8, distanceKm: 0 };
  const distanceKm = haversineKm(
    profile?.lat ?? profile?.location?.lat,
    profile?.lng ?? profile?.location?.lng,
    event?.lat ?? event?.latitude,
    event?.lng ?? event?.longitude
  );
  if (distanceKm == null) return { score: 0.45, distanceKm: null };

  const preferredRadius = Math.max(3, toNumber(profile?.maxDistanceKm) || 30);
  return {
    score: clamp(1 - distanceKm / (preferredRadius * 1.35)),
    distanceKm,
  };
}

function formatDistance(distanceKm) {
  if (!Number.isFinite(distanceKm)) return null;
  return distanceKm >= 10 ? distanceKm.toFixed(0) : distanceKm.toFixed(1);
}

function buildReasons(data) {
  const reasons = [];
  const components =
    data.components && typeof data.components === "object" ? data.components : {};

  const genreScore = toNumber(components.genreMatch) ?? 0;
  if (data.matchedGenres.length > 0) {
    const genres = data.matchedGenres.slice(0, 2).join(" / ");
    if (genreScore >= 0.6) {
      reasons.push(`Duidelijke genre-overlap: ${genres}`);
    } else {
      reasons.push(`Lichte genre-overlap: ${genres}`);
    }
  } else if (genreScore < 0.35) {
    reasons.push("Beperkte genre-overlap met je voorkeuren");
  }

  const distanceLabel = formatDistance(data.distanceKm);
  if (distanceLabel != null) reasons.push(`Het is op ${distanceLabel} km van je locatie`);

  const similarityScore = toNumber(components.similarity) ?? 0;
  if (similarityScore < 0.32) {
    reasons.push("Weinig inhoudelijke overlap met events die je eerder likete");
  }

  if (data.peerInterestedCount > 0) {
    reasons.push(`${data.peerInterestedCount} mensen met vergelijkbare smaak tonen interesse`);
  } else if (data.combinedInterest >= 20) {
    reasons.push(`Sterke lokale interesse (${data.combinedInterest} geïnteresseerden)`);
  } else if ((toNumber(components.popularity) ?? 0) < 0.35) {
    reasons.push("Nog beperkte community-interesse voor dit event");
  }

  if (reasons.length === 0) reasons.push("Geselecteerd op basis van algemene relevantie");

  // Remove repetitive/near-identical lines.
  const out = [];
  const seen = new Set();
  for (const reason of reasons) {
    const key = normalizeText(reason).replace(/\b\d+([.,]\d+)?\b/g, "#");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(reason);
  }

  return out.slice(0, 4);
}

function scoreEventForUser(event, profile = {}, options = {}) {
  const weights = normalizeWeights(options.weights);
  const preferredGenres = options.preferredGenres || getPreferredGenreWeights(profile);

  const genre = computeGenreMatch(event, preferredGenres);
  const distance = computeDistanceScore(event, profile);
  const popularity = computePopularityScore(event, profile);
  const similarity = computeSimilarityScore(event, profile.likedEvents || []);

  const score =
    weights.genreMatch * genre.score +
    weights.distance * distance.score +
    weights.popularity * popularity.score +
    weights.similarity * similarity.score;

  return {
    event,
    score: Number(clamp(score).toFixed(4)),
    components: {
      genreMatch: Number(genre.score.toFixed(4)),
      distance: Number(distance.score.toFixed(4)),
      popularity: Number(popularity.score.toFixed(4)),
      similarity: Number(similarity.score.toFixed(4)),
    },
    matchedGenres: genre.matchedGenres,
    distanceKm: distance.distanceKm,
    similarLikedCount: similarity.similarLikedCount,
    combinedInterest: popularity.combinedInterest,
    peerInterestedCount: popularity.peerInterestedCount,
    velocity24h: popularity.velocity24h,
    reasons: buildReasons({
      components: {
        genreMatch: genre.score,
        distance: distance.score,
        popularity: popularity.score,
        similarity: similarity.score,
      },
      matchedGenres: genre.matchedGenres,
      distanceKm: distance.distanceKm,
      similarLikedCount: similarity.similarLikedCount,
      peerInterestedCount: popularity.peerInterestedCount,
      combinedInterest: popularity.combinedInterest,
    }),
  };
}

function recommendEvents(events, profile = {}, options = {}) {
  const limit = Math.max(1, Number(options.limit) || 20);
  const weights = normalizeWeights(options.weights);
  const preferredGenres = getPreferredGenreWeights(profile);

  const scored = toArray(events)
    .filter(Boolean)
    .map((event) => scoreEventForUser(event, profile, { weights, preferredGenres }))
    .sort((a, b) => b.score - a.score);

  const items = scored.slice(0, limit).map((entry, index) => ({
    ...entry.event,
    aiRecommendation: {
      rank: index + 1,
      score: entry.score,
      reasons: entry.reasons,
      components: entry.components,
      matchedGenres: entry.matchedGenres,
      distanceKm: entry.distanceKm,
      similarLikedCount: entry.similarLikedCount,
      peerInterestedCount: entry.peerInterestedCount,
    },
  }));

  const inferredTopGenres = [...preferredGenres.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([genre]) => genre);

  return {
    weights,
    inferredProfile: {
      topGenres: inferredTopGenres,
      likedEventsCount: toArray(profile.likedEvents).length,
    },
    items,
  };
}

function parseEventDate(event) {
  const values = [
    event?.publishedAt,
    event?.createdAt,
    event?.metadata?.fetched_at,
    event?.metadata?.raw?.created_at,
    event?.metadata?.raw?.published_at,
    event?.start,
  ];
  for (const value of values) {
    const clean = cleanText(value);
    if (!clean) continue;
    const dt = new Date(clean);
    if (!Number.isNaN(dt.getTime())) return dt;
  }
  return null;
}

function buildUndergroundRadar(events, profile = {}, options = {}) {
  const recommendation = recommendEvents(events, profile, {
    weights: options.recommendationWeights,
    limit: Math.max(1, Number(options.limit) || events.length || 20),
  });

  const hiddenGemThreshold = Number.isFinite(Number(options.hiddenGemThreshold))
    ? clamp(Number(options.hiddenGemThreshold), 0.2, 0.95)
    : DEFAULT_RADAR_THRESHOLDS.hiddenGem;
  const trendingThreshold = Number.isFinite(Number(options.trendingThreshold))
    ? clamp(Number(options.trendingThreshold), 0.2, 0.95)
    : DEFAULT_RADAR_THRESHOLDS.trendingLocal;

  const output = [];
  for (const event of recommendation.items) {
    const rec = event.aiRecommendation;
    const now = Date.now();
    const date = parseEventDate(event);
    const ageDays = date ? Math.max(0, (now - date.getTime()) / 86400000) : 14;
    const freshness = clamp(1 - ageDays / 30);

    const popularity = rec.components.popularity;
    const relevance = rec.score;
    const velocity = clamp(Math.log1p(toNumber(event?.velocity24h) || 0) / Math.log1p(50));
    const lowVisibility = 1 - popularity;

    const hiddenGemScore = clamp(relevance * 0.5 + lowVisibility * 0.3 + freshness * 0.2);
    const trendingScore = clamp(velocity * 0.5 + relevance * 0.3 + freshness * 0.2);

    const labels = [];
    if (hiddenGemScore >= hiddenGemThreshold && popularity <= 0.55) labels.push("Hidden Gem");
    if (trendingScore >= trendingThreshold) labels.push("Trending Local");
    if (labels.length === 0 && !options.includeAll) continue;

    const reasons = [];
    if (labels.includes("Hidden Gem")) reasons.push("Lage zichtbaarheid, hoge relevantie");
    if (labels.includes("Trending Local")) reasons.push("Interesse stijgt snel lokaal");
    if (rec.similarLikedCount > 0) reasons.push(`${rec.similarLikedCount} vergelijkbare likes in je profiel`);

    output.push({
      ...event,
      aiRadar: {
        labels,
        hiddenGemScore: Number(hiddenGemScore.toFixed(4)),
        trendingScore: Number(trendingScore.toFixed(4)),
        freshness: Number(freshness.toFixed(4)),
        lowVisibility: Number(lowVisibility.toFixed(4)),
        reasons,
      },
    });
  }

  output.sort((a, b) => Math.max(b.aiRadar.hiddenGemScore, b.aiRadar.trendingScore) - Math.max(a.aiRadar.hiddenGemScore, a.aiRadar.trendingScore));

  return {
    thresholds: { hiddenGem: hiddenGemThreshold, trendingLocal: trendingThreshold },
    items: output.slice(0, Math.max(1, Number(options.limit) || 20)),
  };
}

function normalizeToPercentages(items) {
  const total = items.reduce((sum, item) => sum + item.score, 0) || 1;
  let sumPercent = 0;
  return items.map((item, index) => {
    let pct = Math.round((item.score / total) * 100);
    if (index === items.length - 1) pct = Math.max(0, 100 - sumPercent);
    sumPercent += pct;
    return { ...item, percentage: pct };
  });
}

function buildTasteDNA(profile = {}) {
  const likedEvents = toArray(profile.likedEvents).filter(Boolean);
  const explicitPreferredGenres = toArray(profile.preferredGenres)
    .map((genre) => normalizeText(genre))
    .filter(Boolean);
  const preferred = getPreferredGenreWeights(profile);

  const genreVector = {};
  for (const [genre, weight] of preferred.entries()) genreVector[genre] = weight;
  for (const event of likedEvents) {
    const eventWeight = clamp(toNumber(event?.preferenceWeight) || 1, 0.35, 3);
    for (const prediction of predictGenresForEvent(event, { topK: 3 })) {
      const confidence = clamp(prediction.confidence, 0.1, 1);
      genreVector[prediction.genre] =
        (genreVector[prediction.genre] || 0) + eventWeight * confidence;
    }
    for (const genre of extractEventGenres(event)) {
      genreVector[genre] = (genreVector[genre] || 0) + eventWeight * 0.35;
    }
  }

  const hours = likedEvents
    .map((event) => {
      const dt = new Date(event?.start || "");
      return Number.isNaN(dt.getTime()) ? null : dt.getHours();
    })
    .filter((value) => value != null);

  const eveningRatio = hours.length > 0 ? hours.filter((h) => h >= 18 && h <= 23).length / hours.length : 0.5;
  const nightRatio = hours.length > 0 ? hours.filter((h) => h >= 22 || h < 3).length / hours.length : 0.3;

  const distances = likedEvents
    .map((event) => computeDistanceScore(event, profile).distanceKm)
    .filter((value) => Number.isFinite(value));
  const avgDistanceKm = distances.length > 0 ? distances.reduce((sum, value) => sum + value, 0) / distances.length : null;
  const localScore = avgDistanceKm == null ? 0.5 : clamp(1 - avgDistanceKm / Math.max(10, toNumber(profile.maxDistanceKm) || 35));
  const travelScore = avgDistanceKm == null ? 0.45 : clamp(avgDistanceKm / 35);

  const festivalRatio = likedEvents.length > 0
    ? likedEvents.filter((event) => /festival|open air|mainstage/i.test(buildEventText(event))).length / likedEvents.length
    : 0.25;

  const scored = ARCHETYPE_CONFIG.map((archetype) => {
    let score = 0.2;
    for (const [genre, weight] of Object.entries(archetype.genreWeights)) {
      score += (genreVector[genre] || 0) * weight;
    }
    if (archetype.localBias) score += localScore * archetype.localBias;
    if (archetype.distanceBias) score += travelScore * archetype.distanceBias;
    if (archetype.eveningBias) score += eveningRatio * archetype.eveningBias;
    if (archetype.nightBias) score += nightRatio * archetype.nightBias;
    if (archetype.festivalBias) score += festivalRatio * archetype.festivalBias;
    return { label: archetype.label, score: clamp(score, 0.01, 10) };
  }).sort((a, b) => b.score - a.score);

  const archetypes = normalizeToPercentages(scored);
  const summary = archetypes.slice(0, 3).map((item) => `${item.percentage}% ${item.label}`).join(", ");

  const topGenres = Object.entries(genreVector)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([genre]) => genre);

  if (likedEvents.length < 3 && explicitPreferredGenres.length < 2) {
    return {
      summary: null,
      archetypes: [],
      inferredPreferences: {
        topGenres: [...new Set([...explicitPreferredGenres, ...topGenres])].slice(0, 5),
        avgDistanceKm: avgDistanceKm == null ? null : Number(avgDistanceKm.toFixed(2)),
        eveningRatio: Number(eveningRatio.toFixed(3)),
        nightRatio: Number(nightRatio.toFixed(3)),
        festivalRatio: Number(festivalRatio.toFixed(3)),
        sampleSize: likedEvents.length,
      },
      generatedAt: new Date().toISOString(),
    };
  }

  return {
    summary,
    archetypes,
    inferredPreferences: {
      topGenres,
      avgDistanceKm: avgDistanceKm == null ? null : Number(avgDistanceKm.toFixed(2)),
      eveningRatio: Number(eveningRatio.toFixed(3)),
      nightRatio: Number(nightRatio.toFixed(3)),
      festivalRatio: Number(festivalRatio.toFixed(3)),
      sampleSize: likedEvents.length,
    },
    generatedAt: new Date().toISOString(),
  };
}

function suggestAgeRange(primaryGenre) {
  const genre = normalizeText(primaryGenre);
  if (["electronic", "hip-hop", "pop", "latin"].includes(genre)) return "21-28";
  if (["indie", "folk", "singer-songwriter"].includes(genre)) return "23-34";
  if (["jazz", "blues", "classical", "soul"].includes(genre)) return "28-45";
  if (["rock", "metal"].includes(genre)) return "20-35";
  return "21-32";
}

function suggestPromotionDay(eventDate) {
  if (!eventDate) return "Wednesday";
  const day = eventDate.getDay();
  if ([5, 6, 0].includes(day)) return "Wednesday";
  if ([1, 2].includes(day)) return "Thursday";
  return "Tuesday";
}

function predictEventSuccess(draftEvent, historicalEvents = []) {
  const draft = draftEvent || {};
  const draftGenres = extractEventGenres(draft);
  const draftTokens = buildTokenSet(buildEventText(draft));
  const draftDate = parseEventDate(draft);
  const draftCity = normalizeText(draft.city);

  const similar = [];
  for (const event of toArray(historicalEvents)) {
    const eventGenres = extractEventGenres(event);
    const sameGenre = eventGenres.some((genre) => draftGenres.includes(genre));
    const sameCity = draftCity && normalizeText(event.city) === draftCity;
    const textSimilarity = jaccard(draftTokens, buildTokenSet(buildEventText(event)));
    if (sameGenre || sameCity || textSimilarity >= 0.15) {
      similar.push({ event, sameCity });
    }
  }

  const basePopularityValues = similar
    .map((entry) => computePopularityScore(entry.event).combinedInterest)
    .filter((value) => Number.isFinite(value));
  const avgComparableInterest = basePopularityValues.length > 0
    ? basePopularityValues.reduce((sum, value) => sum + value, 0) / basePopularityValues.length
    : 18;

  const genreDemand = clamp(Math.log1p(avgComparableInterest) / Math.log1p(120));
  const locationFit = clamp(similar.filter((entry) => entry.sameCity).length / Math.max(similar.length, 5), 0.25, 0.95);

  let timeFit = 0.58;
  if (draftDate) {
    const day = draftDate.getDay();
    const hour = draftDate.getHours();
    const evening = hour >= 18 && hour <= 23;
    if (evening && [4, 5, 6].includes(day)) timeFit = 0.9;
    else if (evening && [2, 3].includes(day)) timeFit = 0.75;
    else if ([0].includes(day) && hour >= 14 && hour <= 20) timeFit = 0.72;
    else if (!evening && [1, 2, 3].includes(day)) timeFit = 0.52;
  }

  const price = toNumber(draft.cost);
  let priceFit = 0.68;
  if (draft.isFree === true || price === 0) priceFit = 0.8;
  else if (price != null && price <= 20) priceFit = 0.84;
  else if (price != null && price <= 40) priceFit = 0.72;
  else if (price != null && price > 70) priceFit = 0.46;

  let leadTimeFit = 0.62;
  if (draftDate) {
    const days = (draftDate.getTime() - Date.now()) / 86400000;
    if (days >= 21 && days <= 45) leadTimeFit = 0.9;
    else if (days >= 10 && days < 21) leadTimeFit = 0.75;
    else if (days > 45 && days <= 90) leadTimeFit = 0.68;
    else if (days >= 3 && days < 10) leadTimeFit = 0.5;
    else if (days < 3) leadTimeFit = 0.35;
  }

  const sameDayCompetition = similar.filter((entry) => {
    if (!draftDate) return false;
    const dt = parseEventDate(entry.event);
    if (!dt) return false;
    return dt.toISOString().slice(0, 10) === draftDate.toISOString().slice(0, 10);
  }).length;
  const competitionPenalty = clamp(sameDayCompetition / 12, 0, 0.25);

  const finalScore = clamp(
    genreDemand * 0.3 +
    locationFit * 0.2 +
    timeFit * 0.2 +
    priceFit * 0.15 +
    leadTimeFit * 0.15 -
    competitionPenalty
  );

  const probabilityHighAttendance = Math.round(clamp(0.3 + finalScore * 0.65, 0.05, 0.97) * 100);
  const expectedAttendance = Math.max(8, Math.round(avgComparableInterest * (0.55 + finalScore * 0.9)));

  const primaryGenre = draftGenres[0] || "music";
  const bestPromotionDay = suggestPromotionDay(draftDate);
  const targetAudienceAgeRange = suggestAgeRange(primaryGenre);

  const notes = [];
  if (genreDemand >= 0.7) notes.push("Sterke vraag in dit genre op basis van recente events.");
  if (timeFit < 0.6) notes.push("Timeslot is minder gunstig; overweeg een avondslot.");
  if (leadTimeFit < 0.55) notes.push("Korte lead time: start promotie onmiddellijk.");
  if (competitionPenalty >= 0.18) notes.push("Hoge concurrentie op dezelfde dag.");

  return {
    probabilityHighAttendance,
    expectedAttendance,
    bestPromotionDay,
    targetAudienceAgeRange,
    primaryGenre,
    components: {
      genreDemand: Number(genreDemand.toFixed(4)),
      locationFit: Number(locationFit.toFixed(4)),
      timeFit: Number(timeFit.toFixed(4)),
      priceFit: Number(priceFit.toFixed(4)),
      leadTimeFit: Number(leadTimeFit.toFixed(4)),
      competitionPenalty: Number(competitionPenalty.toFixed(4)),
      finalScore: Number(finalScore.toFixed(4)),
    },
    sampleContext: {
      similarEvents: similar.length,
      avgComparableInterest: Number(avgComparableInterest.toFixed(2)),
    },
    notes,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  DEFAULT_RECOMMENDATION_WEIGHTS,
  DEFAULT_RADAR_THRESHOLDS,
  predictGenresFromText,
  predictGenresForEvent,
  recommendEvents,
  buildUndergroundRadar,
  buildTasteDNA,
  predictEventSuccess,
};
