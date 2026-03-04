const axios = require("axios");
const { Pool } = require("pg");
const cron = require("node-cron");
const crypto = require("crypto");
require("dotenv").config();

const CONFIG = {

  API_BASE_URL: process.env.API_BASE_URL || "",
  
  // Sync settings
  SYNC_INTERVAL: process.env.SYNC_INTERVAL || "0 * * * *", 
  DEFAULT_LAT: process.env.DEFAULT_LAT || "50.8503",      
  DEFAULT_LNG: process.env.DEFAULT_LNG || "4.3517",
  DEFAULT_RADIUS_KM: process.env.DEFAULT_RADIUS_KM || "50",
  FETCH_SIZE: process.env.FETCH_SIZE || "50",
  SYNC_INCLUDE_SCRAPED: process.env.SYNC_INCLUDE_SCRAPED || "1",
  
  // Database
  DATABASE_URL:
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    "",
  
  // Sync user (for organizer_id field)
  SYNC_USER_ID: process.env.SYNC_USER_ID || 1,

  // DB SSL mode: true/1/require to enable, otherwise disabled
  DATABASE_SSL: process.env.DATABASE_SSL || "",
};

function parseDbSsl(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "require";
}

function cleanText(value) {
  if (value == null) return null;
  const text = String(value).replace(/\s+/g, " ").trim();
  return text || null;
}

function trimTrailingSlashes(value) {
  return String(value || "").replace(/\/+$/, "");
}

function inferApiBaseUrlFromEnv() {
  const explicit = cleanText(CONFIG.API_BASE_URL);
  if (explicit) return trimTrailingSlashes(explicit);

  const vercelUrl = cleanText(process.env.VERCEL_URL);
  if (vercelUrl) return `https://${trimTrailingSlashes(vercelUrl)}/api`;

  return "http://localhost:3000";
}

function resolveApiBaseUrl(rawBaseUrl) {
  const explicit = cleanText(rawBaseUrl);
  if (explicit) return trimTrailingSlashes(explicit);
  return inferApiBaseUrlFromEnv();
}

