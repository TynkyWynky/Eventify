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
  return /\b(free|gratis|gratuit(?:e)?|kostenlos|vrij(?:e)?\s*(?:toegang|entry|admission)?|no\s*charge)\b/i.test(
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

async function scrapeSource(sourceUrl, options) {
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

module.exports = {
  DEFAULT_USER_AGENT,
  fetchScrapedEvents,
  parseDelimitedUrls,
};
