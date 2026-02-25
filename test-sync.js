#!/usr/bin/env node
/**
 * Test script for the sync service
 * Run this to verify your setup before starting the scheduler
 */

const { Pool } = require("pg");
const axios = require("axios");
require("dotenv").config();

const CONFIG = {
  DATABASE_URL: process.env.DATABASE_URL,
  API_BASE_URL: process.env.API_BASE_URL || "http://localhost:3000",
  DEFAULT_LAT: process.env.DEFAULT_LAT || "50.8503",
  DEFAULT_LNG: process.env.DEFAULT_LNG || "4.3517",
  DEFAULT_RADIUS_KM: process.env.DEFAULT_RADIUS_KM || "50",
};

const pool = new Pool({
  connectionString: CONFIG.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function testDatabase() {
  console.log("\n TEST 1: Database Connection");
  console.log("-".repeat(50));
  
  try {
    const client = await pool.connect();
    const result = await client.query("SELECT version()");
    console.log(" Database connected");
    console.log(`   Version: ${result.rows[0].version.split(' ')[0]} ${result.rows[0].version.split(' ')[1]}`);
    
    // Check if events table exists
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'events'
      )
    `);
    
    if (tableCheck.rows[0].exists) {
      console.log(" 'events' table exists");
      
      // Check for source columns
      const colCheck = await client.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'events' AND column_name = 'source'
      `);
      
      if (colCheck.rows.length > 0) {
        console.log(" 'source' column exists (API sync ready)");

        const metadataColCheck = await client.query(`
          SELECT column_name
          FROM information_schema.columns
          WHERE table_name = 'events' AND column_name = 'source_metadata'
        `);

        if (metadataColCheck.rows.length > 0) {
          console.log(" 'source_metadata' column exists (raw payload storage ready)");
        } else {
          console.log("  'source_metadata' column missing - sync will auto-add it");
        }
      } else {
        console.log("  'source' column missing - run updated schema!");
      }
      
      // Count existing events
      const countResult = await client.query("SELECT COUNT(*) FROM events");
      console.log(`   Current events: ${countResult.rows[0].count}`);
    } else {
      console.log(" 'events' table not found - run schema first!");
    }
    
    client.release();
    return true;
  } catch (err) {
    console.error(" Database test failed:", err.message);
    return false;
  }
}

async function testAPI() {
  console.log("\n TEST 2: API Connection");
  console.log("-".repeat(50));
  
  try {
    const url = `${CONFIG.API_BASE_URL}/events`;
    console.log(`   Testing: ${url}`);
    
    const { data } = await axios.get(url, {
      params: {
        lat: CONFIG.DEFAULT_LAT,
        lng: CONFIG.DEFAULT_LNG,
        radiusKm: CONFIG.DEFAULT_RADIUS_KM,
        size: 3, // Small test
      },
      timeout: 10000,
    });
    
    if (data.ok) {
      console.log(" API is responding");
      console.log(`   Events returned: ${data.events?.length || 0}`);
      
      if (data.events && data.events.length > 0) {
        const sample = data.events[0];
        console.log("\n   Sample event:");
        console.log(`   - Title: ${sample.title}`);
        console.log(`   - Source: ${sample.source}`);
        console.log(`   - Start: ${sample.start}`);
        console.log(`   - City: ${sample.city}`);
      }
      return true;
    } else {
      console.log("  API returned error:", data.error);
      return false;
    }
  } catch (err) {
    console.error(" API test failed:", err.message);
    if (err.code === 'ECONNREFUSED') {
      console.log("   Is your API running on", CONFIG.API_BASE_URL, "?");
    }
    return false;
  }
}

async function testInsert() {
  console.log("\n TEST 3: Database Insert");
  console.log("-".repeat(50));
  
  try {
    const client = await pool.connect();
    
    // Test insert
    const testEvent = {
      title: "TEST EVENT - DELETE ME",
      description: "This is a test event from sync test script",
      start_datetime: new Date(Date.now() + 86400000), // Tomorrow
      timezone: "UTC",
      venue_name: "Test Venue",
      city: "Test City",
      is_free: true,
      organizer_id: 1,
      category: "Test",
      tags: ["test"],
      status: "draft",
      source: "test",
      source_id: `test_${Date.now()}`,
    };
    
    const result = await client.query(`
      INSERT INTO events (
        title, description, start_datetime, timezone,
        venue_name, city, is_free, organizer_id, category, tags, status,
        source, source_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (source, source_id) DO NOTHING
      RETURNING id
    `, [
      testEvent.title, testEvent.description, testEvent.start_datetime,
      testEvent.timezone, testEvent.venue_name, testEvent.city,
      testEvent.is_free, testEvent.organizer_id, testEvent.category,
      testEvent.tags, testEvent.status, testEvent.source, testEvent.source_id
    ]);
    
    if (result.rows.length > 0) {
      console.log(" Insert test passed");
      console.log(`   Inserted event ID: ${result.rows[0].id}`);
      
      // Clean up
      await client.query("DELETE FROM events WHERE source = 'test'");
      console.log("   Test event cleaned up");
    } else {
      console.log(" Insert returned no rows (conflict?)");
    }
    
    client.release();
    return true;
  } catch (err) {
    console.error(" Insert test failed:", err.message);
    return false;
  }
}

async function runAllTests() {
  console.log("\n" + "=".repeat(50));
  console.log(" EVENTS SYNC SERVICE - TEST SUITE");
  console.log("=".repeat(50));
  
  const dbOk = await testDatabase();
  const apiOk = await testAPI();
  const insertOk = dbOk ? await testInsert() : false;
  
  console.log("\n" + "=".repeat(50));
  console.log(" TEST RESULTS");
  console.log("=".repeat(50));
  console.log(`Database: ${dbOk ? ' PASS' : ' FAIL'}`);
  console.log(`API:      ${apiOk ? ' PASS' : ' FAIL'}`);
  console.log(`Insert:   ${insertOk ? ' PASS' : ' FAIL'}`);
  
  const allPassed = dbOk && apiOk && insertOk;
  
  console.log("\n" + (allPassed ? " All tests passed! Ready to sync." : " Some tests failed. Fix issues before syncing."));
  console.log("=".repeat(50) + "\n");
  
  await pool.end();
  process.exit(allPassed ? 0 : 1);
}

runAllTests().catch((err) => {
  console.error("Test suite error:", err);
  process.exit(1);
});