function toBool(value, fallback = false) {
  if (value == null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function toNumberOrNull(value) {
  if (value == null || value === "") return null;
  if (typeof value === "boolean") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeCurrencyCode(value, fallback = "USD") {
  const text = cleanText(value);
  if (!text) return fallback;
  if (text === "€") return "EUR";
  const normalized = text.toUpperCase();
  if (normalized === "EURO") return "EUR";
  if (/^[A-Z]{3}$/.test(normalized)) return normalized;
  return fallback;
}

function coercePriceTier(value) {
  const text = cleanText(value)?.toLowerCase();
  if (!text) return null;
  if (["free", "low", "mid", "high", "premium"].includes(text)) return text;
  return null;
}

function parseDateTime(value) {
  const text = cleanText(value);
  if (!text) return null;
  const dt = new Date(text);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function normalizeTag(tag) {
  const normalized = cleanText(tag)
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || null;
}

function parseTags(apiEvent) {
  const out = [];
  const seen = new Set();
  const add = (value) => {
    const normalized = normalizeTag(value);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    out.push(normalized);
  };

  if (Array.isArray(apiEvent.tags)) {
    for (const tag of apiEvent.tags) add(tag);
  } else if (typeof apiEvent.tags === "string") {
    for (const tag of apiEvent.tags.split(/[;,|]/)) add(tag);
  }

  add(apiEvent.genre);
  add(apiEvent.category);
  add(apiEvent.artistName);

  return out;
}

function mapStatus(status) {
  const normalized = cleanText(status)?.toLowerCase();
  if (!normalized) return "published";
  if (["draft", "published", "cancelled", "completed"].includes(normalized)) {
    return normalized;
  }
  if (["scheduled", "onsale", "active", "upcoming"].includes(normalized)) {
    return "published";
  }
  if (["canceled", "cancelled"].includes(normalized)) {
    return "cancelled";
  }
  if (["done", "past"].includes(normalized)) {
    return "completed";
  }
  return "published";
}

function buildSourceId(apiEvent, source) {
  const provided = cleanText(apiEvent.sourceId);
  if (provided) return provided.slice(0, 255);

  const seed = [
    source,
    cleanText(apiEvent.url),
    cleanText(apiEvent.title),
    cleanText(apiEvent.start),
    cleanText(apiEvent.city),
  ]
    .filter(Boolean)
    .join("|");

  const digest = crypto.createHash("sha1").update(seed || String(Date.now())).digest("hex");
  return digest.slice(0, 64);
}

const pool = new Pool({
  connectionString: CONFIG.DATABASE_URL,
  ssl:
    parseDbSsl(CONFIG.DATABASE_SSL) || /(?:[?&]sslmode=require)(?:&|$)/i.test(CONFIG.DATABASE_URL)
      ? { rejectUnauthorized: false }
      : false,
});

function requirePool() {
  if (!CONFIG.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not configured for sync. Set DATABASE_URL (or POSTGRES_URL/POSTGRES_PRISMA_URL) in environment variables."
    );
  }
  return pool;
}

async function testConnection() {
  try {
    const client = await requirePool().connect();
    console.log(" Database connected successfully");
    client.release();
    return true;
  } catch (err) {
    console.error(" Database connection failed:", err.message);
    return false;
  }
}

/**
 * Fetch events from your API
 */
async function fetchEventsFromAPI({
  lat = CONFIG.DEFAULT_LAT,
  lng = CONFIG.DEFAULT_LNG,
  radiusKm = CONFIG.DEFAULT_RADIUS_KM,
  size = CONFIG.FETCH_SIZE,
  keyword = "",
  apiBaseUrl,
} = {}) {
  const baseUrl = resolveApiBaseUrl(apiBaseUrl);
  const url = `${baseUrl}/events`;
  
  console.log(` Fetching events from API: ${url}`);
  console.log(`   Params: lat=${lat}, lng=${lng}, radius=${radiusKm}km, size=${size}`);
  
  try {
    const includeScraped = toBool(CONFIG.SYNC_INCLUDE_SCRAPED, true) ? 1 : 0;
    const { data } = await axios.get(url, {
      params: {
        lat,
        lng,
        radiusKm,
        size,
        maxResults: size,
        includeScraped,
        keyword: keyword || undefined,
      },
      timeout: 30000,
    });

    if (!data.ok) {
      throw new Error(data.error || "API returned not ok");
    }

    console.log(` Fetched ${data.events?.length || 0} events from API`);
    return data.events || [];
  } catch (err) {
    console.error(" API fetch failed:", err.message);
    throw err;
  }
}


/**
 * Map API event to database schema
 */
function mapApiEventToDb(apiEvent) {
  const startDatetime = parseDateTime(apiEvent.start);
  if (!startDatetime) {
    throw new Error("Missing/invalid start datetime");
  }

  const endDatetime = parseDateTime(apiEvent.end);
  const source = cleanText(apiEvent.source) || "unknown";
  const sourceId = buildSourceId(apiEvent, source);
  const ticketUrl = cleanText(apiEvent.ticketUrl) || cleanText(apiEvent.url);
  const category = cleanText(apiEvent.category) || cleanText(apiEvent.genre) || "Music";
  const tags = parseTags(apiEvent);

  const parsedCost = toNumberOrNull(apiEvent.cost);
  const parsedPriceMin = toNumberOrNull(
    apiEvent.priceMin ?? apiEvent?.metadata?.priceMin
  );
  const parsedPriceMax = toNumberOrNull(
    apiEvent.priceMax ?? apiEvent?.metadata?.priceMax
  );
  const resolvedCost =
    parsedCost != null
      ? parsedCost
      : parsedPriceMin != null
      ? parsedPriceMin
      : parsedPriceMax;
  const apiIsFree = toBool(apiEvent.isFree, false);
  const isFree = resolvedCost != null ? resolvedCost === 0 : apiIsFree;
  const hasAnyPrice =
    resolvedCost != null || parsedPriceMin != null || parsedPriceMax != null || isFree;
  const priceTier = coercePriceTier(apiEvent.priceTier);
  const priceSource =
    cleanText(apiEvent.priceSource || apiEvent?.metadata?.priceSource) ||
    (hasAnyPrice ? "api" : "unknown");

  const sourceMetadata =
    apiEvent && typeof apiEvent === "object"
      ? {
          fetched_at: new Date().toISOString(),
          metadata:
            apiEvent.metadata && typeof apiEvent.metadata === "object"
              ? apiEvent.metadata
              : null,
          raw_event: apiEvent,
        }
      : null;

  return {
    title: cleanText(apiEvent.title) || "Untitled Event",
    description:
      cleanText(apiEvent.description) ||
      (cleanText(apiEvent.artistName) ? `Featuring: ${cleanText(apiEvent.artistName)}` : null),
    start_datetime: startDatetime,
    end_datetime: endDatetime,
    timezone: cleanText(apiEvent.timezone) || "UTC",
    venue_name: cleanText(apiEvent.venue),
    address: cleanText(apiEvent.address),
    city: cleanText(apiEvent.city),
    state: cleanText(apiEvent.state),
    country: cleanText(apiEvent.country),
    postal_code: cleanText(apiEvent.postalCode),
    latitude: toNumberOrNull(apiEvent.lat),
    longitude: toNumberOrNull(apiEvent.lng),
    is_virtual: toBool(apiEvent.isVirtual, false),
    virtual_link: cleanText(apiEvent.virtualLink),
    is_free: isFree,
    cost: resolvedCost != null ? resolvedCost : isFree ? 0 : null,
    price_min: parsedPriceMin != null ? parsedPriceMin : resolvedCost,
    price_max: parsedPriceMax != null ? parsedPriceMax : resolvedCost,
    currency: normalizeCurrencyCode(apiEvent.currency, "USD"),
    price_tier: priceTier,
    price_source: priceSource,
    ticket_url: ticketUrl,
    organizer_id: CONFIG.SYNC_USER_ID,
    category,
    tags,
    status: mapStatus(apiEvent.status),
    capacity: toNumberOrNull(apiEvent.capacity),
    cover_image_url: cleanText(apiEvent.imageUrl),
    source,
    source_id: sourceId,
    source_url: cleanText(apiEvent.url) || ticketUrl,
    source_metadata: sourceMetadata,
  };
}

/**
 * Ensure source tracking columns exist
 */
async function ensureSourceColumns() {
  const client = await requirePool().connect();
  try {
    await client.query(`
      ALTER TABLE events 
      ADD COLUMN IF NOT EXISTS source VARCHAR(50),
      ADD COLUMN IF NOT EXISTS source_id VARCHAR(255),
      ADD COLUMN IF NOT EXISTS source_url VARCHAR(500),
      ADD COLUMN IF NOT EXISTS source_metadata JSONB,
      ADD COLUMN IF NOT EXISTS price_min DECIMAL(10, 2),
      ADD COLUMN IF NOT EXISTS price_max DECIMAL(10, 2),
      ADD COLUMN IF NOT EXISTS price_tier VARCHAR(16),
      ADD COLUMN IF NOT EXISTS price_source VARCHAR(32)
    `);

    const constraintResult = await client.query(`
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'unique_source_event'
        AND conrelid = 'events'::regclass
    `);

    if (constraintResult.rowCount === 0) {
      console.log(" Adding unique_source_event constraint...");
      await client.query(`
        ALTER TABLE events
        ADD CONSTRAINT unique_source_event UNIQUE (source, source_id)
      `);
      console.log(" unique_source_event constraint added");
    }
  } finally {
    client.release();
  }
}

/**
 * Upsert (insert or update) an event
 */
async function upsertEvent(eventData) {
  const client = await requirePool().connect();
  try {
    const query = `
      INSERT INTO events (
        title, description, start_datetime, end_datetime, timezone,
        venue_name, address, city, state, country, postal_code,
        latitude, longitude, is_virtual, virtual_link,
        is_free, cost, price_min, price_max, currency, price_tier, price_source, ticket_url,
        organizer_id, category, tags, status, capacity,
        cover_image_url, source, source_id, source_url,
        source_metadata, published_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
        $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34
      )
      ON CONFLICT (source, source_id) 
      DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        start_datetime = EXCLUDED.start_datetime,
        end_datetime = EXCLUDED.end_datetime,
        timezone = EXCLUDED.timezone,
        venue_name = EXCLUDED.venue_name,
        address = EXCLUDED.address,
        city = EXCLUDED.city,
        state = EXCLUDED.state,
        country = EXCLUDED.country,
        postal_code = EXCLUDED.postal_code,
        latitude = EXCLUDED.latitude,
        longitude = EXCLUDED.longitude,
        is_virtual = EXCLUDED.is_virtual,
        virtual_link = EXCLUDED.virtual_link,
        is_free = EXCLUDED.is_free,
        cost = EXCLUDED.cost,
        price_min = EXCLUDED.price_min,
        price_max = EXCLUDED.price_max,
        currency = EXCLUDED.currency,
        price_tier = EXCLUDED.price_tier,
        price_source = EXCLUDED.price_source,
        ticket_url = EXCLUDED.ticket_url,
        category = EXCLUDED.category,
        tags = EXCLUDED.tags,
        status = EXCLUDED.status,
        cover_image_url = EXCLUDED.cover_image_url,
        source_url = EXCLUDED.source_url,
        source_metadata = EXCLUDED.source_metadata,
        updated_at = CURRENT_TIMESTAMP
      RETURNING id, title, source_id, 
        CASE WHEN xmax::text::int > 0 THEN 'updated' ELSE 'inserted' END as action
    `;

    const values = [
      eventData.title,
      eventData.description,
      eventData.start_datetime,
      eventData.end_datetime,
      eventData.timezone,
      eventData.venue_name,
      eventData.address,
      eventData.city,
      eventData.state,
      eventData.country,
      eventData.postal_code,
      eventData.latitude,
      eventData.longitude,
      eventData.is_virtual,
      eventData.virtual_link,
      eventData.is_free,
      eventData.cost,
      eventData.price_min,
      eventData.price_max,
      eventData.currency,
      eventData.price_tier,
      eventData.price_source,
      eventData.ticket_url,
      eventData.organizer_id,
      eventData.category,
      eventData.tags,
      eventData.status,
      eventData.capacity,
      eventData.cover_image_url,
      eventData.source,
      eventData.source_id,
      eventData.source_url,
      eventData.source_metadata,
      eventData.status === 'published' ? new Date() : null,
    ];

    const result = await client.query(query, values);
    return result.rows[0];
  } catch (err) {
    console.error("❌ Database error for event:", eventData.title, err.message);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Mark old events as completed
 */
async function markCompletedEvents() {
  const client = await requirePool().connect();
  try {
    const result = await client.query(`
      UPDATE events 
      SET status = 'completed',
          updated_at = CURRENT_TIMESTAMP
      WHERE status = 'published'
        AND COALESCE(end_datetime, start_datetime) < CURRENT_TIMESTAMP - INTERVAL '1 day'
        AND source IS NOT NULL
      RETURNING id, title
    `);
    
    if (result.rows.length > 0) {
      console.log(`🏁 Marked ${result.rows.length} events as completed`);
    }
    return result.rows;
  } finally {
    client.release();
  }
}

/**
 * Get sync statistics
 */
async function getSyncStats() {
  const client = await requirePool().connect();
  try {
    const totalResult = await client.query(`
      SELECT COUNT(*) as total FROM events WHERE source IS NOT NULL
    `);
    const upcomingResult = await client.query(`
      SELECT COUNT(*) as upcoming FROM events 
      WHERE source IS NOT NULL 
        AND status = 'published' 
        AND start_datetime > CURRENT_TIMESTAMP
    `);
    const bySourceResult = await client.query(`
      SELECT source, COUNT(*) as count 
      FROM events 
      WHERE source IS NOT NULL 
      GROUP BY source
    `);
    
    return {
      totalSynced: parseInt(totalResult.rows[0].total),
      upcomingEvents: parseInt(upcomingResult.rows[0].upcoming),
      bySource: bySourceResult.rows,
    };
  } finally {
    client.release();
  }
}

/**
 * Remove exact duplicate synced events.
 * Duplicate key: lower(title) + start_datetime + lower(city) + lower(venue_name)
 */
async function cleanupDuplicateSyncedEvents() {
  const client = await requirePool().connect();
  try {
    await client.query("BEGIN");

    const duplicateCountResult = await client.query(`
      WITH ranked AS (
        SELECT
          id,
          FIRST_VALUE(id) OVER (
            PARTITION BY
              LOWER(title),
              start_datetime,
              LOWER(COALESCE(city, '')),
              LOWER(COALESCE(venue_name, ''))
            ORDER BY updated_at DESC NULLS LAST, id DESC
          ) AS keep_id,
          ROW_NUMBER() OVER (
            PARTITION BY
              LOWER(title),
              start_datetime,
              LOWER(COALESCE(city, '')),
              LOWER(COALESCE(venue_name, ''))
            ORDER BY updated_at DESC NULLS LAST, id DESC
          ) AS rn
        FROM events
        WHERE source IS NOT NULL
          AND start_datetime IS NOT NULL
      )
      SELECT COUNT(*)::int AS total_duplicates
      FROM ranked
      WHERE rn > 1
    `);

    const totalDuplicates = duplicateCountResult.rows[0]?.total_duplicates || 0;
    if (totalDuplicates === 0) {
      await client.query("COMMIT");
      return { removed: 0, mergedRegistrations: 0 };
    }

    const mergedRegistrationsResult = await client.query(`
      WITH ranked AS (
        SELECT
          id,
          FIRST_VALUE(id) OVER (
            PARTITION BY
              LOWER(title),
              start_datetime,
              LOWER(COALESCE(city, '')),
              LOWER(COALESCE(venue_name, ''))
            ORDER BY updated_at DESC NULLS LAST, id DESC
          ) AS keep_id,
          ROW_NUMBER() OVER (
            PARTITION BY
              LOWER(title),
              start_datetime,
              LOWER(COALESCE(city, '')),
              LOWER(COALESCE(venue_name, ''))
            ORDER BY updated_at DESC NULLS LAST, id DESC
          ) AS rn
        FROM events
        WHERE source IS NOT NULL
          AND start_datetime IS NOT NULL
      ),
      duplicates AS (
        SELECT id, keep_id
        FROM ranked
        WHERE rn > 1
      )
      INSERT INTO event_registrations (event_id, user_id, registered_at, status, notes)
      SELECT d.keep_id, er.user_id, er.registered_at, er.status, er.notes
      FROM duplicates d
      JOIN event_registrations er ON er.event_id = d.id
      ON CONFLICT (event_id, user_id) DO NOTHING
    `);

    await client.query(`
      WITH ranked AS (
        SELECT
          id,
          FIRST_VALUE(id) OVER (
            PARTITION BY
              LOWER(title),
              start_datetime,
              LOWER(COALESCE(city, '')),
              LOWER(COALESCE(venue_name, ''))
            ORDER BY updated_at DESC NULLS LAST, id DESC
          ) AS keep_id,
          ROW_NUMBER() OVER (
            PARTITION BY
              LOWER(title),
              start_datetime,
              LOWER(COALESCE(city, '')),
              LOWER(COALESCE(venue_name, ''))
            ORDER BY updated_at DESC NULLS LAST, id DESC
          ) AS rn
        FROM events
        WHERE source IS NOT NULL
          AND start_datetime IS NOT NULL
      ),
      duplicates AS (
        SELECT id
        FROM ranked
        WHERE rn > 1
      )
      DELETE FROM event_registrations er
      USING duplicates d
      WHERE er.event_id = d.id
    `);

    const deleteResult = await client.query(`
      WITH ranked AS (
        SELECT
          id,
          FIRST_VALUE(id) OVER (
            PARTITION BY
              LOWER(title),
              start_datetime,
              LOWER(COALESCE(city, '')),
              LOWER(COALESCE(venue_name, ''))
            ORDER BY updated_at DESC NULLS LAST, id DESC
          ) AS keep_id,
          ROW_NUMBER() OVER (
            PARTITION BY
              LOWER(title),
              start_datetime,
              LOWER(COALESCE(city, '')),
              LOWER(COALESCE(venue_name, ''))
            ORDER BY updated_at DESC NULLS LAST, id DESC
          ) AS rn
        FROM events
        WHERE source IS NOT NULL
          AND start_datetime IS NOT NULL
      ),
      duplicates AS (
        SELECT id
        FROM ranked
        WHERE rn > 1
      )
      DELETE FROM events e
      USING duplicates d
      WHERE e.id = d.id
      RETURNING e.id
    `);

    await client.query("COMMIT");
    return {
      removed: deleteResult.rowCount || 0,
      mergedRegistrations: mergedRegistrationsResult.rowCount || 0,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function syncEvents({ apiBaseUrl } = {}) {
  const startTime = Date.now();
  console.log("\n" + "=".repeat(60));
  console.log(` SYNC STARTED at ${new Date().toISOString()}`);
  console.log("=".repeat(60));

  let inserted = 0;
  let updated = 0;
  let failed = 0;
  let fetched = 0;

  try {
    await ensureSourceColumns();

    const apiEvents = await fetchEventsFromAPI({ apiBaseUrl });
    fetched = apiEvents.length;

    if (apiEvents.length === 0) {
      console.log(" No events fetched from API");
      const durationSeconds = Number(((Date.now() - startTime) / 1000).toFixed(2));
      return {
        fetched: 0,
        inserted: 0,
        updated: 0,
        failed: 0,
        dedupeRemoved: 0,
        mergedRegistrations: 0,
        totalSynced: null,
        upcomingEvents: null,
        bySource: [],
        durationSeconds,
      };
    }

    console.log(`\n Processing ${apiEvents.length} events...`);
    
    for (const apiEvent of apiEvents) {
      try {
        const eventData = mapApiEventToDb(apiEvent);
        const result = await upsertEvent(eventData);
        
        if (result.action === 'inserted') {
          inserted++;
          console.log(`   Inserted: ${result.title}`);
        } else {
          updated++;
          console.log(`   Updated: ${result.title}`);
        }
      } catch (err) {
        failed++;
        console.error(`   Failed: ${apiEvent.title || 'Unknown'} - ${err.message}`);
      }
    }

    await markCompletedEvents();
    const dedupeResult = await cleanupDuplicateSyncedEvents();
    if (dedupeResult.removed > 0) {
      console.log(
        `🧹 Removed ${dedupeResult.removed} duplicate synced events (merged registrations: ${dedupeResult.mergedRegistrations})`
      );
    }

    const stats = await getSyncStats();

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log("\n" + "-".repeat(60));
    console.log(` SYNC COMPLETED in ${duration}s`);
    console.log(`   Inserted: ${inserted} | Updated: ${updated} | Failed: ${failed}`);
    console.log(`   Total synced events: ${stats.totalSynced}`);
    console.log(`   Upcoming events: ${stats.upcomingEvents}`);
    console.log(`   By source: ${stats.bySource.map(s => `${s.source}=${s.count}`).join(', ')}`);
    console.log("=".repeat(60) + "\n");

    return {
      fetched,
      inserted,
      updated,
      failed,
      dedupeRemoved: dedupeResult.removed || 0,
      mergedRegistrations: dedupeResult.mergedRegistrations || 0,
      totalSynced: stats.totalSynced,
      upcomingEvents: stats.upcomingEvents,
      bySource: stats.bySource,
      durationSeconds: Number(duration),
    };

  } catch (err) {
    console.error("\n SYNC FAILED:", err.message);
    console.error(err.stack);
    throw err;
  }
}


function startScheduler() {
  console.log(` Scheduler configured: ${CONFIG.SYNC_INTERVAL} (every hour)`);
  
  console.log(" Running initial sync...");
  syncEvents().catch(console.error);

  cron.schedule(CONFIG.SYNC_INTERVAL, () => {
    syncEvents().catch(console.error);
  });

  console.log(" Scheduler started. Press Ctrl+C to stop.\n");
}


async function runSyncOnce({ apiBaseUrl, skipConnectionTest = false } = {}) {
  if (!skipConnectionTest) {
    const connected = await testConnection();
    if (!connected) {
      throw new Error("Database connection failed");
    }
  }
  return syncEvents({ apiBaseUrl });
}

async function closePool() {
  if (CONFIG.DATABASE_URL) {
    await pool.end();
  }
}

function registerSignalHandlers() {
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("\n Shutting down gracefully...");
    await closePool();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    shutdown().catch((err) => {
      console.error("Failed to close DB pool on SIGINT:", err);
      process.exit(1);
    });
  });

  process.on("SIGTERM", () => {
    shutdown().catch((err) => {
      console.error("Failed to close DB pool on SIGTERM:", err);
      process.exit(1);
    });
  });
}

async function main(args = process.argv.slice(2)) {
  const connected = await testConnection();
  if (!connected) {
    throw new Error("Database connection failed");
  }
  
  if (args.includes('--once') || args.includes('-o')) {
    console.log(" Running one-time sync...");
    const summary = await runSyncOnce({ skipConnectionTest: true });
    await closePool();
    return summary;
  } else {
    startScheduler();
    return null;
  }
}

if (require.main === module) {
  registerSignalHandlers();
  main().catch(async (err) => {
    console.error("Sync service failed:", err);
    try {
      await closePool();
    } catch {
      // Ignore pool-close errors on fatal path.
    }
    process.exitCode = 1;
  });
}

module.exports = {
  CONFIG,
  fetchEventsFromAPI,
  mapApiEventToDb,
  syncEvents,
  runSyncOnce,
  startScheduler,
  testConnection,
  closePool,
};
