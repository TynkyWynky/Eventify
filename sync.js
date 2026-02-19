const axios = require("axios");
const { Pool } = require("pg");
const cron = require("node-cron");
require("dotenv").config();

const CONFIG = {

  API_BASE_URL: process.env.API_BASE_URL || "http://localhost:3000",
  
  // Sync settings
  SYNC_INTERVAL: process.env.SYNC_INTERVAL || "0 * * * *", 
  DEFAULT_LAT: process.env.DEFAULT_LAT || "50.8503",      
  DEFAULT_LNG: process.env.DEFAULT_LNG || "4.3517",
  DEFAULT_RADIUS_KM: process.env.DEFAULT_RADIUS_KM || "50",
  FETCH_SIZE: process.env.FETCH_SIZE || "50",
  
  // Database
  DATABASE_URL: process.env.DATABASE_URL,
  
  // Sync user (for organizer_id field)
  SYNC_USER_ID: process.env.SYNC_USER_ID || 1,

  // DB SSL mode: true/1/require to enable, otherwise disabled
  DATABASE_SSL: process.env.DATABASE_SSL || "",
};

function parseDbSsl(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "require";
}

const pool = new Pool({
  connectionString: CONFIG.DATABASE_URL,
  ssl: parseDbSsl(CONFIG.DATABASE_SSL) ? { rejectUnauthorized: false } : false,
});

async function testConnection() {
  try {
    const client = await pool.connect();
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
} = {}) {
  const url = `${CONFIG.API_BASE_URL}/events`;
  
  console.log(` Fetching events from API: ${url}`);
  console.log(`   Params: lat=${lat}, lng=${lng}, radius=${radiusKm}km, size=${size}`);
  
  try {
    const { data } = await axios.get(url, {
      params: {
        lat,
        lng,
        radiusKm,
        size,
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
  
  let startDatetime = null;
  if (apiEvent.start) {
    
    startDatetime = new Date(apiEvent.start);
    if (isNaN(startDatetime.getTime())) {
      startDatetime = null;
    }
  }

  const sourceId = `${apiEvent.source || 'unknown'}_${apiEvent.sourceId || apiEvent.title}`;

  return {
    
    title: apiEvent.title || "Untitled Event",
    description: apiEvent.artistName 
      ? `Featuring: ${apiEvent.artistName}` 
      : null,
    
    
    start_datetime: startDatetime,
    end_datetime: null, 
    timezone: "UTC",
    
    venue_name: apiEvent.venue,
    address: null, 
    city: apiEvent.city,
    state: null,
    country: null,
    postal_code: null,
    latitude: apiEvent.lat,
    longitude: apiEvent.lng,
    is_virtual: false,
    virtual_link: null,
    
    is_free: false, 
    cost: null,     
    currency: "USD",
    ticket_url: apiEvent.url,
    
    organizer_id: CONFIG.SYNC_USER_ID,
    category: "Music",
    tags: apiEvent.artistName ? [apiEvent.artistName.toLowerCase().replace(/\s+/g, '-')] : [],
    
    status: "published",
    capacity: null,
    
    cover_image_url: apiEvent.imageUrl || null,
    
    source: apiEvent.source || "unknown",
    source_id: apiEvent.sourceId || null,
    source_url: apiEvent.url || null,
  };
}

/**
 * Ensure source tracking columns exist
 */
async function ensureSourceColumns() {
  const client = await pool.connect();
  try {
    const checkResult = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'events' AND column_name = 'source'
    `);
    
    if (checkResult.rows.length === 0) {
      console.log(" Adding source tracking columns to events table...");
      await client.query(`
        ALTER TABLE events 
        ADD COLUMN IF NOT EXISTS source VARCHAR(50),
        ADD COLUMN IF NOT EXISTS source_id VARCHAR(255),
        ADD COLUMN IF NOT EXISTS source_url VARCHAR(500),
        ADD CONSTRAINT unique_source_event UNIQUE (source, source_id)
      `);
      console.log(" Source columns added");
    }
  } finally {
    client.release();
  }
}

/**
 * Upsert (insert or update) an event
 */
async function upsertEvent(eventData) {
  const client = await pool.connect();
  try {
    const query = `
      INSERT INTO events (
        title, description, start_datetime, end_datetime, timezone,
        venue_name, address, city, state, country, postal_code,
        latitude, longitude, is_virtual, virtual_link,
        is_free, cost, currency, ticket_url,
        organizer_id, category, tags, status, capacity,
        cover_image_url, source, source_id, source_url,
        published_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
        $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29
      )
      ON CONFLICT (source, source_id) 
      DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        start_datetime = EXCLUDED.start_datetime,
        end_datetime = EXCLUDED.end_datetime,
        venue_name = EXCLUDED.venue_name,
        city = EXCLUDED.city,
        latitude = EXCLUDED.latitude,
        longitude = EXCLUDED.longitude,
        ticket_url = EXCLUDED.ticket_url,
        category = EXCLUDED.category,
        tags = EXCLUDED.tags,
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
      eventData.currency,
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
  const client = await pool.connect();
  try {
    const result = await client.query(`
      UPDATE events 
      SET status = 'completed',
          updated_at = CURRENT_TIMESTAMP
      WHERE status = 'published'
        AND end_datetime < CURRENT_TIMESTAMP - INTERVAL '1 day'
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
  const client = await pool.connect();
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

async function syncEvents() {
  const startTime = Date.now();
  console.log("\n" + "=".repeat(60));
  console.log(` SYNC STARTED at ${new Date().toISOString()}`);
  console.log("=".repeat(60));

  let inserted = 0;
  let updated = 0;
  let failed = 0;

  try {
    await ensureSourceColumns();

    const apiEvents = await fetchEventsFromAPI();

    if (apiEvents.length === 0) {
      console.log(" No events fetched from API");
      return;
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

    const stats = await getSyncStats();

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log("\n" + "-".repeat(60));
    console.log(` SYNC COMPLETED in ${duration}s`);
    console.log(`   Inserted: ${inserted} | Updated: ${updated} | Failed: ${failed}`);
    console.log(`   Total synced events: ${stats.totalSynced}`);
    console.log(`   Upcoming events: ${stats.upcomingEvents}`);
    console.log(`   By source: ${stats.bySource.map(s => `${s.source}=${s.count}`).join(', ')}`);
    console.log("=".repeat(60) + "\n");

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


async function runManualSync() {
  try {
    const connected = await testConnection();
    if (!connected) {
      process.exit(1);
    }
    await syncEvents();
    process.exit(0);
  } catch (err) {
    console.error("Manual sync failed:", err);
    process.exit(1);
  }
}


async function main() {
  const connected = await testConnection();
  if (!connected) {
    process.exit(1);
  }

  const args = process.argv.slice(2);
  
  if (args.includes('--once') || args.includes('-o')) {
    console.log(" Running one-time sync...");
    await runManualSync();
  } else {
    startScheduler();
  }
}

process.on('SIGINT', async () => {
  console.log('\n Shutting down gracefully...');
  await pool.end();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n Shutting down gracefully...');
  await pool.end();
  process.exit(0);
});

main().catch(console.error);
