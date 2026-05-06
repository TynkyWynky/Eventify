const axios = require("axios");
const cheerio = require("cheerio");
const crypto = require("crypto");

const DEFAULT_USER_AGENT =
  "EventifyScraper/1.0 (+https://example.com/eventify; educational-project)";

function parseDelimitedUrls(rawValue) {
  if (!rawValue) return [];

  const values = String(rawValue)
    .split(/[,\n]/)
    .map((value) => value.trim())
    .filter(Boolean);

  const unique = new Set();
  const out = [];
  for (const value of values) {
    try {
      const parsed = new URL(value);
      if (!/^https?:$/i.test(parsed.protocol)) continue;
      const normalized = parsed.toString();
      if (unique.has(normalized)) continue;
      unique.add(normalized);
      out.push(normalized);
    } catch {
      // Skip invalid URLs.
    }
  }

  return out;
}

function cleanText(value) {
  if (value == null) return null;
  const text = String(value).replace(/\s+/g, " ").trim();
  return text || null;
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function toFiniteNumber(value) {
  if (value == null || value === "") return null;
  if (typeof value === "boolean") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeNumericToken(rawToken) {
  const token = cleanText(rawToken);
  if (!token || !/\d/.test(token)) return null;

  let text = token.replace(/\s+/g, "");
  const commaCount = (text.match(/,/g) || []).length;
  const dotCount = (text.match(/\./g) || []).length;
  const hasComma = commaCount > 0;
  const hasDot = dotCount > 0;

  if (hasComma && hasDot) {
    if (text.lastIndexOf(",") > text.lastIndexOf(".")) {
      // 1.234,56 -> 1234.56
      text = text.replace(/\./g, "").replace(",", ".");
    } else {
      // 1,234.56 -> 1234.56
      text = text.replace(/,/g, "");
    }
  } else if (hasComma) {
    if (commaCount > 1) {
      const last = text.lastIndexOf(",");
      const head = text.slice(0, last).replace(/,/g, "");
      const tail = text.slice(last + 1);
      text = tail.length <= 2 ? `${head}.${tail}` : `${head}${tail}`;
    } else {
      const split = text.split(",");
      const tail = split[1] || "";
      text = tail.length <= 2 ? text.replace(",", ".") : text.replace(/,/g, "");
    }
  } else if (hasDot) {
    if (dotCount > 1) {
      const last = text.lastIndexOf(".");
      const head = text.slice(0, last).replace(/\./g, "");
      const tail = text.slice(last + 1);
      text = tail.length <= 2 ? `${head}.${tail}` : `${head}${tail}`;
    } else {
      const split = text.split(".");
      const tail = split[1] || "";
      if (tail.length > 2) {
        text = text.replace(/\./g, "");
      }
    }
  }

  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractPriceNumbers(value) {
  if (value == null) return [];
  if (typeof value === "number") {
    return Number.isFinite(value) ? [value] : [];
  }

  const text = cleanText(value);
  if (!text) return [];

  const out = [];
  const direct = normalizeNumericToken(text);
  if (direct != null) out.push(direct);

  const tokenMatches = text.match(/\d[\d.,\s]*/g) || [];
  for (const token of tokenMatches) {
    const parsed = normalizeNumericToken(token);
    if (parsed != null) out.push(parsed);
  }

  const unique = new Set();
  const deduped = [];
  for (const amount of out) {
    const key = String(Math.round(amount * 10000) / 10000);
    if (unique.has(key)) continue;
    unique.add(key);
    deduped.push(amount);
  }

  return deduped;
}

function looksLikeFreePriceText(value) {
  const text = cleanText(value);
  if (!text) return false;
  return /\b(free\s+(entry|admission|event|concert|show|ticket|tickets)|entry\s+free|admission\s+free|gratis\s+(toegang|concert|event)|gratuit(?:e)?\s+(entree|acces|concert|evenement)|kostenlos(?:e)?\s+(eintritt|ticket)|vrije?\s+toegang|no\s*charge)\b/i.test(
    text
  );
}

function toTypeList(value) {
  const asArray = toArray(value);
  return asArray
    .map((entry) => cleanText(entry))
    .filter(Boolean)
    .map((entry) => entry.toLowerCase());
}

function parseJsonText(raw) {
  const trimmed = cleanText(raw);
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function collectJsonLdEvents(node, out) {
  if (!node) return;

  if (Array.isArray(node)) {
    for (const item of node) collectJsonLdEvents(item, out);
    return;
  }

  if (typeof node !== "object") return;

  if (Array.isArray(node["@graph"])) {
    collectJsonLdEvents(node["@graph"], out);
  }

  const types = toTypeList(node["@type"]);
  if (types.some((entry) => entry.includes("event"))) {
    out.push(node);
  }

  // Some pages nest Event objects under "mainEntity" / "itemListElement".
  const nestedCandidates = [
    "mainEntity",
    "itemListElement",
    "hasPart",
    "subEvent",
    "item",
  ];
  for (const key of nestedCandidates) {
    if (node[key] != null) collectJsonLdEvents(node[key], out);
  }
}

function extractJsonLdEventNodes(html) {
  const $ = cheerio.load(html);
  const out = [];

  $('script[type="application/ld+json"]').each((_, element) => {
    const raw = $(element).text();
    const parsed = parseJsonText(raw);
    if (!parsed) return;
    collectJsonLdEvents(parsed, out);
  });

  return out;
}

function extractEventbriteOffersFromNextData(html) {
  const $ = cheerio.load(html);
  const raw = cleanText($("#__NEXT_DATA__").text());
  if (!raw) return [];

  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  const offersSchema =
    parsed?.props?.pageProps?.context?.seo?.offersSchema ??
    parsed?.props?.pageProps?.seo?.offersSchema ??
    parsed?.props?.pageProps?.event?.offersSchema;
  return toArray(offersSchema).filter(Boolean);
}

function hostnameFromUrl(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function unwrapTrackingUrl(url, maxDepth = 3) {
  let current = cleanText(url);
  if (!current) return null;

  for (let i = 0; i < maxDepth; i++) {
    try {
      const parsed = new URL(current);
      const keys = ["u", "url", "redirect", "redirect_url", "target", "dest"];
      let next = null;
      for (const key of keys) {
        const value = cleanText(parsed.searchParams.get(key));
        if (!value) continue;
        const resolved = resolveUrlMaybe(value, current);
        if (resolved) {
          next = resolved;
          break;
        }
      }
      if (!next || next === current) break;
      current = next;
    } catch {
      break;
    }
  }

  return current;
}

function isSongkickHost(value) {
  const host = hostnameFromUrl(value) || cleanText(value)?.toLowerCase() || "";
  if (!host) return false;
  return host === "songkick.com" || host.endsWith(".songkick.com");
}

function isEventbriteHost(value) {
  const host = hostnameFromUrl(value) || cleanText(value)?.toLowerCase() || "";
  if (!host) return false;
  return /(^|\.)eventbrite\./i.test(host);
}

function resolveUrlMaybe(url, baseUrl) {
  const text = cleanText(url);
  if (!text) return null;
  try {
    return new URL(text, baseUrl).toString();
  } catch {
    return null;
  }
}

function normalizeEventUrl(url, baseUrl) {
  const resolved = resolveUrlMaybe(url, baseUrl);
  if (!resolved) return null;

  const unwrapped = unwrapTrackingUrl(resolved) || resolved;
  try {
    const parsed = new URL(unwrapped);
    parsed.hash = "";

    const host = parsed.hostname.toLowerCase();
    if (isEventbriteHost(host)) {
      // Eventbrite uses query params like `aff` for attribution; canonical URL is path-only.
      parsed.search = "";
    } else {
      const trackingParamPattern =
        /^(utm_|aff$|ref$|source$|fbclid$|gclid$|mc_[a-z]+$)/i;
      const keys = [...parsed.searchParams.keys()];
      for (const key of keys) {
        if (trackingParamPattern.test(key)) {
          parsed.searchParams.delete(key);
        }
      }
    }

    if (parsed.pathname !== "/") {
      parsed.pathname = parsed.pathname.replace(/\/+$/, "");
      if (!parsed.pathname) parsed.pathname = "/";
    }

    return parsed.toString();
  } catch {
    return cleanText(unwrapped);
  }
}

function extractEventbriteEventId(url) {
  try {
    const parsed = new URL(url);
    if (!isEventbriteHost(parsed.hostname)) return null;
    const pathname = decodeURIComponent(parsed.pathname || "");

    const byTicketSuffix = pathname.match(/tickets-(\d{6,})\/?$/i);
    if (byTicketSuffix) return byTicketSuffix[1];

    const byTrailingDigits = pathname.match(/-(\d{6,})\/?$/);
    if (byTrailingDigits) return byTrailingDigits[1];

    const eid = cleanText(parsed.searchParams.get("eid"));
    if (eid && /^\d{6,}$/.test(eid)) return eid;
  } catch {
    return null;
  }

  return null;
}

function pickImageUrl(image, baseUrl) {
  if (!image) return null;

  if (typeof image === "string") {
    return resolveUrlMaybe(image, baseUrl);
  }

  if (Array.isArray(image)) {
    for (const entry of image) {
      const picked = pickImageUrl(entry, baseUrl);
      if (picked) return picked;
    }
    return null;
  }

  if (typeof image === "object") {
    return (
      resolveUrlMaybe(image.url, baseUrl) ||
      resolveUrlMaybe(image.contentUrl, baseUrl) ||
      resolveUrlMaybe(image.thumbnailUrl, baseUrl)
    );
  }

  return null;
}

function extractMetaContent(html, nameOrProperty) {
  const $ = cheerio.load(html);
  const selectors = [
    `meta[property="${nameOrProperty}"]`,
    `meta[name="${nameOrProperty}"]`,
  ];
  for (const selector of selectors) {
    const value = cleanText($(selector).attr("content"));
    if (value) return value;
  }
  return null;
}

function parseTagsFromKeywords(keywords) {
  if (!keywords) return [];
  const parts = toArray(keywords)
    .flatMap((value) =>
      String(value)
        .split(/[;,|]/)
        .map((entry) => cleanText(entry))
        .filter(Boolean)
    )
    .slice(0, 20);

  const unique = [];
  const seen = new Set();
  for (const entry of parts) {
    const key = entry.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(entry);
  }
  return unique;
}

function parseAddressTextFallback(addressText) {
  const text = cleanText(addressText);
  if (!text) return { city: null, postalCode: null, country: null };

  let city = null;
  let postalCode = null;
  let country = null;

  const postalMatch = text.match(/\b(\d{4,6})\b/);
  if (postalMatch) {
    postalCode = cleanText(postalMatch[1]);
    const afterPostal = text
      .slice((postalMatch.index || 0) + postalMatch[0].length)
      .trim();
    const cityMatch = afterPostal.match(/^([A-Za-zÀ-ÿ'’\-\s]{2,})/);
    if (cityMatch) city = cleanText(cityMatch[1]);
  }

  if (!city) {
    const parts = text
      .split(/[,\-|/]/)
      .map((part) => cleanText(part))
      .filter(Boolean);
    for (let i = parts.length - 1; i >= 0; i--) {
      const part = parts[i];
      if (!part || /\d/.test(part)) continue;
      if (part.length < 2) continue;
      city = part;
      break;
    }
  }

  const lowered = text.toLowerCase();
  if (
    /belgium|belgie|belgique/.test(lowered) ||
    /brussel|brussels|antwerp|gent|ghent|brugge|bruges|leuven|li[eè]ge|namur|charleroi|mechelen|hasselt|mons/.test(
      lowered
    )
  ) {
    country = "Belgium";
  }

  return { city, postalCode, country };
}

function inferLocationFromHost(sourceHost) {
  const host = cleanText(sourceHost)?.toLowerCase() || "";
  if (!host) return { city: null, country: null };

  const hostDefaults = [
    { pattern: /abconcerts\.be$/, city: "Brussels", country: "Belgium" },
    { pattern: /anciennebelgique\.be$/, city: "Brussels", country: "Belgium" },
    { pattern: /botanique\.be$/, city: "Brussels", country: "Belgium" },
    { pattern: /bozar\.be$/, city: "Brussels", country: "Belgium" },
    { pattern: /trixonline\.be$/, city: "Antwerp", country: "Belgium" },
    { pattern: /hetdepot\.be$/, city: "Leuven", country: "Belgium" },
    { pattern: /uitinleuven\.be$/, city: "Leuven", country: "Belgium" },
    { pattern: /uitin\.mechelen\.be$/, city: "Mechelen", country: "Belgium" },
  ];

  const match = hostDefaults.find((entry) => entry.pattern.test(host));
  if (!match) return { city: null, country: null };
  return { city: match.city, country: match.country };
}

function normalizeEventDate(value) {
  const text = cleanText(value);
  if (!text) return null;

  const direct = new Date(text);
  if (!Number.isNaN(direct.getTime())) {
    return direct.toISOString();
  }

  // Example seen in the wild: 2026-02-24CET19:00:00+0100
  const withZoneName = text.match(
    /^(\d{4}-\d{2}-\d{2})([A-Za-z]{2,5})(\d{2}:\d{2}:\d{2})([+-]\d{2})(\d{2})$/
  );
  if (withZoneName) {
    const iso = `${withZoneName[1]}T${withZoneName[3]}${withZoneName[4]}:${withZoneName[5]}`;
    const parsed = new Date(iso);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  const withZoneNameNoOffset = text.match(
    /^(\d{4}-\d{2}-\d{2})([A-Za-z]{2,5})(\d{2}:\d{2}:\d{2})$/
  );
  if (withZoneNameNoOffset) {
    const zone = withZoneNameNoOffset[2].toUpperCase();
    const offset =
      zone === "CEST" ? "+02:00" : zone === "CET" ? "+01:00" : "+00:00";
    const iso = `${withZoneNameNoOffset[1]}T${withZoneNameNoOffset[3]}${offset}`;
    const parsed = new Date(iso);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  return text;
}

function normalizeAsciiishText(value) {
  const text = cleanText(value);
  if (!text) return "";
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

const LOCALIZED_MONTH_INDEX = Object.freeze({
  january: 1,
  jan: 1,
  janvier: 1,
  januari: 1,
  february: 2,
  feb: 2,
  fevrier: 2,
  fevr: 2,
  fev: 2,
  februari: 2,
  march: 3,
  mar: 3,
  mars: 3,
  maart: 3,
  april: 4,
  avril: 4,
  may: 5,
  mai: 5,
  mei: 5,
  june: 6,
  jun: 6,
  juin: 6,
  juni: 6,
  july: 7,
  jul: 7,
  juillet: 7,
  juli: 7,
  august: 8,
  aug: 8,
  aout: 8,
  augustus: 8,
  september: 9,
  sept: 9,
  octobre: 10,
  october: 10,
  okt: 10,
  oktober: 10,
  november: 11,
  december: 12,
  dec: 12,
  decembre: 12,
});

function pad2(value) {
  return String(Number(value) || 0).padStart(2, "0");
}

function parseMonthIndex(rawValue) {
  const token = normalizeAsciiishText(rawValue)
    .replace(/[^a-z]/g, "")
    .trim();
  if (!token) return null;
  return LOCALIZED_MONTH_INDEX[token] || null;
}

function parseTimeParts(value) {
  const text = cleanText(value);
  if (!text) return null;

  const amPmMatch = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (amPmMatch) {
    let hour = Number(amPmMatch[1]);
    const minute = Number(amPmMatch[2] || 0);
    const meridiem = amPmMatch[3].toLowerCase();
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
    return { hour, minute, second: 0 };
  }

  const twentyFourHour = text.match(/\b(\d{1,2})(?:[:hHuU](\d{2}))(?::(\d{2}))?\b/);
  if (twentyFourHour) {
    return {
      hour: Number(twentyFourHour[1]),
      minute: Number(twentyFourHour[2] || 0),
      second: Number(twentyFourHour[3] || 0),
    };
  }

  return null;
}

function parseNumericDateParts(value) {
  const text = cleanText(value);
  if (!text) return null;

  let match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    return {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
    };
  }

  match = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (match) {
    return {
      year: Number(match[3]),
      month: Number(match[2]),
      day: Number(match[1]),
    };
  }

  return null;
}

function parseLocalizedSingleDateParts(value) {
  const text = cleanText(value);
  if (!text) return null;

  const numeric = parseNumericDateParts(text);
  if (numeric) return numeric;

  const monthPattern = Object.keys(LOCALIZED_MONTH_INDEX)
    .sort((a, b) => b.length - a.length)
    .join("|");
  const singleRegex = new RegExp(
    `(?:^|\\b)(?:[a-z]{2,12}\\.?\\s+)?(\\d{1,2})\\s+(${monthPattern})\\s+(\\d{4})(?:\\b|$)`,
    "i"
  );
  const monthOnlyRegex = new RegExp(`(?:^|\\b)(${monthPattern})\\s+(\\d{4})(?:\\b|$)`, "i");

  let match = normalizeAsciiishText(text).match(singleRegex);
  if (match) {
    const month = parseMonthIndex(match[2]);
    if (month) {
      return {
        year: Number(match[3]),
        month,
        day: Number(match[1]),
      };
    }
  }

  match = normalizeAsciiishText(text).match(monthOnlyRegex);
  if (match) {
    const month = parseMonthIndex(match[1]);
    if (month) {
      return {
        year: Number(match[2]),
        month,
        day: 1,
      };
    }
  }

  return null;
}

function resolveEuropeBrusselsOffset(parts) {
  const guess = new Date(
    Date.UTC(
      parts.year,
      Math.max(0, parts.month - 1),
      Math.max(1, parts.day),
      parts.hour || 0,
      parts.minute || 0,
      parts.second || 0
    )
  );

  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Brussels",
      timeZoneName: "longOffset",
    });
    const zoneName = dtf
      .formatToParts(guess)
      .find((entry) => entry.type === "timeZoneName")?.value;
    const match = cleanText(zoneName)?.match(/GMT([+-]\d{1,2})(?::?(\d{2}))?/i);
    if (match) {
      const hours = match[1].replace(/([+-])(\d)$/, "$10$2");
      return `${hours}:${match[2] || "00"}`;
    }
  } catch {
    // Fall back below.
  }

  return parts.month >= 4 && parts.month <= 9 ? "+02:00" : "+01:00";
}

function buildEuropeBrusselsIso(parts, timeValue) {
  if (!parts) return null;
  const time = parseTimeParts(timeValue) || { hour: 0, minute: 0, second: 0 };
  const offset = resolveEuropeBrusselsOffset({
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: time.hour,
    minute: time.minute,
    second: time.second,
  });
  const iso = `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}T${pad2(time.hour)}:${pad2(
    time.minute
  )}:${pad2(time.second)}${offset}`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function parseLocalizedDateRange(value, timeValue) {
  const text = cleanText(value)?.replace(/[–—]/g, "-");
  if (!text) return { start: null, end: null };

  const numericRanges = text.match(/\d{1,2}[./-]\d{1,2}[./-]\d{4}/g) || [];
  if (numericRanges.length >= 2) {
    const startParts = parseNumericDateParts(numericRanges[0]);
    const endParts = parseNumericDateParts(numericRanges[1]);
    return {
      start: buildEuropeBrusselsIso(startParts, timeValue),
      end: buildEuropeBrusselsIso(endParts, timeValue),
    };
  }
  if (numericRanges.length === 1) {
    const parts = parseNumericDateParts(numericRanges[0]);
    const iso = buildEuropeBrusselsIso(parts, timeValue);
    return { start: iso, end: iso };
  }

  const normalized = normalizeAsciiishText(text);
  const monthPattern = Object.keys(LOCALIZED_MONTH_INDEX)
    .sort((a, b) => b.length - a.length)
    .join("|");
  const crossMonthRegex = new RegExp(
    `(?:^|\\b)(?:from\\s+)?(?:[a-z]{2,12}\\.?\\s+)?(\\d{1,2})\\s+(${monthPattern})\\s+(?:until|untill|to|au|tot(?:\\s+en\\s+met)?|-)\\s+(?:[a-z]{2,12}\\.?\\s+)?(\\d{1,2})\\s+(${monthPattern})\\s+(\\d{4})(?:\\b|$)`,
    "i"
  );
  const sameMonthRegex = new RegExp(
    `(?:^|\\b)(?:from\\s+)?(?:[a-z]{2,12}\\.?\\s+)?(\\d{1,2})\\s+(?:until|untill|to|au|tot(?:\\s+en\\s+met)?|-)\\s+(?:[a-z]{2,12}\\.?\\s+)?(\\d{1,2})\\s+(${monthPattern})\\s+(\\d{4})(?:\\b|$)`,
    "i"
  );

  let match = normalized.match(crossMonthRegex);
  if (match) {
    const startParts = {
      year: Number(match[5]),
      month: parseMonthIndex(match[2]),
      day: Number(match[1]),
    };
    const endParts = {
      year: Number(match[5]),
      month: parseMonthIndex(match[4]),
      day: Number(match[3]),
    };
    return {
      start: buildEuropeBrusselsIso(startParts, timeValue),
      end: buildEuropeBrusselsIso(endParts, timeValue),
    };
  }

  match = normalized.match(sameMonthRegex);
  if (match) {
    const month = parseMonthIndex(match[3]);
    const year = Number(match[4]);
    const startParts = { year, month, day: Number(match[1]) };
    const endParts = { year, month, day: Number(match[2]) };
    return {
      start: buildEuropeBrusselsIso(startParts, timeValue),
      end: buildEuropeBrusselsIso(endParts, timeValue),
    };
  }

  const single = parseLocalizedSingleDateParts(text);
  if (single) {
    const iso = buildEuropeBrusselsIso(single, timeValue);
    return { start: iso, end: iso };
  }

  const fallback = normalizeEventDate(text);
  return { start: fallback, end: fallback };
}

function createNormalizedScrapedEvent(fields, context = {}) {
  const title = cleanText(fields?.title);
  const start = cleanText(fields?.start);
  if (!title || !start || !hasConcreteIsoDate(start)) return null;

  const sourceHost =
    cleanText(context.sourceHost) ||
    hostnameFromUrl(context.pageUrl) ||
    hostnameFromUrl(context.sourceUrl);
  const eventUrl =
    normalizeEventUrl(fields?.url || fields?.ticketUrl || context.pageUrl, context.pageUrl) ||
    normalizeEventUrl(context.pageUrl, context.pageUrl);
  const hostLocation = inferLocationFromHost(sourceHost);
  const tags = parseTagsFromKeywords(
    [
      ...(Array.isArray(fields?.tags) ? fields.tags : []),
      cleanText(fields?.genre),
      cleanText(fields?.category),
      cleanText(fields?.artistName),
      cleanText(fields?.city),
    ].filter(Boolean)
  );

  return {
    source: "webscrape",
    sourceId: buildSourceId({
      eventUrl,
      title,
      start,
      venue: cleanText(fields?.venue),
      sourceHost,
    }),
    title,
    description: cleanText(fields?.description),
    start,
    end: cleanText(fields?.end),
    timezone: cleanText(fields?.timezone) || "Europe/Brussels",
    venue: cleanText(fields?.venue),
    address: cleanText(fields?.address),
    city: cleanText(fields?.city) || hostLocation.city,
    state: cleanText(fields?.state),
    country: cleanText(fields?.country) || hostLocation.country || "Belgium",
    postalCode: cleanText(fields?.postalCode),
    lat: toFiniteNumber(fields?.lat),
    lng: toFiniteNumber(fields?.lng),
    isVirtual: Boolean(fields?.isVirtual),
    virtualLink: cleanText(fields?.virtualLink),
    isFree: Boolean(fields?.isFree),
    cost: toFiniteNumber(fields?.cost),
    priceMin: toFiniteNumber(fields?.priceMin),
    priceMax: toFiniteNumber(fields?.priceMax),
    currency: cleanText(fields?.currency) || "EUR",
    url: eventUrl,
    ticketUrl: normalizeEventUrl(fields?.ticketUrl || eventUrl, context.pageUrl),
    imageUrl: resolveUrlMaybe(fields?.imageUrl, context.pageUrl || context.sourceUrl),
    genre: cleanText(fields?.genre),
    category: cleanText(fields?.category),
    tags,
    artistName: cleanText(fields?.artistName),
    organizerName: cleanText(fields?.organizerName),
    status: cleanText(fields?.status),
    metadata: {
      scrapedFrom: cleanText(context.pageUrl),
      sourceListingUrl: cleanText(context.sourceUrl) || cleanText(context.pageUrl),
      sourceHost,
      raw: fields?.raw ?? null,
    },
  };
}

function hasConcreteIsoDate(value) {
  const text = cleanText(value);
  return Boolean(text && /^\d{4}-\d{2}-\d{2}t/i.test(text.replace("T", "t")));
}

function resolveMergedIsFree(primary, secondary, merged) {
  const costCandidates = [
    primary?.cost,
    primary?.priceMin,
    primary?.priceMax,
    secondary?.cost,
    secondary?.priceMin,
    secondary?.priceMax,
    merged?.cost,
    merged?.priceMin,
    merged?.priceMax,
  ]
    .map((value) => toFiniteNumber(value))
    .filter((value) => value != null);

  if (costCandidates.some((value) => value > 0)) return false;
  if (costCandidates.some((value) => value === 0)) return true;

  const flags = [primary?.isFree, secondary?.isFree].filter(
    (value) => typeof value === "boolean"
  );

  if (flags.includes(false)) return false;
  if (flags.includes(true)) return true;
  return false;
}

function mergeEventData(baseEvent, enrichment) {
  const merged = { ...baseEvent };

  const fields = [
    "description",
    "start",
    "end",
    "timezone",
    "venue",
    "address",
    "city",
    "state",
    "country",
    "postalCode",
    "lat",
    "lng",
    "virtualLink",
    "cost",
    "priceMin",
    "priceMax",
    "currency",
    "ticketUrl",
    "genre",
    "category",
    "artistName",
    "organizerName",
    "status",
    "imageUrl",
  ];

  for (const key of fields) {
    const current = merged[key];
    const next = enrichment[key];

    const hasCurrent =
      current != null &&
      !(typeof current === "string" && cleanText(current) == null);
    const hasNext =
      next != null && !(typeof next === "string" && cleanText(next) == null);

    if (!hasCurrent && hasNext) {
      merged[key] = next;
    }
  }

  merged.isFree = resolveMergedIsFree(baseEvent, enrichment, merged);
  merged.isVirtual = Boolean(baseEvent.isVirtual || enrichment.isVirtual);

  const tags = new Set([...(baseEvent.tags || []), ...(enrichment.tags || [])]);
  merged.tags = [...tags].filter(Boolean);

  return merged;
}

function extractSongkickTicketLink(pageHtml, pageUrl) {
  const $ = cheerio.load(pageHtml);
  const directVenueWebsiteCandidates = [];
  const ticketRedirectCandidates = [];
  const seen = new Set();

  $("a[href]").each((_, element) => {
    const href = resolveUrlMaybe($(element).attr("href"), pageUrl);
    if (!href) return;
    if (seen.has(href)) return;

    const text = cleanText($(element).text()) || "";
    const textLower = text.toLowerCase();
    const path = new URL(href).pathname.toLowerCase();
    seen.add(href);

    if (!isSongkickHost(href) && /venue website/.test(textLower)) {
      directVenueWebsiteCandidates.push(href);
      return;
    }

    if (/\/tickets\/\d+/.test(path) && isSongkickHost(href)) {
      ticketRedirectCandidates.push(href);
      return;
    }
  });

  if (directVenueWebsiteCandidates.length > 0) {
    return directVenueWebsiteCandidates[0];
  }
  if (ticketRedirectCandidates.length > 0) {
    return ticketRedirectCandidates[0];
  }
  return null;
}

async function resolveRedirectTarget(url, options) {
  try {
    const response = await axios.get(url, {
      timeout: options.songkickTicketTimeoutMs || options.timeoutMs,
      responseType: "text",
      maxRedirects: 0,
      headers: {
        "User-Agent": options.userAgent || DEFAULT_USER_AGENT,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      validateStatus(status) {
        return status >= 200 && status < 400;
      },
    });

    const location = resolveUrlMaybe(response.headers?.location, url);
    if (location) return location;

    const finalUrl = cleanText(response.request?.res?.responseUrl);
    if (finalUrl) return finalUrl;

    return cleanText(url);
  } catch {
    return null;
  }
}

async function enrichFromOfficialPage(event, officialUrl, options) {
  if (!officialUrl || !options.enableOfficialPageEnrichment) {
    return event;
  }

  try {
    const html = await fetchHtml(officialUrl, {
      ...options,
      timeoutMs: options.officialPageTimeoutMs || options.timeoutMs,
    });

    const nodes = extractJsonLdEventNodes(html);
    if (nodes.length > 0) {
      const node = normalizeJsonLdEvent(nodes[0], {
        pageUrl: officialUrl,
        sourceHost: hostnameFromUrl(officialUrl),
      });
      if (node) {
        const merged = mergeEventData(event, node);
        return {
          ...merged,
          metadata: {
            ...(merged.metadata || {}),
            officialPageEnriched: true,
            officialPageSource: "jsonld",
          },
        };
      }
    }

    const fallbackDescription =
      extractMetaContent(html, "og:description") ||
      extractMetaContent(html, "description");
    const fallbackImage = extractMetaContent(html, "og:image");

    const merged = { ...event };
    if (!cleanText(merged.description) && cleanText(fallbackDescription)) {
      merged.description = cleanText(fallbackDescription);
    }
    if (!cleanText(merged.imageUrl) && cleanText(fallbackImage)) {
      merged.imageUrl = cleanText(fallbackImage);
    }
    merged.metadata = {
      ...(merged.metadata || {}),
      officialPageEnriched: Boolean(
        cleanText(fallbackDescription) || cleanText(fallbackImage)
      ),
      officialPageSource: "meta",
    };

    return merged;
  } catch {
    return event;
  }
}

async function enrichSongkickEvent(event, pageHtml, pageUrl, options) {
  const linkCandidate = extractSongkickTicketLink(pageHtml, pageUrl);
  if (!linkCandidate) return event;

  let officialUrl = linkCandidate;
  if (isSongkickHost(linkCandidate)) {
    const resolved = await resolveRedirectTarget(linkCandidate, options);
    if (resolved) officialUrl = resolved;
  }

  if (!officialUrl) return event;
  officialUrl = unwrapTrackingUrl(officialUrl) || officialUrl;

  const officialHost = hostnameFromUrl(officialUrl);
  const keepOriginalUrl = cleanText(event.url) || cleanText(pageUrl);

  const enrichedBase = {
    ...event,
    url: officialUrl,
    ticketUrl: officialUrl,
    metadata: {
      ...(event.metadata || {}),
      songkickUrl: keepOriginalUrl,
      officialEventUrl: officialUrl,
      officialEventHost: officialHost || null,
      songkickTicketRedirectUrl: isSongkickHost(linkCandidate)
        ? linkCandidate
        : null,
    },
  };

  const needsOfficialPageData =
    !cleanText(enrichedBase.description) ||
    !cleanText(enrichedBase.imageUrl) ||
    !cleanText(enrichedBase.city) ||
    !cleanText(enrichedBase.country);

  if (!needsOfficialPageData) {
    return enrichedBase;
  }

  if (!isSongkickHost(officialUrl)) {
    return enrichFromOfficialPage(enrichedBase, officialUrl, options);
  }

  return enrichedBase;
}

function parseLocation(location, pageUrl) {
  const candidates = toArray(location).filter(Boolean);
  const placeLike =
    candidates.find((item) => {
      const types = toTypeList(item?.["@type"]);
      return types.some((entry) => entry.includes("place"));
    }) || candidates[0] || null;

  const addressObject =
    typeof placeLike?.address === "object" && placeLike.address
      ? placeLike.address
      : null;
  const addressString =
    typeof placeLike?.address === "string" ? cleanText(placeLike.address) : null;

  const addressFromObject = addressObject
    ? [
        cleanText(addressObject.streetAddress),
        cleanText(addressObject.addressLocality),
        cleanText(addressObject.addressRegion),
        cleanText(addressObject.postalCode),
        cleanText(
          typeof addressObject.addressCountry === "object"
            ? addressObject.addressCountry.name
            : addressObject.addressCountry
        ),
      ]
        .filter(Boolean)
        .join(", ")
    : null;

  const address =
    addressString || cleanText(addressFromObject) || cleanText(placeLike?.name);
  const addressFallback = parseAddressTextFallback(addressString || addressFromObject);
  const city = cleanText(addressObject?.addressLocality) || addressFallback.city;
  const state = cleanText(addressObject?.addressRegion);
  const postalCode =
    cleanText(addressObject?.postalCode) || cleanText(addressFallback.postalCode);
  const country = cleanText(
    typeof addressObject?.addressCountry === "object"
      ? addressObject.addressCountry.name
      : addressObject?.addressCountry
  ) || cleanText(addressFallback.country);

  const latitudeRaw = placeLike?.geo?.latitude;
  const longitudeRaw = placeLike?.geo?.longitude;
  const latitude = Number(latitudeRaw);
  const longitude = Number(longitudeRaw);

  const types = toTypeList(placeLike?.["@type"]);
  const attendanceMode = cleanText(placeLike?.eventAttendanceMode) || "";
  const isVirtual =
    types.some((entry) => entry.includes("virtuallocation")) ||
    /onlineeventattendancemode/i.test(attendanceMode);
  const virtualLink = resolveUrlMaybe(placeLike?.url, pageUrl);

  return {
    venue: cleanText(placeLike?.name),
    address,
    city,
    state,
    country,
    postalCode,
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
    isVirtual,
    virtualLink,
  };
}

function parseOffers(offers, pageUrl, isAccessibleForFree) {
  const candidates = toArray(offers).filter(Boolean);

  let cost = null;
  let priceMin = null;
  let priceMax = null;
  let currency = null;
  let ticketUrl = null;
  let availability = null;
  let sawPositivePrice = false;
  let sawZeroPrice = false;
  let sawFreeLabel = false;
  const positivePrices = [];

  const capturePrice = (value) => {
    const amounts = extractPriceNumbers(value);
    for (const amount of amounts) {
      if (amount > 0) {
        sawPositivePrice = true;
        positivePrices.push(amount);
      } else if (amount === 0) {
        sawZeroPrice = true;
      }
    }
    if (typeof value === "string" && looksLikeFreePriceText(value)) {
      sawFreeLabel = true;
    }
  };

  const inspectOfferNode = (node, depth = 0) => {
    if (node == null || depth > 3) return;

    if (Array.isArray(node)) {
      for (const entry of node) inspectOfferNode(entry, depth + 1);
      return;
    }

    if (typeof node !== "object") {
      capturePrice(node);
      return;
    }

    currency =
      currency ||
      cleanText(node.priceCurrency) ||
      cleanText(node.currency) ||
      cleanText(node.currencyCode);

    capturePrice(node.price);
    capturePrice(node.lowPrice);
    capturePrice(node.highPrice);
    capturePrice(node.minPrice);
    capturePrice(node.maxPrice);
    capturePrice(node.amount);
    capturePrice(node.value);
    capturePrice(node.listPrice);
    capturePrice(node.priceRange);

    if (node.priceSpecification != null) {
      inspectOfferNode(node.priceSpecification, depth + 1);
    }
    if (node.offers != null) {
      inspectOfferNode(node.offers, depth + 1);
    }
  };

  for (const offer of candidates) {
    ticketUrl = ticketUrl || normalizeEventUrl(offer?.url, pageUrl);
    availability = availability || cleanText(offer?.availability);
    inspectOfferNode(offer);
  }

  const weakAccessibleHint = Boolean(
    isAccessibleForFree === true && candidates.length === 0
  );

  const isFree = sawPositivePrice
    ? false
    : sawZeroPrice || sawFreeLabel || weakAccessibleHint;

  if (positivePrices.length > 0) {
    priceMin = Math.min(...positivePrices);
    priceMax = Math.max(...positivePrices);
    cost = priceMin;
  }

  if (isFree && cost == null && !sawPositivePrice) {
    cost = 0;
    priceMin = 0;
    priceMax = 0;
  }

  return {
    cost,
    priceMin,
    priceMax,
    currency,
    ticketUrl,
    isFree,
    availability,
  };
}

function parsePerformerName(eventNode) {
  const performerCandidates = [
    ...toArray(eventNode?.performer),
    ...toArray(eventNode?.actor),
    ...toArray(eventNode?.byArtist),
  ].filter(Boolean);

  for (const performer of performerCandidates) {
    if (typeof performer === "string") {
      return cleanText(performer);
    }
    if (typeof performer === "object") {
      const name = cleanText(performer?.name);
      if (name) return name;
    }
  }

  return null;
}

function parseStatus(eventStatus) {
  const raw = cleanText(eventStatus);
  if (!raw) return null;

  if (/cancelled/i.test(raw)) return "cancelled";
  if (/postponed|rescheduled/i.test(raw)) return "published";
  if (/eventscheduled|scheduled/i.test(raw)) return "published";
  if (/completed/i.test(raw)) return "completed";

  return null;
}

function buildSourceId({ eventUrl, title, start, venue, sourceHost }) {
  const normalizedEventUrl = normalizeEventUrl(eventUrl);
  if (isEventbriteHost(normalizedEventUrl || sourceHost)) {
    const eventbriteId = extractEventbriteEventId(normalizedEventUrl || eventUrl);
    if (eventbriteId) {
      return crypto
        .createHash("sha1")
        .update(`eventbrite|${eventbriteId}`)
        .digest("hex")
        .slice(0, 32);
    }
  }

  const raw =
    cleanText(normalizedEventUrl) ||
    [cleanText(title), cleanText(start), cleanText(venue), cleanText(sourceHost)]
      .filter(Boolean)
      .join("|");

  return crypto.createHash("sha1").update(raw || `fallback-${Date.now()}`).digest("hex").slice(0, 32);
}

function normalizeJsonLdEvent(eventNode, context) {
  const title = cleanText(eventNode?.name) || cleanText(eventNode?.headline);
  const start = normalizeEventDate(eventNode?.startDate);
  if (!title || !start) return null;

  const end = normalizeEventDate(eventNode?.endDate);
  const description = cleanText(eventNode?.description);
  const eventUrl =
    normalizeEventUrl(eventNode?.url || eventNode?.sameAs, context.pageUrl) ||
    normalizeEventUrl(context.pageUrl, context.pageUrl);
  const imageUrl = pickImageUrl(eventNode?.image, context.pageUrl);

  const location = parseLocation(eventNode?.location, context.pageUrl);
  const hostLocation = inferLocationFromHost(context.sourceHost);
  const offers = parseOffers(eventNode?.offers, context.pageUrl, eventNode?.isAccessibleForFree);
  const artistName = parsePerformerName(eventNode);
  const organizerName = cleanText(
    typeof eventNode?.organizer === "object" ? eventNode.organizer.name : eventNode?.organizer
  );
  const genre = cleanText(
    Array.isArray(eventNode?.genre) ? eventNode.genre.join(", ") : eventNode?.genre
  );
  const category =
    cleanText(
      Array.isArray(eventNode?.eventType) ? eventNode.eventType[0] : eventNode?.eventType
    ) || cleanText(eventNode?.about);

  const tags = parseTagsFromKeywords(eventNode?.keywords);
  if (genre && !tags.some((entry) => entry.toLowerCase() === genre.toLowerCase())) {
    tags.push(genre);
  }
  if (category && !tags.some((entry) => entry.toLowerCase() === category.toLowerCase())) {
    tags.push(category);
  }

  const attendanceMode = cleanText(eventNode?.eventAttendanceMode) || "";
  const isVirtual =
    location.isVirtual || /onlineeventattendancemode/i.test(attendanceMode);

  return {
    source: "webscrape",
    sourceId: buildSourceId({
      eventUrl,
      title,
      start,
      venue: location.venue,
      sourceHost: context.sourceHost,
    }),
    title,
    description,
    start,
    end,
    timezone: cleanText(eventNode?.timezone),
    venue: location.venue,
    address: location.address,
    city: location.city || hostLocation.city,
    state: location.state,
    country: location.country || hostLocation.country,
    postalCode: location.postalCode,
    lat: location.latitude,
    lng: location.longitude,
    isVirtual,
    virtualLink: isVirtual ? location.virtualLink || eventUrl : null,
    isFree: offers.isFree,
    cost: offers.cost,
    priceMin: offers.priceMin,
    priceMax: offers.priceMax,
    currency: offers.currency || "USD",
    url: eventUrl,
    ticketUrl: normalizeEventUrl(offers.ticketUrl || eventUrl, context.pageUrl),
    imageUrl,
    genre,
    category,
    tags,
    artistName,
    organizerName,
    status: parseStatus(eventNode?.eventStatus),
    metadata: {
      scrapedFrom: context.pageUrl,
      sourceListingUrl: cleanText(context.sourceUrl) || cleanText(context.pageUrl),
      sourceHost: context.sourceHost,
      availability: offers.availability,
      priceMin: offers.priceMin,
      priceMax: offers.priceMax,
      raw: eventNode,
    },
  };
}

function pathSegments(pathname) {
  return String(pathname || "")
    .split("/")
    .map((segment) => segment.trim().toLowerCase())
    .filter(Boolean);
}

function startsWithSegments(pathA, pathB) {
  if (pathB.length === 0 || pathA.length < pathB.length) return false;
  for (let i = 0; i < pathB.length; i++) {
    if (pathA[i] !== pathB[i]) return false;
  }
  return true;
}

function looksLikeEventLink(url, sourceUrl) {
  try {
    const parsed = new URL(url);
    const source = new URL(sourceUrl);
    const path = `${parsed.pathname}${parsed.search}`.toLowerCase();
    if (!/^https?:$/i.test(parsed.protocol)) return false;

    const parsedHost = parsed.hostname.toLowerCase();
    const sourceHost = source.hostname.toLowerCase();
    const sameHost = parsedHost === sourceHost;
    const sameEventbriteFamily =
      isEventbriteHost(parsedHost) && isEventbriteHost(sourceHost);

    if (!sameHost && !sameEventbriteFamily) return false;

    const pathname = parsed.pathname.toLowerCase();
    const sourcePathname = source.pathname.toLowerCase();
    const segments = pathSegments(pathname);
    const sourceSegments = pathSegments(sourcePathname);

    if (sameEventbriteFamily) {
      return /^\/e\/.+/i.test(pathname) || /tickets-\d{6,}/i.test(pathname);
    }

    if (isSongkickHost(parsed.hostname) && isSongkickHost(source.hostname)) {
      const isFestivalEvent =
        segments[0] === "festivals" &&
        segments.includes("id") &&
        segments.some((segment) => /\d{5,}/.test(segment));
      const isConcertEvent =
        segments[0] === "concerts" &&
        segments.some((segment) => /\d{5,}/.test(segment));
      const isFestivalHub = segments[0] === "festivals";
      return Boolean(isFestivalEvent || isConcertEvent || isFestivalHub);
    }

    const blockTokens = [
      "login",
      "register",
      "privacy",
      "cookie",
      "faq",
      "contact",
      "about",
      "jobs",
      "terms",
      "press",
      "news",
      "search",
      "account",
      "cart",
      "checkout",
      "support",
    ];
    if (segments.some((segment) => blockTokens.includes(segment))) return false;

    const eventTokenRegex =
      /(event|events|concert|show|gig|festival|ticket|agenda|calendar|programme|program|whatson|whats-on|lineup)/i;
    const hasEventToken = eventTokenRegex.test(path);

    const samePath = pathname === sourcePathname;
    const deeperInSameSection =
      sourceSegments.length > 0 &&
      startsWithSegments(segments, sourceSegments) &&
      segments.length > sourceSegments.length;

    const sourceLeaf = sourceSegments[sourceSegments.length - 1];
    const containsSourceLeaf =
      sourceLeaf && segments.length > sourceSegments.length && segments.includes(sourceLeaf);

    // Ignore shallow pagination/listing links unless they clearly point to event-like paths.
    const isShallowListing = segments.length <= sourceSegments.length;
    if (samePath && !hasEventToken) return false;
    if (isShallowListing && !hasEventToken) return false;

    return Boolean(hasEventToken || deeperInSameSection || containsSourceLeaf);
  } catch {
    return false;
  }
}

function extractCandidateLinks(html, sourceUrl, maxLinksPerSource) {
  const $ = cheerio.load(html);
  const sourceHost = new URL(sourceUrl).hostname.toLowerCase();
  const links = [];
  const seen = new Set();

  $("a[href]").each((_, element) => {
    if (links.length >= maxLinksPerSource) return;

    const href = $(element).attr("href");
    const absolute =
      normalizeEventUrl(href, sourceUrl) || resolveUrlMaybe(href, sourceUrl);
    if (!absolute) return;
    if (!looksLikeEventLink(absolute, sourceUrl)) return;

    const host = new URL(absolute).hostname.toLowerCase();
    const sameHost = host === sourceHost;
    const sameEventbriteFamily =
      isEventbriteHost(host) && isEventbriteHost(sourceHost);
    if (!sameHost && !sameEventbriteFamily) return;
    if (seen.has(absolute)) return;

    seen.add(absolute);
    links.push(absolute);
  });

  return links;
}

async function fetchHtml(url, options) {
  const { data } = await axios.get(url, {
    timeout: options.timeoutMs,
    responseType: "text",
    maxRedirects: 5,
    headers: {
      "User-Agent": options.userAgent || DEFAULT_USER_AGENT,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    validateStatus(status) {
      return status >= 200 && status < 400;
    },
  });

  return typeof data === "string" ? data : String(data || "");
}

async function fetchJson(url, options) {
  const { data } = await axios.get(url, {
    timeout: options.timeoutMs,
    responseType: "json",
    maxRedirects: 5,
    headers: {
      "User-Agent": options.userAgent || DEFAULT_USER_AGENT,
      Accept: "application/json,text/plain,*/*",
    },
    validateStatus(status) {
      return status >= 200 && status < 400;
    },
  });

  return data && typeof data === "object" ? data : null;
}

async function postJson(url, body, options) {
  const { data } = await axios.post(url, body, {
    timeout: options.timeoutMs,
    responseType: "json",
    maxRedirects: 5,
    headers: {
      "User-Agent": options.userAgent || DEFAULT_USER_AGENT,
      Accept: "application/json,text/plain,*/*",
      "Content-Type": "application/json",
    },
    validateStatus(status) {
      return status >= 200 && status < 500;
    },
  });

  return data && typeof data === "object" ? data : null;
}

function buildEventDedupeKey(event) {
  const sourceKey = cleanText(event?.sourceId);
  if (sourceKey) return sourceKey;

  return [
    cleanText(event?.title)?.toLowerCase(),
    cleanText(event?.start),
    cleanText(event?.city)?.toLowerCase(),
    cleanText(event?.venue)?.toLowerCase(),
  ]
    .filter(Boolean)
    .join("|");
}

function hasExplicitStartTime(event) {
  const rawStart = cleanText(event?.metadata?.raw?.startDate);
  if (rawStart && /t\d{2}:\d{2}/i.test(rawStart)) return true;

  const normalizedStart = cleanText(event?.start);
  if (!normalizedStart) return false;
  if (!/t\d{2}:\d{2}/i.test(normalizedStart)) return false;
  return !/t00:00(?::00(?:\.000)?)?z?$/i.test(normalizedStart);
}

function scoreEventCompleteness(event) {
  let score = 0;
  if (cleanText(event?.title)) score += 2;
  if (cleanText(event?.start)) score += 2;
  if (hasExplicitStartTime(event)) score += 2;
  if (cleanText(event?.venue)) score += 1;
  if (cleanText(event?.city)) score += 1;
  if (cleanText(event?.country)) score += 1;
  if (cleanText(event?.description)?.length >= 40) score += 1;
  if (cleanText(event?.imageUrl)) score += 1;
  if (cleanText(event?.ticketUrl) || cleanText(event?.url)) score += 1;
  if (Array.isArray(event?.tags) && event.tags.length > 0) score += 1;
  return score;
}

function dedupeEvents(events, limit) {
  const out = [];
  const seen = new Map();

  for (const event of events) {
    const key = buildEventDedupeKey(event);
    if (!key) continue;

    if (!seen.has(key)) {
      const nextIndex = out.length;
      out.push(event);
      seen.set(key, nextIndex);
      if (out.length >= limit) break;
      continue;
    }

    const existingIndex = seen.get(key);
    const existing = out[existingIndex];
    const existingScore = scoreEventCompleteness(existing);
    const candidateScore = scoreEventCompleteness(event);

    const winner = candidateScore >= existingScore ? event : existing;
    const loser = winner === event ? existing : event;

    const merged = mergeEventData(winner, loser);
    out[existingIndex] = merged;
    seen.set(key, existingIndex);
  }

  return out;
}

function pickElementImageUrl($root, baseUrl) {
  const direct =
    cleanText($root.find("img").first().attr("src")) ||
    cleanText($root.find("img").first().attr("data-src"));
  if (direct) return resolveUrlMaybe(direct, baseUrl);

  const srcset = cleanText($root.find("source").first().attr("srcset"));
  if (!srcset) return null;
  const firstCandidate = cleanText(srcset.split(",")[0]?.trim().split(/\s+/)[0]);
  return resolveUrlMaybe(firstCandidate, baseUrl);
}

function isVisitBrusselsFeedUrl(value) {
  const url = cleanText(value)?.toLowerCase() || "";
  return url.includes("visit.brussels") && url.includes("agendafinder.feed.json");
}

function isVisitGentConcertsUrl(value) {
  const url = cleanText(value)?.toLowerCase() || "";
  return url.includes("visit.gent.be") && url.includes("/calendar/events");
}

function isVisitLeuvenEventsUrl(value) {
  const url = cleanText(value)?.toLowerCase() || "";
  return url.includes("visitleuven.be") && /\/events(?:$|\?)/.test(url);
}

function isVisitLiegeMusicUrl(value) {
  const url = cleanText(value)?.toLowerCase() || "";
  return url.includes("visitezliege.be") && url.includes("/catalogue/evenement/musique");
}

function isVisitBrugesEventsUrl(value) {
  const url = cleanText(value)?.toLowerCase() || "";
  return url.includes("visitbruges.be") && url.includes("/events-calendar");
}

function isVisitMonsConcertsUrl(value) {
  const url = cleanText(value)?.toLowerCase() || "";
  return url.includes("visitmons.be") && url.includes("/agenda/concerts");
}

function isCharleroiAgendaUrl(value) {
  const url = cleanText(value)?.toLowerCase() || "";
  return url.includes("charleroi.be/agenda");
}

function isVisitNamurAgendaUrl(value) {
  const url = cleanText(value)?.toLowerCase() || "";
  return url.includes("destination.visitnamur.eu/agenda");
}

function isTrixConcertsUrl(value) {
  const url = cleanText(value)?.toLowerCase() || "";
  return url.includes("trixonline.be") && url.includes("/program/") && url.includes("type=concert");
}

function isCchaConcertsUrl(value) {
  const url = cleanText(value)?.toLowerCase() || "";
  return url.includes("ccha.be/concerten");
}

function isUitInMechelenAgendaUrl(value) {
  const url = cleanText(value)?.toLowerCase() || "";
  return url.includes("uitin.mechelen.be/agenda");
}

function isUitInLeuvenAgendaUrl(value) {
  const url = cleanText(value)?.toLowerCase() || "";
  return url.includes("uitinleuven.be/agenda");
}

function isUitInVlaanderenMusicUrl(value) {
  const url = cleanText(value)?.toLowerCase() || "";
  return url.includes("uitinvlaanderen.be/agenda/muziek");
}

function isVisitLimburgAgendaUrl(value) {
  const url = cleanText(value)?.toLowerCase() || "";
  if (!url.includes("visitlimburg.be")) return false;
  return /\/(?:nl|en|fr|de)\/(?:events-festivals|hasselt\/hasselt)(?:$|[/?#])/.test(url);
}

function isGenericUitInAgendaUrl(value) {
  const url = cleanText(value)?.toLowerCase() || "";
  if (!url.includes("/agenda")) return false;
  if (url.includes("uitin.mechelen.be/agenda")) return false;
  return url.includes("uitinleuven.be/agenda");
}

function pickVisitBrusselsTranslation(item) {
  const translations = item?.translations || {};
  return (
    translations.en ||
    translations.fr ||
    translations.nl ||
    Object.values(translations).find((value) => value && typeof value === "object") ||
    {}
  );
}

function pickVisitBrusselsPlaceTranslation(item) {
  const translations = item?.place?.translations || {};
  return (
    translations.en ||
    translations.fr ||
    translations.nl ||
    Object.values(translations).find((value) => value && typeof value === "object") ||
    {}
  );
}

function flattenVisitBrusselsCategoryLabels(item) {
  const out = [];
  const main = item?.categories?.main?.translations || {};
  const others = item?.categories?.others?.translations || {};

  for (const value of Object.values(main)) {
    const label = cleanText(value);
    if (label) out.push(label);
  }

  for (const value of Object.values(others)) {
    for (const entry of toArray(value)) {
      const label = cleanText(entry);
      if (label) out.push(label);
    }
  }

  return Array.from(new Set(out.map((label) => label.trim()))).filter(Boolean);
}

function pickVisitBrusselsOccurrence(item) {
  const occurrences = toArray(item?.dates)
    .filter((entry) => entry && entry.day && entry.is_canceled !== true)
    .sort((a, b) => {
      const left = `${cleanText(a?.day) || ""} ${cleanText(a?.start) || ""}`;
      const right = `${cleanText(b?.day) || ""} ${cleanText(b?.start) || ""}`;
      return left.localeCompare(right);
    });
  return occurrences[0] || null;
}

function extractVisitBrusselsPrice(prices, eventUrl) {
  const rawText = JSON.stringify(toArray(prices));
  if (!rawText) {
    return {
      cost: null,
      priceMin: null,
      priceMax: null,
      currency: "EUR",
      isFree: false,
    };
  }

  const fallback = parseTextPriceFallback(rawText, eventUrl);
  if (!fallback) {
    return {
      cost: null,
      priceMin: null,
      priceMax: null,
      currency: "EUR",
      isFree: false,
    };
  }
  return {
    cost: fallback.cost,
    priceMin: fallback.priceMin,
    priceMax: fallback.priceMax,
    currency: fallback.currency || "EUR",
    isFree: fallback.isFree,
  };
}

function looksMusicLikeText(value) {
  const text = normalizeAsciiishText(value);
  if (!text) return false;
  return /\b(concert|music|musique|muziek|festival|jazz|opera|dj|live|choral|choir|orchestra|symphon|folk|hip ?hop|rap|electro|electronic|classical|blues|rock|pop|soul|latin|world)\b/.test(
    text
  );
}

async function scrapeVisitBrusselsFeed(sourceUrl, options) {
  const payload = await fetchJson(sourceUrl, options);
  const sourceHost = hostnameFromUrl(sourceUrl);
  const items = toArray(payload?.data);
  const events = [];

  for (const item of items) {
    if (events.length >= options.maxEventsPerSource) break;

    const translation = pickVisitBrusselsTranslation(item);
    const place = pickVisitBrusselsPlaceTranslation(item);
    const occurrence = pickVisitBrusselsOccurrence(item);
    if (!occurrence) continue;

    const title = cleanText(translation?.name);
    if (!title) continue;

    const categoryLabels = flattenVisitBrusselsCategoryLabels(item);
    const description =
      cleanText(translation?.longdescr) ||
      cleanText(translation?.shortdescr) ||
      cleanText(translation?.performers);
    const musicBlob = [title, description, categoryLabels.join(", ")].filter(Boolean).join(" ");
    if (!looksMusicLikeText(musicBlob)) continue;

    const start = buildEuropeBrusselsIso(parseNumericDateParts(occurrence.day), occurrence.start);
    const end = buildEuropeBrusselsIso(parseNumericDateParts(occurrence.day), occurrence.end);
    if (!start) continue;

    const agendaUrl =
      normalizeEventUrl(translation?.agenda_url, sourceUrl) ||
      normalizeEventUrl(translation?.boxoffice_url, sourceUrl) ||
      normalizeEventUrl(translation?.website, sourceUrl) ||
      sourceUrl;
    const price = extractVisitBrusselsPrice(item?.prices, agendaUrl);
    const addressLine1 = cleanText(place?.address_line1);
    const addressLine2 = cleanText(place?.address_line2);

    const normalized = createNormalizedScrapedEvent(
      {
        title,
        description,
        start,
        end,
        venue: cleanText(place?.name),
        address: [addressLine1, addressLine2].filter(Boolean).join(", "),
        city: cleanText(place?.address_city) || "Brussels",
        postalCode: cleanText(place?.address_zip),
        country: "Belgium",
        cost: price.cost,
        priceMin: price.priceMin,
        priceMax: price.priceMax,
        currency: price.currency,
        isFree: price.isFree,
        url: agendaUrl,
        ticketUrl:
          normalizeEventUrl(translation?.boxoffice_url, sourceUrl) ||
          normalizeEventUrl(translation?.website, sourceUrl) ||
          agendaUrl,
        imageUrl:
          cleanText(item?.firstImagePath) ||
          cleanText(item?.media?.[0]?.link) ||
          null,
        category: categoryLabels[0] || "Concert",
        tags: categoryLabels,
        organizerName: cleanText(place?.name),
        status: occurrence.is_canceled ? "cancelled" : "published",
        raw: {
          id: item?.id,
          categories: item?.categories,
          occurrence,
          translation,
          place,
        },
      },
      { pageUrl: agendaUrl, sourceUrl, sourceHost }
    );

    if (normalized) events.push(normalized);
  }

  return dedupeEvents(events, options.maxEventsPerSource);
}

async function scrapeVisitGentConcerts(sourceUrl, options) {
  const html = await fetchHtml(sourceUrl, options);
  const $ = cheerio.load(html);
  const sourceHost = hostnameFromUrl(sourceUrl);
  const events = [];

  $(".view-event-index .views-row article.node--type-event").each((_, element) => {
    if (events.length >= options.maxEventsPerSource) return;

    const $card = $(element);
    const href = cleanText($card.find(".node--title a").attr("href"));
    const url = normalizeEventUrl(href, sourceUrl);
    const dateText = cleanText($card.find(".vg-schedule-short").first().text());
    const schedule = parseLocalizedDateRange(dateText);
    const title = cleanText($card.find(".node--title").first().text());
    const description =
      cleanText($card.find(".field--name-field-introduction").first().text()) ||
      cleanText($card.find(".field--name-field-subtitle").first().text());

    const normalized = createNormalizedScrapedEvent(
      {
        title,
        description,
        start: schedule.start,
        end: schedule.end,
        city: "Ghent",
        country: "Belgium",
        url,
        ticketUrl: url,
        imageUrl: pickElementImageUrl($card, sourceUrl),
        category: cleanText($card.find(".field--name-field-category").first().text()) || "Concerts",
        tags: ["Concerts", "Ghent"],
        raw: {
          dateText,
          href,
        },
      },
      { pageUrl: url || sourceUrl, sourceUrl, sourceHost }
    );

    if (normalized) events.push(normalized);
  });

  return dedupeEvents(events, options.maxEventsPerSource);
}

async function scrapeVisitLeuvenEvents(sourceUrl, options) {
  const html = await fetchHtml(sourceUrl, options);
  const $ = cheerio.load(html);
  const sourceHost = hostnameFromUrl(sourceUrl);
  const events = [];

  $("a.state--published.card--size-normal").each((_, element) => {
    if (events.length >= options.maxEventsPerSource) return;

    const $card = $(element);
    const title = cleanText(
      $card.find(".field--name-extra-field-f-content-navigation-title span").first().text()
    );
    const dateText = cleanText($card.find(".field--name-field-ct-intertitle").first().text());
    const description = cleanText($card.find(".field--name-field-ct-description").first().text());
    const href = cleanText($card.attr("href"));
    const url = normalizeEventUrl(href, sourceUrl) || resolveUrlMaybe(href, sourceUrl);
    const schedule = parseLocalizedDateRange(dateText);
    const category = cleanText(title?.split(":")[0]);

    const normalized = createNormalizedScrapedEvent(
      {
        title,
        description,
        start: schedule.start,
        end: schedule.end,
        city: "Leuven",
        country: "Belgium",
        url,
        ticketUrl: url,
        imageUrl: pickElementImageUrl($card, sourceUrl),
        category,
        tags: ["Leuven", category].filter(Boolean),
        raw: {
          dateText,
          href,
        },
      },
      { pageUrl: url || sourceUrl, sourceUrl, sourceHost }
    );

    if (normalized) events.push(normalized);
  });

  return dedupeEvents(events, options.maxEventsPerSource);
}

async function scrapeVisitLiegeMusic(sourceUrl, options) {
  const html = await fetchHtml(sourceUrl, options);
  const $ = cheerio.load(html);
  const sourceHost = hostnameFromUrl(sourceUrl);
  const events = [];

  $(".insertStd.insertLink > a[href]").each((_, element) => {
    if (events.length >= options.maxEventsPerSource) return;

    const $card = $(element);
    const dateText = cleanText($card.find(".date").first().text());
    const schedule = parseLocalizedDateRange(dateText);
    const title = cleanText($card.find(".titreH4").first().text());
    const description = cleanText($card.find(".text").first().text());
    const href = cleanText($card.attr("href"));
    const url = normalizeEventUrl(href, sourceUrl);

    const normalized = createNormalizedScrapedEvent(
      {
        title,
        description,
        start: schedule.start,
        end: schedule.end,
        city: "Liege",
        country: "Belgium",
        url,
        ticketUrl: url,
        imageUrl: pickElementImageUrl($card, sourceUrl),
        category: "Music",
        tags: ["Music", "Liege"],
        raw: {
          dateText,
          href,
        },
      },
      { pageUrl: url || sourceUrl, sourceUrl, sourceHost }
    );

    if (normalized) events.push(normalized);
  });

  return dedupeEvents(events, options.maxEventsPerSource);
}

async function scrapeVisitBrugesEvents(sourceUrl, options) {
  const html = await fetchHtml(sourceUrl, options);
  const $ = cheerio.load(html);
  const sourceHost = hostnameFromUrl(sourceUrl);
  const events = [];

  $("article.card--event").each((_, element) => {
    if (events.length >= options.maxEventsPerSource) return;

    const $card = $(element);
    const href = cleanText($card.find("a.card__link").first().attr("href"));
    const url = normalizeEventUrl(href, sourceUrl);
    const title = cleanText($card.find(".card__title__text").first().text());
    const dateText = cleanText($card.find(".card__content__date span").first().text());
    const schedule = parseLocalizedDateRange(dateText);
    const description = cleanText($card.find(".card__content__summary").first().text());
    const tags = $card
      .find(".tags a")
      .map((__, node) => cleanText($(node).text()))
      .get()
      .filter(Boolean);

    const normalized = createNormalizedScrapedEvent(
      {
        title,
        description,
        start: schedule.start,
        end: schedule.end,
        city: "Bruges",
        country: "Belgium",
        url,
        ticketUrl: url,
        imageUrl: pickElementImageUrl($card, sourceUrl),
        category: tags[0] || "Event",
        tags: ["Bruges", ...tags],
        raw: {
          dateText,
          href,
        },
      },
      { pageUrl: url || sourceUrl, sourceUrl, sourceHost }
    );

    if (normalized) events.push(normalized);
  });

  return dedupeEvents(events, options.maxEventsPerSource);
}

async function scrapeVisitMonsConcerts(sourceUrl, options) {
  const html = await fetchHtml(sourceUrl, options);
  const $ = cheerio.load(html);
  const sourceHost = hostnameFromUrl(sourceUrl);
  const events = [];

  $('a[href*="/fr/agenda/"]').each((_, element) => {
    if (events.length >= options.maxEventsPerSource) return;

    const $card = $(element);
    const href = cleanText($card.attr("href"));
    if (!href || /\/agenda\/(?:concerts|all)(?:$|[/?#])/.test(href)) return;

    const url = normalizeEventUrl(href, sourceUrl);
    const title = cleanText($card.find("h3").first().text());
    const dateText = cleanText(
      $card
        .find("p")
        .filter((__, node) => /\d{2}\/\d{2}\/\d{4}/.test($(node).text()))
        .first()
        .text()
    );
    const schedule = parseLocalizedDateRange(dateText);

    const normalized = createNormalizedScrapedEvent(
      {
        title,
        description: null,
        start: schedule.start,
        end: schedule.end,
        city: "Mons",
        country: "Belgium",
        url,
        ticketUrl: url,
        imageUrl: pickElementImageUrl($card, sourceUrl),
        category: "Concert",
        tags: ["Concert", "Mons"],
        raw: {
          dateText,
          href,
        },
      },
      { pageUrl: url || sourceUrl, sourceUrl, sourceHost }
    );

    if (normalized) events.push(normalized);
  });

  return dedupeEvents(events, options.maxEventsPerSource);
}

function extractBackgroundImageUrl(styleText) {
  const text = cleanText(styleText);
  if (!text) return null;
  return cleanText(text.match(/background-image\s*:\s*url\(['"]?([^'")]+)['"]?\)/i)?.[1]);
}

async function scrapeVisitNamurAgenda(sourceUrl, options) {
  const html = await fetchHtml(sourceUrl, options);
  const $ = cheerio.load(html);
  const sourceHost = hostnameFromUrl(sourceUrl);
  const events = [];

  $(".ag-card > a[href*='/agenda-item/']").each((_, element) => {
    if (events.length >= options.maxEventsPerSource) return;

    const $card = $(element);
    const href = cleanText($card.attr("href"));
    const url = normalizeEventUrl(href, sourceUrl);
    const title = cleanText($card.find(".ag-card-title").first().text());
    const dateText = cleanText($card.find(".ag-card-date-badge").first().text());
    const schedule = parseLocalizedDateRange(dateText);
    const description = cleanText($card.find(".ag-card-excerpt").first().text());
    const imageUrl =
      extractBackgroundImageUrl($card.find(".ag-card-img-inner").attr("style")) ||
      pickElementImageUrl($card, sourceUrl);

    const normalized = createNormalizedScrapedEvent(
      {
        title,
        description,
        start: schedule.start,
        end: schedule.end,
        city: "Namur",
        country: "Belgium",
        url,
        ticketUrl: url,
        imageUrl,
        category: "Event",
        tags: ["Namur"],
        raw: {
          dateText,
          href,
        },
      },
      { pageUrl: url || sourceUrl, sourceUrl, sourceHost }
    );

    if (normalized) events.push(normalized);
  });

  return dedupeEvents(events, options.maxEventsPerSource);
}

function parseCharleroiAgendaDetail(detailHtml, detailUrl, sourceUrl, sourceHost) {
  const $ = cheerio.load(detailHtml);
  const title =
    cleanText($("h1").first().text()) ||
    cleanText(extractMetaContent(detailHtml, "og:title"))?.replace(/\s*\|\s*Ville de Charleroi$/i, "");
  const description =
    cleanText(extractMetaContent(detailHtml, "description")) ||
    cleanText($("article p").first().text());
  const startRaw = cleanText(
    detailHtml.match(/Date de d[ée]but\s*:\s*([0-9]{2}\.[0-9]{2}\.[0-9]{4})/i)?.[1]
  );
  const endRaw = cleanText(
    detailHtml.match(/Date de fin\s*:\s*([0-9]{2}\.[0-9]{2}\.[0-9]{4})/i)?.[1]
  );
  const timeRaw = cleanText(detailHtml.match(/\bDe\s+([0-9]{1,2}[h:.][0-9]{2})/i)?.[1]);
  const priceHeading = $("h2").filter((_, node) => /^prix$/i.test(cleanText($(node).text()) || "")).first();
  const linksHeading = $("h2")
    .filter((_, node) => /^liens$/i.test(cleanText($(node).text()) || ""))
    .first();
  const organizerHeading = $("h2")
    .filter((_, node) => /^organisateur$/i.test(cleanText($(node).text()) || ""))
    .first();
  const priceText = cleanText(priceHeading.next("ul").text());
  const price = parseTextPriceFallback(priceText || "", detailUrl);
  const ticketUrl =
    normalizeEventUrl(linksHeading.next("ul").find("a[href]").first().attr("href"), detailUrl) ||
    normalizeEventUrl(organizerHeading.next("ul").find("a[href]").first().attr("href"), detailUrl) ||
    detailUrl;
  const category = cleanText(
    $("ul")
      .filter((_, node) => $(node).text().includes("Charleroi"))
      .first()
      .find("li")
      .last()
      .text()
  );

  return createNormalizedScrapedEvent(
    {
      title,
      description,
      start: buildEuropeBrusselsIso(parseNumericDateParts(startRaw), timeRaw),
      end: buildEuropeBrusselsIso(parseNumericDateParts(endRaw || startRaw), timeRaw),
      city: "Charleroi",
      country: "Belgium",
      url: detailUrl,
      ticketUrl,
      imageUrl: extractMetaContent(detailHtml, "og:image"),
      category,
      tags: ["Charleroi", category].filter(Boolean),
      organizerName: cleanText(organizerHeading.next("ul").text()),
      cost: price?.cost,
      priceMin: price?.priceMin,
      priceMax: price?.priceMax,
      currency: price?.currency || "EUR",
      isFree: price?.isFree || /gratuit|gratuite|free/i.test(priceText || ""),
      raw: {
        startRaw,
        endRaw,
        timeRaw,
      },
    },
    { pageUrl: detailUrl, sourceUrl, sourceHost }
  );
}

async function scrapeCharleroiAgenda(sourceUrl, options) {
  const html = await fetchHtml(sourceUrl, options);
  const $ = cheerio.load(html);
  const sourceHost = hostnameFromUrl(sourceUrl);
  const detailUrls = [];
  const seen = new Set();

  $('a[href*="/agenda/"]').each((_, element) => {
    if (detailUrls.length >= options.maxLinksPerSource) return;
    const href = cleanText($(element).attr("href"));
    if (!href || /\/agenda\/page\/\d+/i.test(href)) return;
    const absolute = normalizeEventUrl(href, sourceUrl);
    if (!absolute || seen.has(absolute) || absolute === sourceUrl) return;
    seen.add(absolute);
    detailUrls.push(absolute);
  });

  const events = [];
  for (const detailUrl of detailUrls) {
    if (events.length >= options.maxEventsPerSource) break;
    try {
      const detailHtml = await fetchHtml(detailUrl, options);
      const normalized = parseCharleroiAgendaDetail(detailHtml, detailUrl, sourceUrl, sourceHost);
      if (normalized) events.push(normalized);
    } catch {
      // Skip detail failures and keep the rest of the source flowing.
    }
  }

  return dedupeEvents(events, options.maxEventsPerSource);
}

async function scrapeTrixConcerts(sourceUrl, options) {
  const html = await fetchHtml(sourceUrl, options);
  const $ = cheerio.load(html);
  const sourceHost = hostnameFromUrl(sourceUrl);
  const events = [];

  $("ul.program-list--programs > li").each((_, element) => {
    if (events.length >= options.maxEventsPerSource) return;

    const $item = $(element);
    const $eventLink = $item.find("a.program-list__item").first();
    const href = cleanText($eventLink.attr("href"));
    const url = normalizeEventUrl(href, sourceUrl);
    const title = cleanText(
      $eventLink
        .find(".program-list__artist")
        .clone()
        .find(".h-small")
        .remove()
        .end()
        .text()
    );
    const dateValue =
      cleanText($eventLink.find(".program-list__date time").attr("datetime")) ||
      cleanText($eventLink.find(".program-list__date").first().text());
    const description = cleanText($eventLink.find(".program-list__description").first().text());
    const priceText = cleanText($item.find(".program-list__buttons-wrapper").first().text());
    const price = parseTextPriceFallback(priceText || "", url || sourceUrl);

    const normalized = createNormalizedScrapedEvent(
      {
        title,
        description,
        start: buildEuropeBrusselsIso(parseNumericDateParts(dateValue)),
        end: buildEuropeBrusselsIso(parseNumericDateParts(dateValue)),
        venue: "Trix Antwerp",
        address: "Noordersingel 28-30, 2140 Antwerpen (Borgerhout)",
        city: "Antwerp",
        postalCode: "2140",
        country: "Belgium",
        url,
        ticketUrl:
          normalizeEventUrl($item.find(".program-list__buttons-wrapper a.ticket-link").first().attr("href"), sourceUrl) ||
          url,
        imageUrl: pickElementImageUrl($item, sourceUrl),
        category: "Concert",
        tags: ["Concert", "Antwerp", "Trix"],
        artistName: title,
        status: /cancelled/i.test(priceText || "") ? "cancelled" : "published",
        cost: price?.cost,
        priceMin: price?.priceMin,
        priceMax: price?.priceMax,
        currency: price?.currency || "EUR",
        isFree: /free/i.test(priceText || "") || price?.isFree === true,
        raw: {
          dateValue,
          priceText,
        },
      },
      { pageUrl: url || sourceUrl, sourceUrl, sourceHost }
    );

    if (normalized) events.push(normalized);
  });

  return dedupeEvents(events, options.maxEventsPerSource);
}

async function scrapeCchaConcerts(sourceUrl, options) {
  const html = await fetchHtml(sourceUrl, options);
  const $ = cheerio.load(html);
  const sourceHost = hostnameFromUrl(sourceUrl);
  const events = [];

  $("li.eventCard").each((_, element) => {
    if (events.length >= options.maxEventsPerSource) return;

    const $item = $(element);
    const $descLink = $item.find("a.desc").first();
    const href = cleanText($descLink.attr("href"));
    const url = normalizeEventUrl(href, sourceUrl);
    const dateText = cleanText($descLink.find(".top-date .start").first().text());
    const timeText = cleanText($descLink.find(".top-date .time").first().text())?.replace(/^-+\s*/, "");
    const schedule = parseLocalizedDateRange(dateText, timeText);
    const title = cleanText($descLink.find(".title").first().text());
    const subtitle = cleanText($descLink.find(".subtitle").first().text());
    const venue = cleanText($descLink.find(".venue").first().text());
    const ticketUrl =
      normalizeEventUrl($item.find("a.btn-order").first().attr("href"), sourceUrl) || url;

    const normalized = createNormalizedScrapedEvent(
      {
        title,
        description: subtitle,
        start: schedule.start,
        end: schedule.end,
        venue,
        city: "Hasselt",
        country: "Belgium",
        url,
        ticketUrl,
        imageUrl: pickElementImageUrl($item, sourceUrl),
        category: "Concert",
        tags: ["Concert", "Hasselt", "CCHA"],
        artistName: subtitle || title,
        raw: {
          dateText,
          timeText,
        },
      },
      { pageUrl: url || sourceUrl, sourceUrl, sourceHost }
    );

    if (normalized) events.push(normalized);
  });

  return dedupeEvents(events, options.maxEventsPerSource);
}

const UIT_IN_MECHELEN_WIDGET_PAGE_ID = "f19fb0d8fe653c3bb25377e0ac25fbb2";
const UIT_IN_MECHELEN_SEARCH_WIDGET_ID = "78ed6b8b-8da7-9b56-e577-1484b0e5b29a";
const UIT_IN_MECHELEN_API_BASE =
  `https://projectaanvraag-api.uitdatabank.be/widgets/api/render/${UIT_IN_MECHELEN_WIDGET_PAGE_ID}/${UIT_IN_MECHELEN_SEARCH_WIDGET_ID}/search-results-with-facets`;

function buildUitInMechelenApiUrl(sourceUrl, pageIndex = 0) {
  const parsed = new URL(sourceUrl);
  const params = new URLSearchParams(parsed.searchParams);
  params.set("origin", `${parsed.origin}${parsed.pathname}`);
  if (pageIndex > 0) {
    params.set("search-result[0][page]", String(pageIndex));
  } else {
    params.delete("search-result[0][page]");
  }
  return `${UIT_IN_MECHELEN_API_BASE}?${params.toString()}`;
}

function findUitInMechelenCardValue($, $card, label) {
  let value = null;
  const labelNeedle = normalizeAsciiishText(label);
  $card.find(".list-item").each((_, element) => {
    const $item = $(element);
    const itemLabel = normalizeAsciiishText(
      cleanText($item.find(".cnw_searchresult-detail-label").first().text())
    );
    if (itemLabel !== labelNeedle) return;
    value = cleanText($item.find(".list-item-content").first().text());
    return false;
  });
  return value;
}

function parseUitInMechelenCard($, $card, sourceUrl, sourceHost) {
  const title = cleanText($card.find(".cnw_card-title").first().text());
  if (!title) return null;

  const url = normalizeEventUrl($card.find(".cnw_card-title a").first().attr("href"), sourceUrl);
  const description = cleanText($card.find("p.cnw_card-description").last().text());
  const badgeTexts = $card
    .find(".cnw_badge")
    .toArray()
    .map((element) => cleanText($(element).text()))
    .filter(Boolean);
  const whenText = findUitInMechelenCardValue($, $card, "Wanneer");
  const whereText = findUitInMechelenCardValue($, $card, "Waar");
  const schedule = parseLocalizedDateRange(whenText, whenText);
  const musicBlob = [title, description, badgeTexts.join(" "), whenText].filter(Boolean).join(" ");
  if (!looksMusicLikeText(musicBlob) || !schedule.start) return null;

  const imageUrl = resolveUrlMaybe($card.find("img").first().attr("src"), sourceUrl);
  const venueLine = cleanText(whereText);
  const venue = cleanText(venueLine?.split(",")[0]);
  const category =
    badgeTexts.find((value) => /concert|festival|party|fuif/i.test(normalizeAsciiishText(value))) ||
    badgeTexts[0] ||
    "Concert";
  const genre =
    badgeTexts.find((value) =>
      /muziek|music|jazz|blues|rock|folk|pop|dance|klassiek|classique|wereld/i.test(
        normalizeAsciiishText(value)
      )
    ) || null;

  return createNormalizedScrapedEvent(
    {
      title,
      description,
      start: schedule.start,
      end: schedule.end || schedule.start,
      venue,
      address: venueLine,
      city: "Mechelen",
      country: "Belgium",
      url,
      ticketUrl: url,
      imageUrl,
      category,
      genre,
      tags: ["Mechelen", ...badgeTexts],
      raw: {
        badges: badgeTexts,
        whenText,
        whereText,
      },
    },
    { pageUrl: url || sourceUrl, sourceUrl, sourceHost }
  );
}

async function scrapeUitInMechelenAgenda(sourceUrl, options) {
  const sourceHost = hostnameFromUrl(sourceUrl);
  const events = [];
  const visitedPages = new Set();

  for (let pageIndex = 0; events.length < options.maxEventsPerSource; pageIndex++) {
    const apiUrl = buildUitInMechelenApiUrl(sourceUrl, pageIndex);
    if (visitedPages.has(apiUrl)) break;
    visitedPages.add(apiUrl);

    const payload = await fetchJson(apiUrl, options);
    const searchResultsHtml = cleanText(payload?.data?.search_results);
    if (!searchResultsHtml) break;

    const $ = cheerio.load(searchResultsHtml);
    let pageEventCount = 0;
    $(".cnw_searchresult--block").each((_, element) => {
      if (events.length >= options.maxEventsPerSource) return false;
      const normalized = parseUitInMechelenCard($, $(element), sourceUrl, sourceHost);
      if (normalized) {
        events.push(normalized);
        pageEventCount += 1;
      }
      return undefined;
    });

    const pageTargets = $(".cnw_page-link[data-target-page]")
      .map((_, element) => Number(cleanText($(element).attr("data-target-page"))))
      .get()
      .filter((value) => Number.isFinite(value));
    const maxPageIndex = pageTargets.length > 0 ? Math.max(...pageTargets) : pageIndex;

    if (pageEventCount === 0 || pageIndex >= maxPageIndex) break;
  }

  return dedupeEvents(events, options.maxEventsPerSource);
}

function parseUitInLeuvenCard($, $card, sourceUrl, sourceHost) {
  const title = cleanText($card.find("h3").first().text());
  if (!title) return null;

  const url = normalizeEventUrl($card.attr("href"), sourceUrl);
  const start = cleanText($card.find('time[itemprop="startDate"]').first().attr("datetime"));
  const end =
    cleanText($card.find('time[itemprop="endDate"]').first().attr("datetime")) || start;
  if (!start) return null;

  const items = $card.find("ul.list li");
  const venueText = cleanText(items.eq(1).text())?.replace(/^waar\s*:\s*/i, "") || null;
  const labels = $card
    .find(".event-label")
    .toArray()
    .map((element) => cleanText($(element).text()))
    .filter(Boolean);

  const musicBlob = [title, venueText, labels.join(" ")].filter(Boolean).join(" ");
  if (!looksMusicLikeText(musicBlob)) return null;

  const priceText = labels.join(" ");
  const price = parseTextPriceFallback(priceText, url || sourceUrl);
  const isFree =
    labels.some((label) => /gratis|free|gratuit/i.test(label)) || price?.isFree === true;
  const category =
    labels.find((label) => /concert|festival|optreden|open mic|muziek/i.test(normalizeAsciiishText(label))) ||
    labels[0] ||
    null;

  return createNormalizedScrapedEvent(
    {
      title,
      start,
      end,
      venue: venueText,
      city: "Leuven",
      country: "Belgium",
      url,
      ticketUrl: url,
      imageUrl: resolveUrlMaybe($card.find("img").first().attr("src"), sourceUrl),
      category,
      tags: ["Leuven", ...labels],
      cost: price?.cost,
      priceMin: price?.priceMin,
      priceMax: price?.priceMax,
      currency: price?.currency || "EUR",
      isFree,
      raw: {
        labels,
      },
    },
    { pageUrl: url || sourceUrl, sourceUrl, sourceHost }
  );
}

async function scrapeUitInLeuvenAgenda(sourceUrl, options) {
  const sourceHost = hostnameFromUrl(sourceUrl);
  const listingHtml = await fetchHtml(sourceUrl, options);
  const $ = cheerio.load(listingHtml);
  const events = [];

  $("a.culturefeed-search-result-teaser[href]").each((_, element) => {
    if (events.length >= options.maxEventsPerSource) return false;
    const normalized = parseUitInLeuvenCard($, $(element), sourceUrl, sourceHost);
    if (normalized) events.push(normalized);
    return undefined;
  });

  return dedupeEvents(events, options.maxEventsPerSource);
}

function isMusicLikeEventRecord(event) {
  const blob = [
    cleanText(event?.title),
    cleanText(event?.description),
    cleanText(event?.genre),
    cleanText(event?.category),
    cleanText(event?.artistName),
    cleanText(event?.organizerName),
    cleanText(event?.venue),
    ...(Array.isArray(event?.tags) ? event.tags : []),
  ]
    .filter(Boolean)
    .join(" ");

  return looksMusicLikeText(blob);
}

const UITIN_VLAANDEREN_GRAPHQL_URL = "https://www.uitinvlaanderen.be/api/graphql";
const UITIN_VLAANDEREN_MUSIC_THEME_IDS = Object.freeze([
  "1.8.1.0.0",
  "1.8.2.0.0",
  "1.8.3.1.0.0",
  "1.8.3.2.0.0",
  "1.8.3.3.0.0",
  "1.8.4.0.0",
  "1.8.3.5.0.0",
]);
const UITIN_VLAANDEREN_MUSIC_QUERY = `
  query EventiumUitInVlaanderenMusic($themes: [String!], $limit: Float, $offset: Float, $dateFrom: DateTimeISO) {
    events(themes: $themes, limit: $limit, offset: $offset, dateFrom: $dateFrom) {
      totalItems
      data {
        __typename
        ... on Event {
          id
          name
          description
          isOnline
          onlineUrl
          attendanceMode
          bookingAvailability
          workflowStatus
          calendar {
            summary {
              small
              large
            }
          }
          subEvent {
            startDate
            endDate
          }
          location {
            name
            address {
              locality
              postalCode
              streetAddress
            }
            geo {
              lat
              lng
            }
          }
          organizer {
            name
          }
          prices {
            name
            category
            value
          }
          images {
            url
          }
          bookingInfo {
            url
            urlLabel
          }
          types {
            id
            name
          }
          themes {
            id
            name
          }
          benefits
        }
      }
    }
  }
`;

function getEuropeBrusselsCalendarDayParts(value = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Brussels",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(value);
  const pick = (type) => Number(parts.find((part) => part.type === type)?.value || 0);
  return {
    year: pick("year"),
    month: pick("month"),
    day: pick("day"),
  };
}

function buildUitInVlaanderenDetailUrl(id, title) {
  const normalizedId = cleanText(id);
  if (!normalizedId) return null;

  const slugSeed = normalizeAsciiishText(title || "event")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const slug = slugSeed || "event";
  return `https://www.uitinvlaanderen.be/agenda/e/${slug}/${normalizedId}`;
}

function pickUitInVlaanderenOccurrence(eventNode) {
  const occurrences = Array.isArray(eventNode?.subEvent) ? eventNode.subEvent : [];
  const validOccurrences = occurrences
    .map((occurrence) => ({
      start: cleanText(occurrence?.startDate),
      end: cleanText(occurrence?.endDate),
    }))
    .filter((occurrence) => occurrence.start && hasConcreteIsoDate(occurrence.start))
    .sort((left, right) => {
      const leftTs = new Date(left.start).getTime();
      const rightTs = new Date(right.start).getTime();
      return leftTs - rightTs;
    });

  if (validOccurrences.length > 0) return validOccurrences[0];
  return { start: null, end: null };
}

function extractUitInVlaanderenPrice(prices) {
  const normalizedPrices = Array.isArray(prices) ? prices : [];
  const amounts = normalizedPrices
    .map((entry) => ({
      category: cleanText(entry?.category)?.toLowerCase(),
      value: toFiniteNumber(entry?.value),
    }))
    .filter((entry) => entry.value != null);

  if (amounts.length === 0) {
    return {
      cost: null,
      priceMin: null,
      priceMax: null,
      currency: "EUR",
      isFree: false,
    };
  }

  const sortedAmounts = amounts
    .map((entry) => entry.value)
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  const basePrice =
    amounts.find((entry) => entry.category === "base")?.value ?? sortedAmounts[0] ?? null;
  const priceMin = sortedAmounts[0] ?? null;
  const priceMax = sortedAmounts[sortedAmounts.length - 1] ?? null;
  const isFree = priceMin != null && priceMin <= 0;

  return {
    cost: basePrice,
    priceMin,
    priceMax,
    currency: "EUR",
    isFree,
  };
}

function normalizeUitInVlaanderenGraphqlEvent(eventNode, sourceUrl, sourceHost) {
  if (!eventNode || cleanText(eventNode.__typename) !== "Event") return null;

  const title = cleanText(eventNode.name);
  const occurrence = pickUitInVlaanderenOccurrence(eventNode);
  if (!title || !occurrence.start) return null;

  const description = extractHtmlTextWithBreaks(eventNode.description);
  const venue = cleanText(eventNode?.location?.name);
  const city = cleanText(eventNode?.location?.address?.locality);
  const category =
    cleanText(eventNode?.types?.[0]?.name) ||
    cleanText(eventNode?.themes?.[0]?.name) ||
    "Concert";
  const tags = [
    ...toArray(eventNode?.themes).map((theme) => cleanText(theme?.name)).filter(Boolean),
    ...toArray(eventNode?.types).map((type) => cleanText(type?.name)).filter(Boolean),
  ];
  const hasUiTPAS = toArray(eventNode?.benefits).some(
    (benefit) => cleanText(benefit)?.toLowerCase() === "uitpas"
  );
  if (hasUiTPAS) tags.push("UiTPAS");

  const price = extractUitInVlaanderenPrice(eventNode?.prices);
  const detailUrl =
    buildUitInVlaanderenDetailUrl(eventNode.id, title) ||
    cleanText(eventNode?.onlineUrl) ||
    sourceUrl;
  const ticketUrl =
    normalizeEventUrl(eventNode?.bookingInfo?.url, detailUrl) ||
    normalizeEventUrl(eventNode?.onlineUrl, detailUrl) ||
    detailUrl;

  return createNormalizedScrapedEvent(
    {
      title,
      description,
      start: occurrence.start,
      end: occurrence.end || occurrence.start,
      venue,
      address: cleanText(eventNode?.location?.address?.streetAddress),
      city,
      postalCode: cleanText(eventNode?.location?.address?.postalCode),
      country: "Belgium",
      lat: toFiniteNumber(eventNode?.location?.geo?.lat),
      lng: toFiniteNumber(eventNode?.location?.geo?.lng),
      isVirtual: Boolean(eventNode?.isOnline),
      virtualLink: cleanText(eventNode?.onlineUrl),
      url: detailUrl,
      ticketUrl,
      imageUrl: cleanText(eventNode?.images?.[0]?.url),
      category,
      genre: cleanText(eventNode?.themes?.[0]?.name),
      tags,
      organizerName: cleanText(eventNode?.organizer?.name),
      status: cleanText(eventNode?.workflowStatus)?.toLowerCase() || "published",
      cost: price.cost,
      priceMin: price.priceMin,
      priceMax: price.priceMax,
      currency: price.currency,
      isFree: price.isFree,
    },
    {
      pageUrl: detailUrl,
      sourceUrl,
      sourceHost,
    }
  );
}

function parseUitInVlaanderenCard($, $card, sourceUrl) {
  const link = normalizeEventUrl($card.attr("href"), sourceUrl);
  const title = cleanText($card.find(".app-event-teaser__title").first().text());
  const addressText = cleanText($card.find(".app-event-teaser__address").first().text());
  const category = cleanText($card.find(".app-event-teaser__category span").first().text());
  const rawDateText = cleanText($card.find(".app-event-teaser__date").first().text());
  const venue = cleanText(addressText?.split(" - ")[0]);
  const city = cleanText(addressText?.split(" - ").slice(1).join(" - "));
  const teaserImage = resolveUrlMaybe($card.find("img").first().attr("src"), sourceUrl);
  const hasUiTPAS = $card.find(".app-icon-logo-uitpas").length > 0;

  return {
    link,
    title,
    addressText,
    category,
    rawDateText,
    venue,
    city,
    teaserImage,
    hasUiTPAS,
  };
}

function isLikelyUitInVlaanderenMusicCard(card) {
  const blob = [
    card?.title,
    card?.venue,
    card?.city,
    card?.category,
    card?.rawDateText,
  ]
    .filter(Boolean)
    .join(" ");

  return looksMusicLikeText(blob);
}

async function scrapeUitInVlaanderenMusic(sourceUrl, options) {
  const sourceHost = hostnameFromUrl(sourceUrl);
  const events = [];

  const pageSize = Math.max(1, Math.min(options.maxEventsPerSource, 50));
  const dateFrom = buildEuropeBrusselsIso(getEuropeBrusselsCalendarDayParts(), "00:00");

  for (let offset = 0; events.length < options.maxEventsPerSource; offset += pageSize) {
    const payload = await postJson(
      UITIN_VLAANDEREN_GRAPHQL_URL,
      {
        query: UITIN_VLAANDEREN_MUSIC_QUERY,
        variables: {
          themes: UITIN_VLAANDEREN_MUSIC_THEME_IDS,
          limit: pageSize,
          offset,
          dateFrom,
        },
      },
      options
    );

    if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
      throw new Error(
        cleanText(payload.errors.map((entry) => cleanText(entry?.message)).filter(Boolean).join("; ")) ||
          "UiTinVlaanderen GraphQL error"
      );
    }

    const pageEvents = toArray(payload?.data?.events?.data);
    if (pageEvents.length === 0) break;

    for (const eventNode of pageEvents) {
      if (events.length >= options.maxEventsPerSource) break;
      const normalized = normalizeUitInVlaanderenGraphqlEvent(
        eventNode,
        sourceUrl,
        sourceHost
      );
      if (normalized && isMusicLikeEventRecord(normalized)) events.push(normalized);
    }

    if (pageEvents.length < pageSize) break;
  }

  return dedupeEvents(events, options.maxEventsPerSource);
}

function extractHtmlTextWithBreaks(fragmentHtml) {
  if (!fragmentHtml) return null;
  const normalized = String(fragmentHtml)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/li>/gi, "\n");
  const $ = cheerio.load(`<div>${normalized}</div>`);
  return cleanText($("div").text().replace(/\n\s+/g, "\n"));
}

function findDefinitionValue($, labels) {
  const needles = labels.map((label) => normalizeAsciiishText(label));
  const match = $("dt")
    .filter((_, element) => {
      const text = normalizeAsciiishText(cleanText($(element).text()));
      return needles.includes(text);
    })
    .first();

  if (!match.length) return null;
  return match.next("dd");
}

function parseGenericUitInDetail(detailHtml, detailUrl, sourceUrl, sourceHost) {
  const $ = cheerio.load(detailHtml);
  const title =
    cleanText($("h1").first().text()) ||
    cleanText(extractMetaContent(detailHtml, "og:title"))?.replace(/\s*\|\s*uit.*$/i, "");
  if (!title) return null;

  const description =
    cleanText(extractMetaContent(detailHtml, "description")) ||
    cleanText(
      extractHtmlTextWithBreaks(
        findDefinitionValue($, ["Beschrijving", "Description", "Omschrijving"])?.html()
      )
    ) ||
    cleanText($(".event-content p").first().text());

  const start =
    cleanText($('time[itemprop="startDate"]').first().attr("datetime")) ||
    cleanText($("meta[itemprop='startDate']").attr("content"));
  const end =
    cleanText($('time[itemprop="endDate"]').first().attr("datetime")) ||
    cleanText($("meta[itemprop='endDate']").attr("content")) ||
    start;
  if (!start) return null;

  const whereNode = findDefinitionValue($, ["Waar", "Where", "Ou", "Où"]);
  const whereHtml = whereNode?.find("p").first().html() || whereNode?.html() || "";
  const whereText = extractHtmlTextWithBreaks(whereHtml);
  const whereLines = String(whereText || "")
    .split(/\n+/)
    .map((line) => cleanText(line))
    .filter(Boolean);
  const venue = whereLines[0] || null;
  const address = whereLines.join(", ");
  const locationBits = extractAddressBits(address);

  const priceNode = findDefinitionValue($, ["Prijs", "Price", "Prix"]);
  const priceText = cleanText(extractHtmlTextWithBreaks(priceNode?.html() || ""));
  const price = parseTextPriceFallback(priceText || "", detailUrl);

  const organizerNode = findDefinitionValue($, ["Organisator", "Organizer", "Organisation"]);
  const organizerName =
    cleanText(organizerNode?.find("li").first().text()) || cleanText(organizerNode?.text());

  const ticketUrl =
    normalizeEventUrl($('a.btn.btn-primary[href]').first().attr("href"), detailUrl) ||
    normalizeEventUrl(priceNode?.find("a[href]").first().attr("href"), detailUrl) ||
    detailUrl;

  return createNormalizedScrapedEvent(
    {
      title,
      description,
      start,
      end,
      venue,
      address,
      city: locationBits.city,
      postalCode: locationBits.postalCode,
      country: locationBits.country || "Belgium",
      url: detailUrl,
      ticketUrl,
      imageUrl: extractMetaContent(detailHtml, "og:image"),
      organizerName,
      cost: price?.cost,
      priceMin: price?.priceMin,
      priceMax: price?.priceMax,
      currency: price?.currency || "EUR",
      isFree: price?.isFree || /gratis|free|gratuit/i.test(priceText || ""),
      raw: {
        whereText,
        priceText,
      },
    },
    { pageUrl: detailUrl, sourceUrl, sourceHost }
  );
}

async function scrapeGenericUitInAgenda(sourceUrl, options) {
  const sourceHost = hostnameFromUrl(sourceUrl);
  const listingHtml = await fetchHtml(sourceUrl, options);
  const candidateLinks = extractCandidateLinks(
    listingHtml,
    sourceUrl,
    Math.max(options.maxLinksPerSource, options.maxEventsPerSource * 2)
  );
  const events = [];

  for (const link of candidateLinks) {
    if (events.length >= options.maxEventsPerSource) break;

    try {
      const detailHtml = await fetchHtml(link, options);
      const normalized = parseGenericUitInDetail(detailHtml, link, sourceUrl, sourceHost);
      if (!normalized) continue;

      const musicBlob = [
        normalized.title,
        normalized.description,
        normalized.genre,
        normalized.category,
        normalized.organizerName,
        normalized.venue,
      ]
        .filter(Boolean)
        .join(" ");

      if (!looksMusicLikeText(musicBlob)) continue;
      events.push(normalized);
    } catch {
      // Ignore per-detail fetch failures for generic UiTin sources.
    }
  }

  return dedupeEvents(events, options.maxEventsPerSource);
}

async function scrapeVisitLimburgAgenda(sourceUrl, options) {
  const html = await fetchHtml(sourceUrl, options);
  const $ = cheerio.load(html);
  const sourceHost = hostnameFromUrl(sourceUrl);
  const events = [];
  const seen = new Set();
  const fallbackCity = /\/hasselt\/hasselt(?:$|[/?#])/i.test(sourceUrl) ? "Hasselt" : null;

  $("a.node--type-event.node--view-mode-teaser-alt[href*='/event/'], a[href*='/event/']").each(
    (_, element) => {
      if (events.length >= options.maxEventsPerSource) return false;

      const $card = $(element);
      const href = cleanText($card.attr("href"));
      const detailUrl = normalizeEventUrl(href, sourceUrl);
      if (!detailUrl || seen.has(detailUrl)) return undefined;
      seen.add(detailUrl);

      const title =
        cleanText($card.find("h1, h2, h3, .title").first().text()) ||
        cleanText($card.attr("title"));
      const city = cleanText($card.find(".event-location").first().text()) || fallbackCity;
      const dateText = cleanText($card.find(".event-available-dates").first().text());
      const description =
        cleanText($card.find(".event-description, .description").first().text());
      const imageUrl = pickElementImageUrl($card, sourceUrl);
      const coords = $card.find(".coordinates").first();
      const { start, end } = parseLocalizedDateRange(dateText);

      const normalized = createNormalizedScrapedEvent(
        {
          title,
          description,
          start,
          end,
          city,
          url: detailUrl,
          imageUrl,
          lat: toFiniteNumber(coords.attr("data-lat")),
          lng: toFiniteNumber(coords.attr("data-lng")),
        },
        { pageUrl: detailUrl, sourceUrl, sourceHost }
      );

      if (normalized) events.push(normalized);
      return undefined;
    }
  );

  return dedupeEvents(events, options.maxEventsPerSource);
}

function pickCustomSourceScraper(sourceUrl) {
  if (isVisitBrusselsFeedUrl(sourceUrl)) return scrapeVisitBrusselsFeed;
  if (isVisitGentConcertsUrl(sourceUrl)) return scrapeVisitGentConcerts;
  if (isVisitLeuvenEventsUrl(sourceUrl)) return scrapeVisitLeuvenEvents;
  if (isVisitLiegeMusicUrl(sourceUrl)) return scrapeVisitLiegeMusic;
  if (isVisitBrugesEventsUrl(sourceUrl)) return scrapeVisitBrugesEvents;
  if (isVisitMonsConcertsUrl(sourceUrl)) return scrapeVisitMonsConcerts;
  if (isCharleroiAgendaUrl(sourceUrl)) return scrapeCharleroiAgenda;
  if (isVisitNamurAgendaUrl(sourceUrl)) return scrapeVisitNamurAgenda;
  if (isTrixConcertsUrl(sourceUrl)) return scrapeTrixConcerts;
  if (isCchaConcertsUrl(sourceUrl)) return scrapeCchaConcerts;
  if (isVisitLimburgAgendaUrl(sourceUrl)) return scrapeVisitLimburgAgenda;
  if (isUitInVlaanderenMusicUrl(sourceUrl)) return scrapeUitInVlaanderenMusic;
  if (isUitInLeuvenAgendaUrl(sourceUrl)) return scrapeUitInLeuvenAgenda;
  if (isUitInMechelenAgendaUrl(sourceUrl)) return scrapeUitInMechelenAgenda;
  if (isGenericUitInAgendaUrl(sourceUrl)) return scrapeGenericUitInAgenda;
  return null;
}

async function scrapeSource(sourceUrl, options) {
  const customScraper = pickCustomSourceScraper(sourceUrl);
  if (customScraper) {
    return customScraper(sourceUrl, options);
  }

  const sourceHost = new URL(sourceUrl).hostname;
  const sourceIsSongkick = isSongkickHost(sourceHost);
  const sourceIsEventbrite = isEventbriteHost(sourceHost);
  let songkickEnrichedCount = 0;
  let eventbriteEnrichedCount = 0;
  const events = [];

  const listingHtml = await fetchHtml(sourceUrl, options);
  const listingJsonLd = extractJsonLdEventNodes(listingHtml);
  for (const eventNode of listingJsonLd) {
    if (events.length >= options.maxEventsPerSource) break;
    const normalized = normalizeJsonLdEvent(eventNode, {
      pageUrl: sourceUrl,
      sourceHost,
      sourceUrl,
    });
    if (normalized) events.push(normalized);
  }

  if (
    sourceIsSongkick &&
    options.songkickOfficialLookup &&
    events.length > 0 &&
    options.songkickOfficialEnrichLimit > 0
  ) {
    for (let i = 0; i < events.length; i++) {
      if (songkickEnrichedCount >= options.songkickOfficialEnrichLimit) break;
      const event = events[i];
      const detailUrl = cleanText(event?.url);
      if (!detailUrl || !isSongkickHost(detailUrl)) continue;

      try {
        const detailHtml = await fetchHtml(detailUrl, {
          ...options,
          timeoutMs: options.songkickTicketTimeoutMs || options.timeoutMs,
        });
        const enriched = await enrichSongkickEvent(
          event,
          detailHtml,
          detailUrl,
          options
        );
        events[i] = enriched;
      } catch {
        // Skip per-event enrichment failures.
      } finally {
        songkickEnrichedCount++;
      }
    }
  }

  if (
    sourceIsEventbrite &&
    options.eventbriteDetailLookup &&
    events.length > 0 &&
    options.eventbriteDetailEnrichLimit > 0
  ) {
    for (let i = 0; i < events.length; i++) {
      if (eventbriteEnrichedCount >= options.eventbriteDetailEnrichLimit) break;

      const event = events[i];
      const detailUrl = cleanText(event?.url);
      if (!detailUrl || !isEventbriteHost(detailUrl)) continue;

      try {
        const detailHtml = await fetchHtml(detailUrl, {
          ...options,
          timeoutMs: options.eventbriteDetailTimeoutMs || options.timeoutMs,
        });
        const detailNodes = extractJsonLdEventNodes(detailHtml);
        const candidates = [];
        for (const node of detailNodes) {
          const normalized = normalizeJsonLdEvent(node, {
            pageUrl: detailUrl,
            sourceHost,
            sourceUrl,
          });
          if (normalized) candidates.push(normalized);
        }

        const preferredSourceId = cleanText(event?.sourceId);
        const preferredCandidates = preferredSourceId
          ? candidates.filter(
              (candidate) =>
                cleanText(candidate?.sourceId) === preferredSourceId
            )
          : candidates;
        const pool =
          preferredCandidates.length > 0 ? preferredCandidates : candidates;
        if (pool.length > 0) {
          pool.sort(
            (a, b) => scoreEventCompleteness(b) - scoreEventCompleteness(a)
          );
          let mergedEvent = mergeEventData(pool[0], event);

          const fallbackOffers = extractEventbriteOffersFromNextData(detailHtml);
          if (fallbackOffers.length > 0) {
            const fallbackPrice = parseOffers(fallbackOffers, detailUrl, false);
            if (
              fallbackPrice.cost != null ||
              fallbackPrice.priceMin != null ||
              fallbackPrice.priceMax != null
            ) {
              mergedEvent = mergeEventData(mergedEvent, {
                cost: fallbackPrice.cost,
                priceMin: fallbackPrice.priceMin,
                priceMax: fallbackPrice.priceMax,
                currency: fallbackPrice.currency,
                ticketUrl: fallbackPrice.ticketUrl,
                isFree: fallbackPrice.isFree,
              });
              mergedEvent.metadata = {
                ...(mergedEvent.metadata || {}),
                priceMin:
                  mergedEvent.priceMin ??
                  fallbackPrice.priceMin ??
                  mergedEvent.metadata?.priceMin ??
                  null,
                priceMax:
                  mergedEvent.priceMax ??
                  fallbackPrice.priceMax ??
                  mergedEvent.metadata?.priceMax ??
                  null,
                eventbriteOfferSource: "next_data",
              };
            }
          }

          events[i] = mergedEvent;
        }
      } catch {
        // Skip per-event enrichment failures.
      } finally {
        eventbriteEnrichedCount++;
      }
    }
  }

  if (events.length >= options.maxEventsPerSource) {
    return dedupeEvents(events, options.maxEventsPerSource);
  }

  const candidateLinks = extractCandidateLinks(
    listingHtml,
    sourceUrl,
    options.maxLinksPerSource
  );

  for (const link of candidateLinks) {
    if (events.length >= options.maxEventsPerSource) break;

    try {
      const pageHtml = await fetchHtml(link, options);
      const eventNodes = extractJsonLdEventNodes(pageHtml);
      for (const eventNode of eventNodes) {
        if (events.length >= options.maxEventsPerSource) break;
        let normalized = normalizeJsonLdEvent(eventNode, {
          pageUrl: link,
          sourceHost,
          sourceUrl,
        });
        if (
          normalized &&
          sourceIsSongkick &&
          options.songkickOfficialLookup &&
          songkickEnrichedCount < options.songkickOfficialEnrichLimit
        ) {
          const songkickDetailUrl =
            cleanText(normalized?.metadata?.raw?.url) || cleanText(normalized?.url) || link;
          let enrichHtml = pageHtml;
          let enrichPageUrl = link;

          if (
            songkickDetailUrl &&
            isSongkickHost(songkickDetailUrl) &&
            cleanText(songkickDetailUrl) !== cleanText(link)
          ) {
            try {
              enrichHtml = await fetchHtml(songkickDetailUrl, {
                ...options,
                timeoutMs: options.songkickTicketTimeoutMs || options.timeoutMs,
              });
              enrichPageUrl = songkickDetailUrl;
            } catch {
              // Fall back to current page HTML.
            }
          }

          normalized = await enrichSongkickEvent(
            normalized,
            enrichHtml,
            enrichPageUrl,
            options
          );
          songkickEnrichedCount++;
        }
        if (normalized) events.push(normalized);
      }
    } catch {
      // Skip individual link failures and continue with the next page.
    }
  }

  return dedupeEvents(events, options.maxEventsPerSource);
}

async function fetchScrapedEvents({
  sourceUrls = [],
  maxEvents = 40,
  maxEventsPerSource = 25,
  maxLinksPerSource = 20,
  timeoutMs = 12000,
  userAgent = DEFAULT_USER_AGENT,
  sourceConcurrency = 3,
  songkickOfficialLookup = true,
  songkickOfficialEnrichLimit = 15,
  songkickTicketTimeoutMs = 10000,
  officialPageTimeoutMs = 10000,
  enableOfficialPageEnrichment = true,
  eventbriteDetailLookup = true,
  eventbriteDetailEnrichLimit = 8,
  eventbriteDetailTimeoutMs = 10000,
} = {}) {
  const normalizedUrls = Array.isArray(sourceUrls) ? sourceUrls : [];
  if (normalizedUrls.length === 0 || maxEvents <= 0) return [];

  const options = {
    maxEventsPerSource: Math.max(1, maxEventsPerSource),
    maxLinksPerSource: Math.max(1, maxLinksPerSource),
    timeoutMs: Math.max(2000, timeoutMs),
    userAgent,
    sourceConcurrency: Math.max(1, sourceConcurrency),
    songkickOfficialLookup: Boolean(songkickOfficialLookup),
    songkickOfficialEnrichLimit: Math.max(0, songkickOfficialEnrichLimit),
    songkickTicketTimeoutMs: Math.max(2000, songkickTicketTimeoutMs),
    officialPageTimeoutMs: Math.max(2000, officialPageTimeoutMs),
    enableOfficialPageEnrichment: Boolean(enableOfficialPageEnrichment),
    eventbriteDetailLookup: Boolean(eventbriteDetailLookup),
    eventbriteDetailEnrichLimit: Math.max(0, eventbriteDetailEnrichLimit),
    eventbriteDetailTimeoutMs: Math.max(2000, eventbriteDetailTimeoutMs),
  };

  const allEvents = [];
  const queue = [...normalizedUrls];
  const workers = Array.from(
    { length: Math.min(options.sourceConcurrency, queue.length) },
    async () => {
      while (queue.length > 0) {
        const sourceUrl = queue.shift();
        if (!sourceUrl) continue;
        try {
          const events = await scrapeSource(sourceUrl, options);
          allEvents.push(...events);
        } catch {
          // Skip broken source URLs and continue scraping others.
        }
      }
    }
  );

  await Promise.all(workers);

  return dedupeEvents(allEvents, maxEvents);
}

function hasPriceSignal(price) {
  if (!price || typeof price !== "object") return false;
  const values = [price.cost, price.priceMin, price.priceMax]
    .map((value) => toFiniteNumber(value))
    .filter((value) => value != null);
  if (values.length > 0) return true;
  return price.isFree === true;
}

function normalizeCurrencyCode(value) {
  const text = cleanText(value);
  if (!text) return null;
  if (text === "€") return "EUR";
  const normalized = text.toUpperCase();
  if (/^[A-Z]{3}$/.test(normalized)) return normalized;
  if (normalized === "EURO" || normalized === "EUR") return "EUR";
  return null;
}

function normalizePriceResult(price, source) {
  const priceMin = toFiniteNumber(price?.priceMin);
  const priceMax = toFiniteNumber(price?.priceMax);
  const cost = toFiniteNumber(price?.cost);
  const hasPositive =
    (priceMin != null && priceMin > 0) ||
    (priceMax != null && priceMax > 0) ||
    (cost != null && cost > 0);
  const hasZero =
    priceMin === 0 || priceMax === 0 || cost === 0 || price?.isFree === true;

  const normalized = {
    cost:
      cost != null
        ? cost
        : priceMin != null
        ? priceMin
        : priceMax != null
        ? priceMax
        : hasZero
        ? 0
        : null,
    priceMin:
      priceMin != null
        ? priceMin
        : cost != null
        ? cost
        : hasZero
        ? 0
        : null,
    priceMax:
      priceMax != null
        ? priceMax
        : cost != null
        ? cost
        : hasZero
        ? 0
        : null,
    currency: normalizeCurrencyCode(price?.currency),
    ticketUrl: cleanText(price?.ticketUrl),
    isFree: hasPositive ? false : hasZero,
    priceSource: source,
  };

  if (
    normalized.priceMin != null &&
    normalized.priceMax != null &&
    normalized.priceMin > normalized.priceMax
  ) {
    const swap = normalized.priceMin;
    normalized.priceMin = normalized.priceMax;
    normalized.priceMax = swap;
  }

  return normalized;
}

function parseInlineJsonPrice(html, pageUrl) {
  const $ = cheerio.load(html);
  const positives = [];
  let sawZero = false;
  let sawFree = false;
  let currency = null;

  const capture = (value) => {
    const numbers = extractPriceNumbers(value);
    for (const amount of numbers) {
      if (amount > 0) positives.push(amount);
      else if (amount === 0) sawZero = true;
    }
    if (looksLikeFreePriceText(value)) sawFree = true;
  };

  $("script").each((_, element) => {
    const raw = $(element).html() || $(element).text() || "";
    if (!raw || raw.length > 450000) return;
    if (!/\b(price|lowPrice|highPrice|priceCurrency|minPrice|maxPrice)\b/i.test(raw)) {
      return;
    }

    const currencyMatches = raw.match(
      /"priceCurrency"\s*:\s*"([A-Za-z]{3}|€)"|"currency"\s*:\s*"([A-Za-z]{3}|€)"/gi
    );
    if (currencyMatches && currencyMatches.length > 0 && !currency) {
      const token = currencyMatches[0].match(/([A-Za-z]{3}|€)/);
      currency = normalizeCurrencyCode(token?.[1]);
    }

    const regexes = [
      /"(?:price|lowPrice|minPrice|amount|value)"\s*:\s*"([^"]+)"/gi,
      /"(?:price|lowPrice|minPrice|amount|value)"\s*:\s*([0-9][0-9.,]*)/gi,
      /"(?:highPrice|maxPrice|listPrice)"\s*:\s*"([^"]+)"/gi,
      /"(?:highPrice|maxPrice|listPrice)"\s*:\s*([0-9][0-9.,]*)/gi,
    ];

    for (const regex of regexes) {
      let match = null;
      while ((match = regex.exec(raw))) {
        if (!match[1]) continue;
        capture(match[1]);
      }
    }
  });

  if (positives.length === 0 && !sawZero && !sawFree) return null;

  const priceMin = positives.length > 0 ? Math.min(...positives) : null;
  const priceMax = positives.length > 0 ? Math.max(...positives) : null;

  return normalizePriceResult(
    {
      cost: priceMin,
      priceMin,
      priceMax,
      currency,
      ticketUrl: pageUrl,
      isFree: positives.length === 0 && (sawZero || sawFree),
    },
    "scraped_text"
  );
}

function parseTextPriceFallback(html, pageUrl) {
  const text = String(html || "").replace(/\s+/g, " ").trim();
  if (!text) return null;

  const euroRegex =
    /(?:€|eur)\s*([0-9][0-9.,]*)\s*(?:-|to|tot|–|—)\s*(?:€|eur)?\s*([0-9][0-9.,]*)/gi;
  const fromRegex = /\b(?:from|vanaf|a partir de)\s*(?:€|eur)\s*([0-9][0-9.,]*)/gi;
  const singleRegex = /(?:€|eur)\s*([0-9][0-9.,]*)|([0-9][0-9.,]*)\s*(?:€|eur)/gi;
  const values = [];
  let match = null;

  while ((match = euroRegex.exec(text))) {
    const a = normalizeNumericToken(match[1]);
    const b = normalizeNumericToken(match[2]);
    if (a != null) values.push(a);
    if (b != null) values.push(b);
  }
  while ((match = fromRegex.exec(text))) {
    const parsed = normalizeNumericToken(match[1]);
    if (parsed != null) values.push(parsed);
  }
  while ((match = singleRegex.exec(text))) {
    const parsed = normalizeNumericToken(match[1] || match[2]);
    if (parsed != null) values.push(parsed);
    if (values.length >= 8) break;
  }

  const freeSignal = looksLikeFreePriceText(text);
  if (values.length === 0 && !freeSignal) return null;

  const positives = values.filter((value) => value > 0);
  const sawZero = values.some((value) => value === 0);
  const priceMin = positives.length > 0 ? Math.min(...positives) : null;
  const priceMax = positives.length > 0 ? Math.max(...positives) : null;

  return normalizePriceResult(
    {
      cost: priceMin,
      priceMin,
      priceMax,
      currency: "EUR",
      ticketUrl: pageUrl,
      isFree: positives.length === 0 && (sawZero || freeSignal),
    },
    "scraped_text"
  );
}

function isTicketmasterHost(value) {
  const host = hostnameFromUrl(value) || cleanText(value)?.toLowerCase() || "";
  if (!host) return false;
  return /(^|\.)ticketmaster\./i.test(host);
}

function buildProxyTargetUrl(baseUrl, targetUrl) {
  const base = cleanText(baseUrl);
  const target = cleanText(targetUrl);
  if (!base || !target) return null;
  const normalizedBase = base.replace(/\s+/g, "");
  const strippedTarget = target.replace(/^https?:\/\//i, "");
  return `${normalizedBase}${strippedTarget}`;
}

function extractEmbeddedTicketmasterUrl(rawValue) {
  const text = cleanText(rawValue);
  if (!text) return null;

  const candidates = [text];
  try {
    candidates.push(decodeURIComponent(text));
  } catch {
    // Ignore decode failures.
  }

  for (const candidate of candidates) {
    const match = String(candidate).match(/https?:\/\/(?:www\.)?ticketmaster\.[^ "'<>]+/i);
    if (!match?.[0]) continue;
    const normalized = match[0].replace(/[),.;]+$/, "");
    try {
      const parsed = new URL(normalized);
      if (isTicketmasterHost(parsed.hostname)) return parsed.toString();
    } catch {
      // Ignore invalid candidate URL.
    }
  }

  return null;
}

function resolveTicketmasterTargetUrl(rawTarget) {
  const target = cleanText(rawTarget);
  if (!target) return null;

  try {
    const parsed = new URL(target);
    if (isTicketmasterHost(parsed.hostname)) {
      if (parsed.protocol === "http:") parsed.protocol = "https:";
      return parsed.toString();
    }
  } catch {
    // Fall through to embedded URL extraction.
  }

  const embedded = extractEmbeddedTicketmasterUrl(target);
  if (!embedded) return null;
  try {
    const parsed = new URL(embedded);
    if (!isTicketmasterHost(parsed.hostname)) return null;
    if (parsed.protocol === "http:") parsed.protocol = "https:";
    return parsed.toString();
  } catch {
    return null;
  }
}

function extractTicketmasterWebEventId(url) {
  const target = cleanText(url);
  if (!target) return null;

  try {
    const parsed = new URL(target);
    const segments = String(parsed.pathname || "")
      .split("/")
      .map((segment) => cleanText(segment))
      .filter(Boolean);

    for (let i = segments.length - 1; i >= 0; i -= 1) {
      const segment = segments[i];
      if (!segment) continue;
      const exact = segment.match(/^\d{6,}$/);
      if (exact) return exact[0];
      const suffix = segment.match(/(\d{6,})$/);
      if (suffix) return suffix[1];
      const mixedId = segment.match(/^[A-Za-z0-9_-]{8,}$/);
      if (mixedId && /\d/.test(segment) && /[A-Za-z]/.test(segment)) {
        return mixedId[0];
      }
    }

    const queryId =
      cleanText(parsed.searchParams.get("eventId")) ||
      cleanText(parsed.searchParams.get("eventid")) ||
      cleanText(parsed.searchParams.get("id"));
    if (queryId && /^[A-Za-z0-9_-]{6,}$/.test(queryId)) return queryId;
  } catch {
    return null;
  }

  return null;
}

function createStatusError(prefix, status) {
  const err = new Error(`${prefix}_${status}`);
  err.response = { status };
  return err;
}

function isBlockedHttpStatus(status) {
  const value = Number(status);
  return value === 401 || value === 403 || value === 429;
}

function isBlockedHttpError(err) {
  return isBlockedHttpStatus(err?.response?.status);
}

function roundCurrencyAmount(value) {
  const n = toFiniteNumber(value);
  if (n == null) return null;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function parseTicketmasterTicketSelectionPrice(payload, context = {}) {
  const normalizedPayload =
    payload && typeof payload === "object" && !Array.isArray(payload) ? payload : null;
  if (!normalizedPayload) return null;

  const values = [];
  let sawZero = false;

  const ticketTypes = toArray(normalizedPayload.ticketTypes);
  for (const ticketType of ticketTypes) {
    const prices = toArray(ticketType?.prices);
    for (const price of prices) {
      const base = toFiniteNumber(
        price?.faceValue ?? price?.amount ?? price?.value ?? price?.listPrice
      );
      const serviceFee = toFiniteNumber(price?.serviceFeeChargesValue);
      const upsellFee = toFiniteNumber(price?.upsellFeeChargesValue);

      let total = base;
      if (total != null) {
        if (serviceFee != null && serviceFee >= 0) total += serviceFee;
        if (upsellFee != null && upsellFee >= 0) total += upsellFee;
      } else {
        const directValues = extractPriceNumbers(
          price?.displayPrice ??
            price?.formattedPrice ??
            price?.formatted ??
            price?.label
        );
        if (directValues.length > 0) {
          total = directValues.find((entry) => entry > 0) ?? directValues[0];
        }
      }

      if (total == null) continue;
      const roundedTotal = roundCurrencyAmount(total);
      if (roundedTotal == null) continue;
      if (roundedTotal > 0) values.push(roundedTotal);
      else if (total === 0) sawZero = true;
    }
  }

  if (values.length === 0 && !sawZero) return null;

  let currency =
    normalizeCurrencyCode(normalizedPayload.currencyCode) ||
    normalizeCurrencyCode(normalizedPayload.currency);
  if (!currency && /\.be$/i.test(context.hostname || "")) {
    currency = "EUR";
  }

  const priceMin = values.length > 0 ? Math.min(...values) : null;
  const priceMax = values.length > 0 ? Math.max(...values) : null;

  return normalizePriceResult(
    {
      cost: priceMin,
      priceMin,
      priceMax,
      currency,
      ticketUrl: context.ticketUrl || null,
      isFree: values.length === 0 && sawZero,
    },
    "ticketmaster_api"
  );
}

function parseTicketmasterEventInfoPrice(payload, context = {}) {
  const normalizedPayload =
    payload && typeof payload === "object" && !Array.isArray(payload) ? payload : null;
  if (!normalizedPayload) return null;

  const values = [];
  let sawZero = false;
  const ignoredPathRegex =
    /(fee|delivery|shipping|service|handling|order|payment|charge|tax|vat|reference|references|tracking|analytics|campaign|session|cookie|token|limit|quantity|count|inventory|capacity|availability|identifier|eventid|discoeventid|code|sourceid|id)/i;
  const priceKeyRegex =
    /(price|lowprice|highprice|minprice|maxprice|facevalue|listprice|ticketprice|totalprice|amount|cost)/i;
  const textPriceHintRegex =
    /(€|\beur\b|\beuro\b|\bprice(?:s)?\b|\bprijs(?:en)?\b|\btar(?:if|ief)(?:en)?\b)/i;
  const maxReasonablePrice = 20000;

  const isReasonablePrice = (amount) => {
    const n = toFiniteNumber(amount);
    if (n == null) return false;
    if (n < 0) return false;
    if (n > maxReasonablePrice) return false;
    return true;
  };

  const captureNumbers = (value, pathLabel) => {
    if (ignoredPathRegex.test(pathLabel)) return;
    const numbers = extractPriceNumbers(value);
    for (const amount of numbers) {
      const rounded = roundCurrencyAmount(amount);
      if (rounded == null) continue;
      if (!isReasonablePrice(rounded)) continue;
      if (rounded > 0) values.push(rounded);
      else if (rounded === 0) sawZero = true;
    }
  };

  const walk = (node, path = []) => {
    if (node == null) return;
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, path.concat(String(index))));
      return;
    }
    if (typeof node !== "object") return;

    for (const [key, value] of Object.entries(node)) {
      const nextPath = path.concat(String(key || ""));
      const pathLabel = nextPath.join(".");
      if (
        value != null &&
        (typeof value === "number" || typeof value === "string") &&
        priceKeyRegex.test(String(key || ""))
      ) {
        captureNumbers(value, pathLabel);
      }
      walk(value, nextPath);
    }
  };

  walk(normalizedPayload);

  // Some markets only expose textual labels under event info blocks.
  const textBlocks = [];
  if (typeof normalizedPayload.webInfo === "string") textBlocks.push(normalizedPayload.webInfo);
  if (typeof normalizedPayload.webInfoNoHtml === "string") textBlocks.push(normalizedPayload.webInfoNoHtml);
  for (const topic of toArray(normalizedPayload.eventInfoTopics)) {
    if (typeof topic?.description === "string") textBlocks.push(topic.description);
  }

  for (const block of textBlocks) {
    const compact = cleanText(String(block || "").replace(/<[^>]+>/g, " ")) || "";
    if (!compact) continue;
    if (!textPriceHintRegex.test(compact)) continue;
    const numbers = extractPriceNumbers(compact);
    for (const amount of numbers) {
      const rounded = roundCurrencyAmount(amount);
      if (rounded == null) continue;
      if (!isReasonablePrice(rounded)) continue;
      if (rounded > 0) values.push(rounded);
      else if (rounded === 0) sawZero = true;
    }
  }

  if (values.length === 0 && !sawZero) return null;

  let currency =
    normalizeCurrencyCode(normalizedPayload.currencyCode) ||
    normalizeCurrencyCode(normalizedPayload.currency);
  if (!currency && /\.be$/i.test(context.hostname || "")) {
    currency = "EUR";
  }

  const priceMin = values.length > 0 ? Math.min(...values) : null;
  const priceMax = values.length > 0 ? Math.max(...values) : null;

  return normalizePriceResult(
    {
      cost: priceMin,
      priceMin,
      priceMax,
      currency,
      ticketUrl: context.ticketUrl || null,
      isFree: values.length === 0 && sawZero,
    },
    "ticketmaster_eventinfo"
  );
}

async function extractTicketmasterApiPrice({
  targetUrl,
  timeoutMs,
  userAgent,
  proxyBaseUrl = null,
}) {
  const canonicalTarget = resolveTicketmasterTargetUrl(targetUrl);
  if (!canonicalTarget) return null;

  let parsedTarget = null;
  try {
    parsedTarget = new URL(canonicalTarget);
  } catch {
    return null;
  }

  const eventId = extractTicketmasterWebEventId(canonicalTarget);
  if (!eventId) return null;

  const directApiUrl = `${parsedTarget.protocol}//${parsedTarget.host}/api/ticketselection/${encodeURIComponent(
    eventId
  )}`;
  const referer = `${parsedTarget.protocol}//${parsedTarget.host}${parsedTarget.pathname}`;
  const proxyApiUrl = buildProxyTargetUrl(proxyBaseUrl, directApiUrl);

  const requestCandidates = [
    {
      apiUrl: directApiUrl,
      referer,
      matchedBy: "ticketmaster_ticketselection",
      maxAttempts: 3,
    },
  ];

  if (proxyApiUrl) {
    requestCandidates.push({
      apiUrl: proxyApiUrl,
      referer: buildProxyTargetUrl(proxyBaseUrl, referer) || referer,
      matchedBy: "ticketmaster_ticketselection_proxy",
      maxAttempts: 2,
    });
  }

  let lastBlockedStatus = null;

  for (const candidate of requestCandidates) {
    for (let attempt = 1; attempt <= candidate.maxAttempts; attempt += 1) {
      const response = await axios.get(candidate.apiUrl, {
        timeout: Math.max(1200, timeoutMs),
        responseType: "json",
        maxRedirects: 2,
        headers: {
          "User-Agent": userAgent || DEFAULT_USER_AGENT,
          Accept: "application/json,text/plain,*/*",
          "X-Requested-With": "XMLHttpRequest",
          Referer: candidate.referer,
          "Accept-Language": "en-US,en;q=0.9",
        },
        validateStatus(status) {
          return status >= 200 && status < 500;
        },
      });

      if (response.status === 400 || response.status === 404) break;
      if (response.status >= 500) break;
      if (response.status >= 400) {
        if (isBlockedHttpStatus(response.status) && attempt < candidate.maxAttempts) {
          lastBlockedStatus = response.status;
          await delay(300 + attempt * 500);
          continue;
        }
        if (isBlockedHttpStatus(response.status)) {
          lastBlockedStatus = response.status;
        }
        break;
      }

      const parsed = parseTicketmasterTicketSelectionPrice(response.data, {
        hostname: parsedTarget.hostname,
        ticketUrl: canonicalTarget,
      });
      if (!parsed || !hasPriceSignal(parsed)) break;

      return {
        ...parsed,
        fetchedUrl: candidate.apiUrl,
        matchedBy: candidate.matchedBy,
      };
    }
  }

  if (lastBlockedStatus != null) {
    throw createStatusError("ticketmaster_ticketselection_failed", lastBlockedStatus);
  }

  return null;
}

async function extractTicketmasterEventInfoApiPrice({
  targetUrl,
  timeoutMs,
  userAgent,
  proxyBaseUrl = null,
}) {
  const canonicalTarget = resolveTicketmasterTargetUrl(targetUrl);
  if (!canonicalTarget) return null;

  let parsedTarget = null;
  try {
    parsedTarget = new URL(canonicalTarget);
  } catch {
    return null;
  }

  const eventId = extractTicketmasterWebEventId(canonicalTarget);
  if (!eventId) return null;

  const directApiUrl = `${parsedTarget.protocol}//${parsedTarget.host}/api/eventinfo/${encodeURIComponent(
    eventId
  )}`;
  const referer = `${parsedTarget.protocol}//${parsedTarget.host}${parsedTarget.pathname}`;
  const proxyApiUrl = buildProxyTargetUrl(proxyBaseUrl, directApiUrl);

  const requestCandidates = [
    {
      apiUrl: directApiUrl,
      referer,
      matchedBy: "ticketmaster_eventinfo",
      maxAttempts: 2,
    },
  ];
  if (proxyApiUrl) {
    requestCandidates.push({
      apiUrl: proxyApiUrl,
      referer: buildProxyTargetUrl(proxyBaseUrl, referer) || referer,
      matchedBy: "ticketmaster_eventinfo_proxy",
      maxAttempts: 2,
    });
  }

  let lastBlockedStatus = null;

  for (const candidate of requestCandidates) {
    for (let attempt = 1; attempt <= candidate.maxAttempts; attempt += 1) {
      const response = await axios.get(candidate.apiUrl, {
        timeout: Math.max(1200, timeoutMs),
        responseType: "json",
        maxRedirects: 2,
        headers: {
          "User-Agent": userAgent || DEFAULT_USER_AGENT,
          Accept: "application/json,text/plain,*/*",
          Referer: candidate.referer,
          "Accept-Language": "en-US,en;q=0.9",
        },
        validateStatus(status) {
          return status >= 200 && status < 500;
        },
      });

      if (response.status === 400 || response.status === 404) break;
      if (response.status >= 500) break;
      if (response.status >= 400) {
        if (isBlockedHttpStatus(response.status) && attempt < candidate.maxAttempts) {
          lastBlockedStatus = response.status;
          await delay(250 + attempt * 450);
          continue;
        }
        if (isBlockedHttpStatus(response.status)) {
          lastBlockedStatus = response.status;
        }
        break;
      }

      const parsed = parseTicketmasterEventInfoPrice(response.data, {
        hostname: parsedTarget.hostname,
        ticketUrl: canonicalTarget,
      });
      if (!parsed || !hasPriceSignal(parsed)) break;

      return {
        ...parsed,
        fetchedUrl: candidate.apiUrl,
        matchedBy: candidate.matchedBy,
      };
    }
  }

  if (lastBlockedStatus != null) {
    throw createStatusError("ticketmaster_eventinfo_failed", lastBlockedStatus);
  }

  return null;
}

function pickBestPriceCandidate(candidates) {
  let best = null;
  for (const candidate of candidates) {
    if (!candidate || !hasPriceSignal(candidate)) continue;
    if (!best) {
      best = candidate;
      continue;
    }
    const bestMax = toFiniteNumber(best.priceMax) ?? toFiniteNumber(best.priceMin) ?? 0;
    const candidateMax =
      toFiniteNumber(candidate.priceMax) ?? toFiniteNumber(candidate.priceMin) ?? 0;
    if (candidateMax > bestMax) best = candidate;
  }
  return best;
}

async function extractPriceFromEventUrl({
  url,
  ticketUrl,
  timeoutMs = 4500,
  userAgent = DEFAULT_USER_AGENT,
  ticketmasterProxyBaseUrl = null,
} = {}) {
  const target = cleanText(ticketUrl) || cleanText(url);
  if (!target) return null;

  let parsed = null;
  try {
    parsed = new URL(target);
  } catch {
    return null;
  }
  if (!/^https?:$/i.test(parsed.protocol)) return null;

  let blockedTicketmasterError = null;
  const ticketmasterTarget = resolveTicketmasterTargetUrl(target);
  if (isTicketmasterHost(parsed.hostname || target) || ticketmasterTarget) {
    try {
      const ticketmasterApiPrice = await extractTicketmasterApiPrice({
        targetUrl: ticketmasterTarget || target,
        timeoutMs,
        userAgent,
        proxyBaseUrl: ticketmasterProxyBaseUrl,
      });
      if (ticketmasterApiPrice && hasPriceSignal(ticketmasterApiPrice)) {
        return ticketmasterApiPrice;
      }
    } catch (err) {
      if (isBlockedHttpError(err)) {
        blockedTicketmasterError = err;
      }
    }

    try {
      const ticketmasterEventInfoPrice = await extractTicketmasterEventInfoApiPrice({
        targetUrl: ticketmasterTarget || target,
        timeoutMs,
        userAgent,
        proxyBaseUrl: ticketmasterProxyBaseUrl,
      });
      if (ticketmasterEventInfoPrice && hasPriceSignal(ticketmasterEventInfoPrice)) {
        return ticketmasterEventInfoPrice;
      }
    } catch (err) {
      if (!blockedTicketmasterError && isBlockedHttpError(err)) {
        blockedTicketmasterError = err;
      }
    }
  }

  let html = null;
  try {
    html = await fetchHtml(target, {
      timeoutMs: Math.max(1200, timeoutMs),
      userAgent,
    });
  } catch (err) {
    const status = Number(err?.response?.status);
    if (Number.isFinite(status) && status >= 400) {
      if (blockedTicketmasterError && isBlockedHttpStatus(status)) {
        throw blockedTicketmasterError;
      }
      const wrapped = new Error(`price_fetch_failed_${status}`);
      wrapped.response = { status };
      throw wrapped;
    }
    if (blockedTicketmasterError) {
      throw blockedTicketmasterError;
    }
    return null;
  }

  if (!html) return null;

  const eventNodes = extractJsonLdEventNodes(html);
  const offerCandidates = [];
  for (const node of eventNodes) {
    const offers = parseOffers(node?.offers, target, node?.isAccessibleForFree === true);
    if (offers) {
      offerCandidates.push(
        normalizePriceResult(
          {
            cost: offers.cost,
            priceMin: offers.priceMin,
            priceMax: offers.priceMax,
            currency: offers.currency,
            ticketUrl: offers.ticketUrl || target,
            isFree: offers.isFree,
          },
          "scraped_jsonld"
        )
      );
    }
  }

  const bestJsonLd = pickBestPriceCandidate(offerCandidates);
  if (bestJsonLd) {
    return {
      ...bestJsonLd,
      fetchedUrl: target,
      matchedBy: "jsonld_offers",
    };
  }

  const inlineJson = parseInlineJsonPrice(html, target);
  if (inlineJson) {
    return {
      ...inlineJson,
      fetchedUrl: target,
      matchedBy: "inline_json",
    };
  }

  const textFallback = parseTextPriceFallback(html, target);
  if (textFallback) {
    return {
      ...textFallback,
      fetchedUrl: target,
      matchedBy: "text_fallback",
    };
  }

  if (blockedTicketmasterError) {
    throw blockedTicketmasterError;
  }

  return null;
}

module.exports = {
  DEFAULT_USER_AGENT,
  fetchScrapedEvents,
  parseDelimitedUrls,
  extractPriceFromEventUrl,
};
