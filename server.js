const express = require("express");
const axios = require("axios");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
require("dotenv").config();
const {
  DEFAULT_USER_AGENT,
  fetchScrapedEvents,
  parseDelimitedUrls,
  extractPriceFromEventUrl,
} = require("./webScraper");
const {
  DEFAULT_RECOMMENDATION_WEIGHTS,
  DEFAULT_RADAR_THRESHOLDS,
  predictGenresFromText,
  predictGenresForEvent,
  recommendEvents,
  buildUndergroundRadar,
  buildTasteDNA,
  predictEventSuccess,
} = require("./aiEngine");

const app = express();

// -----------------------------
// Config
// -----------------------------
function toBool(value, fallback = false) {
  if (value == null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function toPositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function toNonNegativeInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

function parseDelimitedList(rawValue) {
  if (!rawValue) return [];

  const seen = new Set();
  const out = [];
  for (const raw of String(rawValue).split(/[,\n]/)) {
    const value = cleanText(raw);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const NODE_ENV = (process.env.NODE_ENV || "development").trim().toLowerCase();
const IS_PROD = NODE_ENV === "production";
const JWT_SECRET = (process.env.JWT_SECRET || "dev_change_me").trim();
const JWT_EXPIRES_IN = (process.env.JWT_EXPIRES_IN || "7d").trim();
const JWT_ISSUER = (process.env.JWT_ISSUER || "eventify-api").trim();
const JWT_AUDIENCE = (process.env.JWT_AUDIENCE || "eventify-client").trim();
const JWT_ALGORITHMS = ["HS256"];
const JSON_BODY_LIMIT = (process.env.JSON_BODY_LIMIT || "100kb").trim();
const AUTH_LOGIN_WINDOW_MS = toPositiveInt(process.env.AUTH_LOGIN_WINDOW_MS, 15 * 60 * 1000);
const AUTH_LOGIN_MAX_ATTEMPTS = toPositiveInt(process.env.AUTH_LOGIN_MAX_ATTEMPTS, 10);
const AUTH_REGISTER_WINDOW_MS = toPositiveInt(process.env.AUTH_REGISTER_WINDOW_MS, 60 * 60 * 1000);
const AUTH_REGISTER_MAX_ATTEMPTS = toPositiveInt(process.env.AUTH_REGISTER_MAX_ATTEMPTS, 5);
const SOCIAL_WRITE_WINDOW_MS = toPositiveInt(process.env.SOCIAL_WRITE_WINDOW_MS, 60 * 1000);
const SOCIAL_WRITE_MAX_ATTEMPTS = toPositiveInt(process.env.SOCIAL_WRITE_MAX_ATTEMPTS, 60);
const INVITE_WINDOW_MS = toPositiveInt(process.env.INVITE_WINDOW_MS, 60 * 60 * 1000);
const INVITE_MAX_ATTEMPTS = toPositiveInt(process.env.INVITE_MAX_ATTEMPTS, 30);
const rawLlmProvider = (process.env.LLM_PROVIDER || "").trim().toLowerCase();
const llmApiKey = (process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "").trim();
const inferredLlmProvider = rawLlmProvider || (llmApiKey ? "openai" : "ollama");
const llmDefaultBaseUrl =
  inferredLlmProvider === "openai" ? "https://api.openai.com/v1" : "http://127.0.0.1:11434";
const llmDefaultModel = inferredLlmProvider === "openai" ? "gpt-4o-mini" : "llama3.1:8b";
const llmEnabledFallback =
  inferredLlmProvider === "openai" ? Boolean(llmApiKey) : toBool(process.env.OLLAMA_ENABLED, false);
const LLM_CONFIG = {
  provider: inferredLlmProvider,
  enabled: toBool(process.env.LLM_ENABLED, llmEnabledFallback),
  baseUrl: (process.env.LLM_BASE_URL || process.env.OLLAMA_BASE_URL || llmDefaultBaseUrl)
    .trim()
    .replace(/\/+$/, ""),
  apiKey: llmApiKey,
  model: (process.env.LLM_MODEL || process.env.OLLAMA_MODEL || llmDefaultModel).trim(),
  timeoutMs: Math.max(
    1200,
    toPositiveInt(process.env.LLM_TIMEOUT_MS, toPositiveInt(process.env.OLLAMA_TIMEOUT_MS, 5500))
  ),
  maxMessageChars: Math.max(
    200,
    toPositiveInt(
      process.env.LLM_MAX_MESSAGE_CHARS,
      toPositiveInt(process.env.OLLAMA_MAX_MESSAGE_CHARS, 1200)
    )
  ),
};
const CHATBOT_CONFIG = {
  ollamaOnly: toBool(process.env.CHATBOT_FAST_ONLY, toBool(process.env.CHATBOT_OLLAMA_ONLY, true)),
  timeoutMs: Math.max(
    1200,
    toPositiveInt(
      process.env.CHATBOT_TIMEOUT_MS,
      toPositiveInt(process.env.CHATBOT_OLLAMA_TIMEOUT_MS, Math.min(12000, LLM_CONFIG.timeoutMs))
    )
  ),
  maxReplyChars: Math.max(
    400,
    toPositiveInt(process.env.CHATBOT_MAX_REPLY_CHARS, toPositiveInt(process.env.CHATBOT_OLLAMA_MAX_REPLY_CHARS, 1400))
  ),
  cacheTtlMs: Math.max(
    5000,
    toPositiveInt(process.env.CHATBOT_CACHE_TTL_MS, toPositiveInt(process.env.CHATBOT_OLLAMA_CACHE_TTL_MS, 120000))
  ),
};
const PRICE_TIER_THRESHOLDS = Object.freeze({
  low: 20,
  mid: 45,
  high: 80,
});

const chatbotReplyCache = new Map();
const PRICE_ENRICH_CONFIG = {
  enabled: toBool(process.env.PRICE_ENRICH_ENABLED, true),
  maxPerRequest: toNonNegativeInt(process.env.PRICE_ENRICH_MAX_PER_REQUEST, 12),
  ticketmasterMaxPerRequest: toNonNegativeInt(
    process.env.PRICE_ENRICH_TICKETMASTER_MAX_PER_REQUEST,
    6
  ),
  concurrency: Math.max(1, toPositiveInt(process.env.PRICE_ENRICH_CONCURRENCY, 4)),
  timeoutMs: Math.max(1200, toPositiveInt(process.env.PRICE_ENRICH_TIMEOUT_MS, 4500)),
  userAgent: cleanText(process.env.PRICE_ENRICH_USER_AGENT) || "Mozilla/5.0",
  backgroundEnabled: toBool(process.env.PRICE_ENRICH_BACKGROUND_ENABLED, true),
  backgroundDelayMs: Math.max(
    250,
    toPositiveInt(process.env.PRICE_ENRICH_BACKGROUND_DELAY_MS, 2000)
  ),
  backgroundMaxQueue: Math.max(
    10,
    toPositiveInt(process.env.PRICE_ENRICH_BACKGROUND_MAX_QUEUE, 250)
  ),
  cacheTtlMs: Math.max(
    60 * 1000,
    toPositiveInt(process.env.PRICE_ENRICH_CACHE_TTL_MS, 6 * 60 * 60 * 1000)
  ),
  blockTtlMs: Math.max(
    30 * 1000,
    toPositiveInt(process.env.PRICE_ENRICH_BLOCK_TTL_MS, 10 * 60 * 1000)
  ),
  ticketmasterProxyBaseUrl: cleanText(process.env.PRICE_ENRICH_TICKETMASTER_PROXY_BASE_URL),
  ticketmasterProxyTimeoutMs: Math.max(
    1200,
    toPositiveInt(process.env.PRICE_ENRICH_TICKETMASTER_PROXY_TIMEOUT_MS, 10000)
  ),
};

function parseDbSsl(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "require";
}

const DATABASE_URL = (
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  ""
).trim();
const DATABASE_SSL_ENABLED =
  parseDbSsl(process.env.DATABASE_SSL) || /(?:[?&]sslmode=require)(?:&|$)/i.test(DATABASE_URL);
const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl: DATABASE_SSL_ENABLED ? { rejectUnauthorized: false } : false,
    })
  : null;

if (!DATABASE_URL) {
  console.warn(
    "⚠️  DATABASE_URL/POSTGRES_URL is not set. Auth + admin endpoints will not work until you configure it."
  );
}

if (!process.env.JWT_SECRET) {
  console.warn(
    "⚠️  JWT_SECRET is not set. Using a default dev secret. Set JWT_SECRET in .env for real usage."
  );
}
if (IS_PROD && (!process.env.JWT_SECRET || JWT_SECRET === "dev_change_me" || JWT_SECRET.length < 32)) {
  throw new Error("Refusing to start in production without a strong JWT_SECRET (min 32 chars).");
}

function normalizeOrigin(rawOrigin) {
  if (!rawOrigin) return "";
  try {
    const u = new URL(String(rawOrigin));
    return `${u.protocol}//${u.host}`.toLowerCase();
  } catch {
    return String(rawOrigin).trim().toLowerCase();
  }
}

function withWwwVariants(origin) {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return [];
  try {
    const u = new URL(normalized);
    const out = new Set([normalizeOrigin(u.toString())]);
    const hasWww = u.hostname.startsWith("www.");
    const altHost = hasWww ? u.hostname.replace(/^www\./, "") : `www.${u.hostname}`;
    const alt = `${u.protocol}//${altHost}${u.port ? `:${u.port}` : ""}`;
    out.add(normalizeOrigin(alt));
    return Array.from(out).filter(Boolean);
  } catch {
    return [normalized];
  }
}

const configuredCorsOrigins = parseDelimitedList(process.env.CORS_ORIGINS).map(normalizeOrigin);
const allowLocalhostAnyPort = toBool(process.env.CORS_ALLOW_LOCALHOST_ANY_PORT, false);
const allowAllCorsOrigins = toBool(process.env.CORS_ALLOW_ALL, false);
const allowVercelAppOrigins = toBool(
  process.env.CORS_ALLOW_VERCEL_APP,
  IS_PROD && String(process.env.VERCEL || "").trim() === "1"
);
const autoConfiguredCorsOrigins = [
  process.env.APP_URL,
  process.env.PUBLIC_APP_URL,
  process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${String(process.env.VERCEL_PROJECT_PRODUCTION_URL).trim()}`
    : "",
  process.env.VERCEL_URL ? `https://${String(process.env.VERCEL_URL).trim()}` : "",
]
  .flatMap(withWwwVariants)
  .map(normalizeOrigin)
  .filter(Boolean);
const defaultDevCorsOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
].map(normalizeOrigin);

function isLoopbackOrigin(rawOrigin) {
  try {
    const u = new URL(String(rawOrigin || ""));
    if (!["http:", "https:"].includes(u.protocol)) return false;
    return u.hostname === "localhost" || u.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

function isVercelAppOrigin(rawOrigin) {
  try {
    const u = new URL(String(rawOrigin || ""));
    if (u.protocol !== "https:") return false;
    return u.hostname.endsWith(".vercel.app");
  } catch {
    return false;
  }
}

const allowedCorsOrigins = new Set(
  configuredCorsOrigins.length > 0
    ? [...configuredCorsOrigins, ...autoConfiguredCorsOrigins]
    : IS_PROD
      ? autoConfiguredCorsOrigins
      : defaultDevCorsOrigins
);

const trustProxyHops = Number(process.env.TRUST_PROXY || 0);
if (Number.isInteger(trustProxyHops) && trustProxyHops > 0) {
  app.set("trust proxy", trustProxyHops);
}

app.disable("x-powered-by");
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowAllCorsOrigins) return callback(null, true);
      const normalized = normalizeOrigin(origin);
      if (allowedCorsOrigins.has(normalized)) return callback(null, true);
      if (allowLocalhostAnyPort && isLoopbackOrigin(origin)) return callback(null, true);
      if (allowVercelAppOrigins && isVercelAppOrigin(origin)) return callback(null, true);
      return callback(new Error("Origin not allowed by CORS"));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type"],
    maxAge: 600,
    credentials: false,
  })
);
app.use(express.json({ limit: JSON_BODY_LIMIT, strict: true }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
  );
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").toLowerCase();
  if (IS_PROD && (req.secure || forwardedProto === "https")) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  return next();
});
app.use((err, _req, res, next) => {
  if (err && String(err.message || "").includes("Origin not allowed by CORS")) {
    return res.status(403).json({ ok: false, error: "CORS origin denied." });
  }
  return next(err);
});

// -----------------------------
// Helpers (DB + Auth)
// -----------------------------
function requireDb() {
  if (!pool) {
    const err = new Error(
      "DATABASE_URL is not configured. Add it to .env (and docker-compose) to enable auth."
    );
    err.status = 500;
    throw err;
  }
  return pool;
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function splitNameParts(name) {
  const cleaned = String(name || "").trim().replace(/\s+/g, " ");
  if (!cleaned) return { firstName: "", lastName: "" };
  const [firstName, ...rest] = cleaned.split(" ");
  return { firstName, lastName: rest.join(" ") };
}

function safeText(v, fallback = "") {
  return typeof v === "string" ? v : fallback;
}

function isStrongPassword(password) {
  const pwd = String(password || "");
  if (pwd.length < 10 || pwd.length > 256) return false;
  return /[A-Z]/.test(pwd) && /[a-z]/.test(pwd) && /\d/.test(pwd) && /[^A-Za-z0-9]/.test(pwd);
}

function mustBoolean(value, name) {
  if (typeof value !== "boolean") {
    const err = new Error(`Invalid ${name}. Must be boolean.`);
    err.status = 400;
    throw err;
  }
  return value;
}

function mustEventKey(value, name = "eventKey") {
  const key = String(value || "").trim();
  if (!key || key.length > 180 || !/^[a-zA-Z0-9:_-]+$/.test(key)) {
    const err = new Error(`Invalid ${name}`);
    err.status = 400;
    throw err;
  }
  return key;
}

function roleFromRow(row) {
  if (row?.is_admin) return "admin";
  if (row?.is_organisator) return "organizer";
  return "user";
}

function userRowToUser(row) {
  const first = safeText(row.first_name, "").trim();
  const last = safeText(row.last_name, "").trim();
  const name = `${first} ${last}`.trim() || safeText(row.username, "User");

  return {
    id: String(row.id),
    name,
    email: normalizeEmail(row.email),
    role: roleFromRow(row),
  };
}

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: JWT_EXPIRES_IN,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
}

function verifyJwtToken(token) {
  return jwt.verify(token, JWT_SECRET, {
    algorithms: JWT_ALGORITHMS,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
}

function getBearerToken(req) {
  const raw = req.headers.authorization || "";
  const parts = String(raw).split(" ");
  if (parts.length === 2 && /^bearer$/i.test(parts[0])) return parts[1];
  return null;
}

function authRequired(req, res, next) {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return res.status(401).json({ ok: false, error: "Missing Authorization: Bearer <token>" });
    }
    const payload = verifyJwtToken(token);
    if (!payload?.sub || !payload?.role) {
      return res.status(401).json({ ok: false, error: "Invalid token payload" });
    }
    req.auth = payload;
    return next();
  } catch {
    return res.status(401).json({ ok: false, error: "Invalid or expired token" });
  }
}

const rateLimitBuckets = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateLimitBuckets.entries()) {
    if (!bucket || bucket.resetAt <= now) rateLimitBuckets.delete(key);
  }
}, 60_000).unref();

function createRateLimiter({ keyPrefix, windowMs, max }) {
  return (req, res, next) => {
    const ip = String(req.ip || req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown");
    const key = `${keyPrefix}:${ip}`;
    const now = Date.now();
    let bucket = rateLimitBuckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      rateLimitBuckets.set(key, bucket);
    }
    bucket.count += 1;

    const remaining = Math.max(0, max - bucket.count);
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(remaining));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      res.setHeader("Retry-After", String(Math.ceil((bucket.resetAt - now) / 1000)));
      return res.status(429).json({ ok: false, error: "Too many requests. Try again later." });
    }

    return next();
  };
}

const authLoginLimiter = createRateLimiter({
  keyPrefix: "auth:login",
  windowMs: AUTH_LOGIN_WINDOW_MS,
  max: AUTH_LOGIN_MAX_ATTEMPTS,
});

const authRegisterLimiter = createRateLimiter({
  keyPrefix: "auth:register",
  windowMs: AUTH_REGISTER_WINDOW_MS,
  max: AUTH_REGISTER_MAX_ATTEMPTS,
});

const socialWriteLimiter = createRateLimiter({
  keyPrefix: "social:write",
  windowMs: SOCIAL_WRITE_WINDOW_MS,
  max: SOCIAL_WRITE_MAX_ATTEMPTS,
});

const inviteLimiter = createRateLimiter({
  keyPrefix: "invite:write",
  windowMs: INVITE_WINDOW_MS,
  max: INVITE_MAX_ATTEMPTS,
});

function requireRole(allowedRoles) {
  return (req, res, next) => {
    const role = req?.auth?.role;
    if (!role || !allowedRoles.includes(role)) {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }
    return next();
  };
}

async function buildUniqueUsername(email) {
  const base = (String(email).split("@")[0] || "user")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);

  const db = requireDb();

  for (let i = 0; i < 8; i++) {
    const suffix = i === 0 ? "" : `_${Math.floor(Math.random() * 9000 + 1000)}`;
    const candidate = `${base || "user"}${suffix}`.slice(0, 50);

    const r = await db.query("SELECT 1 FROM users WHERE username = $1 LIMIT 1", [candidate]);
    if (r.rowCount === 0) return candidate;
  }

  return `user_${Math.floor(Math.random() * 1_000_000)}`;
}

async function ensureDatabaseSchemaCompatibility() {
  if (!pool) return;
  const db = requireDb();

  await db.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS is_organisator BOOLEAN DEFAULT FALSE
  `);

  await db.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'users'
          AND column_name = 'is_organizer'
      ) THEN
        UPDATE users
        SET is_organisator = COALESCE(is_organisator, is_organizer)
        WHERE is_organisator IS DISTINCT FROM COALESCE(is_organizer, FALSE);
      END IF;
    END $$;
  `);

  await db.query(`
    ALTER TABLE events
    ADD COLUMN IF NOT EXISTS price_min DECIMAL(10, 2),
    ADD COLUMN IF NOT EXISTS price_max DECIMAL(10, 2),
    ADD COLUMN IF NOT EXISTS price_tier VARCHAR(16),
    ADD COLUMN IF NOT EXISTS price_source VARCHAR(32)
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS friend_requests (
      id              SERIAL PRIMARY KEY,
      from_user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      to_user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
      created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      responded_at    TIMESTAMP WITH TIME ZONE,
      CONSTRAINT unique_friend_request UNIQUE (from_user_id, to_user_id),
      CONSTRAINT chk_friend_request_self CHECK (from_user_id <> to_user_id)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS user_friends (
      user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      friend_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, friend_user_id),
      CONSTRAINT chk_friends_self CHECK (user_id <> friend_user_id)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS event_attendance (
      id              SERIAL PRIMARY KEY,
      user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event_key       TEXT NOT NULL,
      is_going        BOOLEAN NOT NULL DEFAULT TRUE,
      created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT unique_attendance UNIQUE (user_id, event_key)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS event_invites (
      id              SERIAL PRIMARY KEY,
      event_key       TEXT NOT NULL,
      inviter_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      invitee_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
      created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      responded_at    TIMESTAMP WITH TIME ZONE,
      CONSTRAINT unique_invite UNIQUE (event_key, invitee_id),
      CONSTRAINT chk_invite_self CHECK (inviter_id <> invitee_id)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id              SERIAL PRIMARY KEY,
      user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type            VARCHAR(50) NOT NULL,
      title           TEXT NOT NULL,
      message         TEXT NOT NULL,
      payload         JSONB DEFAULT '{}'::jsonb,
      is_read         BOOLEAN NOT NULL DEFAULT FALSE,
      created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS event_group_plans (
      id              SERIAL PRIMARY KEY,
      event_key       TEXT NOT NULL,
      creator_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title           TEXT NOT NULL,
      note            TEXT,
      options         JSONB NOT NULL DEFAULT '[]'::jsonb,
      status          VARCHAR(20) NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open', 'closed')),
      created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS event_group_plan_members (
      plan_id         INTEGER NOT NULL REFERENCES event_group_plans(id) ON DELETE CASCADE,
      user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role            VARCHAR(20) NOT NULL DEFAULT 'invited'
                      CHECK (role IN ('creator', 'invited')),
      created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (plan_id, user_id)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS event_group_plan_votes (
      plan_id         INTEGER NOT NULL REFERENCES event_group_plans(id) ON DELETE CASCADE,
      user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      option_index    INTEGER NOT NULL,
      created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (plan_id, user_id)
    )
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_friend_requests_to_status
    ON friend_requests(to_user_id, status)
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_friend_requests_from_status
    ON friend_requests(from_user_id, status)
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_user_friends_user
    ON user_friends(user_id)
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_event_attendance_event
    ON event_attendance(event_key, is_going)
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_event_attendance_user
    ON event_attendance(user_id, updated_at DESC)
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_event_invites_invitee_status
    ON event_invites(invitee_id, status)
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_notifications_user_read_created
    ON notifications(user_id, is_read, created_at DESC)
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_group_plans_event_created
    ON event_group_plans(event_key, created_at DESC)
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_group_plan_members_user
    ON event_group_plan_members(user_id, created_at DESC)
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_group_plan_votes_plan
    ON event_group_plan_votes(plan_id, option_index)
  `);

  await db.query(`
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = CURRENT_TIMESTAMP;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);

  await db.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE t.tgname = 'update_event_attendance_updated_at'
          AND c.relname = 'event_attendance'
          AND n.nspname = 'public'
      ) THEN
        CREATE TRIGGER update_event_attendance_updated_at
          BEFORE UPDATE ON event_attendance
          FOR EACH ROW
          EXECUTE FUNCTION update_updated_at_column();
      END IF;
    END $$;
  `);

  await db.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE t.tgname = 'update_event_group_plans_updated_at'
          AND c.relname = 'event_group_plans'
          AND n.nspname = 'public'
      ) THEN
        CREATE TRIGGER update_event_group_plans_updated_at
          BEFORE UPDATE ON event_group_plans
          FOR EACH ROW
          EXECUTE FUNCTION update_updated_at_column();
      END IF;
    END $$;
  `);

  await db.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE t.tgname = 'update_event_group_plan_votes_updated_at'
          AND c.relname = 'event_group_plan_votes'
          AND n.nspname = 'public'
      ) THEN
        CREATE TRIGGER update_event_group_plan_votes_updated_at
          BEFORE UPDATE ON event_group_plan_votes
          FOR EACH ROW
          EXECUTE FUNCTION update_updated_at_column();
      END IF;
    END $$;
  `);


  // Admin moderation: allow disabling remote/scraped events (we can't delete because they can re-appear)
  await db.query(`
    CREATE TABLE IF NOT EXISTS event_moderation (
      event_key TEXT PRIMARY KEY,
      is_disabled BOOLEAN NOT NULL DEFAULT TRUE,
      reason TEXT,
      snapshot JSONB DEFAULT '{}'::jsonb,
      disabled_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_event_moderation_disabled
    ON event_moderation(is_disabled)
  `);

  await db.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE t.tgname = 'update_event_moderation_updated_at'
          AND c.relname = 'event_moderation'
          AND n.nspname = 'public'
      ) THEN
        CREATE TRIGGER update_event_moderation_updated_at
          BEFORE UPDATE ON event_moderation
          FOR EACH ROW
          EXECUTE FUNCTION update_updated_at_column();
      END IF;
    END $$;
  `);

}

let apiBootstrapPromise = null;
async function ensureApiBootstrap() {
  if (apiBootstrapPromise) return apiBootstrapPromise;

  apiBootstrapPromise = (async () => {
    await ensureDatabaseSchemaCompatibility();
  })().catch((err) => {
    // Allow retries after transient startup failures.
    apiBootstrapPromise = null;
    throw err;
  });

  return apiBootstrapPromise;
}

// -----------------------------
// Auth endpoints
// -----------------------------

/**
 * POST /auth/register
 * body: { name, email, password }
 */
app.post("/auth/register", authRegisterLimiter, async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = safeText(req.body?.password, "");
    const name = safeText(req.body?.name, "").trim();

    if (!email) return res.status(400).json({ ok: false, error: "Email is required." });
    if (email.length > 320) return res.status(400).json({ ok: false, error: "Invalid email." });
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ ok: false, error: "Invalid email." });
    }
    if (!isStrongPassword(password)) {
      return res.status(400).json({
        ok: false,
        error:
          "Password must be 10-256 chars and include uppercase, lowercase, number, and symbol.",
      });
    }
    if (name.length > 120) {
      return res.status(400).json({ ok: false, error: "Name is too long." });
    }

    const username = await buildUniqueUsername(email);
    const firstName = name || "Demo";
    const lastName = "";

    const db = requireDb();
    const created = await db.query(
      `
      INSERT INTO users (username, email, password_hash, first_name, last_name, is_admin, is_organisator, is_active)
      VALUES ($1, $2, crypt($3, gen_salt('bf', 10)), $4, $5, FALSE, FALSE, TRUE)
      RETURNING id, username, email, first_name, last_name, is_admin, is_organisator, is_active, created_at, last_login
      `,
      [username, email, password, firstName, lastName]
    );

    const row = created.rows[0];
    const user = userRowToUser(row);
    const token = signToken(user);

    return res.status(201).json({ ok: true, token, user });
  } catch (err) {
    if (err && err.code === "23505") {
      return res.status(409).json({ ok: false, error: "An account with this email already exists." });
    }
    const status = err?.status || 500;
    return res.status(status).json({ ok: false, error: err?.message || String(err) });
  }
});

/**
 * POST /auth/login
 * body: { emailOrUsername, password }
 */
app.post("/auth/login", authLoginLimiter, async (req, res) => {
  try {
    const identifierRaw = safeText(req.body?.emailOrUsername, "") || safeText(req.body?.email, "");
    const identifier = String(identifierRaw || "").trim();
    const password = safeText(req.body?.password, "");

    if (!identifier) return res.status(400).json({ ok: false, error: "Email or username is required." });
    if (!password) return res.status(400).json({ ok: false, error: "Password is required." });
    if (identifier.length > 320 || password.length > 256) {
      return res.status(400).json({ ok: false, error: "Invalid credentials format." });
    }

    const db = requireDb();

    const result = await db.query(
      `
      SELECT id, username, email, first_name, last_name, is_admin, is_organisator, is_active
      FROM users
      WHERE is_active = TRUE
        AND (email = $1 OR username = $1)
        AND password_hash = crypt($2, password_hash)
      LIMIT 1
      `,
      [normalizeEmail(identifier), password]
    );

    if (result.rowCount === 0) {
      const result2 = await db.query(
        `
        SELECT id, username, email, first_name, last_name, is_admin, is_organisator, is_active
        FROM users
        WHERE is_active = TRUE
          AND (email = $1 OR username = $1)
          AND password_hash = crypt($2, password_hash)
        LIMIT 1
        `,
        [identifier, password]
      );

      if (result2.rowCount === 0) {
        return res.status(401).json({ ok: false, error: "Invalid email/username or password." });
      }

      const row = result2.rows[0];
      const user = userRowToUser(row);
      const token = signToken(user);

      await db.query("UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1", [row.id]);
      return res.json({ ok: true, token, user });
    }

    const row = result.rows[0];
    const user = userRowToUser(row);
    const token = signToken(user);

    await db.query("UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1", [row.id]);
    return res.json({ ok: true, token, user });
  } catch (err) {
    const status = err?.status || 500;
    return res.status(status).json({ ok: false, error: err?.message || String(err) });
  }
});

/**
 * GET /auth/me
 */
app.get("/auth/me", authRequired, async (req, res) => {
  try {
    const userId = req?.auth?.sub;
    if (!userId) return res.status(401).json({ ok: false, error: "Invalid token" });

    const db = requireDb();
    const result = await db.query(
      `
      SELECT id, username, email, first_name, last_name, is_admin, is_organisator, is_active
      FROM users
      WHERE id = $1
      LIMIT 1
      `,
      [userId]
    );

    if (result.rowCount === 0) return res.status(401).json({ ok: false, error: "User not found" });

    const row = result.rows[0];
    if (!row.is_active) return res.status(401).json({ ok: false, error: "User disabled" });

    const user = userRowToUser(row);
    return res.json({ ok: true, user });
  } catch (err) {
    const status = err?.status || 500;
    return res.status(status).json({ ok: false, error: err?.message || String(err) });
  }
});

/**
 * PATCH /auth/me
 * body: { name, email }
 */
app.patch("/auth/me", authRequired, async (req, res) => {
  try {
    const userId = req?.auth?.sub;
    if (!userId) return res.status(401).json({ ok: false, error: "Invalid token" });

    const name = safeText(req.body?.name, "").trim();
    const email = normalizeEmail(req.body?.email);

    if (!name || name.length < 2) {
      return res.status(400).json({ ok: false, error: "Name must be at least 2 characters." });
    }
    if (name.length > 120) {
      return res.status(400).json({ ok: false, error: "Name is too long." });
    }

    if (!email) return res.status(400).json({ ok: false, error: "Email is required." });
    if (email.length > 320) return res.status(400).json({ ok: false, error: "Invalid email." });
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ ok: false, error: "Invalid email." });
    }

    const { firstName, lastName } = splitNameParts(name);
    const db = requireDb();
    const updated = await db.query(
      `
      UPDATE users
      SET email = $2,
          first_name = $3,
          last_name = $4,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id, username, email, first_name, last_name, is_admin, is_organisator, is_active
      `,
      [userId, email, firstName, lastName]
    );

    if (updated.rowCount === 0) return res.status(404).json({ ok: false, error: "User not found" });
    if (!updated.rows[0].is_active) {
      return res.status(401).json({ ok: false, error: "User disabled" });
    }

    return res.json({ ok: true, user: userRowToUser(updated.rows[0]) });
  } catch (err) {
    if (err && err.code === "23505") {
      return res.status(409).json({ ok: false, error: "An account with this email already exists." });
    }
    const status = err?.status || 500;
    return res.status(status).json({ ok: false, error: err?.message || String(err) });
  }
});

// -----------------------------
// Admin endpoints
// -----------------------------

/**
 * GET /admin/users
 */
app.get("/admin/users", authRequired, requireRole(["admin"]), async (_req, res) => {
  try {
    const db = requireDb();
    const result = await db.query(
      `
      SELECT id, username, email, first_name, last_name,
             is_admin, is_organisator, is_active,
             created_at, last_login
      FROM users
      ORDER BY created_at DESC
      `
    );

    const users = result.rows.map((r) => ({
      id: String(r.id),
      username: r.username,
      email: normalizeEmail(r.email),
      name:
        `${safeText(r.first_name, "").trim()} ${safeText(r.last_name, "").trim()}`.trim() ||
        r.username,
      role: roleFromRow(r),
      isActive: Boolean(r.is_active),
      createdAt: r.created_at,
      lastLogin: r.last_login,
    }));

    return res.json({ ok: true, users });
  } catch (err) {
    const status = err?.status || 500;
    return res.status(status).json({ ok: false, error: err?.message || String(err) });
  }
});

/**
 * PATCH /admin/users/:id/role
 * body: { role: 'user' | 'organizer' | 'admin' }
 */
app.patch("/admin/users/:id/role", authRequired, requireRole(["admin"]), async (req, res) => {
  try {
    const userId = mustInt(req.params.id, "user id");
    const role = String(req.body?.role || "").trim();
    if (!role || !["user", "organizer", "admin"].includes(role)) {
      return res.status(400).json({ ok: false, error: "role must be one of: user, organizer, admin" });
    }

    const isAdmin = role === "admin";
    const isOrganizer = role === "organizer" || role === "admin";

    const db = requireDb();
    const updated = await db.query(
      `
      UPDATE users
      SET is_admin = $2,
          is_organisator = $3,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id, username, email, first_name, last_name, is_admin, is_organisator, is_active
      `,
      [userId, isAdmin, isOrganizer]
    );

    if (updated.rowCount === 0) return res.status(404).json({ ok: false, error: "User not found" });

    const user = userRowToUser(updated.rows[0]);
    return res.json({ ok: true, user });
  } catch (err) {
    const status = err?.status || 500;
    return res.status(status).json({ ok: false, error: err?.message || String(err) });
  }
});

/**
 * PATCH /admin/users/:id/active
 * body: { isActive: boolean }
 */
app.patch("/admin/users/:id/active", authRequired, requireRole(["admin"]), async (req, res) => {
  try {
    const userId = mustInt(req.params.id, "user id");
    const isActive = mustBoolean(req.body?.isActive, "isActive");

    const db = requireDb();
    const updated = await db.query(
      `
      UPDATE users
      SET is_active = $2,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id, username, email, first_name, last_name, is_admin, is_organisator, is_active
      `,
      [userId, isActive]
    );

    if (updated.rowCount === 0) return res.status(404).json({ ok: false, error: "User not found" });

    const user = userRowToUser(updated.rows[0]);
    return res.json({ ok: true, user });
  } catch (err) {
    const status = err?.status || 500;
    return res.status(status).json({ ok: false, error: err?.message || String(err) });
  }
});



/**
 * GET /admin/events/disabled
 * Returns disabled event keys stored in DB so admins can re-enable them.
 * Query params:
 * - q (optional) : search in event_key / reason / snapshot.title
 */
app.get("/admin/events/disabled", authRequired, requireRole(["admin"]), async (req, res) => {
  try {
    const q = String(req.query?.q || "").trim();
    const db = requireDb();

    const like = q ? `%${q}%` : null;
    const r = await db.query(
      `
      SELECT
        m.event_key,
        m.reason,
        m.snapshot,
        m.disabled_by,
        m.created_at,
        m.updated_at,
        u.id as u_id,
        u.username as u_username,
        u.email as u_email,
        u.first_name as u_first_name,
        u.last_name as u_last_name
      FROM event_moderation m
      LEFT JOIN users u ON u.id = m.disabled_by
      WHERE m.is_disabled = TRUE
        AND ($1::text IS NULL
          OR m.event_key ILIKE $1
          OR COALESCE(m.reason, '') ILIKE $1
          OR COALESCE(m.snapshot->>'title', '') ILIKE $1
        )
      ORDER BY m.updated_at DESC
      LIMIT 200
      `,
      [like]
    );

    const items = (r.rows || []).map((row) => {
      const first = String(row.u_first_name || '').trim();
      const last = String(row.u_last_name || '').trim();
      const name = `${first} ${last}`.trim() || String(row.u_username || 'Admin');

      return {
        eventKey: String(row.event_key),
        reason: row.reason ? String(row.reason) : null,
        snapshot: row.snapshot || {},
        disabledBy: row.u_id
          ? {
              id: String(row.u_id),
              username: String(row.u_username || ''),
              name,
              email: normalizeEmail(row.u_email),
            }
          : null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });

    return res.json({ ok: true, items });
  } catch (err) {
    const status = err?.status || 500;
    return res.status(status).json({ ok: false, error: err?.message || String(err) });
  }
});

/**
 * PATCH /admin/events/:eventKey/disabled
 * Body: { disabled: boolean, reason?: string, snapshot?: object }
 */
app.patch("/admin/events/:eventKey/disabled", authRequired, requireRole(["admin"]), async (req, res) => {
  try {
    const eventKey = String(req.params.eventKey || '').trim();
    const disabled = Boolean(req.body?.disabled);
    const reason = cleanText(req.body?.reason);
    const snapshot = objectOrEmpty(req.body?.snapshot);

    if (!eventKey) return res.status(400).json({ ok: false, error: 'Missing eventKey' });

    const me = mustInt(req.auth?.sub, 'user id');
    const db = requireDb();

    const r = await db.query(
      `
      INSERT INTO event_moderation (event_key, is_disabled, reason, snapshot, disabled_by)
      VALUES ($1, $2, $3, $4::jsonb, $5)
      ON CONFLICT (event_key) DO UPDATE
      SET is_disabled = EXCLUDED.is_disabled,
          reason = EXCLUDED.reason,
          snapshot = EXCLUDED.snapshot,
          disabled_by = EXCLUDED.disabled_by,
          updated_at = CURRENT_TIMESTAMP
      RETURNING event_key, is_disabled, reason, snapshot, created_at, updated_at
      `,
      [eventKey, disabled, reason, JSON.stringify(snapshot || {}), me]
    );

    invalidateModerationCache();

    const row = r.rows[0];
    return res.json({
      ok: true,
      eventKey: String(row.event_key),
      disabled: Boolean(row.is_disabled),
      reason: row.reason ? String(row.reason) : null,
      snapshot: row.snapshot || {},
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  } catch (err) {
    const status = err?.status || 500;
    return res.status(status).json({ ok: false, error: err?.message || String(err) });
  }
});
// -----------------------------
// Social + Notifications (Friends / Going / Invites / Real-time)
// -----------------------------

function mustInt(value, name) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    const err = new Error(`Invalid ${name}`);
    err.status = 400;
    throw err;
  }
  return n;
}

function authOptional(req, _res, next) {
  try {
    const token = getBearerToken(req);
    if (!token) {
      req.auth = null;
      return next();
    }
    const payload = verifyJwtToken(token);
    req.auth = payload?.sub && payload?.role ? payload : null;
    return next();
  } catch {
    req.auth = null;
    return next();
  }
}

// SSE clients per userId
const sseClients = new Map(); // userId:number -> Set<res>

function addSseClient(userId, res) {
  let set = sseClients.get(userId);
  if (!set) {
    set = new Set();
    sseClients.set(userId, set);
  }
  set.add(res);
}

function removeSseClient(userId, res) {
  const set = sseClients.get(userId);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) sseClients.delete(userId);
}

function pushSse(userId, eventName, payload) {
  const set = sseClients.get(userId);
  if (!set || set.size === 0) return;
  const data = `event: ${eventName}\n` + `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of set) {
    try {
      res.write(data);
    } catch {}
  }
}

async function createNotification({ userId, type, title, message, payload }) {
  const db = requireDb();
  const r = await db.query(
    `
    INSERT INTO notifications (user_id, type, title, message, payload, is_read)
    VALUES ($1, $2, $3, $4, $5::jsonb, FALSE)
    RETURNING id, user_id, type, title, message, payload, is_read, created_at
    `,
    [userId, type, title, message, JSON.stringify(payload || {})]
  );

  const n = r.rows[0];
  const dto = {
    id: String(n.id),
    type: n.type,
    title: n.title,
    message: n.message,
    payload: n.payload,
    isRead: Boolean(n.is_read),
    createdAt: n.created_at,
  };

  pushSse(userId, "notification", dto);
  return dto;
}

async function areFriends(db, a, b) {
  const r = await db.query(
    `SELECT 1 FROM user_friends WHERE user_id = $1 AND friend_user_id = $2 LIMIT 1`,
    [a, b]
  );
  return r.rowCount > 0;
}

function userSummaryRow(row) {
  const first = safeText(row.first_name, "").trim();
  const last = safeText(row.last_name, "").trim();
  const name = `${first} ${last}`.trim() || safeText(row.username, "User");
  return {
    id: String(row.id),
    username: safeText(row.username, ""),
    name,
    email: normalizeEmail(row.email),
  };
}

function normalizePlanOptions(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const raw of value) {
    const clean = safeText(raw, "").trim();
    if (!clean) continue;
    if (out.includes(clean)) continue;
    out.push(clean);
    if (out.length >= 6) break;
  }
  return out;
}

async function loadEventPlansForUser({ db, eventKey, userId }) {
  const planRows = await db.query(
    `
    SELECT p.id, p.event_key, p.title, p.note, p.options, p.status, p.creator_id,
           p.created_at, p.updated_at,
           u.id AS creator_user_id, u.username AS creator_username, u.email AS creator_email,
           u.first_name AS creator_first_name, u.last_name AS creator_last_name
    FROM event_group_plans p
    JOIN event_group_plan_members m ON m.plan_id = p.id
    JOIN users u ON u.id = p.creator_id
    WHERE p.event_key = $1
      AND m.user_id = $2
    ORDER BY p.created_at DESC
    `,
    [eventKey, userId]
  );

  if (planRows.rowCount === 0) return [];
  const planIds = planRows.rows.map((row) => Number(row.id));

  const memberRows = await db.query(
    `
    SELECT m.plan_id, m.user_id, m.role, m.created_at,
           u.id AS member_user_id, u.username AS member_username, u.email AS member_email,
           u.first_name AS member_first_name, u.last_name AS member_last_name
    FROM event_group_plan_members m
    JOIN users u ON u.id = m.user_id
    WHERE m.plan_id = ANY($1::int[])
    ORDER BY m.created_at ASC
    `,
    [planIds]
  );

  const voteRows = await db.query(
    `
    SELECT plan_id, option_index, COUNT(*)::int AS votes
    FROM event_group_plan_votes
    WHERE plan_id = ANY($1::int[])
    GROUP BY plan_id, option_index
    `,
    [planIds]
  );

  const myVotesRows = await db.query(
    `
    SELECT plan_id, option_index
    FROM event_group_plan_votes
    WHERE plan_id = ANY($1::int[]) AND user_id = $2
    `,
    [planIds, userId]
  );

  const membersByPlan = new Map();
  for (const row of memberRows.rows) {
    const planId = Number(row.plan_id);
    const list = membersByPlan.get(planId) || [];
    list.push({
      role: row.role,
      joinedAt: row.created_at,
      user: userSummaryRow({
        id: row.member_user_id,
        username: row.member_username,
        email: row.member_email,
        first_name: row.member_first_name,
        last_name: row.member_last_name,
      }),
    });
    membersByPlan.set(planId, list);
  }

  const voteCountsByPlan = new Map();
  for (const row of voteRows.rows) {
    const planId = Number(row.plan_id);
    const item = voteCountsByPlan.get(planId) || {};
    item[String(Number(row.option_index))] = Number(row.votes) || 0;
    voteCountsByPlan.set(planId, item);
  }

  const myVoteByPlan = new Map();
  for (const row of myVotesRows.rows) {
    myVoteByPlan.set(Number(row.plan_id), Number(row.option_index));
  }

  return planRows.rows.map((row) => ({
    id: String(row.id),
    eventKey: String(row.event_key),
    title: safeText(row.title, "Group plan"),
    note: row.note ? String(row.note) : "",
    status: row.status,
    options: Array.isArray(row.options) ? row.options.map((x) => String(x)) : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    creator: userSummaryRow({
      id: row.creator_user_id,
      username: row.creator_username,
      email: row.creator_email,
      first_name: row.creator_first_name,
      last_name: row.creator_last_name,
    }),
    members: membersByPlan.get(Number(row.id)) || [],
    voteCounts: voteCountsByPlan.get(Number(row.id)) || {},
    myVote: myVoteByPlan.has(Number(row.id)) ? myVoteByPlan.get(Number(row.id)) : null,
  }));
}

// --- Users search
app.get("/users/search", authRequired, async (req, res) => {
  try {
    const me = mustInt(req.auth?.sub, "user id");
    const q = String(req.query?.q || "").trim();
    if (!q || q.length < 2) return res.json({ ok: true, users: [] });

    const db = requireDb();
    const like = `%${q}%`;
    const r = await db.query(
      `
      SELECT id, username, email, first_name, last_name
      FROM users
      WHERE is_active = TRUE
        AND id <> $1
        AND (username ILIKE $2 OR email ILIKE $2 OR first_name ILIKE $2 OR last_name ILIKE $2)
      ORDER BY created_at DESC
      LIMIT 12
      `,
      [me, like]
    );

    return res.json({ ok: true, users: r.rows.map(userSummaryRow) });
  } catch (err) {
    return res.status(err?.status || 500).json({ ok: false, error: err?.message || String(err) });
  }
});

// --- Friends list
app.get("/friends", authRequired, async (req, res) => {
  try {
    const me = mustInt(req.auth?.sub, "user id");
    const db = requireDb();
    const r = await db.query(
      `
      SELECT u.id, u.username, u.email, u.first_name, u.last_name
      FROM user_friends f
      JOIN users u ON u.id = f.friend_user_id
      WHERE f.user_id = $1
      ORDER BY u.first_name NULLS LAST, u.username ASC
      `,
      [me]
    );

    return res.json({ ok: true, friends: r.rows.map(userSummaryRow) });
  } catch (err) {
    return res.status(err?.status || 500).json({ ok: false, error: err?.message || String(err) });
  }
});

// --- Friend requests incoming/outgoing
app.get("/friends/requests/incoming", authRequired, async (req, res) => {
  try {
    const me = mustInt(req.auth?.sub, "user id");
    const db = requireDb();
    const r = await db.query(
      `
      SELECT fr.id, fr.status, fr.created_at,
             u.id AS from_id, u.username, u.email, u.first_name, u.last_name
      FROM friend_requests fr
      JOIN users u ON u.id = fr.from_user_id
      WHERE fr.to_user_id = $1 AND fr.status = 'pending'
      ORDER BY fr.created_at DESC
      `,
      [me]
    );

    const items = r.rows.map((row) => ({
      id: String(row.id),
      status: row.status,
      createdAt: row.created_at,
      from: userSummaryRow({
        id: row.from_id,
        username: row.username,
        email: row.email,
        first_name: row.first_name,
        last_name: row.last_name,
      }),
    }));

    return res.json({ ok: true, requests: items });
  } catch (err) {
    return res.status(err?.status || 500).json({ ok: false, error: err?.message || String(err) });
  }
});

app.get("/friends/requests/outgoing", authRequired, async (req, res) => {
  try {
    const me = mustInt(req.auth?.sub, "user id");
    const db = requireDb();
    const r = await db.query(
      `
      SELECT fr.id, fr.status, fr.created_at,
             u.id AS to_id, u.username, u.email, u.first_name, u.last_name
      FROM friend_requests fr
      JOIN users u ON u.id = fr.to_user_id
      WHERE fr.from_user_id = $1 AND fr.status = 'pending'
      ORDER BY fr.created_at DESC
      `,
      [me]
    );

    const items = r.rows.map((row) => ({
      id: String(row.id),
      status: row.status,
      createdAt: row.created_at,
      to: userSummaryRow({
        id: row.to_id,
        username: row.username,
        email: row.email,
        first_name: row.first_name,
        last_name: row.last_name,
      }),
    }));

    return res.json({ ok: true, requests: items });
  } catch (err) {
    return res.status(err?.status || 500).json({ ok: false, error: err?.message || String(err) });
  }
});

// Send request
app.post("/friends/requests", authRequired, socialWriteLimiter, async (req, res) => {
  try {
    const me = mustInt(req.auth?.sub, "user id");
    const toUserId = mustInt(req.body?.toUserId, "toUserId");
    if (toUserId === me) return res.status(400).json({ ok: false, error: "You can't add yourself." });

    const db = requireDb();
    if (await areFriends(db, me, toUserId)) {
      return res.status(409).json({ ok: false, error: "Already friends." });
    }

    const existing = await db.query(
      `
      SELECT id, status
      FROM friend_requests
      WHERE (from_user_id = $1 AND to_user_id = $2)
         OR (from_user_id = $2 AND to_user_id = $1)
      LIMIT 1
      `,
      [me, toUserId]
    );

    if (existing.rowCount > 0 && existing.rows[0].status === "pending") {
      return res.status(409).json({ ok: false, error: "Friend request already pending." });
    }

    const r = await db.query(
      `
      INSERT INTO friend_requests (from_user_id, to_user_id, status)
      VALUES ($1, $2, 'pending')
      ON CONFLICT (from_user_id, to_user_id)
      DO UPDATE SET status = 'pending', created_at = CURRENT_TIMESTAMP, responded_at = NULL
      RETURNING id
      `,
      [me, toUserId]
    );

    await createNotification({
      userId: toUserId,
      type: "friend_request",
      title: "New friend request",
      message: "You received a friend request.",
      payload: { fromUserId: me },
    });

    return res.status(201).json({ ok: true, requestId: String(r.rows[0].id) });
  } catch (err) {
    return res.status(err?.status || 500).json({ ok: false, error: err?.message || String(err) });
  }
});

// Accept / Decline
app.post("/friends/requests/:id/accept", authRequired, socialWriteLimiter, async (req, res) => {
  try {
    const me = mustInt(req.auth?.sub, "user id");
    const reqId = mustInt(req.params.id, "request id");
    const db = requireDb();

    const r = await db.query(
      `
      UPDATE friend_requests
      SET status = 'accepted', responded_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND to_user_id = $2 AND status = 'pending'
      RETURNING from_user_id
      `,
      [reqId, me]
    );

    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: "Request not found." });

    const fromUserId = Number(r.rows[0].from_user_id);

    await db.query(
      `INSERT INTO user_friends (user_id, friend_user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [me, fromUserId]
    );
    await db.query(
      `INSERT INTO user_friends (user_id, friend_user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [fromUserId, me]
    );

    await createNotification({
      userId: fromUserId,
      type: "friend_accept",
      title: "Friend request accepted",
      message: "Your friend request was accepted.",
      payload: { userId: me },
    });

    return res.json({ ok: true });
  } catch (err) {
    return res.status(err?.status || 500).json({ ok: false, error: err?.message || String(err) });
  }
});

app.post("/friends/requests/:id/decline", authRequired, socialWriteLimiter, async (req, res) => {
  try {
    const me = mustInt(req.auth?.sub, "user id");
    const reqId = mustInt(req.params.id, "request id");
    const db = requireDb();

    const r = await db.query(
      `
      UPDATE friend_requests
      SET status = 'declined', responded_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND to_user_id = $2 AND status = 'pending'
      RETURNING id
      `,
      [reqId, me]
    );

    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: "Request not found." });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(err?.status || 500).json({ ok: false, error: err?.message || String(err) });
  }
});

// Remove friend
app.delete("/friends/:friendId", authRequired, socialWriteLimiter, async (req, res) => {
  try {
    const me = mustInt(req.auth?.sub, "user id");
    const friendId = mustInt(req.params.friendId, "friend id");
    const db = requireDb();

    await db.query(`DELETE FROM user_friends WHERE user_id = $1 AND friend_user_id = $2`, [me, friendId]);
    await db.query(`DELETE FROM user_friends WHERE user_id = $1 AND friend_user_id = $2`, [friendId, me]);

    return res.json({ ok: true });
  } catch (err) {
    return res.status(err?.status || 500).json({ ok: false, error: err?.message || String(err) });
  }
});

// --- My going list
app.get("/me/going", authRequired, async (req, res) => {
  try {
    const me = mustInt(req.auth?.sub, "user id");
    const db = requireDb();

    const r = await db.query(
      `
      SELECT event_key
      FROM event_attendance
      WHERE user_id = $1 AND is_going = TRUE
      ORDER BY updated_at DESC
      LIMIT 200
      `,
      [me]
    );

    return res.json({ ok: true, eventKeys: r.rows.map((x) => String(x.event_key)) });
  } catch (err) {
    return res.status(err?.status || 500).json({ ok: false, error: err?.message || String(err) });
  }
});

// --- Event social info
app.get("/events/:eventKey/social", authOptional, async (req, res) => {
  try {
    const eventKey = mustEventKey(req.params.eventKey);

    const db = requireDb();

    const countR = await db.query(
      `SELECT COUNT(*)::int AS c FROM event_attendance WHERE event_key = $1 AND is_going = TRUE`,
      [eventKey]
    );
    const goingCount = Number(countR.rows[0]?.c) || 0;

    const me = req.auth?.sub ? Number(req.auth.sub) : null;

    let myGoing = false;
    let friendsGoing = [];
    let myInvite = null;

    if (me) {
      const myR = await db.query(
        `SELECT is_going FROM event_attendance WHERE user_id = $1 AND event_key = $2 LIMIT 1`,
        [me, eventKey]
      );
      myGoing = myR.rowCount > 0 ? Boolean(myR.rows[0].is_going) : false;

      const fR = await db.query(
        `
        SELECT u.id, u.username, u.email, u.first_name, u.last_name
        FROM user_friends f
        JOIN event_attendance a
          ON a.user_id = f.friend_user_id
         AND a.event_key = $2
         AND a.is_going = TRUE
        JOIN users u ON u.id = f.friend_user_id
        WHERE f.user_id = $1
        ORDER BY u.first_name NULLS LAST, u.username ASC
        LIMIT 25
        `,
        [me, eventKey]
      );
      friendsGoing = fR.rows.map(userSummaryRow);

      const inv = await db.query(
        `
        SELECT i.id, i.status, i.created_at,
               u.id AS inviter_id, u.username, u.email, u.first_name, u.last_name
        FROM event_invites i
        JOIN users u ON u.id = i.inviter_id
        WHERE i.event_key = $1 AND i.invitee_id = $2
        ORDER BY i.created_at DESC
        LIMIT 1
        `,
        [eventKey, me]
      );

      if (inv.rowCount > 0) {
        const row = inv.rows[0];
        myInvite = {
          id: String(row.id),
          status: row.status,
          createdAt: row.created_at,
          inviter: userSummaryRow({
            id: row.inviter_id,
            username: row.username,
            email: row.email,
            first_name: row.first_name,
            last_name: row.last_name,
          }),
        };
      }
    }

    return res.json({ ok: true, eventKey, goingCount, myGoing, friendsGoing, myInvite });
  } catch (err) {
    return res.status(err?.status || 500).json({ ok: false, error: err?.message || String(err) });
  }
});

// --- Group plans for event (member scope)
app.get("/events/:eventKey/plans", authRequired, async (req, res) => {
  try {
    const me = mustInt(req.auth?.sub, "user id");
    const eventKey = mustEventKey(req.params.eventKey);

    const db = requireDb();
    const plans = await loadEventPlansForUser({ db, eventKey, userId: me });
    return res.json({ ok: true, plans });
  } catch (err) {
    return res.status(err?.status || 500).json({ ok: false, error: err?.message || String(err) });
  }
});

app.post("/events/:eventKey/plans", authRequired, socialWriteLimiter, inviteLimiter, async (req, res) => {
  try {
    const me = mustInt(req.auth?.sub, "user id");
    const eventKey = mustEventKey(req.params.eventKey);

    const title = safeText(req.body?.title, "").trim();
    const note = safeText(req.body?.note, "").trim();
    const options = normalizePlanOptions(req.body?.options);
    const inviteeIdsRaw = Array.isArray(req.body?.inviteeIds) ? req.body.inviteeIds : [];
    const inviteeIds = Array.from(
      new Set(
        inviteeIdsRaw
          .map((x) => Number(x))
          .filter((x) => Number.isInteger(x) && x > 0 && x !== me)
      )
    );

    if (!title) return res.status(400).json({ ok: false, error: "Title is required." });
    if (options.length < 2) {
      return res.status(400).json({ ok: false, error: "At least 2 plan options are required." });
    }

    const db = requireDb();
    for (const friendId of inviteeIds) {
      if (!(await areFriends(db, me, friendId))) {
        return res.status(403).json({ ok: false, error: "You can only invite friends." });
      }
    }

    const created = await db.query(
      `
      INSERT INTO event_group_plans (event_key, creator_id, title, note, options, status)
      VALUES ($1, $2, $3, $4, $5::jsonb, 'open')
      RETURNING id
      `,
      [eventKey, me, title, note || null, JSON.stringify(options)]
    );

    const planId = Number(created.rows[0].id);
    await db.query(
      `
      INSERT INTO event_group_plan_members (plan_id, user_id, role)
      VALUES ($1, $2, 'creator')
      ON CONFLICT (plan_id, user_id) DO NOTHING
      `,
      [planId, me]
    );

    for (const friendId of inviteeIds) {
      await db.query(
        `
        INSERT INTO event_group_plan_members (plan_id, user_id, role)
        VALUES ($1, $2, 'invited')
        ON CONFLICT (plan_id, user_id) DO NOTHING
        `,
        [planId, friendId]
      );

      await createNotification({
        userId: friendId,
        type: "group_plan_invite",
        title: "Group plan invite",
        message: `You were invited to the plan "${title}".`,
        payload: { planId: String(planId), eventKey, title, note: note || null },
      });
    }

    const plans = await loadEventPlansForUser({ db, eventKey, userId: me });
    const plan = plans.find((p) => p.id === String(planId)) || null;
    return res.status(201).json({ ok: true, plan });
  } catch (err) {
    return res.status(err?.status || 500).json({ ok: false, error: err?.message || String(err) });
  }
});

app.post("/plans/:planId/vote", authRequired, socialWriteLimiter, async (req, res) => {
  try {
    const me = mustInt(req.auth?.sub, "user id");
    const planId = mustInt(req.params.planId, "planId");
    const optionIndex = Number(req.body?.optionIndex);
    if (!Number.isInteger(optionIndex) || optionIndex < 0) {
      return res.status(400).json({ ok: false, error: "Invalid optionIndex." });
    }

    const db = requireDb();
    const scope = await db.query(
      `
      SELECT p.event_key, p.options
      FROM event_group_plans p
      JOIN event_group_plan_members m ON m.plan_id = p.id
      WHERE p.id = $1 AND m.user_id = $2
      LIMIT 1
      `,
      [planId, me]
    );
    if (scope.rowCount === 0) {
      return res.status(404).json({ ok: false, error: "Plan not found." });
    }

    const options = Array.isArray(scope.rows[0].options) ? scope.rows[0].options : [];
    if (optionIndex >= options.length) {
      return res.status(400).json({ ok: false, error: "Option index out of range." });
    }

    await db.query(
      `
      INSERT INTO event_group_plan_votes (plan_id, user_id, option_index)
      VALUES ($1, $2, $3)
      ON CONFLICT (plan_id, user_id)
      DO UPDATE SET option_index = $3, updated_at = CURRENT_TIMESTAMP
      `,
      [planId, me, optionIndex]
    );

    const eventKey = String(scope.rows[0].event_key || "");
    const plans = await loadEventPlansForUser({ db, eventKey, userId: me });
    const plan = plans.find((p) => p.id === String(planId)) || null;
    return res.json({ ok: true, plan });
  } catch (err) {
    return res.status(err?.status || 500).json({ ok: false, error: err?.message || String(err) });
  }
});

// --- Set going + notify friends (real-time)
app.put("/events/:eventKey/going", authRequired, socialWriteLimiter, async (req, res) => {
  try {
    const me = mustInt(req.auth?.sub, "user id");
    const eventKey = mustEventKey(req.params.eventKey);
    const going = mustBoolean(req.body?.going, "going");
    const eventMeta = req.body?.event && typeof req.body.event === "object" ? req.body.event : null;

    const db = requireDb();

    const prev = await db.query(
      `SELECT is_going FROM event_attendance WHERE user_id = $1 AND event_key = $2 LIMIT 1`,
      [me, eventKey]
    );
    const wasGoing = prev.rowCount > 0 ? Boolean(prev.rows[0].is_going) : false;

    await db.query(
      `
      INSERT INTO event_attendance (user_id, event_key, is_going)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id, event_key)
      DO UPDATE SET is_going = $3, updated_at = CURRENT_TIMESTAMP
      `,
      [me, eventKey, going]
    );

    if (going && !wasGoing) {
      const fr = await db.query(`SELECT friend_user_id FROM user_friends WHERE user_id = $1`, [me]);

      const title = safeText(eventMeta?.title, "An event");
      const city = safeText(eventMeta?.city, "");
      const msg = city
        ? `Your friend is going to "${title}" (${city}).`
        : `Your friend is going to "${title}".`;

      for (const row of fr.rows) {
        const friendId = Number(row.friend_user_id);
        await createNotification({
          userId: friendId,
          type: "friend_going",
          title: "Friend is going",
          message: msg,
          payload: { fromUserId: me, eventKey, event: eventMeta || null },
        });
      }
    }

    return res.json({ ok: true, going });
  } catch (err) {
    return res.status(err?.status || 500).json({ ok: false, error: err?.message || String(err) });
  }
});

// --- Invite friend to event
app.post("/events/:eventKey/invite", authRequired, socialWriteLimiter, inviteLimiter, async (req, res) => {
  try {
    const me = mustInt(req.auth?.sub, "user id");
    const eventKey = mustEventKey(req.params.eventKey);
    const inviteeId = mustInt(req.body?.inviteeId, "inviteeId");
    const eventMeta = req.body?.event && typeof req.body.event === "object" ? req.body.event : null;

    if (inviteeId === me) return res.status(400).json({ ok: false, error: "Can't invite yourself" });

    const db = requireDb();

    if (!(await areFriends(db, me, inviteeId))) {
      return res.status(403).json({ ok: false, error: "You can only invite friends." });
    }

    const r = await db.query(
      `
      INSERT INTO event_invites (event_key, inviter_id, invitee_id, status)
      VALUES ($1, $2, $3, 'pending')
      ON CONFLICT (event_key, invitee_id)
      DO UPDATE SET inviter_id = $2, status = 'pending', created_at = CURRENT_TIMESTAMP, responded_at = NULL
      RETURNING id
      `,
      [eventKey, me, inviteeId]
    );

    const title = safeText(eventMeta?.title, "an event");
    await createNotification({
      userId: inviteeId,
      type: "event_invite",
      title: "Event invite",
      message: `You were invited to "${title}".`,
      payload: { inviterId: me, eventKey, inviteId: String(r.rows[0].id), event: eventMeta || null },
    });

    return res.status(201).json({ ok: true, inviteId: String(r.rows[0].id) });
  } catch (err) {
    return res.status(err?.status || 500).json({ ok: false, error: err?.message || String(err) });
  }
});

// --- Invites list + respond
app.get("/invites", authRequired, async (req, res) => {
  try {
    const me = mustInt(req.auth?.sub, "user id");
    const db = requireDb();

    const r = await db.query(
      `
      SELECT i.id, i.event_key, i.status, i.created_at,
             u.id AS inviter_id, u.username, u.email, u.first_name, u.last_name
      FROM event_invites i
      JOIN users u ON u.id = i.inviter_id
      WHERE i.invitee_id = $1 AND i.status = 'pending'
      ORDER BY i.created_at DESC
      LIMIT 50
      `,
      [me]
    );

    const invites = r.rows.map((row) => ({
      id: String(row.id),
      eventKey: String(row.event_key),
      status: row.status,
      createdAt: row.created_at,
      inviter: userSummaryRow({
        id: row.inviter_id,
        username: row.username,
        email: row.email,
        first_name: row.first_name,
        last_name: row.last_name,
      }),
    }));

    return res.json({ ok: true, invites });
  } catch (err) {
    return res.status(err?.status || 500).json({ ok: false, error: err?.message || String(err) });
  }
});

app.post("/invites/:id/respond", authRequired, socialWriteLimiter, async (req, res) => {
  try {
    const me = mustInt(req.auth?.sub, "user id");
    const inviteId = mustInt(req.params.id, "invite id");
    const status = String(req.body?.status || "").trim();
    if (!["accepted", "declined"].includes(status)) {
      return res.status(400).json({ ok: false, error: "status must be accepted|declined" });
    }

    const db = requireDb();
    const r = await db.query(
      `
      UPDATE event_invites
      SET status = $3, responded_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND invitee_id = $2 AND status = 'pending'
      RETURNING inviter_id, event_key
      `,
      [inviteId, me, status]
    );

    if (r.rowCount === 0) return res.status(404).json({ ok: false, error: "Invite not found." });

    const inviterId = Number(r.rows[0].inviter_id);
    const eventKey = String(r.rows[0].event_key);

    if (status === "accepted") {
      await db.query(
        `
        INSERT INTO event_attendance (user_id, event_key, is_going)
        VALUES ($1, $2, TRUE)
        ON CONFLICT (user_id, event_key)
        DO UPDATE SET is_going = TRUE, updated_at = CURRENT_TIMESTAMP
        `,
        [me, eventKey]
      );
    }

    await createNotification({
      userId: inviterId,
      type: "invite_response",
      title: "Invite response",
      message: status === "accepted" ? "Your invite was accepted." : "Your invite was declined.",
      payload: { inviteeId: me, eventKey, status },
    });

    return res.json({ ok: true, status });
  } catch (err) {
    return res.status(err?.status || 500).json({ ok: false, error: err?.message || String(err) });
  }
});

// --- Notifications REST
app.get("/notifications", authRequired, async (req, res) => {
  try {
    const me = mustInt(req.auth?.sub, "user id");
    const limit = Math.max(1, Math.min(50, Number(req.query?.limit) || 20));
    const db = requireDb();

    const r = await db.query(
      `
      SELECT id, type, title, message, payload, is_read, created_at
      FROM notifications
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2
      `,
      [me, limit]
    );

    const notifications = r.rows.map((n) => ({
      id: String(n.id),
      type: n.type,
      title: n.title,
      message: n.message,
      payload: n.payload,
      isRead: Boolean(n.is_read),
      createdAt: n.created_at,
    }));

    return res.json({ ok: true, notifications });
  } catch (err) {
    return res.status(err?.status || 500).json({ ok: false, error: err?.message || String(err) });
  }
});

app.post("/notifications/:id/read", authRequired, async (req, res) => {
  try {
    const me = mustInt(req.auth?.sub, "user id");
    const id = mustInt(req.params.id, "notification id");
    const db = requireDb();
    await db.query(`UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2`, [id, me]);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(err?.status || 500).json({ ok: false, error: err?.message || String(err) });
  }
});

app.post("/notifications/read-all", authRequired, async (req, res) => {
  try {
    const me = mustInt(req.auth?.sub, "user id");
    const db = requireDb();
    await db.query(`UPDATE notifications SET is_read = TRUE WHERE user_id = $1`, [me]);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(err?.status || 500).json({ ok: false, error: err?.message || String(err) });
  }
});

// --- Notifications SSE (real-time)
app.get("/notifications/stream", async (req, res) => {
  try {
    const token = String(req.query?.token || "");
    if (!token) return res.status(401).end();

    const payload = verifyJwtToken(token);
    const userId = mustInt(payload?.sub, "user id");

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });

    res.write(`event: ready\ndata: {}\n\n`);
    addSseClient(userId, res);

    const pingId = setInterval(() => {
      try {
        res.write(`event: ping\ndata: {}\n\n`);
      } catch {}
    }, 25000);

    req.on("close", () => {
      clearInterval(pingId);
      removeSseClient(userId, res);
    });
  } catch {
    return res.status(401).end();
  }
});

// -----------------------------
// Event API (existing)
// -----------------------------

function cleanText(value) {
  if (value == null) return null;
  const text = String(value).replace(/\s+/g, " ").trim();
  return text || null;
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of tags) {
    const tag = cleanText(raw);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

function toNumberOrNull(value) {
  if (value == null || value === "") return null;
  if (typeof value === "boolean") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pickFirstNumber(values = []) {
  for (const value of values) {
    const n = toNumberOrNull(value);
    if (n != null) return n;
  }
  return null;
}

function parsePriceBoundsFromText(value) {
  const text = cleanText(value);
  if (!text) return null;

  const lowered = text.toLowerCase();
  let currency = null;
  if (/[€]|\beur\b|\beuro\b/.test(lowered)) currency = "EUR";
  else if (/[$]|\busd\b|\bdollar/.test(lowered)) currency = "USD";
  else if (/[£]|\bgbp\b|\bpound/.test(lowered)) currency = "GBP";

  const isFreeHint = /\b(free|gratis|gratuit|kosteloos)\b/i.test(lowered);
  const rawNumbers = text.match(/\d{1,4}(?:[.,]\d{1,2})?/g) || [];
  const numbers = rawNumbers
    .map((entry) => Number(String(entry).replace(",", ".")))
    .filter((entry) => Number.isFinite(entry) && entry >= 0 && entry <= 5000);

  if (numbers.length === 0) {
    if (!isFreeHint) return null;
    return { min: 0, max: 0, currency, isFreeHint: true };
  }

  return {
    min: Math.min(...numbers),
    max: Math.max(...numbers),
    currency,
    isFreeHint,
  };
}

function normalizeCurrencyCode(value) {
  const text = cleanText(value);
  if (!text) return null;
  if (text === "€") return "EUR";
  const normalized = text.toUpperCase();
  if (normalized === "EURO") return "EUR";
  if (/^[A-Z]{3}$/.test(normalized)) return normalized;
  return null;
}

function hasPositivePriceSignal(price) {
  const values = [price?.cost, price?.priceMin, price?.priceMax]
    .map((value) => toNumberOrNull(value))
    .filter((value) => value != null);
  return values.some((value) => value > 0);
}

function hasAnyPriceSignal(price) {
  const values = [price?.cost, price?.priceMin, price?.priceMax]
    .map((value) => toNumberOrNull(value))
    .filter((value) => value != null);
  if (values.length > 0) return true;
  return price?.isFree === true;
}

function computePriceTier({ priceMin, priceMax, cost, currency, isFree }) {
  if (isFree === true) return "free";
  const normalizedCurrency = normalizeCurrencyCode(currency);
  if (!normalizedCurrency || normalizedCurrency !== "EUR") return null;

  const values = [toNumberOrNull(priceMax), toNumberOrNull(priceMin), toNumberOrNull(cost)].filter(
    (value) => value != null && value > 0
  );
  if (values.length === 0) return null;

  const reference = values[0];
  if (reference <= PRICE_TIER_THRESHOLDS.low) return "low";
  if (reference <= PRICE_TIER_THRESHOLDS.mid) return "mid";
  if (reference <= PRICE_TIER_THRESHOLDS.high) return "high";
  return "premium";
}

function formatPriceAmount(value, currency) {
  const n = toNumberOrNull(value);
  if (n == null) return null;
  const normalizedCurrency = normalizeCurrencyCode(currency);
  const rounded = Number.isInteger(n) ? String(Math.round(n)) : n.toFixed(2).replace(/\.00$/, "");
  if (!normalizedCurrency || normalizedCurrency === "EUR") return `€${rounded}`;
  return `${normalizedCurrency} ${rounded}`;
}

function formatPriceLabel({ priceMin, priceMax, cost, currency, isFree }) {
  if (isFree === true) return "Free";
  const min = toNumberOrNull(priceMin);
  const max = toNumberOrNull(priceMax);
  const single = toNumberOrNull(cost);
  if (min != null && max != null) {
    const a = Math.min(min, max);
    const b = Math.max(min, max);
    if (Math.abs(a - b) < 0.01) return formatPriceAmount(a, currency) || "Price unknown";
    const left = formatPriceAmount(a, currency);
    const right = formatPriceAmount(b, currency);
    if (left && right) return `${left}–${right}`;
  }
  if (single != null) return formatPriceAmount(single, currency) || "Price unknown";
  if (min != null) return formatPriceAmount(min, currency) || "Price unknown";
  if (max != null) return formatPriceAmount(max, currency) || "Price unknown";
  return "Price unknown";
}

function normalizeEventPrice(event) {
  const metadata =
    event?.metadata && typeof event.metadata === "object" ? event.metadata : {};
  const sourceMetadata =
    event?.sourceMetadata && typeof event.sourceMetadata === "object"
      ? event.sourceMetadata
      : event?.source_metadata && typeof event.source_metadata === "object"
      ? event.source_metadata
      : {};

  const priceTextHints = [
    event?.priceLabel,
    event?.priceText,
    event?.price,
    metadata?.priceLabel,
    metadata?.priceText,
    metadata?.price,
    sourceMetadata?.priceLabel,
    sourceMetadata?.priceText,
    sourceMetadata?.price,
  ]
    .map((entry) => parsePriceBoundsFromText(entry))
    .filter(Boolean);

  const hintPriceMin = pickFirstNumber(priceTextHints.map((entry) => entry?.min));
  const hintPriceMax = pickFirstNumber(priceTextHints.map((entry) => entry?.max));
  const hintCurrency =
    priceTextHints.map((entry) => normalizeCurrencyCode(entry?.currency)).find(Boolean) || null;
  const hintIsFree = priceTextHints.some((entry) => entry?.isFreeHint === true);

  const topPriceMin = pickFirstNumber([
    event?.priceMin,
    event?.price_min,
    event?.minPrice,
    event?.minimumPrice,
    event?.price?.min,
    event?.price?.low,
    event?.price?.from,
  ]);
  const topPriceMax = pickFirstNumber([
    event?.priceMax,
    event?.price_max,
    event?.maxPrice,
    event?.maximumPrice,
    event?.price?.max,
    event?.price?.high,
    event?.price?.to,
  ]);
  const metaPriceMin = pickFirstNumber([
    metadata?.priceMin,
    metadata?.price_min,
    metadata?.minPrice,
    metadata?.minimumPrice,
    metadata?.price?.min,
    metadata?.price?.low,
    sourceMetadata?.priceMin,
    sourceMetadata?.price_min,
    sourceMetadata?.minPrice,
    sourceMetadata?.minimumPrice,
    sourceMetadata?.price?.min,
    sourceMetadata?.price?.low,
    hintPriceMin,
  ]);
  const metaPriceMax = pickFirstNumber([
    metadata?.priceMax,
    metadata?.price_max,
    metadata?.maxPrice,
    metadata?.maximumPrice,
    metadata?.price?.max,
    metadata?.price?.high,
    sourceMetadata?.priceMax,
    sourceMetadata?.price_max,
    sourceMetadata?.maxPrice,
    sourceMetadata?.maximumPrice,
    sourceMetadata?.price?.max,
    sourceMetadata?.price?.high,
    hintPriceMax,
  ]);
  const topCost = pickFirstNumber([
    event?.cost,
    event?.priceAmount,
    event?.priceValue,
    event?.amount,
    metadata?.cost,
    metadata?.priceAmount,
    metadata?.priceValue,
    metadata?.amount,
    sourceMetadata?.cost,
    sourceMetadata?.priceAmount,
    sourceMetadata?.priceValue,
    sourceMetadata?.amount,
    hintPriceMin,
  ]);

  let priceMin = topPriceMin != null ? topPriceMin : metaPriceMin;
  let priceMax = topPriceMax != null ? topPriceMax : metaPriceMax;
  let cost =
    topCost != null
      ? topCost
      : priceMin != null
      ? priceMin
      : priceMax != null
      ? priceMax
      : null;

  if (priceMin == null && cost != null) priceMin = cost;
  if (priceMax == null && cost != null) priceMax = cost;

  if (priceMin != null && priceMax != null && priceMin > priceMax) {
    const swap = priceMin;
    priceMin = priceMax;
    priceMax = swap;
  }

  const currency =
    normalizeCurrencyCode(event?.currency) ||
    normalizeCurrencyCode(event?.currencyCode) ||
    normalizeCurrencyCode(event?.priceCurrency) ||
    normalizeCurrencyCode(event?.price?.currency) ||
    normalizeCurrencyCode(event?.metadata?.currency) ||
    normalizeCurrencyCode(event?.metadata?.currencyCode) ||
    normalizeCurrencyCode(event?.metadata?.priceCurrency) ||
    normalizeCurrencyCode(event?.metadata?.price?.currency) ||
    normalizeCurrencyCode(sourceMetadata?.currency) ||
    normalizeCurrencyCode(sourceMetadata?.currencyCode) ||
    normalizeCurrencyCode(sourceMetadata?.priceCurrency) ||
    normalizeCurrencyCode(sourceMetadata?.price?.currency) ||
    hintCurrency;

  const hasFreeHint =
    hintIsFree ||
    event?.isFree === true ||
    metadata?.isFree === true ||
    sourceMetadata?.isFree === true;

  const hasPaidSignal =
    (priceMin != null && priceMin > 0) ||
    (priceMax != null && priceMax > 0) ||
    (cost != null && cost > 0);
  const hasZeroSignal =
    priceMin === 0 || priceMax === 0 || cost === 0 || hasFreeHint;
  const isFree = hasPaidSignal ? false : hasZeroSignal;
  const hasAnyPrice = hasPaidSignal || hasZeroSignal;

  return {
    cost: cost != null ? cost : isFree ? 0 : null,
    priceMin: priceMin != null ? priceMin : isFree ? 0 : null,
    priceMax: priceMax != null ? priceMax : isFree ? 0 : null,
    currency: currency || null,
    isFree,
    hasAnyPrice,
  };
}

function resolvePriceConfidence(event, normalizedPrice) {
  const explicit = cleanText(event?.priceConfidence)?.toLowerCase();
  if (explicit) return explicit;

  const sourceHint = cleanText(event?.priceSource || event?.metadata?.priceSource)?.toLowerCase();
  if (sourceHint === "scraped_jsonld") return "scraped_jsonld";
  if (sourceHint === "scraped_text") return "scraped_text";
  if (sourceHint === "scraped_proxy") return "scraped_text";

  if (!normalizedPrice?.hasAnyPrice) return "unknown";
  if (
    normalizedPrice.priceMin != null &&
    normalizedPrice.priceMax != null &&
    normalizedPrice.priceMin > 0 &&
    normalizedPrice.priceMax > 0
  ) {
    return "api_exact";
  }
  return "api_partial";
}

function enrichEventWithPriceInsights(event) {
  const normalizedPrice = normalizeEventPrice(event);
  const priceTier = computePriceTier(normalizedPrice);
  const priceLabel = formatPriceLabel(normalizedPrice);
  const priceSource =
    cleanText(event?.priceSource || event?.metadata?.priceSource) ||
    (normalizedPrice.hasAnyPrice ? "api" : "unknown");
  const priceConfidence = resolvePriceConfidence(event, normalizedPrice);

  const metadata =
    event?.metadata && typeof event.metadata === "object" ? event.metadata : null;

  return {
    ...event,
    ...normalizedPrice,
    priceTier,
    priceLabel,
    priceSource,
    priceConfidence,
    metadata: metadata
      ? {
          ...metadata,
          priceMin:
            toNumberOrNull(metadata.priceMin) != null
              ? toNumberOrNull(metadata.priceMin)
              : normalizedPrice.priceMin,
          priceMax:
            toNumberOrNull(metadata.priceMax) != null
              ? toNumberOrNull(metadata.priceMax)
              : normalizedPrice.priceMax,
        }
      : event?.metadata,
  };
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
    .map((value) => toNumberOrNull(value))
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

function normalizeCountryValue(value) {
  const normalized = cleanText(value)?.toLowerCase();
  if (!normalized) return null;
  if (
    ["be", "belgium", "belgique", "belgie", "kingdom of belgium"].includes(
      normalized
    )
  ) {
    return "belgium";
  }
  return normalized;
}

function normalizeKeyPart(value) {
  const clean = cleanText(value);
  if (!clean) return "";
  return clean
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeTitleForKey(value) {
  const key = normalizeKeyPart(value);
  if (!key) return "";
  return key
    .replace(/\b(19|20)\d{2}\b/g, " ")
    .replace(/\b(live|tickets|official|tour|concert|show)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getDateKey(startValue) {
  const clean = cleanText(startValue);
  if (!clean) return "";
  const dt = new Date(clean);
  if (Number.isNaN(dt.getTime())) return clean.slice(0, 10);
  return dt.toISOString().slice(0, 10);
}

function getTimeKey(startValue) {
  const clean = cleanText(startValue);
  if (!clean) return "";
  const dt = new Date(clean);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toISOString().slice(11, 16);
}

function buildDedupKeys(event) {
  const source = normalizeKeyPart(event?.source);
  const sourceId = normalizeKeyPart(event?.sourceId);
  const title = normalizeTitleForKey(event?.title);
  const day = getDateKey(event?.start);
  const time = getTimeKey(event?.start);
  const city = normalizeKeyPart(event?.city);
  const venue = normalizeKeyPart(event?.venue);
  const artist = normalizeKeyPart(event?.artistName);

  const keys = new Set();
  if (source && sourceId) {
    keys.add(`source|${source}|${sourceId}`);
  }
  if (title && day && city && venue && time) {
    keys.add(`strict|${title}|${day}|${time}|${city}|${venue}`);
  }
  if (title && day && city && venue && !time) {
    keys.add(`strict_day|${title}|${day}|${city}|${venue}`);
  }
  if (title && day && city && !time) {
    keys.add(`cityday|${title}|${day}|${city}`);
  }
  if (title && day && venue && !time) {
    keys.add(`venueday|${title}|${day}|${venue}`);
  }
  if (title && day && time) {
    keys.add(`titledaytime|${title}|${day}|${time}`);
  }
  if (artist && day && venue && time) {
    keys.add(`artist|${artist}|${day}|${time}|${venue}`);
  }
  if (artist && day && venue && !time) {
    keys.add(`artist_day|${artist}|${day}|${venue}`);
  }

  return [...keys];
}

function scoreEventQuality(event) {
  let score = 0;

  if (cleanText(event?.title)) score += 2;
  if (cleanText(event?.start)) score += 2;
  if (cleanText(event?.venue)) score += 1;
  if (cleanText(event?.city)) score += 1;
  if (cleanText(event?.country)) score += 1;
  if (toNumberOrNull(event?.lat) != null && toNumberOrNull(event?.lng) != null) {
    score += 2;
  }
  if (cleanText(event?.imageUrl)) score += 1;
  if (cleanText(event?.ticketUrl) || cleanText(event?.url)) score += 1;
  if (cleanText(event?.description) && cleanText(event?.description).length >= 40) {
    score += 1;
  }
  if (Array.isArray(event?.tags) && event.tags.length > 0) score += 1;

  const source = normalizeKeyPart(event?.source);
  if (source === "ticketmaster") score += 2;
  if (source === "webscrape") score += 1;

  return score;
}

function mergeEventsPrefer(primary, secondary) {
  const merged = { ...primary };
  const fillKeys = [
    "description",
    "end",
    "timezone",
    "address",
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
    "url",
    "imageUrl",
    "genre",
    "category",
    "organizerName",
    "artistName",
  ];

  for (const key of fillKeys) {
    const current = merged[key];
    const candidate = secondary[key];
    const hasCurrent =
      current != null && !(typeof current === "string" && cleanText(current) == null);
    const hasCandidate =
      candidate != null &&
      !(typeof candidate === "string" && cleanText(candidate) == null);
    if (!hasCurrent && hasCandidate) {
      merged[key] = candidate;
    }
  }

  merged.isFree = resolveMergedIsFree(primary, secondary, merged);
  merged.isVirtual = Boolean(primary?.isVirtual || secondary?.isVirtual);

  const tags = new Set([...(primary?.tags || []), ...(secondary?.tags || [])]);
  merged.tags = [...tags].filter(Boolean);

  return merged;
}

function dedupe(events) {
  const keyToIndex = new Map();
  const out = [];

  for (const candidate of events) {
    const keys = buildDedupKeys(candidate);

    let existingIndex = null;
    for (const key of keys) {
      if (keyToIndex.has(key)) {
        existingIndex = keyToIndex.get(key);
        break;
      }
    }

    if (existingIndex == null) {
      const nextIndex = out.length;
      out.push(candidate);
      for (const key of keys) keyToIndex.set(key, nextIndex);
      continue;
    }

    const current = out[existingIndex];
    const currentScore = scoreEventQuality(current);
    const candidateScore = scoreEventQuality(candidate);

    let winner = current;
    let loser = candidate;
    if (candidateScore > currentScore) {
      winner = candidate;
      loser = current;
    } else if (candidateScore === currentScore) {
      const currentSource = normalizeKeyPart(current?.source);
      const candidateSource = normalizeKeyPart(candidate?.source);
      const sourceRank = {
        ticketmaster: 3,
        webscrape: 2,
      };
      const currentRank = sourceRank[currentSource] || 1;
      const candidateRank = sourceRank[candidateSource] || 1;
      if (candidateRank > currentRank) {
        winner = candidate;
        loser = current;
      }
    }

    out[existingIndex] = mergeEventsPrefer(winner, loser);
    const mergedKeys = new Set([
      ...buildDedupKeys(out[existingIndex]),
      ...buildDedupKeys(current),
      ...keys,
    ]);
    for (const key of mergedKeys) keyToIndex.set(key, existingIndex);
  }
  return out;
}

function interleaveBySource(events, limit) {
  const maxItems = Math.max(1, Number(limit) || events.length || 1);
  const groups = new Map();

  for (const event of events) {
    const source = (cleanText(event?.source) || "unknown").toLowerCase();
    if (!groups.has(source)) groups.set(source, []);
    groups.get(source).push(event);
  }

  const sourceOrder = [...groups.keys()].sort(
    (a, b) => groups.get(b).length - groups.get(a).length
  );

  const out = [];
  while (out.length < maxItems) {
    let added = false;
    for (const source of sourceOrder) {
      const queue = groups.get(source);
      if (!queue || queue.length === 0) continue;
      out.push(queue.shift());
      added = true;
      if (out.length >= maxItems) break;
    }
    if (!added) break;
  }

  return out;
}

async function mapSequential(items, fn) {
  const out = [];
  for (const it of items) out.push(await fn(it));
  return out;
}

async function mapWithConcurrency(items, concurrency, worker) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return [];
  const limit = Math.max(1, Number(concurrency) || 1);
  const out = new Array(list.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (cursor < list.length) {
      const index = cursor++;
      out[index] = await worker(list[index], index);
    }
  });

  await Promise.all(runners);
  return out;
}

function summarizeSources(events) {
  const counts = {};
  for (const event of events) {
    const source = cleanText(event.source) || "unknown";
    counts[source] = (counts[source] || 0) + 1;
  }
  return counts;
}

const SCRAPE_CONFIG = {
  enabled: toBool(process.env.SCRAPE_ENABLED, true),
  sourceUrls: parseDelimitedUrls(process.env.SCRAPE_SOURCE_URLS),
  maxEvents: toPositiveInt(process.env.SCRAPE_MAX_EVENTS, 40),
  maxEventsPerSource: toPositiveInt(
    process.env.SCRAPE_MAX_EVENTS_PER_SOURCE,
    25
  ),
  maxLinksPerSource: toPositiveInt(process.env.SCRAPE_MAX_LINKS_PER_SOURCE, 20),
  timeoutMs: toPositiveInt(process.env.SCRAPE_TIMEOUT_MS, 12000),
  userAgent:
    cleanText(process.env.SCRAPE_USER_AGENT) || DEFAULT_USER_AGENT,
  sourceConcurrency: toPositiveInt(process.env.SCRAPE_SOURCE_CONCURRENCY, 3),
  allowedCountries: parseDelimitedList(process.env.SCRAPE_ALLOWED_COUNTRIES),
  allowedCities: parseDelimitedList(process.env.SCRAPE_ALLOWED_CITIES),
  songkickOfficialLookup: toBool(
    process.env.SCRAPE_SONGKICK_OFFICIAL_LOOKUP,
    true
  ),
  songkickOfficialEnrichLimit: toPositiveInt(
    process.env.SCRAPE_SONGKICK_OFFICIAL_ENRICH_LIMIT,
    12
  ),
  songkickTicketTimeoutMs: toPositiveInt(
    process.env.SCRAPE_SONGKICK_TICKET_TIMEOUT_MS,
    10000
  ),
  officialPageTimeoutMs: toPositiveInt(
    process.env.SCRAPE_OFFICIAL_PAGE_TIMEOUT_MS,
    10000
  ),
  enableOfficialPageEnrichment: toBool(
    process.env.SCRAPE_ENABLE_OFFICIAL_PAGE_ENRICHMENT,
    true
  ),
  eventbriteDetailLookup: toBool(
    process.env.SCRAPE_EVENTBRITE_DETAIL_LOOKUP,
    true
  ),
  eventbriteDetailEnrichLimit: toPositiveInt(
    process.env.SCRAPE_EVENTBRITE_DETAIL_ENRICH_LIMIT,
    8
  ),
  eventbriteDetailTimeoutMs: toPositiveInt(
    process.env.SCRAPE_EVENTBRITE_DETAIL_TIMEOUT_MS,
    10000
  ),
};

const SCRAPE_CACHE_CONFIG = {
  ttlMs: toPositiveInt(process.env.SCRAPE_CACHE_TTL_MS, 15 * 60 * 1000),
  requestWaitMs: toPositiveInt(process.env.SCRAPE_REQUEST_WAIT_MS, 2500),
};
const SCRAPE_SYNC_WAIT_MS = Math.max(
  SCRAPE_CACHE_CONFIG.requestWaitMs,
  toPositiveInt(process.env.SCRAPE_SYNC_WAIT_MS, 25000)
);

const scrapeCache = {
  events: [],
  fetchedAt: 0,
  inFlight: null,
  lastError: null,
};
const priceEnrichCache = new Map();
const priceBlockedHosts = new Map();
const priceEnrichRoundRobin = {
  ticketmasterCursor: 0,
  generalCursor: 0,
};
const priceEnrichBackground = {
  queue: [],
  queueKeys: new Set(),
  running: false,
};

// Cache for admin-moderation (disabled events) so we don't hit DB on every /events call
const moderationCache = {
  disabledKeys: new Set(),
  fetchedAt: 0,
  ttlMs: 10 * 1000,
};


const SCRAPE_ALLOWED_COUNTRIES_NORMALIZED = SCRAPE_CONFIG.allowedCountries
  .map((value) => normalizeCountryValue(value))
  .filter(Boolean);
const SCRAPE_ALLOWED_CITIES_NORMALIZED = SCRAPE_CONFIG.allowedCities
  .map((value) => value.toLowerCase())
  .filter(Boolean);

function isScrapeCacheFresh() {
  if (!Array.isArray(scrapeCache.events) || scrapeCache.events.length === 0) {
    return false;
  }
  const ageMs = Date.now() - scrapeCache.fetchedAt;
  return ageMs >= 0 && ageMs < SCRAPE_CACHE_CONFIG.ttlMs;
}

function getScrapeCacheAgeMs() {
  if (!scrapeCache.fetchedAt) return null;
  const ageMs = Date.now() - scrapeCache.fetchedAt;
  return ageMs >= 0 ? ageMs : 0;
}

function isPriceCacheEntryFresh(entry) {
  if (!entry || !entry.cachedAt) return false;
  return Date.now() - entry.cachedAt < PRICE_ENRICH_CONFIG.cacheTtlMs;
}

function getCachedPriceEntry(url) {
  const key = cleanText(url);
  if (!key) return null;
  const cached = priceEnrichCache.get(key);
  if (!cached) return null;
  if (isPriceCacheEntryFresh(cached)) return cached;
  priceEnrichCache.delete(key);
  return null;
}

function setCachedPriceEntry(url, payload) {
  const key = cleanText(url);
  if (!key) return;
  priceEnrichCache.set(key, {
    cachedAt: Date.now(),
    payload: payload || null,
  });
}

function getHostFromUrlSafe(url) {
  const value = cleanText(url);
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (!/^https?:$/i.test(parsed.protocol)) return null;
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function buildPriceBlockKey(url, source) {
  const targetUrl = cleanText(url);
  const host = getHostFromUrlSafe(url);
  if (!targetUrl && !host) return null;

  const sourceKey = cleanText(source)?.toLowerCase() || "";
  // Ticketmaster can return mixed 200/403 across events and over short intervals.
  // Keep retrying per request rather than skipping by block cache.
  if (sourceKey === "ticketmaster") {
    return null;
  }
  return host ? `host:${host}` : targetUrl ? `url:${targetUrl}` : null;
}

function isHostBlockedForPrice(url, source) {
  const key = buildPriceBlockKey(url, source);
  if (!key) return false;
  const blockedUntil = priceBlockedHosts.get(key) || 0;
  if (!blockedUntil) return false;
  if (Date.now() >= blockedUntil) {
    priceBlockedHosts.delete(key);
    return false;
  }
  return true;
}

function blockHostForPrice(url, source) {
  const key = buildPriceBlockKey(url, source);
  if (!key) return;
  priceBlockedHosts.set(key, Date.now() + PRICE_ENRICH_CONFIG.blockTtlMs);
}

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function buildEventPriceQueueKey(event) {
  const source = cleanText(event?.source)?.toLowerCase() || "unknown";
  const sourceId = cleanText(event?.sourceId) || "";
  const url = cleanText(event?.ticketUrl || event?.url) || "";
  if (sourceId) return `${source}:${sourceId}`;
  if (url) return `${source}:url:${url}`;
  return null;
}

async function runPriceEnrichBackgroundQueue() {
  if (priceEnrichBackground.running) return;
  priceEnrichBackground.running = true;

  try {
    while (priceEnrichBackground.queue.length > 0) {
      const event = priceEnrichBackground.queue.shift();
      const key = buildEventPriceQueueKey(event);
      if (key) {
        priceEnrichBackground.queueKeys.delete(key);
      }
      if (!event) continue;

      try {
        await enrichEventPriceOnDemand(event);
      } catch {
        // Ignore background enrichment failures.
      }

      await sleepMs(PRICE_ENRICH_CONFIG.backgroundDelayMs);
    }
  } finally {
    priceEnrichBackground.running = false;
  }
}

function enqueueBackgroundPriceEnrichment(entries) {
  if (!PRICE_ENRICH_CONFIG.backgroundEnabled) return;
  if (!Array.isArray(entries) || entries.length === 0) return;

  for (const entry of entries) {
    const event = entry?.event;
    if (!event) continue;
    const key = buildEventPriceQueueKey(event);
    if (!key) continue;
    if (priceEnrichBackground.queueKeys.has(key)) continue;
    if (priceEnrichBackground.queue.length >= PRICE_ENRICH_CONFIG.backgroundMaxQueue) break;
    priceEnrichBackground.queue.push(event);
    priceEnrichBackground.queueKeys.add(key);
  }

  void runPriceEnrichBackgroundQueue();
}

function buildTicketmasterProxyUrl(url) {
  const base = cleanText(PRICE_ENRICH_CONFIG.ticketmasterProxyBaseUrl);
  const target = cleanText(url);
  if (!base || !target) return null;
  const normalizedBase = base.replace(/\s+/g, "");
  const strippedTarget = target.replace(/^https?:\/\//i, "");
  return `${normalizedBase}${strippedTarget}`;
}

function isBlockedStatusError(err) {
  const status = Number(err?.response?.status);
  return status === 401 || status === 403 || status === 429;
}

async function enrichEventPriceOnDemand(event) {
  if (!PRICE_ENRICH_CONFIG.enabled) {
    return { event: enrichEventWithPriceInsights(event), enriched: false, blockedHostSkip: false };
  }

  const current = enrichEventWithPriceInsights(event);
  if (current.hasAnyPrice) {
    return { event: current, enriched: false, blockedHostSkip: false };
  }

  const targetUrl = cleanText(current.ticketUrl || current.url);
  if (!targetUrl) return { event: current, enriched: false, blockedHostSkip: false };

  const isTicketmaster = cleanText(current.source)?.toLowerCase() === "ticketmaster";
  const sourceKey = cleanText(current.source) || null;
  const ticketmasterProxyUrl = isTicketmaster ? buildTicketmasterProxyUrl(targetUrl) : null;
  const canUseTicketmasterProxy = Boolean(ticketmasterProxyUrl);

  if (isHostBlockedForPrice(targetUrl, sourceKey) && !canUseTicketmasterProxy) {
    return { event: current, enriched: false, blockedHostSkip: true };
  }

  const cached = getCachedPriceEntry(targetUrl);
  if (cached) {
    if (!cached.payload && isTicketmaster) {
      // Ticketmaster availability can flip quickly and bot gating is inconsistent.
      // Do not keep stale "no-price" misses for this source.
      priceEnrichCache.delete(cleanText(targetUrl));
    } else {
      if (!cached.payload) {
        return { event: current, enriched: false, blockedHostSkip: false };
      }
      const merged = enrichEventWithPriceInsights({
        ...current,
        ...cached.payload,
      });
      return { event: merged, enriched: hasAnyPriceSignal(merged), blockedHostSkip: false };
    }
  }

  let directBlocked = false;
  let extracted = null;
  try {
    extracted = await extractPriceFromEventUrl({
      url: current.url,
      ticketUrl: current.ticketUrl,
      timeoutMs: PRICE_ENRICH_CONFIG.timeoutMs,
      userAgent: PRICE_ENRICH_CONFIG.userAgent || DEFAULT_USER_AGENT,
      ticketmasterProxyBaseUrl: isTicketmaster
        ? PRICE_ENRICH_CONFIG.ticketmasterProxyBaseUrl
        : null,
    });
  } catch (err) {
    if (isBlockedStatusError(err)) {
      directBlocked = true;
      blockHostForPrice(targetUrl, sourceKey);
    }
  }

  if ((!extracted || !hasAnyPriceSignal(extracted)) && canUseTicketmasterProxy) {
    try {
      extracted = await extractPriceFromEventUrl({
        url: ticketmasterProxyUrl,
        ticketUrl: ticketmasterProxyUrl,
        timeoutMs: PRICE_ENRICH_CONFIG.ticketmasterProxyTimeoutMs,
        userAgent: PRICE_ENRICH_CONFIG.userAgent || DEFAULT_USER_AGENT,
      });
      if (extracted && hasAnyPriceSignal(extracted)) {
        extracted.priceSource = "scraped_proxy";
      }
    } catch {
      // Ignore proxy fallback failures.
    }
  }

  if (!extracted || !hasAnyPriceSignal(extracted)) {
    if (!directBlocked && !isTicketmaster) {
      setCachedPriceEntry(targetUrl, null);
    }
    return { event: current, enriched: false, blockedHostSkip: directBlocked && !canUseTicketmasterProxy };
  }

  const extractedSource = cleanText(extracted.priceSource) || "scraped_text";
  const extractedCost = toNumberOrNull(extracted.cost);
  const extractedPriceMin = toNumberOrNull(extracted.priceMin);
  const extractedPriceMax = toNumberOrNull(extracted.priceMax);
  const extractedCurrency =
    normalizeCurrencyCode(extracted.currency) || current.currency || null;
  const extractedIsFree = extracted.isFree === true;
  const extractedTicketUrl = cleanText(extracted.ticketUrl) || current.ticketUrl;
  const extractedMatchedBy = cleanText(extracted.matchedBy) || null;
  const extractedFetchedUrl = cleanText(extracted.fetchedUrl) || null;
  const proxyMatchedBy = extractedMatchedBy ? /proxy/i.test(extractedMatchedBy) : false;
  const proxyFetchedUrl = extractedFetchedUrl
    ? /^https?:\/\/(?:[^/]+\.)?ticketmaster\./i.test(extractedFetchedUrl) === false
    : false;

  const confidenceProbe = {
    ...current,
    cost: extractedCost,
    priceMin: extractedPriceMin,
    priceMax: extractedPriceMax,
    currency: extractedCurrency,
    isFree: extractedIsFree,
    priceSource: extractedSource,
    priceConfidence: null,
  };
  const extractedConfidence = resolvePriceConfidence(
    confidenceProbe,
    normalizeEventPrice(confidenceProbe)
  );

  const payload = {
    cost: extractedCost,
    priceMin: extractedPriceMin,
    priceMax: extractedPriceMax,
    currency: extractedCurrency,
    isFree: extractedIsFree,
    ticketUrl: extractedTicketUrl,
    priceSource: extractedSource,
    priceConfidence: extractedConfidence,
    metadata: {
      ...(current.metadata && typeof current.metadata === "object" ? current.metadata : {}),
      priceMin: extractedPriceMin,
      priceMax: extractedPriceMax,
      priceSource: extractedSource,
      priceMatchedBy: extractedMatchedBy,
      priceFetchedUrl: extractedFetchedUrl,
      priceProxyUsed: extractedSource === "scraped_proxy" || proxyMatchedBy || proxyFetchedUrl,
    },
  };

  setCachedPriceEntry(targetUrl, payload);
  const merged = enrichEventWithPriceInsights({
    ...current,
    ...payload,
  });
  if (cleanText(current?.source)?.toLowerCase() === "ticketmaster") {
    const sample = toTicketmasterInferenceSample(merged);
    if (sample) {
      rememberTicketmasterPriceSample(ticketmasterPriceKnowledge, merged, sample);
    }
  }
  return { event: merged, enriched: hasAnyPriceSignal(merged), blockedHostSkip: false };
}

async function enrichMissingPrices(events) {
  const list = Array.isArray(events) ? events : [];
  if (!PRICE_ENRICH_CONFIG.enabled || PRICE_ENRICH_CONFIG.maxPerRequest <= 0 || list.length === 0) {
    const normalized = list.map((event) => enrichEventWithPriceInsights(event));
    return {
      events: normalized,
      enrichedThisRequest: 0,
      blockedHostSkips: 0,
    };
  }

  const normalized = list.map((event) => {
    const current = enrichEventWithPriceInsights(event);
    if (current.hasAnyPrice) return current;
    const targetUrl = cleanText(current.ticketUrl || current.url);
    if (!targetUrl) return current;
    const cached = getCachedPriceEntry(targetUrl);
    if (!cached || !cached.payload) return current;
    return enrichEventWithPriceInsights({
      ...current,
      ...cached.payload,
    });
  });
  const missingAll = normalized
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => !event.hasAnyPrice);

  if (missingAll.length === 0) {
    return {
      events: normalized,
      enrichedThisRequest: 0,
      blockedHostSkips: 0,
    };
  }

  const totalLimit = Math.max(0, PRICE_ENRICH_CONFIG.maxPerRequest);
  const ticketmasterLimit = Math.max(
    0,
    Math.min(totalLimit, PRICE_ENRICH_CONFIG.ticketmasterMaxPerRequest)
  );

  const ticketmasterMissing = missingAll.filter(
    ({ event }) => cleanText(event?.source)?.toLowerCase() === "ticketmaster"
  );
  const otherMissing = missingAll.filter(
    ({ event }) => cleanText(event?.source)?.toLowerCase() !== "ticketmaster"
  );

  const selectRoundRobin = (list, limit, cursorKey) => {
    const safeLimit = Math.max(0, Math.min(limit, list.length));
    if (safeLimit === 0) return [];
    if (safeLimit >= list.length) {
      priceEnrichRoundRobin[cursorKey] = 0;
      return list.slice();
    }

    const start = Math.max(0, priceEnrichRoundRobin[cursorKey] || 0) % list.length;
    const out = [];
    for (let i = 0; i < safeLimit; i += 1) {
      out.push(list[(start + i) % list.length]);
    }
    priceEnrichRoundRobin[cursorKey] = (start + safeLimit) % list.length;
    return out;
  };

  const selectedTicketmaster = selectRoundRobin(
    ticketmasterMissing,
    ticketmasterLimit,
    "ticketmasterCursor"
  );
  const remainingSlots = Math.max(0, totalLimit - selectedTicketmaster.length);
  const selectedOthers = selectRoundRobin(
    otherMissing,
    remainingSlots,
    "generalCursor"
  );
  const missing = [...selectedOthers, ...selectedTicketmaster];
  const selectedKeySet = new Set(missing.map((entry) => String(entry.index)));
  const missingBackground = missingAll.filter(
    (entry) => !selectedKeySet.has(String(entry.index))
  );
  enqueueBackgroundPriceEnrichment(missingBackground);

  if (missing.length === 0) {
    return {
      events: normalized,
      enrichedThisRequest: 0,
      blockedHostSkips: 0,
    };
  }

  let enrichedThisRequest = 0;
  let blockedHostSkips = 0;
  await mapWithConcurrency(missing, PRICE_ENRICH_CONFIG.concurrency, async (entry) => {
    const result = await enrichEventPriceOnDemand(entry.event);
    normalized[entry.index] = result.event;
    if (result.enriched) enrichedThisRequest += 1;
    if (result.blockedHostSkip) blockedHostSkips += 1;
  });

  return {
    events: normalized,
    enrichedThisRequest,
    blockedHostSkips,
  };
}

function invalidateModerationCache() {
  moderationCache.fetchedAt = 0;
  moderationCache.disabledKeys = new Set();
}

async function getDisabledEventKeysOptional() {
  if (!pool) return new Set();

  const now = Date.now();
  if (moderationCache.fetchedAt && now - moderationCache.fetchedAt < moderationCache.ttlMs) {
    return moderationCache.disabledKeys;
  }

  try {
    const db = requireDb();
    const r = await db.query("SELECT event_key FROM event_moderation WHERE is_disabled = TRUE");
    const set = new Set((r.rows || []).map((row) => String(row.event_key)));
    moderationCache.disabledKeys = set;
    moderationCache.fetchedAt = now;
    return set;
  } catch {
    // Fail open: if moderation table isn't there or DB is down, don't break event browsing.
    moderationCache.disabledKeys = new Set();
    moderationCache.fetchedAt = now;
    return moderationCache.disabledKeys;
  }
}

function filterDisabledApiEvents(events, disabledKeys) {
  if (!disabledKeys || disabledKeys.size === 0) return { events, filteredOut: 0 };

  let filteredOut = 0;
  const out = (events || []).filter((e, idx) => {
    let key = null;
    try {
      key = buildEventKeyFromApiEvent(e, idx);
    } catch {
      key = null;
    }
    if (!key) return true;
    const blocked = disabledKeys.has(key);
    if (blocked) filteredOut++;
    return !blocked;
  });

  return { events: out, filteredOut };
}


function buildScrapeFetchOptions() {
  return {
    sourceUrls: SCRAPE_CONFIG.sourceUrls,
    maxEvents: SCRAPE_CONFIG.maxEvents,
    maxEventsPerSource: SCRAPE_CONFIG.maxEventsPerSource,
    maxLinksPerSource: SCRAPE_CONFIG.maxLinksPerSource,
    timeoutMs: SCRAPE_CONFIG.timeoutMs,
    userAgent: SCRAPE_CONFIG.userAgent,
    sourceConcurrency: SCRAPE_CONFIG.sourceConcurrency,
    songkickOfficialLookup: SCRAPE_CONFIG.songkickOfficialLookup,
    songkickOfficialEnrichLimit: SCRAPE_CONFIG.songkickOfficialEnrichLimit,
    songkickTicketTimeoutMs: SCRAPE_CONFIG.songkickTicketTimeoutMs,
    officialPageTimeoutMs: SCRAPE_CONFIG.officialPageTimeoutMs,
    enableOfficialPageEnrichment: SCRAPE_CONFIG.enableOfficialPageEnrichment,
    eventbriteDetailLookup: SCRAPE_CONFIG.eventbriteDetailLookup,
    eventbriteDetailEnrichLimit: SCRAPE_CONFIG.eventbriteDetailEnrichLimit,
    eventbriteDetailTimeoutMs: SCRAPE_CONFIG.eventbriteDetailTimeoutMs,
  };
}

function startScrapeRefresh() {
  if (scrapeCache.inFlight) return scrapeCache.inFlight;

  scrapeCache.inFlight = (async () => {
    try {
      const events = await fetchScrapedEvents(buildScrapeFetchOptions());
      scrapeCache.events = Array.isArray(events) ? events : [];
      scrapeCache.fetchedAt = Date.now();
      scrapeCache.lastError = null;
      return scrapeCache.events;
    } catch (err) {
      scrapeCache.lastError = String(err?.message || err);
      throw err;
    } finally {
      scrapeCache.inFlight = null;
    }
  })();

  return scrapeCache.inFlight;
}

async function getScrapedEventsForRequest({ waitMsOverride } = {}) {
  const waitMs = Math.max(
    250,
    toPositiveInt(waitMsOverride, SCRAPE_CACHE_CONFIG.requestWaitMs)
  );

  if (!SCRAPE_CONFIG.enabled || SCRAPE_CONFIG.sourceUrls.length === 0) {
    return { events: [], cacheMode: "disabled", ageMs: null, timedOut: false, waitMs };
  }

  if (isScrapeCacheFresh()) {
    return {
      events: scrapeCache.events,
      cacheMode: "fresh",
      ageMs: getScrapeCacheAgeMs(),
      timedOut: false,
      lastError: scrapeCache.lastError,
      waitMs,
    };
  }

  if (!scrapeCache.inFlight) {
    startScrapeRefresh().catch(() => {
      // Error is captured in scrapeCache.lastError.
    });
  }

  // Serve stale cache immediately while refresh runs in background.
  if (Array.isArray(scrapeCache.events) && scrapeCache.events.length > 0) {
    return {
      events: scrapeCache.events,
      cacheMode: "stale",
      ageMs: getScrapeCacheAgeMs(),
      timedOut: false,
      lastError: scrapeCache.lastError,
      waitMs,
    };
  }

  // First-run path: wait briefly for scrape results, then fall back.
  let timedOut = false;
  try {
    await Promise.race([
      scrapeCache.inFlight,
      new Promise((_, reject) =>
        setTimeout(() => {
          timedOut = true;
          reject(new Error("scrape_wait_timeout"));
        }, waitMs)
      ),
    ]);
  } catch (err) {
    const msg = String(err?.message || err);
    if (msg !== "scrape_wait_timeout") {
      scrapeCache.lastError = msg;
    }
  }

  return {
    events: Array.isArray(scrapeCache.events) ? scrapeCache.events : [],
    cacheMode:
      scrapeCache.events.length > 0
        ? timedOut
          ? "warm_after_timeout"
          : "fresh_after_wait"
        : "empty_after_timeout",
    ageMs: getScrapeCacheAgeMs(),
    timedOut,
    lastError: scrapeCache.lastError,
    waitMs,
  };
}

function matchesScrapeLocationFilters(event) {
  if (
    SCRAPE_ALLOWED_COUNTRIES_NORMALIZED.length === 0 &&
    SCRAPE_ALLOWED_CITIES_NORMALIZED.length === 0
  ) {
    return true;
  }

  const eventCountry = normalizeCountryValue(event.country);
  const eventCity = cleanText(event.city)?.toLowerCase() || "";

  const countryMatch =
    eventCountry &&
    SCRAPE_ALLOWED_COUNTRIES_NORMALIZED.some(
      (rule) => rule && eventCountry.includes(rule)
    );

  const cityMatch =
    eventCity &&
    SCRAPE_ALLOWED_CITIES_NORMALIZED.some((rule) => {
      if (!rule) return false;
      return eventCity === rule || eventCity.includes(rule);
    });

  return Boolean(countryMatch || cityMatch);
}

function buildSearchBlob(event) {
  return [
    cleanText(event?.title),
    cleanText(event?.description),
    cleanText(event?.genre),
    cleanText(event?.category),
    cleanText(event?.artistName),
    cleanText(event?.organizerName),
    cleanText(event?.venue),
    ...(Array.isArray(event?.tags) ? event.tags.map((tag) => cleanText(tag)) : []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function parseSearchTokens(value) {
  const clean = cleanText(value)?.toLowerCase();
  if (!clean) return [];
  return clean
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .slice(0, 8);
}

function matchesKeywordForScraped(event, keyword) {
  const tokens = parseSearchTokens(keyword);
  if (tokens.length === 0) return true;
  const blob = buildSearchBlob(event);
  if (!blob) return false;
  return tokens.every((token) => blob.includes(token));
}

const MUSIC_POSITIVE_TOKENS = [
  "music",
  "musique",
  "muziek",
  "musik",
  "concert",
  "concerten",
  "konzert",
  "koncert",
  "live",
  "dj",
  "festival",
  "fest",
  "fete",
  "feest",
  "soiree",
  "avond",
  "nacht",
  "gig",
  "rave",
  "party",
  "tour",
  "band",
  "singer",
  "orchestra",
  "symphony",
  "opera",
  "choir",
  "karaoke",
  "showcase",
  "album",
  "hip hop",
  "hip-hop",
  "rap",
  "jazz",
  "blues",
  "rock",
  "metal",
  "pop",
  "techno",
  "house",
  "edm",
  "electronic",
  "electro",
  "electronique",
  "elektronisch",
  "dancehall",
  "afrobeat",
  "amapiano",
  "r&b",
  "rnb",
];

const MUSIC_NEGATIVE_TOKENS = [
  "workshop",
  "atelier",
  "werkplaats",
  "webinar",
  "bootcamp",
  "conference",
  "conferentie",
  "summit",
  "career fair",
  "job fair",
  "jobbeurs",
  "networking",
  "hiring",
  "course",
  "opleiding",
  "formation",
  "training",
  "masterclass",
  "real estate",
  "immobilier",
  "vastgoed",
  "book fair",
  "book launch",
  "dental",
  "medical",
  "tech talk",
  "startup",
  "pitch",
  "hackathon",
];

function scoreMusicLikelihood(event) {
  const blob = buildSearchBlob(event);
  if (!blob) return -1;

  let score = 0;
  for (const token of MUSIC_POSITIVE_TOKENS) {
    if (blob.includes(token)) score += 2;
  }
  for (const token of MUSIC_NEGATIVE_TOKENS) {
    if (blob.includes(token)) score -= 2;
  }

  if (cleanText(event?.genre)?.toLowerCase().includes("music")) score += 3;
  if (cleanText(event?.category)?.toLowerCase().includes("music")) score += 2;
  if (cleanText(event?.artistName)) score += 1;

  return score;
}

function hasMusicPathHint(event) {
  const scrapedFrom = cleanText(event?.metadata?.scrapedFrom)?.toLowerCase() || "";
  const sourceListingUrl =
    cleanText(event?.metadata?.sourceListingUrl)?.toLowerCase() || "";
  const eventUrl = cleanText(event?.url)?.toLowerCase() || "";
  const ticketUrl = cleanText(event?.ticketUrl)?.toLowerCase() || "";
  const pathHintRegex = /(music|concert|festival|gig|live|nightlife)/i;
  return (
    pathHintRegex.test(sourceListingUrl) ||
    pathHintRegex.test(scrapedFrom) ||
    pathHintRegex.test(eventUrl) ||
    pathHintRegex.test(ticketUrl)
  );
}

function isMusicClassification(classificationName) {
  const normalized = cleanText(classificationName)?.toLowerCase() || "";
  if (!normalized) return true;
  return /(music|concert|live)/i.test(normalized);
}

function matchesClassificationForScraped(event, classificationName) {
  const normalized = cleanText(classificationName)?.toLowerCase() || "";
  if (!normalized || ["all", "any", "*"].includes(normalized)) return true;

  if (isMusicClassification(normalized)) {
    const musicScore = scoreMusicLikelihood(event);
    if (musicScore > 0) return true;
    if (musicScore < 0) return false;
    return hasMusicPathHint(event);
  }

  const blob = buildSearchBlob(event);
  if (!blob) return false;
  return blob.includes(normalized);
}

// -----------------------------
// Ticketmaster (future/upcoming events)
// -----------------------------
function mapTicketmasterStatus(statusCode) {
  const code = cleanText(statusCode)?.toLowerCase();
  if (!code) return "published";
  if (["cancelled"].includes(code)) return "cancelled";
  if (["offsale", "postponed", "rescheduled", "moved"].includes(code)) {
    return "published";
  }
  return "published";
}

function pickTicketmasterImage(images) {
  if (!Array.isArray(images) || images.length === 0) return null;

  const exact169 = images
    .filter((img) => img && img.url && img.ratio === "16_9")
    .sort((a, b) => (Number(b.width) || 0) - (Number(a.width) || 0));
  if (exact169.length > 0) return exact169[0].url;

  const any = images
    .filter((img) => img && img.url)
    .sort((a, b) => (Number(b.width) || 0) - (Number(a.width) || 0));
  return any.length > 0 ? any[0].url : null;
}

function cleanTicketmasterText(value) {
  const clean = cleanText(value);
  if (!clean) return null;
  const noHtml = clean.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return noHtml || null;
}

function buildTicketmasterDescription(event, attraction, venue, promoter) {
  const candidates = [
    cleanTicketmasterText(event?.description),
    cleanTicketmasterText(event?.info),
    cleanTicketmasterText(event?.pleaseNote),
    cleanTicketmasterText(event?.additionalInfo),
    cleanTicketmasterText(event?.accessibility?.info),
    cleanTicketmasterText(attraction?.info),
    cleanTicketmasterText(attraction?.additionalInfo),
    cleanTicketmasterText(attraction?.description),
    cleanTicketmasterText(promoter?.description),
    cleanTicketmasterText(venue?.generalInfo?.generalRule),
    cleanTicketmasterText(venue?.generalInfo?.childRule),
  ].filter(Boolean);

  if (candidates.length === 0) return null;

  const unique = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const key = normalizeKeyPart(candidate);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(candidate);
  }

  if (unique.length === 0) return null;
  const joined = unique.join(" ");
  return joined.length > 900 ? `${joined.slice(0, 897)}...` : joined;
}

function extractTicketmasterPrice(event) {
  const readRangeValues = (ranges) => {
    const values = [];
    let rangeCurrency = null;
    if (!Array.isArray(ranges)) return { values, currency: rangeCurrency };
    for (const range of ranges) {
      const min = toNumberOrNull(range?.min);
      const max = toNumberOrNull(range?.max);
      if (min != null) values.push(min);
      if (max != null) values.push(max);
      if (!rangeCurrency) {
        rangeCurrency = cleanText(
          range?.currency || range?.currencyCode || range?.cur
        );
      }
    }
    return { values, currency: rangeCurrency };
  };

  const summarize = (values, currency) => {
    const positives = values.filter((value) => value > 0);
    if (positives.length > 0) {
      return {
        min: Math.min(...positives),
        max: Math.max(...positives),
        cost: Math.min(...positives),
        currency: currency || null,
        isFree: false,
      };
    }
    return null;
  };

  const topLevel = readRangeValues(event?.priceRanges);
  const topSummary = summarize(topLevel.values, topLevel.currency);
  if (topSummary) return topSummary;

  if (topLevel.values.length > 0 && topLevel.values.every((value) => value === 0)) {
    return {
      min: null,
      max: null,
      cost: null,
      currency: topLevel.currency || null,
      isFree: false,
    };
  }

  const nestedValues = [];
  let nestedCurrency = topLevel.currency || null;
  const feeLikeRegex = /(fee|delivery|shipping|service|handling|order|payment|charge|facility)/i;

  const walkNested = (node, path = []) => {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach((item, index) => walkNested(item, path.concat(String(index))));
      return;
    }
    if (typeof node !== "object") return;

    const pathKey = normalizeKeyPart(path.join("."));
    const metaKey = normalizeKeyPart(
      [
        cleanText(node.type),
        cleanText(node.name),
        cleanText(node.title),
        cleanText(node.description),
        cleanText(node.label),
      ]
        .filter(Boolean)
        .join(" ")
    );
    const feeLike = feeLikeRegex.test(`${pathKey} ${metaKey}`);

    if (!feeLike) {
      const min = toNumberOrNull(node.min);
      const max = toNumberOrNull(node.max);
      if (min != null && min > 0) nestedValues.push(min);
      if (max != null && max > 0) nestedValues.push(max);

      if (node.price && typeof node.price === "object") {
        const amount = toNumberOrNull(
          node.price.amount ??
            node.price.value ??
            node.price.total ??
            node.price.listPrice
        );
        if (amount != null && amount > 0) nestedValues.push(amount);
        if (!nestedCurrency) {
          nestedCurrency = cleanText(
            node.price.currency || node.price.currencyCode
          );
        }
      }

      const directAmount = toNumberOrNull(node.amount ?? node.value ?? node.listPrice);
      if (directAmount != null && directAmount > 0) nestedValues.push(directAmount);
      if (!nestedCurrency) {
        nestedCurrency = cleanText(
          node.currency || node.currencyCode || node.cur
        );
      }
    }

    for (const [key, value] of Object.entries(node)) {
      walkNested(value, path.concat(key));
    }
  };

  walkNested(event?.products, ["products"]);
  walkNested(event?.offers, ["offers"]);

  const nestedSummary = summarize(nestedValues, nestedCurrency);
  if (nestedSummary) return nestedSummary;

  return {
    min: null,
    max: null,
    cost: null,
    currency: nestedCurrency || null,
    isFree: false,
  };
}

const TICKETMASTER_PRICE_INFERENCE_CONFIG = {
  enabled: toBool(process.env.TICKETMASTER_PRICE_INFERENCE_ENABLED, true),
  maxSamplesPerKey: Math.max(
    4,
    toPositiveInt(process.env.TICKETMASTER_PRICE_INFERENCE_MAX_SAMPLES_PER_KEY, 24)
  ),
  maxKeysPerBucket: Math.max(
    100,
    toPositiveInt(process.env.TICKETMASTER_PRICE_INFERENCE_MAX_KEYS_PER_BUCKET, 600)
  ),
  minTitleSamples: Math.max(
    2,
    toPositiveInt(process.env.TICKETMASTER_PRICE_INFERENCE_MIN_TITLE_SAMPLES, 2)
  ),
  minArtistSamples: Math.max(
    2,
    toPositiveInt(process.env.TICKETMASTER_PRICE_INFERENCE_MIN_ARTIST_SAMPLES, 2)
  ),
  minVenueSamples: Math.max(
    2,
    toPositiveInt(process.env.TICKETMASTER_PRICE_INFERENCE_MIN_VENUE_SAMPLES, 2)
  ),
  minPromoterSamples: Math.max(
    2,
    toPositiveInt(process.env.TICKETMASTER_PRICE_INFERENCE_MIN_PROMOTER_SAMPLES, 2)
  ),
  minCityCategorySamples: Math.max(
    2,
    toPositiveInt(process.env.TICKETMASTER_PRICE_INFERENCE_MIN_CITY_CATEGORY_SAMPLES, 3)
  ),
  minCategorySamples: Math.max(
    2,
    toPositiveInt(process.env.TICKETMASTER_PRICE_INFERENCE_MIN_CATEGORY_SAMPLES, 4)
  ),
  minCitySamples: Math.max(
    2,
    toPositiveInt(process.env.TICKETMASTER_PRICE_INFERENCE_MIN_CITY_SAMPLES, 4)
  ),
  minGlobalSamples: Math.max(
    3,
    toPositiveInt(process.env.TICKETMASTER_PRICE_INFERENCE_MIN_GLOBAL_SAMPLES, 6)
  ),
  strictMode: toBool(process.env.TICKETMASTER_PRICE_INFERENCE_STRICT_MODE, true),
  maxSpreadRatio: Math.max(
    1.05,
    toNumberOrNull(process.env.TICKETMASTER_PRICE_INFERENCE_MAX_SPREAD_RATIO) || 1.8
  ),
  allowBroadBuckets: toBool(process.env.TICKETMASTER_PRICE_INFERENCE_ALLOW_BROAD_BUCKETS, false),
  allowGlobalBucket: toBool(process.env.TICKETMASTER_PRICE_INFERENCE_ALLOW_GLOBAL_BUCKET, false),
  dbSeedEnabled: toBool(process.env.TICKETMASTER_PRICE_INFERENCE_DB_SEED_ENABLED, true),
  dbSeedTtlMs: Math.max(
    30 * 1000,
    toPositiveInt(process.env.TICKETMASTER_PRICE_INFERENCE_DB_SEED_TTL_MS, 10 * 60 * 1000)
  ),
  dbSeedMaxRows: Math.max(
    100,
    toPositiveInt(process.env.TICKETMASTER_PRICE_INFERENCE_DB_SEED_MAX_ROWS, 3000)
  ),
};

const ticketmasterPriceKnowledge = {
  byTitle: new Map(),
  byArtist: new Map(),
  byVenue: new Map(),
  byPromoter: new Map(),
  byCityCategory: new Map(),
  byCategory: new Map(),
  byCity: new Map(),
  globalSamples: [],
};
const ticketmasterDbSeedState = {
  hydratedAt: 0,
  inFlight: null,
};
const TICKETMASTER_TRUSTED_PRICE_SOURCES = new Set([
  "ticketmaster_discovery",
  "ticketmaster_api",
  "ticketmaster_eventinfo",
  "scraped_jsonld",
  "scraped_text",
  "scraped_proxy",
]);

function normalizeTicketmasterInferenceToken(value) {
  const text = cleanText(value);
  if (!text) return "";
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function toTicketmasterInferenceSample(event) {
  const price = normalizeEventPrice(event);
  if (!price.hasAnyPrice) return null;

  const sourceHint = cleanText(event?.priceSource || event?.metadata?.priceSource)?.toLowerCase() || "";
  if (sourceHint.startsWith("ticketmaster_inferred_")) return null;
  if (!TICKETMASTER_TRUSTED_PRICE_SOURCES.has(sourceHint)) return null;

  let min = toNumberOrNull(price.priceMin);
  let max = toNumberOrNull(price.priceMax);
  const cost = toNumberOrNull(price.cost);

  if (min == null && cost != null) min = cost;
  if (max == null && cost != null) max = cost;
  if (min == null && max != null) min = max;
  if (max == null && min != null) max = min;

  const isFree = price.isFree === true || (min === 0 && max === 0);
  if (!isFree && min == null && max == null) return null;

  const sampleId = cleanText(event?.sourceId || event?.ticketUrl || event?.url || event?.title);
  if (!sampleId) return null;

  return {
    sampleId,
    priceMin: min,
    priceMax: max,
    cost: cost != null ? cost : min,
    isFree,
    currency: normalizeCurrencyCode(price.currency),
  };
}

function ticketmasterTitleKey(event) {
  return normalizeTicketmasterInferenceToken(event?.title);
}

function ticketmasterArtistKey(event) {
  return normalizeTicketmasterInferenceToken(event?.artistName);
}

function ticketmasterVenueKey(event) {
  const city = normalizeTicketmasterInferenceToken(event?.city);
  const venue = normalizeTicketmasterInferenceToken(event?.venue);
  if (!venue) return "";
  return city ? `${city}|${venue}` : venue;
}

function ticketmasterPromoterKey(event) {
  return normalizeTicketmasterInferenceToken(
    event?.organizerName || event?.metadata?.promoterName || event?.metadata?.promoter
  );
}

function ticketmasterCategoryKey(event) {
  return normalizeTicketmasterInferenceToken(
    event?.genre ||
      event?.category ||
      event?.metadata?.primaryCategory ||
      event?.metadata?.classificationName
  );
}

function ticketmasterCityKey(event) {
  return normalizeTicketmasterInferenceToken(event?.city);
}

function ticketmasterCityCategoryKey(event) {
  const city = ticketmasterCityKey(event);
  const category = ticketmasterCategoryKey(event);
  if (!city || !category) return "";
  return `${city}|${category}`;
}

function upsertTicketmasterSample(map, key, sample) {
  if (!key || !sample) return;

  const arr = Array.isArray(map.get(key)) ? map.get(key).slice() : [];
  const existingIndex = arr.findIndex((entry) => entry?.sampleId === sample.sampleId);
  if (existingIndex >= 0) {
    arr[existingIndex] = sample;
  } else {
    arr.push(sample);
  }

  while (arr.length > TICKETMASTER_PRICE_INFERENCE_CONFIG.maxSamplesPerKey) {
    arr.shift();
  }

  map.delete(key);
  map.set(key, arr);
  while (map.size > TICKETMASTER_PRICE_INFERENCE_CONFIG.maxKeysPerBucket) {
    const firstKey = map.keys().next().value;
    if (!firstKey) break;
    map.delete(firstKey);
  }
}

function upsertTicketmasterSampleList(list, sample, limit) {
  const arr = Array.isArray(list) ? list.slice() : [];
  if (!sample) return arr;
  const existingIndex = arr.findIndex((entry) => entry?.sampleId === sample.sampleId);
  if (existingIndex >= 0) {
    arr[existingIndex] = sample;
  } else {
    arr.push(sample);
  }
  const maxSize = Math.max(4, Number(limit) || TICKETMASTER_PRICE_INFERENCE_CONFIG.maxSamplesPerKey);
  while (arr.length > maxSize) {
    arr.shift();
  }
  return arr;
}

function rememberTicketmasterPriceSample(bucket, event, sample) {
  if (!bucket || !sample) return;
  upsertTicketmasterSample(bucket.byTitle, ticketmasterTitleKey(event), sample);
  upsertTicketmasterSample(bucket.byArtist, ticketmasterArtistKey(event), sample);
  upsertTicketmasterSample(bucket.byVenue, ticketmasterVenueKey(event), sample);
  upsertTicketmasterSample(bucket.byPromoter, ticketmasterPromoterKey(event), sample);
  if (TICKETMASTER_PRICE_INFERENCE_CONFIG.allowBroadBuckets) {
    upsertTicketmasterSample(bucket.byCityCategory, ticketmasterCityCategoryKey(event), sample);
    upsertTicketmasterSample(bucket.byCategory, ticketmasterCategoryKey(event), sample);
    upsertTicketmasterSample(bucket.byCity, ticketmasterCityKey(event), sample);
  }
  if (TICKETMASTER_PRICE_INFERENCE_CONFIG.allowGlobalBucket) {
    bucket.globalSamples = upsertTicketmasterSampleList(
      bucket.globalSamples,
      sample,
      TICKETMASTER_PRICE_INFERENCE_CONFIG.maxSamplesPerKey * 8
    );
  }
}

function isTicketmasterDbSeedFresh() {
  if (!ticketmasterDbSeedState.hydratedAt) return false;
  return Date.now() - ticketmasterDbSeedState.hydratedAt < TICKETMASTER_PRICE_INFERENCE_CONFIG.dbSeedTtlMs;
}

async function hydrateTicketmasterPriceKnowledgeFromDbOptional() {
  if (!TICKETMASTER_PRICE_INFERENCE_CONFIG.dbSeedEnabled) return;
  if (!pool) return;
  if (isTicketmasterDbSeedFresh()) return;
  if (ticketmasterDbSeedState.inFlight) {
    await ticketmasterDbSeedState.inFlight;
    return;
  }

  ticketmasterDbSeedState.inFlight = (async () => {
    try {
      const db = requireDb();
      const limit = TICKETMASTER_PRICE_INFERENCE_CONFIG.dbSeedMaxRows;
      const trustedDbSources = [...TICKETMASTER_TRUSTED_PRICE_SOURCES];
      const result = await db.query(
        `
          SELECT id, source_id, title, city, venue_name, category, tags,
                 is_free, cost, price_min, price_max, currency, price_source
          FROM events
          WHERE LOWER(source) = 'ticketmaster'
            AND LOWER(COALESCE(price_source, '')) = ANY($1::text[])
            AND (
              is_free = TRUE
              OR cost IS NOT NULL
              OR price_min IS NOT NULL
              OR price_max IS NOT NULL
            )
          ORDER BY updated_at DESC NULLS LAST, id DESC
          LIMIT $2
        `,
        [trustedDbSources, limit]
      );

      for (const row of result.rows || []) {
        const syntheticEvent = {
          source: "ticketmaster",
          sourceId: cleanText(row?.source_id) || `db:${row?.id || ""}`,
          title: cleanText(row?.title),
          city: cleanText(row?.city),
          venue: cleanText(row?.venue_name),
          category: cleanText(row?.category),
          genre: cleanText(row?.category),
          tags: Array.isArray(row?.tags) ? row.tags.filter(Boolean) : [],
          isFree: row?.is_free === true,
          cost: toNumberOrNull(row?.cost),
          priceMin: toNumberOrNull(row?.price_min),
          priceMax: toNumberOrNull(row?.price_max),
          currency: normalizeCurrencyCode(row?.currency),
          priceSource: cleanText(row?.price_source) || "db_sync",
        };
        const sample = toTicketmasterInferenceSample(syntheticEvent);
        if (!sample) continue;
        rememberTicketmasterPriceSample(ticketmasterPriceKnowledge, syntheticEvent, sample);
      }
    } catch {
      // Ignore DB-seed failures. Live API/scrape enrichment still runs.
    } finally {
      ticketmasterDbSeedState.hydratedAt = Date.now();
      ticketmasterDbSeedState.inFlight = null;
    }
  })();

  await ticketmasterDbSeedState.inFlight;
}

function mergeTicketmasterSamples(primary, secondary) {
  const out = [];
  const seen = new Set();
  for (const source of [primary, secondary]) {
    for (const sample of Array.isArray(source) ? source : []) {
      const key = cleanText(sample?.sampleId);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(sample);
    }
  }
  return out;
}

function medianNumber(values) {
  const list = (Array.isArray(values) ? values : [])
    .map((value) => toNumberOrNull(value))
    .filter((value) => typeof value === "number")
    .sort((a, b) => a - b);
  if (list.length === 0) return null;
  const mid = Math.floor(list.length / 2);
  if (list.length % 2 === 1) return list[mid];
  return (list[mid - 1] + list[mid]) / 2;
}

function mostCommonCurrency(samples) {
  const counts = new Map();
  for (const sample of Array.isArray(samples) ? samples : []) {
    const currency = normalizeCurrencyCode(sample?.currency);
    if (!currency) continue;
    counts.set(currency, (counts.get(currency) || 0) + 1);
  }

  let best = null;
  let bestCount = 0;
  for (const [currency, count] of counts.entries()) {
    if (count > bestCount) {
      best = currency;
      bestCount = count;
    }
  }
  return best;
}

function summarizeTicketmasterSamples(samples) {
  const list = Array.isArray(samples) ? samples : [];
  if (list.length === 0) return null;

  const minValues = [];
  const maxValues = [];
  let freeVotes = 0;

  for (const sample of list) {
    const min = toNumberOrNull(sample?.priceMin);
    const max = toNumberOrNull(sample?.priceMax);
    const cost = toNumberOrNull(sample?.cost);
    const resolvedMin = min != null ? min : cost != null ? cost : max;
    const resolvedMax = max != null ? max : cost != null ? cost : min;

    const hasPositive = (resolvedMin != null && resolvedMin > 0) || (resolvedMax != null && resolvedMax > 0);
    if (hasPositive) {
      if (resolvedMin != null && resolvedMin > 0) minValues.push(resolvedMin);
      if (resolvedMax != null && resolvedMax > 0) maxValues.push(resolvedMax);
      continue;
    }

    if (sample?.isFree === true || resolvedMin === 0 || resolvedMax === 0) {
      freeVotes += 1;
    }
  }

  const currency = mostCommonCurrency(list);
  const medianMin = medianNumber(minValues.length > 0 ? minValues : maxValues);
  const medianMax = medianNumber(maxValues.length > 0 ? maxValues : minValues);

  if (medianMin != null || medianMax != null) {
    let priceMin = medianMin != null ? medianMin : medianMax;
    let priceMax = medianMax != null ? medianMax : medianMin;
    if (priceMin != null && priceMax != null && priceMin > priceMax) {
      const swap = priceMin;
      priceMin = priceMax;
      priceMax = swap;
    }

    return {
      isFree: false,
      cost: priceMin,
      priceMin,
      priceMax,
      currency,
      sampleSize: list.length,
    };
  }

  if (freeVotes > 0) {
    return {
      isFree: true,
      cost: 0,
      priceMin: 0,
      priceMax: 0,
      currency,
      sampleSize: list.length,
    };
  }

  return null;
}

function ticketmasterInferenceMinSamplesForBasis(basis) {
  switch (basis) {
    case "title":
      return TICKETMASTER_PRICE_INFERENCE_CONFIG.minTitleSamples;
    case "artist":
      return TICKETMASTER_PRICE_INFERENCE_CONFIG.minArtistSamples;
    case "venue":
      return TICKETMASTER_PRICE_INFERENCE_CONFIG.minVenueSamples;
    case "promoter":
      return TICKETMASTER_PRICE_INFERENCE_CONFIG.minPromoterSamples;
    case "city_category":
      return TICKETMASTER_PRICE_INFERENCE_CONFIG.minCityCategorySamples;
    case "category":
      return TICKETMASTER_PRICE_INFERENCE_CONFIG.minCategorySamples;
    case "city":
      return TICKETMASTER_PRICE_INFERENCE_CONFIG.minCitySamples;
    case "global":
      return TICKETMASTER_PRICE_INFERENCE_CONFIG.minGlobalSamples;
    default:
      return 2;
  }
}

function ticketmasterInferenceSpreadLimitForBasis(basis) {
  const strict = TICKETMASTER_PRICE_INFERENCE_CONFIG.strictMode;
  const base = TICKETMASTER_PRICE_INFERENCE_CONFIG.maxSpreadRatio;
  if (!strict) return Math.max(1.05, base);
  switch (basis) {
    case "title":
      return Math.min(base, 1.55);
    case "artist":
      return Math.min(base, 1.6);
    case "venue":
      return Math.min(base, 1.45);
    case "promoter":
      return Math.min(base, 1.45);
    case "city_category":
      return Math.min(base, 1.35);
    case "category":
      return Math.min(base, 1.35);
    case "city":
      return Math.min(base, 1.3);
    case "global":
      return Math.min(base, 1.25);
    default:
      return Math.min(base, 1.5);
  }
}

function ticketmasterSamplePositiveValues(samples) {
  const values = [];
  for (const sample of Array.isArray(samples) ? samples : []) {
    const min = toNumberOrNull(sample?.priceMin);
    const max = toNumberOrNull(sample?.priceMax);
    const cost = toNumberOrNull(sample?.cost);
    const resolvedMin = min != null ? min : cost != null ? cost : max;
    const resolvedMax = max != null ? max : cost != null ? cost : min;
    if (resolvedMin != null && resolvedMin > 0) values.push(resolvedMin);
    if (resolvedMax != null && resolvedMax > 0) values.push(resolvedMax);
  }
  return values;
}

function isTicketmasterInferenceReliable(samples, summary, basis) {
  const list = Array.isArray(samples) ? samples : [];
  if (!summary || list.length === 0) return false;

  const minSamples = Math.max(2, ticketmasterInferenceMinSamplesForBasis(basis));
  if (list.length < minSamples) return false;

  if (summary.isFree === true) {
    let freeVotes = 0;
    for (const sample of list) {
      const min = toNumberOrNull(sample?.priceMin);
      const max = toNumberOrNull(sample?.priceMax);
      if (sample?.isFree === true || min === 0 || max === 0) freeVotes += 1;
    }
    const neededVotes = Math.max(2, Math.ceil(list.length * 0.8));
    return freeVotes >= neededVotes;
  }

  const positives = ticketmasterSamplePositiveValues(list);
  if (positives.length < minSamples) return false;
  const minValue = Math.min(...positives);
  const maxValue = Math.max(...positives);
  if (!(minValue > 0) || !(maxValue > 0) || maxValue < minValue) return false;

  const spreadRatio = maxValue / minValue;
  const spreadLimit = ticketmasterInferenceSpreadLimitForBasis(basis);
  return spreadRatio <= spreadLimit;
}

function inferTicketmasterPriceFromKnowledge(event, localKnowledge) {
  const titleKey = ticketmasterTitleKey(event);
  const artistKey = ticketmasterArtistKey(event);
  const venueKey = ticketmasterVenueKey(event);
  const promoterKey = ticketmasterPromoterKey(event);
  const cityCategoryKey = ticketmasterCityCategoryKey(event);
  const categoryKey = ticketmasterCategoryKey(event);
  const cityKey = ticketmasterCityKey(event);

  const titleSamples = mergeTicketmasterSamples(
    localKnowledge.byTitle.get(titleKey),
    ticketmasterPriceKnowledge.byTitle.get(titleKey)
  );
  const titleSummary = summarizeTicketmasterSamples(titleSamples);
  if (titleSummary && isTicketmasterInferenceReliable(titleSamples, titleSummary, "title")) {
    return {
      source: "ticketmaster_inferred_title",
      basis: "title",
      ...titleSummary,
    };
  }

  const artistSamples = mergeTicketmasterSamples(
    localKnowledge.byArtist.get(artistKey),
    ticketmasterPriceKnowledge.byArtist.get(artistKey)
  );
  const artistSummary = summarizeTicketmasterSamples(artistSamples);
  if (artistSummary && isTicketmasterInferenceReliable(artistSamples, artistSummary, "artist")) {
    return {
      source: "ticketmaster_inferred_artist",
      basis: "artist",
      ...artistSummary,
    };
  }

  const venueSamples = mergeTicketmasterSamples(
    localKnowledge.byVenue.get(venueKey),
    ticketmasterPriceKnowledge.byVenue.get(venueKey)
  );
  const venueSummary = summarizeTicketmasterSamples(venueSamples);
  if (venueSummary && isTicketmasterInferenceReliable(venueSamples, venueSummary, "venue")) {
    return {
      source: "ticketmaster_inferred_venue",
      basis: "venue",
      ...venueSummary,
    };
  }

  const promoterSamples = mergeTicketmasterSamples(
    localKnowledge.byPromoter.get(promoterKey),
    ticketmasterPriceKnowledge.byPromoter.get(promoterKey)
  );
  const promoterSummary = summarizeTicketmasterSamples(promoterSamples);
  if (
    promoterSummary &&
    isTicketmasterInferenceReliable(promoterSamples, promoterSummary, "promoter")
  ) {
    return {
      source: "ticketmaster_inferred_promoter",
      basis: "promoter",
      ...promoterSummary,
    };
  }

  if (TICKETMASTER_PRICE_INFERENCE_CONFIG.allowBroadBuckets) {
    const cityCategorySamples = mergeTicketmasterSamples(
      localKnowledge.byCityCategory.get(cityCategoryKey),
      ticketmasterPriceKnowledge.byCityCategory.get(cityCategoryKey)
    );
    const cityCategorySummary = summarizeTicketmasterSamples(cityCategorySamples);
    if (
      cityCategorySummary &&
      isTicketmasterInferenceReliable(cityCategorySamples, cityCategorySummary, "city_category")
    ) {
      return {
        source: "ticketmaster_inferred_city_category",
        basis: "city_category",
        ...cityCategorySummary,
      };
    }

    const categorySamples = mergeTicketmasterSamples(
      localKnowledge.byCategory.get(categoryKey),
      ticketmasterPriceKnowledge.byCategory.get(categoryKey)
    );
    const categorySummary = summarizeTicketmasterSamples(categorySamples);
    if (
      categorySummary &&
      isTicketmasterInferenceReliable(categorySamples, categorySummary, "category")
    ) {
      return {
        source: "ticketmaster_inferred_category",
        basis: "category",
        ...categorySummary,
      };
    }

    const citySamples = mergeTicketmasterSamples(
      localKnowledge.byCity.get(cityKey),
      ticketmasterPriceKnowledge.byCity.get(cityKey)
    );
    const citySummary = summarizeTicketmasterSamples(citySamples);
    if (citySummary && isTicketmasterInferenceReliable(citySamples, citySummary, "city")) {
      return {
        source: "ticketmaster_inferred_city",
        basis: "city",
        ...citySummary,
      };
    }
  }

  if (TICKETMASTER_PRICE_INFERENCE_CONFIG.allowGlobalBucket) {
    const globalSamples = mergeTicketmasterSamples(
      localKnowledge.globalSamples,
      ticketmasterPriceKnowledge.globalSamples
    );
    const globalSummary = summarizeTicketmasterSamples(globalSamples);
    if (globalSummary && isTicketmasterInferenceReliable(globalSamples, globalSummary, "global")) {
      return {
        source: "ticketmaster_inferred_global",
        basis: "global",
        ...globalSummary,
      };
    }
  }

  return null;
}

function applyTicketmasterPriceInference(events) {
  const list = Array.isArray(events) ? events : [];
  if (!TICKETMASTER_PRICE_INFERENCE_CONFIG.enabled || list.length === 0) {
    return list;
  }

  const localKnowledge = {
    byTitle: new Map(),
    byArtist: new Map(),
    byVenue: new Map(),
    byPromoter: new Map(),
    byCityCategory: new Map(),
    byCategory: new Map(),
    byCity: new Map(),
    globalSamples: [],
  };

  for (const event of list) {
    if (cleanText(event?.source)?.toLowerCase() !== "ticketmaster") continue;
    const sample = toTicketmasterInferenceSample(event);
    if (!sample) continue;
    rememberTicketmasterPriceSample(localKnowledge, event, sample);
    rememberTicketmasterPriceSample(ticketmasterPriceKnowledge, event, sample);
  }

  return list.map((event) => {
    if (cleanText(event?.source)?.toLowerCase() !== "ticketmaster") return event;

    const currentPrice = normalizeEventPrice(event);
    if (currentPrice.hasAnyPrice) return event;

    const inferred = inferTicketmasterPriceFromKnowledge(event, localKnowledge);
    if (!inferred) return event;

    const inferredCurrency =
      normalizeCurrencyCode(inferred.currency) ||
      normalizeCurrencyCode(event.currency) ||
      (/\.ticketmaster\.be\//i.test(String(event.url || event.ticketUrl || "")) ? "EUR" : null);
    const inferredConfidence =
      inferred.basis === "city" ||
      inferred.basis === "category" ||
      inferred.basis === "city_category" ||
      inferred.basis === "global"
        ? "inferred_low"
        : "inferred";

    return enrichEventWithPriceInsights({
      ...event,
      cost: inferred.cost,
      priceMin: inferred.priceMin,
      priceMax: inferred.priceMax,
      currency: inferredCurrency,
      isFree: inferred.isFree === true,
      priceSource: inferred.source,
      priceConfidence: inferredConfidence,
      metadata: {
        ...(event.metadata && typeof event.metadata === "object" ? event.metadata : {}),
        priceMin: inferred.priceMin,
        priceMax: inferred.priceMax,
        priceSource: inferred.source,
        priceInferenceBasis: inferred.basis,
        priceInferenceSampleSize: inferred.sampleSize,
        priceInferenceConfidence: inferredConfidence,
      },
    });
  });
}

function mapTicketmasterEvent(e, { classificationName = "music" } = {}) {
  const venue = e?._embedded?.venues?.[0];
  const attraction = e?._embedded?.attractions?.[0];
  const classification = e?.classifications?.[0];
  const promoter = e?.promoter || e?.promoters?.[0];
  const addressLine = [
    cleanText(venue?.address?.line1),
    cleanText(venue?.address?.line2),
  ]
    .filter(Boolean)
    .join(", ");
  const genre =
    classification?.genre?.name ||
    classification?.subGenre?.name ||
    classification?.segment?.name ||
    classificationName ||
    null;
  const category =
    classification?.segment?.name ||
    classification?.genre?.name ||
    classificationName ||
    null;
  const tags = normalizeTags([
    classification?.segment?.name,
    classification?.genre?.name,
    classification?.subGenre?.name,
    attraction?.name,
  ]);
  const priceInfo = extractTicketmasterPrice(e);
  const ticketUrl = cleanText(e.url);
  const hasApiPrice =
    priceInfo.isFree === true ||
    toNumberOrNull(priceInfo.min) != null ||
    toNumberOrNull(priceInfo.max) != null ||
    toNumberOrNull(priceInfo.cost) != null;
  const normalizedCurrency =
    normalizeCurrencyCode(priceInfo.currency) ||
    (ticketUrl && /\.ticketmaster\.be\//i.test(ticketUrl) ? "EUR" : null);
  const start = e.dates?.start?.dateTime || e.dates?.start?.localDate || null;

  return {
    source: "ticketmaster",
    sourceId: String(e.id),
    title: e.name,
    description: buildTicketmasterDescription(e, attraction, venue, promoter),
    start,
    end: e.dates?.end?.dateTime || e.dates?.end?.localDate || null,
    timezone: cleanText(e.dates?.timezone) || "UTC",
    venue: venue?.name || null,
    address: addressLine || cleanText(venue?.name),
    city: venue?.city?.name || null,
    state: venue?.state?.name || null,
    country: venue?.country?.name || null,
    postalCode: venue?.postalCode || null,
    lat: venue?.location?.latitude ? Number(venue.location.latitude) : null,
    lng: venue?.location?.longitude ? Number(venue.location.longitude) : null,
    isVirtual: false,
    virtualLink: null,
    isFree: priceInfo.isFree,
    cost: priceInfo.cost,
    priceMin: priceInfo.min,
    priceMax: priceInfo.max,
    currency: normalizedCurrency,
    priceSource: hasApiPrice ? "ticketmaster_discovery" : "unknown",
    url: ticketUrl,
    ticketUrl,
    imageUrl: pickTicketmasterImage(e?.images),
    genre,
    category,
    tags,
    status: mapTicketmasterStatus(e?.dates?.status?.code),
    organizerName: cleanText(promoter?.name),

    // Useful for setlist enrichment:
    artistName: attraction?.name || null,

    metadata: {
      ticketmasterStatus: cleanText(e?.dates?.status?.code),
      priceMin: priceInfo.min,
      priceMax: priceInfo.max,
      priceSource: hasApiPrice ? "ticketmaster_discovery" : "unknown",
    },
  };
}

async function fetchTicketmaster({
  keyword,
  lat,
  lng,
  radiusKm = 30,
  size = 10,
  classificationName = "music",
}) {
  await hydrateTicketmasterPriceKnowledgeFromDbOptional();
  const url = "https://app.ticketmaster.com/discovery/v2/events.json";

  const latlong =
    lat != null && lng != null && !Number.isNaN(lat) && !Number.isNaN(lng)
      ? `${lat},${lng}`
      : undefined;

  const { data } = await axios.get(url, {
    params: {
      apikey: process.env.TICKETMASTER_API_KEY,
      classificationName,
      keyword: keyword || undefined,
      latlong,
      radius: radiusKm,
      unit: "km",
      size,
      sort: "date,asc",
    },
    timeout: 15000,
  });

  const events = data?._embedded?.events ?? [];
  const mapped = events.map((e) => mapTicketmasterEvent(e, { classificationName }));
  return applyTicketmasterPriceInference(mapped);
}

async function fetchTicketmasterEventById({
  sourceId,
  classificationName = "music",
}) {
  const cleanId = cleanText(sourceId);
  if (!cleanId) return null;
  const url = `https://app.ticketmaster.com/discovery/v2/events/${encodeURIComponent(
    cleanId
  )}.json`;

  const { data } = await axios.get(url, {
    params: {
      apikey: process.env.TICKETMASTER_API_KEY,
    },
    timeout: 15000,
  });

  if (!data || !data.id) return null;
  return mapTicketmasterEvent(data, { classificationName });
}

function requireSetlistFmKey() {
  if (!process.env.SETLISTFM_API_KEY) throw new Error("Missing SETLISTFM_API_KEY in .env");
}

async function fetchSetlistFmSetlistsByArtistName({ artistName, page = 1 }) {
  requireSetlistFmKey();

  const url = "https://api.setlist.fm/rest/1.0/search/setlists";
  const { data } = await axios.get(url, {
    params: { artistName, p: page },
    headers: { "x-api-key": process.env.SETLISTFM_API_KEY, Accept: "application/json" },
    timeout: 15000,
  });

  const list = data?.setlist ?? [];
  return {
    total: Number(data?.total) || null,
    items: list.map((s) => ({
      id: s?.id || null,
      eventDate: s?.eventDate || null,
      tour: s?.tour?.name || null,
      venue: s?.venue?.name || null,
      city: s?.venue?.city?.name || null,
      country: s?.venue?.city?.country?.name || null,
      url: s?.url || null,
    })),
  };
}

async function fetchSetlistFmSetlistsByCityName({ cityName, page = 1 }) {
  requireSetlistFmKey();

  const url = "https://api.setlist.fm/rest/1.0/search/setlists";
  const { data } = await axios.get(url, {
    params: { cityName, p: page },
    headers: { "x-api-key": process.env.SETLISTFM_API_KEY, Accept: "application/json" },
    timeout: 15000,
  });

  const list = data?.setlist ?? [];
  return {
    total: Number(data?.total) || null,
    items: list.map((s) => ({
      id: s?.id || null,
      eventDate: s?.eventDate || null,
      artist: s?.artist?.name || null,
      venue: s?.venue?.name || null,
      city: s?.venue?.city?.name || null,
      country: s?.venue?.city?.country?.name || null,
      url: s?.url || null,
    })),
  };
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeSuggestText(value = "") {
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshteinDistance(a = "", b = "") {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = i - 1;
    dp[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = dp[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return dp[b.length];
}

function isSuggestMatch(query, candidate) {
  if (!query) return true;
  const q = normalizeSuggestText(query);
  const c = normalizeSuggestText(candidate);
  if (!q || !c) return false;
  if (c.includes(q)) return true;

  const qWords = q.split(" ").filter(Boolean);
  const cWords = c.split(" ").filter(Boolean);
  return qWords.every((qWord) =>
    cWords.some((cWord) => {
      if (cWord.startsWith(qWord)) return true;
      const maxDistance = qWord.length <= 4 ? 1 : 2;
      return (
        levenshteinDistance(qWord, cWord.slice(0, qWord.length)) <= maxDistance
      );
    })
  );
}

function buildEventSuggestions(events, query, limit = 10) {
  const byLabel = new Map();
  const q = cleanText(query) || "";

  const add = (raw, kind, boost = 0) => {
    const label = cleanText(raw);
    if (!label || label.length < 2) return;
    if (!isSuggestMatch(q, label)) return;

    const key = normalizeSuggestText(label);
    const current = byLabel.get(key) || {
      label,
      score: 0,
      kinds: new Set(),
    };

    current.kinds.add(kind);
    let score = boost;
    if (kind === "artist") score += 5;
    else if (kind === "title") score += 4;
    else if (kind === "venue") score += 3;
    else if (kind === "city") score += 2;
    else score += 1;

    const normLabel = normalizeSuggestText(label);
    const normQ = normalizeSuggestText(q);
    if (normQ && normLabel.startsWith(normQ)) score += 3;
    if (normQ && normLabel.includes(normQ)) score += 2;

    current.score += score;
    byLabel.set(key, current);
  };

  for (const event of Array.isArray(events) ? events : []) {
    add(event?.artistName, "artist", 1);
    add(event?.title, "title");
    add(event?.venue, "venue");
    add(event?.city, "city");
    add(event?.genre, "genre");
    add(event?.category, "category");

    if (Array.isArray(event?.tags)) {
      for (const tag of event.tags) add(tag, "tag");
    }
  }

  return [...byLabel.values()]
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
    .slice(0, Math.max(1, Math.min(20, Number(limit) || 10)))
    .map((item) => item.label);
}

async function resolveEventsForAi({ events, query = {} } = {}) {
  if (Array.isArray(events) && events.length > 0) {
    return dedupe(events).slice(0, 300);
  }

  const safeQuery = objectOrEmpty(query);
  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  const apiBase = cleanText(process.env.API_BASE_URL);
  const vercelUrl = cleanText(process.env.VERCEL_URL);

  const toAbsoluteBase = (value) => {
    const raw = cleanText(value);
    if (!raw) return null;
    if (/^https?:\/\//i.test(raw)) return raw.replace(/\/+$/, "");
    if (raw.startsWith("/") && vercelUrl) {
      return `https://${vercelUrl}${raw}`.replace(/\/+$/, "");
    }
    return null;
  };

  const joinUrl = (base, path) =>
    `${String(base || "").replace(/\/+$/, "")}/${String(path || "").replace(/^\/+/, "")}`;

  const endpointCandidates = [];
  endpointCandidates.push(`http://127.0.0.1:${port}/events`);

  const absoluteApiBase = toAbsoluteBase(apiBase);
  if (absoluteApiBase) {
    endpointCandidates.push(joinUrl(absoluteApiBase, "events"));
    endpointCandidates.push(joinUrl(absoluteApiBase, "api/events"));
  }

  if (vercelUrl) {
    endpointCandidates.push(`https://${vercelUrl}/api/events`);
    endpointCandidates.push(`https://${vercelUrl}/events`);
  }

  const uniqueEndpoints = [...new Set(endpointCandidates.filter(Boolean))];

  const params = {
    keyword: cleanText(safeQuery.keyword) || undefined,
    lat: Number.isFinite(Number(safeQuery.lat))
      ? Number(safeQuery.lat)
      : 50.8503,
    lng: Number.isFinite(Number(safeQuery.lng))
      ? Number(safeQuery.lng)
      : 4.3517,
    radiusKm: Number.isFinite(Number(safeQuery.radiusKm))
      ? Number(safeQuery.radiusKm)
      : 30,
    classificationName: cleanText(safeQuery.classificationName) || "music",
    size: Number.isFinite(Number(safeQuery.size))
      ? Math.max(1, Number(safeQuery.size))
      : 40,
    maxResults: Number.isFinite(Number(safeQuery.maxResults))
      ? Math.max(1, Number(safeQuery.maxResults))
      : 120,
    includeScraped: toBool(safeQuery.includeScraped, true) ? 1 : 0,
    includeSetlists: 0,
  };

  let lastError = null;
  for (const endpoint of uniqueEndpoints) {
    try {
      const { data } = await axios.get(endpoint, {
        params,
        timeout: 45000,
      });

      if (data && data.ok === true && Array.isArray(data.events)) {
        return data.events;
      }

      lastError = new Error(`Unexpected response shape from ${endpoint}`);
    } catch (err) {
      lastError = err;
    }
  }

  throw new Error(
    `Failed to resolve events for AI endpoints (${uniqueEndpoints.join(" | ")}): ${String(
      lastError?.message || lastError || "unknown"
    )}`
  );
}

// -----------------------------
// Endpoints
// -----------------------------

function parseSourceMetadataObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      // Ignore invalid metadata payloads.
    }
  }
  return {};
}

function resolveOrganizerReviewStatus(row) {
  const metadata = parseSourceMetadataObject(row?.source_metadata);
  const explicit = cleanText(metadata.reviewStatus || metadata.review_status || metadata.status);
  const explicitNormalized = explicit ? explicit.toLowerCase() : null;
  if (explicitNormalized === "approved") return "approved";
  if (explicitNormalized === "rejected") return "rejected";
  if (explicitNormalized === "pending") return "pending";

  const dbStatus = cleanText(row?.status)?.toLowerCase();
  if (dbStatus === "published") return "approved";
  if (dbStatus === "cancelled") return "rejected";
  return "pending";
}

function formatOrganizerDateLabel(startIso) {
  const value = cleanText(startIso);
  if (!value) return "TBA";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function mapDbOrganizerEventToPublicDto(row, { originLat = null, originLng = null } = {}) {
  const metadata = parseSourceMetadataObject(row?.source_metadata);
  const reviewStatus = resolveOrganizerReviewStatus(row);

  const latitude = toNumberOrNull(row?.latitude);
  const longitude = toNumberOrNull(row?.longitude);
  const canComputeDistance =
    latitude != null &&
    longitude != null &&
    originLat != null &&
    originLng != null &&
    Number.isFinite(originLat) &&
    Number.isFinite(originLng);

  const tags = Array.isArray(row?.tags)
    ? row.tags.map((entry) => cleanText(entry)).filter(Boolean)
    : Array.isArray(metadata?.tags)
    ? metadata.tags.map((entry) => cleanText(entry)).filter(Boolean)
    : [];

  const imageUrl =
    cleanText(row?.cover_image_url) ||
    cleanText(metadata?.imageUrl) ||
    cleanText(metadata?.coverImageUrl) ||
    "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=1400&q=80";

  const ownerId =
    cleanText(row?.organizer_id) ||
    cleanText(metadata?.ownerId) ||
    cleanText(metadata?.owner_id) ||
    "0";

  return {
    id: cleanText(row?.source_id) || cleanText(row?.id) || `org_${Math.abs(Number(row?.id) || 0)}`,
    title: cleanText(row?.title) || "Untitled event",
    venue: cleanText(row?.venue_name) || "Venue",
    city: cleanText(row?.city) || "City",
    dateLabel: formatOrganizerDateLabel(row?.start_datetime),
    distanceKm: canComputeDistance ? haversineKm(originLat, originLng, latitude, longitude) : 0,
    imageUrl,
    tags: tags.length > 0 ? tags : ["All"],
    trending: false,
    addressLine: cleanText(row?.address) || cleanText(metadata?.addressLine) || "—",
    postalCode: cleanText(row?.postal_code) || cleanText(metadata?.postalCode) || "—",
    country: cleanText(row?.country) || cleanText(metadata?.country) || "Belgium",
    latitude: latitude != null ? latitude : 50.8466,
    longitude: longitude != null ? longitude : 4.3528,
    description: cleanText(row?.description) || cleanText(metadata?.description) || "—",
    ownerId,
    createdAt: cleanText(row?.created_at) || new Date().toISOString(),
    updatedAt: cleanText(row?.updated_at) || new Date().toISOString(),
    status: reviewStatus,
    reviewedAt: cleanText(metadata?.reviewedAt || metadata?.reviewed_at) || undefined,
    reviewedBy:
      cleanText(metadata?.reviewedBy || metadata?.reviewed_by || metadata?.reviewerId) ||
      undefined,
    promotedUntil: cleanText(metadata?.promotedUntil || metadata?.promoted_until) || undefined,
    promotionPlan:
      metadata?.promotionPlan === "24h" || metadata?.promotionPlan === "7d"
        ? metadata.promotionPlan
        : undefined,
    promotionAmount: toNumberOrNull(metadata?.promotionAmount) || undefined,
  };
}

/**
 * GET /organizer/events/public
 * Public organizer events used by dashboard merge (approved only).
 */
app.get("/organizer/events/public", async (req, res) => {
  try {
    if (!pool) return res.json({ ok: true, events: [] });

    const db = requireDb();
    const originLat = toNumberOrNull(req.query?.originLat);
    const originLng = toNumberOrNull(req.query?.originLng);
    const limit = Math.max(1, Math.min(250, Number(req.query?.limit) || 120));

    const result = await db.query(
      `
        SELECT id, source_id, title, description, start_datetime, venue_name, city,
               address, postal_code, country, latitude, longitude, tags,
               cover_image_url, organizer_id, status, source_metadata,
               created_at, updated_at
        FROM events
        WHERE (
          LOWER(COALESCE(source, '')) IN ('organizer', 'organiser', 'user_submission')
          OR COALESCE(source_id, '') ILIKE 'org_%'
        )
        ORDER BY start_datetime ASC NULLS LAST, created_at DESC
        LIMIT $1
      `,
      [limit]
    );

    const mapped = (result.rows || []).map((row) =>
      mapDbOrganizerEventToPublicDto(row, { originLat, originLng })
    );
    const approvedOnly = mapped.filter((event) => event.status === "approved");
    return res.json({ ok: true, events: approvedOnly });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

/**
 * GET /organizer/events/:id/public
 * Public organizer event detail by id/source_id (approved only).
 */
app.get("/organizer/events/:id/public", async (req, res) => {
  try {
    if (!pool) return res.status(404).json({ ok: false, error: "Organizer event not found." });

    const db = requireDb();
    const rawId = cleanText(req.params?.id);
    if (!rawId) return res.status(400).json({ ok: false, error: "Missing organizer event id." });

    const aliasIds = new Set([rawId]);
    const prefixed = rawId.match(/^org[_:-]?(\d+)$/i);
    if (prefixed?.[1]) aliasIds.add(prefixed[1]);

    const ids = [...aliasIds];
    const result = await db.query(
      `
        SELECT id, source_id, title, description, start_datetime, venue_name, city,
               address, postal_code, country, latitude, longitude, tags,
               cover_image_url, organizer_id, status, source_metadata,
               created_at, updated_at
        FROM events
        WHERE (
          LOWER(COALESCE(source, '')) IN ('organizer', 'organiser', 'user_submission')
          OR COALESCE(source_id, '') ILIKE 'org_%'
        )
          AND (
            CAST(id AS TEXT) = ANY($1::text[])
            OR COALESCE(source_id, '') = ANY($1::text[])
          )
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [ids]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, error: "Organizer event not found." });
    }

    const originLat = toNumberOrNull(req.query?.originLat);
    const originLng = toNumberOrNull(req.query?.originLng);
    const event = mapDbOrganizerEventToPublicDto(result.rows[0], { originLat, originLng });
    if (event.status !== "approved") {
      return res.status(404).json({ ok: false, error: "Organizer event not found." });
    }

    return res.json({ ok: true, event });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
});

function mapDbEventRowToApiEvent(row) {
  const sourceMetadata = parseSourceMetadataObject(row?.source_metadata);
  const metadataInner =
    sourceMetadata?.metadata && typeof sourceMetadata.metadata === "object"
      ? sourceMetadata.metadata
      : {};
  const rawEvent =
    sourceMetadata?.raw_event && typeof sourceMetadata.raw_event === "object"
      ? sourceMetadata.raw_event
      : {};

  const tags = Array.isArray(row?.tags)
    ? row.tags.map((entry) => cleanText(entry)).filter(Boolean)
    : [];

  const mapped = {
    source: cleanText(row?.source) || "db_sync",
    sourceId: cleanText(row?.source_id) || cleanText(row?.id) || null,
    title: cleanText(row?.title) || "Untitled event",
    description: cleanText(row?.description) || null,
    start: cleanText(row?.start_datetime) || null,
    end: cleanText(row?.end_datetime) || null,
    timezone: cleanText(row?.timezone) || "UTC",
    venue: cleanText(row?.venue_name) || null,
    address: cleanText(row?.address) || null,
    city: cleanText(row?.city) || null,
    state: cleanText(row?.state) || null,
    country: cleanText(row?.country) || null,
    postalCode: cleanText(row?.postal_code) || null,
    lat: toNumberOrNull(row?.latitude),
    lng: toNumberOrNull(row?.longitude),
    isVirtual: row?.is_virtual === true,
    virtualLink: cleanText(row?.virtual_link) || null,
    isFree: row?.is_free === true,
    cost: toNumberOrNull(row?.cost),
    priceMin: toNumberOrNull(row?.price_min),
    priceMax: toNumberOrNull(row?.price_max),
    currency: normalizeCurrencyCode(row?.currency),
    priceTier: cleanText(row?.price_tier) || null,
    priceSource: cleanText(row?.price_source) || null,
    ticketUrl: cleanText(row?.ticket_url) || cleanText(row?.source_url) || null,
    url: cleanText(row?.source_url) || cleanText(row?.ticket_url) || null,
    imageUrl: cleanText(row?.cover_image_url) || null,
    genre:
      cleanText(row?.category) ||
      cleanText(metadataInner?.genre) ||
      cleanText(rawEvent?.genre) ||
      null,
    category: cleanText(row?.category) || cleanText(metadataInner?.category) || null,
    tags,
    status: cleanText(row?.status) || "published",
    organizerName: cleanText(rawEvent?.organizerName) || null,
    artistName: cleanText(rawEvent?.artistName) || null,
    metadata: {
      ...metadataInner,
      ...(row?.price_min != null ? { priceMin: toNumberOrNull(row?.price_min) } : {}),
      ...(row?.price_max != null ? { priceMax: toNumberOrNull(row?.price_max) } : {}),
      ...(row?.price_source ? { priceSource: cleanText(row.price_source) } : {}),
    },
  };

  return enrichEventWithPriceInsights(mapped);
}

function matchesDbEventKeyword(event, keyword) {
  const normalized = normalizeCityText(keyword);
  if (!normalized) return true;
  const terms = normalized.split(" ").filter(Boolean);
  if (terms.length === 0) return true;

  const haystack = normalizeCityText(
    [
      event?.title,
      event?.description,
      event?.venue,
      event?.city,
      event?.genre,
      event?.category,
      event?.artistName,
      ...(Array.isArray(event?.tags) ? event.tags : []),
    ]
      .filter(Boolean)
      .join(" ")
  );

  return terms.every((term) => haystack.includes(term));
}

function matchesDbClassification(event, classificationName) {
  const classification = cleanText(classificationName)?.toLowerCase();
  if (!classification || classification === "music") return true;

  const fields = normalizeCityText(
    [
      event?.genre,
      event?.category,
      ...(Array.isArray(event?.tags) ? event.tags : []),
    ]
      .filter(Boolean)
      .join(" ")
  );
  if (!fields) return false;
  return fields.includes(normalizeCityText(classification));
}

function matchesDbDistance(event, { lat, lng, radiusKm }) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(radiusKm) || radiusKm <= 0) {
    return true;
  }
  const eventLat = toNumberOrNull(event?.lat);
  const eventLng = toNumberOrNull(event?.lng);
  if (eventLat == null || eventLng == null) return true;
  return haversineKm(lat, lng, eventLat, eventLng) <= radiusKm;
}

async function fetchPublishedEventsFromDb({
  keyword,
  lat,
  lng,
  radiusKm,
  classificationName,
  maxResults = 80,
}) {
  if (!pool) return [];
  const db = requireDb();
  const safeLimit = Math.max(80, Math.min(1400, maxResults * 12));

  const result = await db.query(
    `
      SELECT id, title, description, start_datetime, end_datetime, timezone,
             venue_name, address, city, state, country, postal_code,
             latitude, longitude, is_virtual, virtual_link,
             is_free, cost, price_min, price_max, currency, price_tier, price_source,
             ticket_url, category, tags, status,
             source, source_id, source_url, cover_image_url, source_metadata,
             created_at, updated_at
      FROM events
      WHERE status = 'published'
        AND start_datetime >= (CURRENT_TIMESTAMP - INTERVAL '6 hours')
      ORDER BY start_datetime ASC, created_at DESC
      LIMIT $1
    `,
    [safeLimit]
  );

  const mapped = (result.rows || []).map((row) => mapDbEventRowToApiEvent(row));
  const filtered = mapped
    .filter((event) => matchesDbClassification(event, classificationName))
    .filter((event) => matchesDbEventKeyword(event, keyword))
    .filter((event) => matchesDbDistance(event, { lat, lng, radiusKm }));

  return filtered.slice(0, Math.max(1, maxResults));
}

/**
 * GET /events
 * Query params:
 * - lat, lng, radiusKm (variables)
 * - keyword (optional)
 * - size (optional)
 * - includeSetlists=1 (optional; enrich with setlist.fm for artists)
 * - setlistsPerArtist (optional; default 3)
 * - maxArtists (optional; default 5)  // to avoid rate limits
 *
 * Examples:
 * /events?lat=50.8503&lng=4.3517&radiusKm=30
 * /events?keyword=rock&lat=50.8503&lng=4.3517&radiusKm=30&includeSetlists=1
 */
app.get("/events", async (req, res) => {
  try {
    const {
      keyword = "",
      lat = "50.8503",
      lng = "4.3517",
      radiusKm = "30",
      classificationName = "music",
      size = "10",
      maxResults = "80",
      includeScraped = "1",

      includeSetlists = "0",
      setlistsPerArtist = "3",
      maxArtists = "5",
      scrapeWaitMs = "",
      preferDb = "1",
      allowLiveFetch = "1",
    } = req.query;

    const latNum = Number(lat);
    const lngNum = Number(lng);
    const radiusNum = Number(radiusKm);
    const sizeNum = Number(size);
    const maxResultsNum = toPositiveInt(maxResults, 80);

    if (Number.isNaN(latNum) || Number.isNaN(lngNum)) {
      return res.status(400).json({ ok: false, error: "Invalid lat/lng." });
    }
    if (Number.isNaN(radiusNum) || radiusNum <= 0) {
      return res.status(400).json({ ok: false, error: "Invalid radiusKm." });
    }

    const sourceErrors = [];
    const isInternalSyncRequest =
      String(req.headers["x-eventify-sync-internal"] || "").trim() === "1";
    const scrapeWaitMsResolved = isInternalSyncRequest
      ? toPositiveInt(scrapeWaitMs, SCRAPE_SYNC_WAIT_MS)
      : toPositiveInt(scrapeWaitMs, SCRAPE_CACHE_CONFIG.requestWaitMs);
    const preferDbFirst = toBool(preferDb, true);
    const allowLiveFetchBool = toBool(allowLiveFetch, true);

    if (preferDbFirst) {
      try {
        const dbEvents = await fetchPublishedEventsFromDb({
          keyword,
          lat: latNum,
          lng: lngNum,
          radiusKm: radiusNum,
          classificationName,
          maxResults: maxResultsNum,
        });

        if (dbEvents.length > 0 || !allowLiveFetchBool) {
          const events = dedupe(dbEvents).slice(0, maxResultsNum);
          const withAnyPrice = events.filter((event) => event?.hasAnyPrice).length;
          const unknownPrice = Math.max(0, events.length - withAnyPrice);
          return res.json({
            ok: true,
            keyword,
            lat: latNum,
            lng: lngNum,
            radiusKm: radiusNum,
            classificationName,
            includeScraped: false,
            includeSetlists: false,
            sourceCounts: summarizeSources(events),
            sourceWarnings: sourceErrors.length > 0 ? sourceErrors : undefined,
            dbFirst: true,
            liveFetchAttempted: false,
            scrapeCache: {
              mode: "db_only",
              ageMs: null,
              timedOut: false,
              ttlMs: SCRAPE_CACHE_CONFIG.ttlMs,
              waitMs: scrapeWaitMsResolved,
            },
            priceCoverage: {
              total: events.length,
              withAnyPrice,
              enrichedThisRequest: 0,
              unknownPrice,
              blockedHostSkips: 0,
            },
            count: events.length,
            events,
          });
        }
      } catch (err) {
        sourceErrors.push({ source: "db", error: String(err?.message || err) });
      }
    }

    if (!allowLiveFetchBool) {
      return res.json({
        ok: true,
        keyword,
        lat: latNum,
        lng: lngNum,
        radiusKm: radiusNum,
        classificationName,
        includeScraped: false,
        includeSetlists: false,
        sourceCounts: {},
        sourceWarnings: sourceErrors.length > 0 ? sourceErrors : undefined,
        dbFirst: true,
        liveFetchAttempted: false,
        scrapeCache: {
          mode: "disabled",
          ageMs: null,
          timedOut: false,
          ttlMs: SCRAPE_CACHE_CONFIG.ttlMs,
          waitMs: scrapeWaitMsResolved,
        },
        priceCoverage: {
          total: 0,
          withAnyPrice: 0,
          enrichedThisRequest: 0,
          unknownPrice: 0,
          blockedHostSkips: 0,
        },
        count: 0,
        events: [],
      });
    }

    const tmPromise = fetchTicketmaster({
      keyword,
      lat: latNum,
      lng: lngNum,
      radiusKm: radiusNum,
      size: sizeNum,
      classificationName,
    }).catch((err) => {
      sourceErrors.push({ source: "ticketmaster", error: String(err.message || err) });
      return [];
    });

    const wantScraped =
      toBool(includeScraped, true) &&
      SCRAPE_CONFIG.enabled &&
      SCRAPE_CONFIG.sourceUrls.length > 0;

    const scrapePromise = wantScraped
      ? getScrapedEventsForRequest({
          waitMsOverride: scrapeWaitMsResolved,
        }).catch((err) => {
          sourceErrors.push({ source: "webscrape", error: String(err.message || err) });
          return {
            events: [],
            cacheMode: "error",
            ageMs: null,
            timedOut: false,
            waitMs: scrapeWaitMsResolved,
            lastError: String(err.message || err),
          };
        })
      : Promise.resolve({
          events: [],
          cacheMode: "disabled",
          ageMs: null,
          timedOut: false,
          waitMs: scrapeWaitMsResolved,
          lastError: null,
        });

    const [tmEvents, scrapeResult] = await Promise.all([tmPromise, scrapePromise]);
    const scrapedEventsRaw = scrapeResult.events || [];
    const scrapedLocationFiltered = scrapedEventsRaw.filter(
      matchesScrapeLocationFilters
    );
    const scrapedClassificationFiltered = scrapedLocationFiltered.filter((event) =>
      matchesClassificationForScraped(event, classificationName)
    );
    const scrapedEvents = scrapedClassificationFiltered.filter((event) =>
      matchesKeywordForScraped(event, keyword)
    );
    const scrapeFilteredOut = Math.max(
      0,
      scrapedEventsRaw.length - scrapedEvents.length
    );
    const scrapeFilterStats = {
      raw: scrapedEventsRaw.length,
      afterLocation: scrapedLocationFiltered.length,
      afterClassification: scrapedClassificationFiltered.length,
      afterKeyword: scrapedEvents.length,
    };
    if (scrapeResult.lastError) {
      sourceErrors.push({ source: "webscrape-cache", error: scrapeResult.lastError });
    }
    const combinedEvents = dedupe([...tmEvents, ...scrapedEvents]);
    let events = interleaveBySource(combinedEvents, maxResultsNum);

    // Admin moderation: hide disabled events (they can be re-fetched from external APIs)
    const disabledKeys = await getDisabledEventKeysOptional();
    const moderationFiltered = filterDisabledApiEvents(events, disabledKeys);
    events = moderationFiltered.events;
    const disabledFilteredOut = moderationFiltered.filteredOut;

    const wantSetlists = String(includeSetlists) === "1";
    if (wantSetlists) {
      const artists = [];
      const seen = new Set();
      for (const e of events) {
        const name = (e.artistName || "").trim();
        if (!name) continue;
        const key = name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        artists.push(name);
      }

      const maxA = Math.max(0, Number(maxArtists) || 0);
      const perArtist = Math.max(1, Number(setlistsPerArtist) || 3);
      const selected = artists.slice(0, maxA);

      const artistToSetlists = {};
      await mapSequential(selected, async (artistName) => {
        try {
          const result = await fetchSetlistFmSetlistsByArtistName({ artistName, page: 1 });
          artistToSetlists[artistName] = {
            total: result.total,
            items: (result.items || []).slice(0, perArtist),
          };
        } catch (err) {
          artistToSetlists[artistName] = { error: String(err) };
        }
      });

      events = events.map((e) => {
        if (!e.artistName) return e;
        const payload = artistToSetlists[e.artistName];
        if (!payload) return e;
        return { ...e, setlistFm: payload };
      });
    }

    const priceResult = await enrichMissingPrices(events);
    events = priceResult.events;
    events = applyTicketmasterPriceInference(events);
    const withAnyPrice = events.filter((event) => event?.hasAnyPrice).length;
    const unknownPrice = Math.max(0, events.length - withAnyPrice);

    if (events.length === 0 && sourceErrors.length > 0) {
      return res.status(502).json({
        ok: false,
        error: "All event sources failed. Check API keys and scrape source URLs.",
        sourcesFailed: sourceErrors,
      });
    }

    return res.json({
      ok: true,
      keyword,
      lat: latNum,
      lng: lngNum,
      radiusKm: radiusNum,
      classificationName,
      includeScraped: wantScraped,
      scrapeConfiguredSources: SCRAPE_CONFIG.sourceUrls.length,
      scrapeLocationFilters: {
        allowedCountries: SCRAPE_CONFIG.allowedCountries,
        allowedCities: SCRAPE_CONFIG.allowedCities,
      },
      scrapeFilteredOut,
      scrapeFilterStats,
      scrapeCache: {
        mode: scrapeResult.cacheMode,
        ageMs: scrapeResult.ageMs,
        timedOut: scrapeResult.timedOut,
        ttlMs: SCRAPE_CACHE_CONFIG.ttlMs,
        waitMs: scrapeResult.waitMs ?? scrapeWaitMsResolved,
      },
      includeSetlists: wantSetlists,
      sourceCounts: summarizeSources(events),
      disabledFilteredOut,
      sourceWarnings: sourceErrors.length > 0 ? sourceErrors : undefined,
      priceCoverage: {
        total: events.length,
        withAnyPrice,
        enrichedThisRequest: priceResult.enrichedThisRequest,
        unknownPrice,
        blockedHostSkips: priceResult.blockedHostSkips,
        settings: {
          enabled: PRICE_ENRICH_CONFIG.enabled,
          maxPerRequest: PRICE_ENRICH_CONFIG.maxPerRequest,
          ticketmasterMaxPerRequest: PRICE_ENRICH_CONFIG.ticketmasterMaxPerRequest,
          proxyConfigured: Boolean(PRICE_ENRICH_CONFIG.ticketmasterProxyBaseUrl),
        },
      },
      count: events.length,
      events,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

/**
 * GET /events/suggestions
 * Query params:
 * - q (required-ish, short text)
 * - lat, lng, radiusKm (optional)
 * - limit (optional, max 20)
 */
app.get("/events/suggestions", async (req, res) => {
  try {
    const q = cleanText(req.query?.q || "");
    if (!q || q.length < 1) {
      return res.json({ ok: true, suggestions: [] });
    }

    const lat = Number(req.query?.lat);
    const lng = Number(req.query?.lng);
    const radiusKm = Number(req.query?.radiusKm);
    const limit = Math.max(1, Math.min(20, Number(req.query?.limit) || 10));

    const events = await resolveEventsForAi({
      query: {
        keyword: q,
        lat: Number.isFinite(lat) ? lat : 50.8503,
        lng: Number.isFinite(lng) ? lng : 4.3517,
        radiusKm: Number.isFinite(radiusKm) ? radiusKm : 1000,
        classificationName: "music",
        size: 80,
        maxResults: 180,
        includeScraped: 1,
      },
    });

    const suggestions = buildEventSuggestions(events, q, limit);
    return res.json({
      ok: true,
      q,
      count: suggestions.length,
      suggestions,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

/**
 * GET /events/enrich
 * Query params:
 * - source=ticketmaster
 * - sourceId=<ticketmaster event id>
 * - classificationName=music (optional)
 */
app.get("/events/enrich", async (req, res) => {
  try {
    const source = cleanText(req.query.source)?.toLowerCase() || "";
    const sourceId = cleanText(req.query.sourceId);
    const classificationName = cleanText(req.query.classificationName) || "music";

    if (!sourceId) {
      return res.status(400).json({
        ok: false,
        error: "Provide sourceId. Example: /events/enrich?source=ticketmaster&sourceId=XYZ",
      });
    }

    if (source !== "ticketmaster") {
      return res.status(400).json({
        ok: false,
        error: "Unsupported source. Currently only source=ticketmaster is supported.",
      });
    }

    const event = await fetchTicketmasterEventById({ sourceId, classificationName });
    if (!event) {
      return res.status(404).json({
        ok: false,
        error: "Ticketmaster event not found for provided sourceId.",
      });
    }

    const disabledKeys = await getDisabledEventKeysOptional();
    const key = buildEventKeyFromApiEvent(event, 0);
    if (disabledKeys.size > 0 && disabledKeys.has(key)) {
      return res.status(404).json({ ok: false, error: 'Event is disabled by admin moderation.' });
    }

    const priceResult = await enrichMissingPrices([event]);
    const pricedEvent = priceResult.events[0] || event;
    const inferredEvent = applyTicketmasterPriceInference([pricedEvent])[0] || pricedEvent;

    return res.json({
      ok: true,
      event: inferredEvent,
      priceCoverage: {
        total: 1,
        withAnyPrice: inferredEvent?.hasAnyPrice ? 1 : 0,
        enrichedThisRequest: priceResult.enrichedThisRequest,
        unknownPrice: inferredEvent?.hasAnyPrice ? 0 : 1,
        blockedHostSkips: priceResult.blockedHostSkips,
        settings: {
          enabled: PRICE_ENRICH_CONFIG.enabled,
          maxPerRequest: PRICE_ENRICH_CONFIG.maxPerRequest,
          ticketmasterMaxPerRequest: PRICE_ENRICH_CONFIG.ticketmasterMaxPerRequest,
          proxyConfigured: Boolean(PRICE_ENRICH_CONFIG.ticketmasterProxyBaseUrl),
        },
      },
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

/**
 * GET /setlists
 * Query params:
 * - artistName=Coldplay OR cityName=Brussels
 * - page=1
 *
 * Examples:
 * /setlists?artistName=Coldplay
 * /setlists?cityName=Brussels
 */
app.get("/setlists", async (req, res) => {
  try {
    const { artistName, cityName, page = "1" } = req.query;
    const pageNum = Number(page) || 1;

    if (!artistName && !cityName) {
      return res.status(400).json({ ok: false, error: "Provide artistName or cityName." });
    }

    if (artistName) {
      const result = await fetchSetlistFmSetlistsByArtistName({ artistName, page: pageNum });
      return res.json({ ok: true, mode: "artistName", artistName, page: pageNum, ...result });
    }

    const result = await fetchSetlistFmSetlistsByCityName({ cityName, page: pageNum });
    return res.json({ ok: true, mode: "cityName", cityName, page: pageNum, ...result });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

/**
 * POST /ai/genre-predict
 * Body:
 * - text?: string
 * - events?: event[]
 * - topK?: number (default 3)
 * - enrichMissingGenres?: boolean (default false)
 */
app.post("/ai/genre-predict", async (req, res) => {
  try {
    const body = objectOrEmpty(req.body);
    const text = cleanText(body.text);
    const events = Array.isArray(body.events) ? body.events : [];
    const topK = toPositiveInt(body.topK, 3);
    const enrichMissingGenres = toBool(body.enrichMissingGenres, false);

    if (!text && events.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "Provide 'text' or a non-empty 'events' array.",
      });
    }

    const result = { ok: true, topK };

    if (text) {
      result.textPrediction = predictGenresFromText(text, { topK });
    }

    if (events.length > 0) {
      result.events = events.map((event, index) => {
        const predictions = predictGenresForEvent(event, { topK });
        const primary = predictions[0] || null;
        const hasExplicitGenre = Boolean(
          cleanText(event?.genre) || cleanText(event?.category)
        );

        const out = {
          index,
          eventId: cleanText(event?.id) || cleanText(event?.sourceId) || null,
          title: cleanText(event?.title) || null,
          predictions,
          primaryGenre: primary?.genre || null,
          primaryConfidence: primary?.confidence || null,
        };

        if (enrichMissingGenres && !hasExplicitGenre && primary) {
          out.suggestedPatch = {
            genre: primary.genre,
            category: primary.genre,
            confidence: primary.confidence,
          };
        }

        return out;
      });
      result.count = result.events.length;
    }

    return res.json(result);
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

/**
 * POST /ai/recommendations
 * Body:
 * - userProfile?: { preferredGenres, likedEvents, lat, lng, maxDistanceKm, peerInterestByEventId }
 * - events?: event[]
 * - query?: /events-style query used if events omitted
 * - limit?: number
 * - weights?: { genreMatch, distance, popularity, similarity }
 */
app.post("/ai/recommendations", async (req, res) => {
  try {
    const body = objectOrEmpty(req.body);
    const userProfile = objectOrEmpty(body.userProfile);
    const limit = toPositiveInt(body.limit, 20);
    const weights = objectOrEmpty(body.weights);

    const events = await resolveEventsForAi({
      events: Array.isArray(body.events) ? body.events : null,
      query: objectOrEmpty(body.query),
    });

    const recommendation = recommendEvents(events, userProfile, {
      limit,
      weights,
    });

    return res.json({
      ok: true,
      count: recommendation.items.length,
      weights: recommendation.weights,
      defaults: DEFAULT_RECOMMENDATION_WEIGHTS,
      inferredProfile: recommendation.inferredProfile,
      events: recommendation.items,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

/**
 * POST /ai/radar
 * Body:
 * - userProfile?: same as /ai/recommendations
 * - events?: event[]
 * - query?: /events-style query used if events omitted
 * - limit?: number
 * - hiddenGemThreshold?: number (0..1)
 * - trendingThreshold?: number (0..1)
 * - includeAll?: boolean
 */
app.post("/ai/radar", async (req, res) => {
  try {
    const body = objectOrEmpty(req.body);
    const userProfile = objectOrEmpty(body.userProfile);

    const events = await resolveEventsForAi({
      events: Array.isArray(body.events) ? body.events : null,
      query: objectOrEmpty(body.query),
    });

    const radar = buildUndergroundRadar(events, userProfile, {
      limit: toPositiveInt(body.limit, 20),
      hiddenGemThreshold: toNumberOrNull(body.hiddenGemThreshold),
      trendingThreshold: toNumberOrNull(body.trendingThreshold),
      includeAll: toBool(body.includeAll, false),
      recommendationWeights: objectOrEmpty(body.weights),
    });

    return res.json({
      ok: true,
      thresholds: radar.thresholds,
      defaults: DEFAULT_RADAR_THRESHOLDS,
      count: radar.items.length,
      events: radar.items,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

/**
 * POST /ai/taste-dna
 * Body:
 * - userProfile?: { likedEvents, preferredGenres, lat, lng, maxDistanceKm }
 * - events?: event[]
 * - likedEventKeys?: string[] (ids/sourceIds/urls)
 * - query?: /events-style query used if events omitted
 * - bootstrapFromFeed?: boolean (default false)
 */
app.post("/ai/taste-dna", async (req, res) => {
  try {
    const body = objectOrEmpty(req.body);
    const userProfile = { ...objectOrEmpty(body.userProfile) };
    const likedEventKeys = Array.isArray(body.likedEventKeys)
      ? body.likedEventKeys.map((value) => cleanText(value)).filter(Boolean)
      : [];

    let feedEvents = [];
    if (Array.isArray(body.events) && body.events.length > 0) {
      feedEvents = body.events;
    } else if (likedEventKeys.length > 0 || toBool(body.bootstrapFromFeed, false)) {
      feedEvents = await resolveEventsForAi({ query: objectOrEmpty(body.query) });
    }

    if (
      (!Array.isArray(userProfile.likedEvents) || userProfile.likedEvents.length === 0) &&
      feedEvents.length > 0
    ) {
      if (likedEventKeys.length > 0) {
        const keySet = new Set(likedEventKeys.map((value) => String(value)));
        userProfile.likedEvents = feedEvents.filter((event) => {
          const candidates = [
            cleanText(event?.id),
            cleanText(event?.sourceId),
            cleanText(event?.url),
            cleanText(event?.ticketUrl),
          ].filter(Boolean);
          return candidates.some((candidate) => keySet.has(candidate));
        });
      } else if (toBool(body.bootstrapFromFeed, false)) {
        userProfile.likedEvents = feedEvents.slice(0, 12);
      }
    }

    const dna = buildTasteDNA(userProfile);
    return res.json({ ok: true, ...dna });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

/**
 * POST /ai/success-predictor
 * Body:
 * - draftEvent: event-like object
 * - historicalEvents?: event[] (optional; auto-fetched if omitted)
 * - query?: /events-style query used for auto-history
 */
app.post("/ai/success-predictor", async (req, res) => {
  try {
    const body = objectOrEmpty(req.body);
    const draftEvent = objectOrEmpty(body.draftEvent);
    if (!draftEvent || Object.keys(draftEvent).length === 0) {
      return res.status(400).json({
        ok: false,
        error: "Provide 'draftEvent' in request body.",
      });
    }

    let historicalEvents = Array.isArray(body.historicalEvents)
      ? body.historicalEvents
      : [];

    if (historicalEvents.length === 0) {
      const query = {
        ...objectOrEmpty(body.query),
        classificationName:
          cleanText(body?.query?.classificationName) ||
          cleanText(draftEvent?.genre) ||
          cleanText(draftEvent?.category) ||
          "music",
        maxResults: toPositiveInt(body?.query?.maxResults, 140),
      };

      historicalEvents = await resolveEventsForAi({ query });
    }

    const prediction = predictEventSuccess(draftEvent, historicalEvents);

    return res.json({
      ok: true,
      prediction,
      historyCount: historicalEvents.length,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

// Health
// -----------------------------
app.get("/", (_req, res) => {
  return res.json({
    ok: true,
    service: "eventify-api",
    message: "API is running. Use /health or /events endpoints.",
  });
});

app.get("/health", async (_req, res) => {
  try {
    if (!pool) return res.json({ ok: true, db: "not_configured" });
    await pool.query("SELECT 1");
    return res.json({ ok: true, db: "ok" });
  } catch (err) {
    return res.status(500).json({ ok: false, db: "error", error: String(err) });
  }
});

// -----------------------------
// Copilot (NL prompt -> intent -> events -> ranking)
// -----------------------------

const COPILOT_CITIES = [
  { name: "Brussels", aliases: ["brussel", "bruxelles", "brussels"], lat: 50.8466, lng: 4.3528 },
  { name: "Ixelles", aliases: ["ixelles", "elsene"], lat: 50.8333, lng: 4.3667 },
  { name: "Uccle", aliases: ["uccle", "ukkel"], lat: 50.802, lng: 4.336 },
  { name: "Schaerbeek", aliases: ["schaerbeek", "schaarbeek"], lat: 50.867, lng: 4.375 },
  { name: "Anderlecht", aliases: ["anderlecht"], lat: 50.836, lng: 4.309 },
  { name: "Antwerp", aliases: ["antwerp", "antwerpen"], lat: 51.2194, lng: 4.4025 },
  { name: "Ghent", aliases: ["ghent", "gent"], lat: 51.0543, lng: 3.7174 },
  { name: "Leuven", aliases: ["leuven", "louvain"], lat: 50.8798, lng: 4.7005 },
  { name: "Liège", aliases: ["liège", "liege", "luik"], lat: 50.6326, lng: 5.5797 },
  { name: "Namur", aliases: ["namur", "namen"], lat: 50.4669, lng: 4.8675 },
  { name: "Charleroi", aliases: ["charleroi"], lat: 50.4108, lng: 4.4446 },
  { name: "Mons", aliases: ["mons", "bergen"], lat: 50.4542, lng: 3.9567 },
  { name: "Bruges", aliases: ["bruges", "brugge"], lat: 51.2093, lng: 3.2247 },
  { name: "Mechelen", aliases: ["mechelen", "malines"], lat: 51.0257, lng: 4.4776 },
  { name: "Hasselt", aliases: ["hasselt"], lat: 50.9307, lng: 5.3325 },
  { name: "Halle", aliases: ["halle"], lat: 50.7333, lng: 4.234 },
  { name: "Lessines", aliases: ["lessines", "leuze", "7860"], lat: 50.712, lng: 3.836 },
  { name: "Tournai", aliases: ["tournai", "doornik"], lat: 50.605, lng: 3.389 },
];
const COPILOT_STYLE_PATTERNS = [
  { style: "Drum & Bass", patterns: ["drum and bass", "drum & bass", "drum n bass", "dnb"] },
  { style: "Hip-Hop", patterns: ["hip hop", "hip-hop", "rap", "trap", "drill"] },
  { style: "R&B", patterns: ["r&b", "rnb", "neo soul"] },
  { style: "Techno", patterns: ["techno", "hard techno", "acid techno"] },
  { style: "House", patterns: ["house", "deep house", "tech house", "afro house"] },
  { style: "Jazz", patterns: ["jazz", "swing", "bebop"] },
  { style: "Metal", patterns: ["metal", "metalcore", "thrash"] },
  { style: "Rock", patterns: ["rock", "punk", "grunge"] },
  { style: "Indie", patterns: ["indie", "alternative", "shoegaze"] },
  { style: "Pop", patterns: ["pop", "mainstream", "top 40"] },
  { style: "Electronic", patterns: ["electronic", "edm", "electro", "electronica"] },
];
const COPILOT_ALLOWED_STYLES = COPILOT_STYLE_PATTERNS.map((item) => item.style);
const COPILOT_WEEKDAY_TO_DOW = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};
const COPILOT_MONTH_NAME_TO_INDEX = Object.freeze({
  jan: 0,
  january: 0,
  januari: 0,
  janvier: 0,
  feb: 1,
  february: 1,
  februari: 1,
  fevrier: 1,
  mar: 2,
  march: 2,
  maart: 2,
  mars: 2,
  apr: 3,
  april: 3,
  avril: 3,
  may: 4,
  mei: 4,
  mai: 4,
  jun: 5,
  june: 5,
  juni: 5,
  juin: 5,
  jul: 6,
  july: 6,
  juli: 6,
  juillet: 6,
  aug: 7,
  august: 7,
  augustus: 7,
  aout: 7,
  sep: 8,
  sept: 8,
  september: 8,
  septembre: 8,
  oct: 9,
  october: 9,
  oktober: 9,
  octobre: 9,
  nov: 10,
  november: 10,
  novembre: 10,
  dec: 11,
  december: 11,
  decembre: 11,
});
const COPILOT_NEXT_WEEK_PHRASES = ["volgende week", "next week", "semaine prochaine"];
const COPILOT_MONTH_NAME_REGEX = Object.keys(COPILOT_MONTH_NAME_TO_INDEX)
  .sort((a, b) => b.length - a.length)
  .join("|");
const COPILOT_LLM_DATE_HINTS = [
  "none",
  "today",
  "tomorrow",
  "this weekend",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];
const COPILOT_FETCH_RADIUS_KM = 200;
const COPILOT_FETCH_SIZE = 120;
const COPILOT_HARD_DISTANCE_CAP_KM = 450;
const CHATBOT_QUERY_STOPWORDS = new Set([
  "de",
  "het",
  "een",
  "en",
  "of",
  "voor",
  "met",
  "zonder",
  "naar",
  "rond",
  "van",
  "in",
  "op",
  "te",
  "bij",
  "ik",
  "wij",
  "we",
  "you",
  "your",
  "for",
  "from",
  "with",
  "without",
  "dans",
  "avec",
  "sans",
  "pour",
  "sur",
  "max",
  "maximum",
  "km",
  "vriend",
  "vrienden",
  "friend",
  "friends",
  "budget",
  "cheap",
  "goedkoop",
  "duur",
  "expensive",
  "city",
  "stad",
  "ville",
  "today",
  "tomorrow",
  "vandaag",
  "morgen",
  "demain",
  "weekend",
  "this",
  "dit",
  "ce",
  "friday",
  "saturday",
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "vrijdag",
  "zaterdag",
  "zondag",
  "maandag",
  "dinsdag",
  "woensdag",
  "donderdag",
]);
for (const budgetKeyword of ["cheap", "goedkoop", "budget", "duur", "expensive"]) {
  CHATBOT_QUERY_STOPWORDS.delete(budgetKeyword);
}
const COPILOT_CHEAP_BUDGET_HINTS = [
  "cheap",
  "budget",
  "budget friendly",
  "low budget",
  "affordable",
  "inexpensive",
  "not too expensive",
  "not expensive",
  "goedkoop",
  "goedkope",
  "goedkoopste",
  "betaalbaar",
  "voordelig",
  "budgetvriendelijk",
  "niet te duur",
  "niet duur",
  "niet te prijzig",
  "laag budget",
  "studentenbudget",
  "pas cher",
  "bon marche",
  "abordable",
  "petit budget",
  "pas trop cher",
];

function copilotNormalize(s) {
  return String(s || "").trim().toLowerCase();
}

function containsCheapBudgetHint(value) {
  const normalized = normalizeCityText(value);
  if (!normalized) return false;
  return COPILOT_CHEAP_BUDGET_HINTS.some((token) => normalized.includes(token));
}

function toRouteSafeId(value) {
  const safe = String(value || "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
  return safe || "event";
}

function hashText(input) {
  let h = 0;
  const s = String(input || "");
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function buildEventKeyFromApiEvent(apiEvent, rank) {
  const source = String(apiEvent?.source || "remote").toLowerCase();
  const rawSourceId = String(apiEvent?.sourceId || apiEvent?.title || `evt_${rank}`);
  const stableHash = hashText(rawSourceId).toString(36);
  const sourceId = `${toRouteSafeId(rawSourceId)}_${stableHash}`;
  return `${source}:${sourceId}`; // must match frontend id logic
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const r = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return r * c;
}

function collectStylesFromText(text) {
  const normalized = copilotNormalize(text);
  if (!normalized) return [];

  const styles = [];
  for (const rule of COPILOT_STYLE_PATTERNS) {
    if (rule.patterns.some((pattern) => normalized.includes(pattern))) {
      styles.push(rule.style);
    }
  }
  return styles;
}

function normalizeCopilotStyle(rawStyle) {
  const normalized = copilotNormalize(rawStyle)
    .replace(/[^a-z0-9&+\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized || normalized.length < 2) return null;

  for (const rule of COPILOT_STYLE_PATTERNS) {
    if (normalized === copilotNormalize(rule.style)) return rule.style;
    if (
      rule.patterns.some(
        (pattern) => normalized.includes(pattern) || (normalized.length >= 4 && pattern.includes(normalized))
      )
    ) {
      return rule.style;
    }
  }
  return null;
}

function inferStyle(text) {
  const styles = collectStylesFromText(text);
  return styles[0] || "Electronic";
}

function parseMaxKm(message) {
  const m = copilotNormalize(message);
  const r1 = m.match(/max(?:imum)?\s*(\d{1,3})\s*km/);
  if (r1 && r1[1]) return Math.max(1, Math.min(200, Number(r1[1]) || 0));
  const r2 = m.match(/(\d{1,3})\s*km/);
  if (r2 && r2[1]) return Math.max(1, Math.min(200, Number(r2[1]) || 0));
  return null;
}

function parseFriendCount(message) {
  const m = copilotNormalize(message);
  const r1 = m.match(/(\d+)\s*(vriend|vrienden|friends)/);
  if (r1 && r1[1]) return Math.max(0, Math.min(20, Number(r1[1]) || 0));
  const r2 = m.match(/we\s*zijn\s*met\s*(\d+)/);
  if (r2 && r2[1]) return Math.max(1, Math.min(20, Number(r2[1]) || 0)) - 1;
  return null;
}

function parseBudget(message) {
  const raw = String(message || "").toLowerCase();
  const normalized = normalizeCityText(raw);
  if (!normalized) return null;

  const parseAmount = (raw) => {
    const n = Number(String(raw || "").replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.min(5000, Math.round(n));
  };

  const amountPatterns = [
    /(?:€|eur|euro)\s*(\d{1,4}(?:[.,]\d{1,2})?)/i,
    /(\d{1,4}(?:[.,]\d{1,2})?)\s*(?:€|eur|euro)\b/i,
    /\bbudget(?:\s*(?:is|=|:))?\s*(?:van\s*)?(?:€\s*)?(\d{1,4}(?:[.,]\d{1,2})?)\b/i,
    /\b(?:max(?:imum)?\s*(?:prijs|price|budget)|prijs\s*max|price\s*max)\s*(?:€\s*)?(\d{1,4}(?:[.,]\d{1,2})?)\b/i,
  ];

  for (const pattern of amountPatterns) {
    const match = raw.match(pattern) || normalized.match(pattern);
    const parsed = parseAmount(match?.[1]);
    if (parsed != null) return parsed;
  }

  if (containsCheapBudgetHint(normalized)) return "cheap";
  return null;
}

function parseRequestedStyles(message) {
  return collectStylesFromText(message);
}

function normalizeCityText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findCity(message) {
  const normalizedMessage = normalizeCityText(message);
  if (!normalizedMessage) return null;

  let best = null;
  let bestAliasLen = 0;

  for (const city of COPILOT_CITIES) {
    const variants = [city.name, ...(Array.isArray(city.aliases) ? city.aliases : [])];
    for (const variant of variants) {
      const alias = normalizeCityText(variant);
      if (!alias) continue;

      const regex = new RegExp(`(^|\\s)${escapeRegex(alias)}(?=\\s|$)`);
      if (!regex.test(normalizedMessage)) continue;

      if (alias.length > bestAliasLen) {
        best = city;
        bestAliasLen = alias.length;
      }
    }
  }

  return best;
}

function extractChatbotQueryTokens(message, city) {
  const normalized = normalizeCityText(message);
  if (!normalized) return [];

  const cityTerms = new Set();
  if (city) {
    const variants = [city.name, ...(Array.isArray(city.aliases) ? city.aliases : [])];
    for (const variant of variants) {
      const cityTokenized = normalizeCityText(variant)
        .split(" ")
        .filter(Boolean);
      for (const token of cityTokenized) cityTerms.add(token);
    }
  }

  const rawTokens = normalized
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);

  const deduped = [];
  const seen = new Set();

  for (const token of rawTokens) {
    if (token.length < 3) continue;
    if (/^\d+$/.test(token)) continue;
    if (CHATBOT_QUERY_STOPWORDS.has(token)) continue;
    if (cityTerms.has(token)) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    deduped.push(token);
  }

  return deduped.slice(0, 10);
}

function scoreChatbotTokenMatch(eventText, queryTokens) {
  const normalizedText = normalizeCityText(eventText);
  const tokens = Array.isArray(queryTokens) ? queryTokens : [];
  if (!normalizedText || tokens.length === 0) {
    return { matchedCount: 0, score: 0 };
  }

  const textParts = normalizedText.split(" ").filter(Boolean);
  const textSet = new Set(textParts);

  let matchedCount = 0;
  let score = 0;

  for (const token of tokens) {
    if (!token) continue;

    let matched = false;
    if (textSet.has(token) || normalizedText.includes(token)) {
      matched = true;
    } else if (token.length >= 5) {
      for (const part of textParts) {
        if (part.length < 5) continue;
        if (part.includes(token) || token.includes(part)) {
          matched = true;
          break;
        }
      }
    }

    if (matched) {
      matchedCount += 1;
      if (token.length >= 7) score += 2.6;
      else if (token.length >= 5) score += 2.1;
      else score += 1.4;
    }
  }

  if (matchedCount > 0) score += matchedCount * 1.5;

  return { matchedCount, score: Number(score.toFixed(2)) };
}

function resolveCityFromHint(value) {
  const hint = cleanText(value);
  if (!hint) return null;
  const normalized = copilotNormalize(hint);

  for (const city of COPILOT_CITIES) {
    if (copilotNormalize(city.name) === normalized) return city;
    if (city.aliases.some((alias) => copilotNormalize(alias) === normalized)) return city;
  }

  return findCity(hint);
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function nextWeekdayRange(now, targetDow) {
  const from = new Date(now);
  const dow = from.getDay(); // 0..6
  let delta = (targetDow - dow + 7) % 7;
  // if same day and it's already late, jump to next week
  if (delta === 0) delta = 0;
  const day = new Date(from);
  day.setDate(day.getDate() + delta);
  return { from: startOfDay(day), to: endOfDay(day), label: day.toDateString() };
}

function nextWeekdayRangeWithWeekOffset(now, targetDow, weekOffset = 0) {
  const safeWeekOffset = Number.isFinite(weekOffset) ? Math.max(0, Math.round(weekOffset)) : 0;
  const from = new Date(now);
  const dow = from.getDay(); // 0..6
  let delta = (targetDow - dow + 7) % 7;
  delta += safeWeekOffset * 7;
  const day = new Date(from);
  day.setDate(day.getDate() + delta);
  return { from: startOfDay(day), to: endOfDay(day), label: day.toDateString() };
}

function buildDateRangeFromParts({ now, day, monthIndex, year = null, label }) {
  const safeDay = Number(day);
  const safeMonth = Number(monthIndex);
  if (!Number.isInteger(safeDay) || safeDay < 1 || safeDay > 31) return null;
  if (!Number.isInteger(safeMonth) || safeMonth < 0 || safeMonth > 11) return null;

  const baseNow = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  let safeYear =
    Number.isInteger(year) && year >= 1970 && year <= 2200 ? year : baseNow.getFullYear();

  const mk = (targetYear) => {
    const d = new Date(targetYear, safeMonth, safeDay);
    if (
      d.getFullYear() !== targetYear ||
      d.getMonth() !== safeMonth ||
      d.getDate() !== safeDay
    ) {
      return null;
    }
    return d;
  };

  let candidate = mk(safeYear);
  if (!candidate) return null;

  if (year == null && endOfDay(candidate).getTime() < startOfDay(baseNow).getTime()) {
    safeYear += 1;
    candidate = mk(safeYear);
    if (!candidate) return null;
  }

  const fallbackLabel = `${String(safeDay).padStart(2, "0")}-${String(safeMonth + 1).padStart(
    2,
    "0"
  )}-${safeYear}`;
  return {
    from: startOfDay(candidate),
    to: endOfDay(candidate),
    label: label || fallbackLabel,
  };
}

function parseExplicitDateRange(message, now) {
  const normalized = normalizeCityText(message);
  if (!normalized) return null;

  const slashMatch = normalized.match(/\b(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?\b/);
  if (slashMatch) {
    const day = Number(slashMatch[1]);
    const month = Number(slashMatch[2]);
    let year = slashMatch[3] ? Number(slashMatch[3]) : null;
    if (year != null && year < 100) year += 2000;
    return buildDateRangeFromParts({
      now,
      day,
      monthIndex: month - 1,
      year: Number.isInteger(year) ? year : null,
      label: `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}`,
    });
  }

  const dayMonthRegex = new RegExp(
    `\\b(\\d{1,2})\\s+(${COPILOT_MONTH_NAME_REGEX})(?:\\s+(\\d{2,4}))?\\b`
  );
  const dayMonth = normalized.match(dayMonthRegex);
  if (dayMonth) {
    const day = Number(dayMonth[1]);
    const monthName = dayMonth[2];
    const monthIndex = COPILOT_MONTH_NAME_TO_INDEX[monthName];
    let year = dayMonth[3] ? Number(dayMonth[3]) : null;
    if (year != null && year < 100) year += 2000;
    return buildDateRangeFromParts({
      now,
      day,
      monthIndex,
      year: Number.isInteger(year) ? year : null,
      label: `${String(day).padStart(2, "0")} ${monthName}`,
    });
  }

  const monthDayRegex = new RegExp(
    `\\b(${COPILOT_MONTH_NAME_REGEX})\\s+(\\d{1,2})(?:\\s+(\\d{2,4}))?\\b`
  );
  const monthDay = normalized.match(monthDayRegex);
  if (monthDay) {
    const monthName = monthDay[1];
    const monthIndex = COPILOT_MONTH_NAME_TO_INDEX[monthName];
    const day = Number(monthDay[2]);
    let year = monthDay[3] ? Number(monthDay[3]) : null;
    if (year != null && year < 100) year += 2000;
    return buildDateRangeFromParts({
      now,
      day,
      monthIndex,
      year: Number.isInteger(year) ? year : null,
      label: `${String(day).padStart(2, "0")} ${monthName}`,
    });
  }

  return null;
}

function parseDateRange(message, clientNowIso) {
  const m = copilotNormalize(message);
  const normalized = normalizeCityText(message);
  const now = clientNowIso ? new Date(clientNowIso) : new Date();
  const explicitDate = parseExplicitDateRange(message, now);
  if (explicitDate) return explicitDate;

  if (m.includes("morgen") || m.includes("demain") || m.includes("tomorrow")) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return { from: startOfDay(d), to: endOfDay(d), label: "tomorrow" };
  }

  if (m.includes("vandaag") || m.includes("aujourd") || m.includes("today") || m.includes("vanavond")) {
    return { from: startOfDay(now), to: endOfDay(now), label: "today" };
  }

  if (m.includes("dit weekend") || m.includes("ce week-end") || m.includes("this weekend") || m.includes("weekend")) {
    const d = new Date(now);
    const dow = d.getDay();
    const deltaToSat = (6 - dow + 7) % 7; // Saturday = 6
    const sat = new Date(d);
    sat.setDate(sat.getDate() + deltaToSat);
    const sun = new Date(sat);
    sun.setDate(sun.getDate() + 1);
    return { from: startOfDay(sat), to: endOfDay(sun), label: "this weekend" };
  }

  // NL/EN/FR days
  const days = [
    { keys: ["zondag", "sunday", "dimanche"], dow: 0 },
    { keys: ["maandag", "monday", "lundi"], dow: 1 },
    { keys: ["dinsdag", "tuesday", "mardi"], dow: 2 },
    { keys: ["woensdag", "wednesday", "mercredi"], dow: 3 },
    { keys: ["donderdag", "thursday", "jeudi"], dow: 4 },
    { keys: ["vrijdag", "friday", "vendredi"], dow: 5 },
    { keys: ["zaterdag", "saturday", "samedi"], dow: 6 },
  ];

  const asksNextWeek = COPILOT_NEXT_WEEK_PHRASES.some((phrase) => normalized.includes(phrase));
  for (const d of days) {
    if (d.keys.some((k) => m.includes(k))) {
      if (asksNextWeek) {
        return nextWeekdayRangeWithWeekOffset(now, d.dow, 1);
      }
      return nextWeekdayRange(now, d.dow);
    }
  }

  if (asksNextWeek) {
    const currentDow = now.getDay();
    const deltaToNextMonday = ((1 - currentDow + 7) % 7) + 7;
    const nextMonday = new Date(now);
    nextMonday.setDate(nextMonday.getDate() + deltaToNextMonday);
    const nextSunday = new Date(nextMonday);
    nextSunday.setDate(nextSunday.getDate() + 6);
    return { from: startOfDay(nextMonday), to: endOfDay(nextSunday), label: "next week" };
  }

  return null; // no explicit date constraint
}

function parseDateRangeFromHint(dateHint, clientNowIso) {
  const hint = copilotNormalize(dateHint).replace(/[_-]/g, " ");
  if (!hint || ["none", "null", "n/a", "na"].includes(hint)) return null;

  if (hint === "today" || hint === "tonight") {
    return parseDateRange("today", clientNowIso);
  }
  if (hint === "tomorrow") {
    return parseDateRange("tomorrow", clientNowIso);
  }
  if (hint === "this weekend" || hint === "weekend") {
    return parseDateRange("this weekend", clientNowIso);
  }

  if (hint in COPILOT_WEEKDAY_TO_DOW) {
    const maybeNow = clientNowIso ? new Date(clientNowIso) : new Date();
    const now = Number.isNaN(maybeNow.getTime()) ? new Date() : maybeNow;
    return nextWeekdayRange(now, COPILOT_WEEKDAY_TO_DOW[hint]);
  }

  return parseDateRange(hint, clientNowIso);
}

function toClampedInteger(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function coerceCopilotBudget(rawBudget) {
  if (rawBudget == null) return null;

  if (typeof rawBudget === "number") {
    if (!Number.isFinite(rawBudget) || rawBudget <= 0) return null;
    return Math.min(5000, Math.round(rawBudget));
  }

  if (typeof rawBudget === "string") {
    const normalized = copilotNormalize(rawBudget);
    if (!normalized) return null;
    if (containsCheapBudgetHint(normalized) || normalized.includes("low")) return "cheap";
    const numeric = Number(normalized.replace(/[^0-9.]/g, ""));
    if (Number.isFinite(numeric) && numeric > 0) {
      return Math.min(5000, Math.round(numeric));
    }
    return null;
  }

  if (typeof rawBudget === "object") {
    const mode = copilotNormalize(rawBudget.mode || rawBudget.type || "");
    if (["cheap", "budget", "low"].includes(mode)) return "cheap";

    const budgetCandidates = [
      rawBudget.value,
      rawBudget.max,
      rawBudget.maxEur,
      rawBudget.max_eur,
      rawBudget.amount,
    ];

    for (const candidate of budgetCandidates) {
      const parsed = coerceCopilotBudget(candidate);
      if (parsed != null) return parsed;
    }
  }

  return null;
}

function parseJsonObjectLoose(value) {
  if (value == null) return null;
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return null;

  const text = value.trim();
  if (!text) return null;

  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {}

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;

  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {}

  return null;
}

function buildChatbotCacheKey({ message, originLabel, suggestions = [] }) {
  const normalizedMessage = copilotNormalize(message)
    .replace(/\s+/g, " ")
    .slice(0, LLM_CONFIG.maxMessageChars);
  const normalizedOrigin = copilotNormalize(originLabel).slice(0, 80);
  const suggestionKey = (Array.isArray(suggestions) ? suggestions : [])
    .map((entry) => {
      const key = cleanText(entry?.eventKey) || "unknown";
      const price = cleanText(entry?.priceLabel) || "price_unknown";
      const tier = cleanText(entry?.priceTier) || "tier_unknown";
      const confidence = cleanText(entry?.priceConfidence) || "conf_unknown";
      return `${key}:${price}:${tier}:${confidence}`;
    })
    .filter(Boolean)
    .slice(0, 5)
    .join("|")
    .slice(0, 420);
  return `${normalizedMessage}||${normalizedOrigin}||${suggestionKey}`;
}

function getCachedChatbotReply(cacheKey) {
  const key = cleanText(cacheKey);
  if (!key) return null;
  const cached = chatbotReplyCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.cachedAt <= CHATBOT_CONFIG.cacheTtlMs) {
    return {
      answer: cleanText(cached.answer) || null,
      suggestions: Array.isArray(cached.suggestions) ? cached.suggestions.slice(0, 5) : [],
    };
  }
  chatbotReplyCache.delete(key);
  return null;
}

function setCachedChatbotReply(cacheKey, { answer, suggestions = [] }) {
  const key = cleanText(cacheKey);
  const text = cleanText(answer);
  if (!key || !text) return;
  chatbotReplyCache.set(key, {
    cachedAt: Date.now(),
    answer: text.slice(0, CHATBOT_CONFIG.maxReplyChars),
    suggestions: Array.isArray(suggestions) ? suggestions.slice(0, 5) : [],
  });
}

function formatFallbackBudgetLabel(value) {
  if (value === "cheap") return "budgetvriendelijk";
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return `max €${Math.round(value)}`;
  }
  return "budget flexibel";
}

function buildChatbotFallbackReply({ message, originLabel, suggestions = [] }) {
  const normalized = copilotNormalize(message);
  const city = findCity(message);
  const dateRange = parseDateRange(message);
  const styles = parseRequestedStyles(message);
  const budget = parseBudget(message);
  const maxKm = parseMaxKm(message);
  const place = city?.name || cleanText(originLabel) || "je locatie";
  const list = Array.isArray(suggestions) ? suggestions.slice(0, 5) : [];
  if (list.length > 0) {
    const lines = [`Top ideeën rond ${place}:`];
    for (let i = 0; i < list.length; i += 1) {
      const item = list[i];
      let price = cleanText(item?.priceLabel);
      if (!price || price.toLowerCase() === "price unknown") {
        const computed = cleanText(formatPriceLabel(item || {}));
        if (computed && computed.toLowerCase() !== "price unknown") {
          price = computed;
        } else if (item?.isFree === true) {
          price = "Free";
        }
      }
      const city = cleanText(item?.city);
      lines.push(
        `${i + 1}. ${item.title}${city ? ` (${city})` : ""}${price ? ` - ${price}` : ""}`
      );
    }
    return lines.join("\n");
  }

  const hasConstraints =
    city != null ||
    dateRange != null ||
    styles.length > 0 ||
    budget != null ||
    typeof maxKm === "number";
  if (hasConstraints) {
    const styleLabel = styles.length > 0 ? styles.slice(0, 2).join(" / ") : "open vibe";
    const dayLabel = cleanText(dateRange?.label) || "komende dagen";
    const kmLabel =
      typeof maxKm === "number" && Number.isFinite(maxKm) && maxKm > 0
        ? `binnen ${Math.round(maxKm)}km`
        : "radius flexibel";
    const budgetLabel = formatFallbackBudgetLabel(budget);
    return (
      `Ik vind nu geen sterke live matches rond ${place} (${dayLabel}).\n` +
      "Snelle alternatieve ideeën:\n" +
      `1. Clubnacht met ${styleLabel}\n` +
      `2. Mid-size concertzaal ${kmLabel}\n` +
      `3. Late set met ${budgetLabel}\n` +
      `Filters gebruikt: ${dayLabel} • ${styleLabel} • ${kmLabel} • ${budgetLabel}.`
    );
  }

  if (containsCheapBudgetHint(normalized)) {
    return (
      `Snelle budget-ideeën rond ${place}:\n` +
      "1. Kleine venue clubnacht met early tickets\n" +
      "2. Lokale live showcase met support acts\n" +
      "3. Late DJ set in alternatieve bar\n" +
      "Tip: geef dag + max km voor scherpere picks."
    );
  }

  return (
    `Snelle ideeën rond ${place}:\n` +
    "1. Clubnacht met elektronische line-up\n" +
    "2. Live concert in middelgrote venue\n" +
    "3. Late set met dansbare vibe\n" +
    "Zeg erbij: dag, stijl, max km en budget."
  );
}

function trimChatbotReply(value) {
  const text = cleanText(value);
  if (!text) return null;
  return text.slice(0, CHATBOT_CONFIG.maxReplyChars);
}

function eventMatchesStyleFast(event, styles) {
  const list = Array.isArray(styles) ? styles : [];
  if (list.length === 0) return true;
  const tags = Array.isArray(event?.tags) ? event.tags : [];
  return tags.some((tag) => list.includes(tag));
}

function eventWithinDistanceFast(event, maxKm) {
  if (typeof maxKm !== "number" || !Number.isFinite(maxKm) || maxKm <= 0) return true;
  if (event?.distanceKm == null) return true;
  return event.distanceKm <= maxKm;
}

function getComparablePriceForBudget(event) {
  const minPrice = toNumberOrNull(event?.priceMin);
  const maxPrice = toNumberOrNull(event?.priceMax);
  const singleCost = toNumberOrNull(event?.cost);
  if (minPrice != null) return minPrice;
  if (singleCost != null) return singleCost;
  if (maxPrice != null) return maxPrice;
  return null;
}

function computeFastChatbotBudgetSignals(event, budget) {
  const noBudget = budget == null || budget === "";
  if (noBudget) {
    return {
      budgetScore: 0,
      budgetPreferred: false,
      budgetWithin: null,
      budgetUnknown: false,
      budgetTooExpensive: false,
    };
  }

  const tier = cleanText(event?.priceTier);
  const isFree = event?.isFree === true;
  const hasPrice = event?.hasAnyPrice === true;
  const comparable = getComparablePriceForBudget(event);

  if (budget === "cheap") {
    if (!hasPrice) {
      return {
        budgetScore: -0.6,
        budgetPreferred: false,
        budgetWithin: null,
        budgetUnknown: true,
        budgetTooExpensive: false,
      };
    }

    if (isFree || tier === "free") {
      return {
        budgetScore: 3.2,
        budgetPreferred: true,
        budgetWithin: true,
        budgetUnknown: false,
        budgetTooExpensive: false,
      };
    }

    if (tier === "low") {
      return {
        budgetScore: 2.6,
        budgetPreferred: true,
        budgetWithin: true,
        budgetUnknown: false,
        budgetTooExpensive: false,
      };
    }

    if (tier === "mid") {
      return {
        budgetScore: 1.1,
        budgetPreferred: true,
        budgetWithin: true,
        budgetUnknown: false,
        budgetTooExpensive: false,
      };
    }

    if (tier === "high" || tier === "premium") {
      return {
        budgetScore: -2.9,
        budgetPreferred: false,
        budgetWithin: false,
        budgetUnknown: false,
        budgetTooExpensive: true,
      };
    }

    if (comparable != null) {
      const cheapComparable = comparable <= PRICE_TIER_THRESHOLDS.mid;
      return {
        budgetScore: cheapComparable ? 1.1 : -2.4,
        budgetPreferred: cheapComparable,
        budgetWithin: cheapComparable,
        budgetUnknown: false,
        budgetTooExpensive: !cheapComparable,
      };
    }

    return {
      budgetScore: -0.6,
      budgetPreferred: false,
      budgetWithin: null,
      budgetUnknown: true,
      budgetTooExpensive: false,
    };
  }

  if (typeof budget === "number" && Number.isFinite(budget) && budget > 0) {
    if (isFree) {
      return {
        budgetScore: 3.3,
        budgetPreferred: true,
        budgetWithin: true,
        budgetUnknown: false,
        budgetTooExpensive: false,
      };
    }
    if (comparable == null) {
      return {
        budgetScore: -0.4,
        budgetPreferred: false,
        budgetWithin: null,
        budgetUnknown: true,
        budgetTooExpensive: false,
      };
    }

    if (comparable <= budget) {
      const closeness = clamp01(1 - comparable / Math.max(1, budget));
      return {
        budgetScore: 1.7 + closeness * 1.8,
        budgetPreferred: true,
        budgetWithin: true,
        budgetUnknown: false,
        budgetTooExpensive: false,
      };
    }

    const overshoot = Math.min(2.2, (comparable - budget) / Math.max(1, budget));
    return {
      budgetScore: -2.1 - overshoot * 2.2,
      budgetPreferred: false,
      budgetWithin: false,
      budgetUnknown: false,
      budgetTooExpensive: true,
    };
  }

  return {
    budgetScore: 0,
    budgetPreferred: false,
    budgetWithin: null,
    budgetUnknown: false,
    budgetTooExpensive: false,
  };
}

function scoreFastChatbotSuggestion(event, budget) {
  let score = 0;
  const keywordScore = Number(event?.keywordScore) || 0;
  const keywordMatchCount = Number(event?.keywordMatchCount) || 0;
  if (keywordScore > 0) score += keywordScore * 20;
  if (keywordMatchCount >= 2) score += 16;

  const distance = typeof event?.distanceKm === "number" ? event.distanceKm : null;
  if (distance != null) {
    score += Math.max(0, 120 - distance);
  }
  const start = event?.startDate;
  if (start && !Number.isNaN(start.getTime())) {
    const now = Date.now();
    const diffHours = (start.getTime() - now) / (1000 * 60 * 60);
    if (diffHours >= -4) score += Math.max(0, 48 - Math.min(48, diffHours));
  }
  if (event?.isFree === true) score += 4;
  if (event?.hasAnyPrice === true) score += 2;
  const budgetSignals = computeFastChatbotBudgetSignals(event, budget);
  score += budgetSignals.budgetScore * 14;
  return score;
}

async function buildFastChatbotSuggestions({
  message,
  originLat,
  originLng,
  originLabel,
  clientNowIso,
  limit = 3,
} = {}) {
  const safeMessage = safeText(message, "").trim();
  const safeOriginLabel = cleanText(originLabel) || "your location";
  const city = findCity(safeMessage);
  const styles = parseRequestedStyles(safeMessage);
  const queryTokens = extractChatbotQueryTokens(safeMessage, city);
  const dateRange = parseDateRange(safeMessage, clientNowIso);
  const budget = parseBudget(safeMessage);
  const maxKm = parseMaxKm(safeMessage) ?? 45;
  const maxResults = Math.max(1, Math.min(3, limit));

  const fallbackLat = Number.isFinite(originLat) ? originLat : 50.8503;
  const fallbackLng = Number.isFinite(originLng) ? originLng : 4.3517;
  const centerLat = city ? city.lat : fallbackLat;
  const centerLng = city ? city.lng : fallbackLng;
  const fetchRadius = Math.max(10, Math.min(120, maxKm + 20));
  const fetchSize = Math.max(20, Math.min(80, maxResults * 16));

  let feedEvents = [];
  const keyword = [...styles, ...queryTokens].slice(0, 5).join(" ");
  const feedQueryBase = {
    lat: centerLat,
    lng: centerLng,
    radiusKm: fetchRadius,
    classificationName: "music",
    size: fetchSize,
    maxResults: fetchSize,
    includeScraped: 1,
    includeSetlists: 0,
  };
  const buildSuggestionReasons = (entry) => {
    const reasons = [];
    if (typeof entry?.distanceKm === "number") reasons.push(`~${Math.round(entry.distanceKm)}km away`);
    const priceText = cleanText(entry?.priceLabel) || formatPriceLabel(entry || {});
    const tierText = cleanText(entry?.priceTier);
    if (priceText) reasons.push(`Price: ${priceText}${tierText ? ` (${tierText})` : ""}`);
    if (city?.name) reasons.push(`City: ${city.name}`);
    return reasons;
  };

  try {
    feedEvents = await resolveEventsForAi({
      query: {
        ...feedQueryBase,
        keyword,
      },
    });
  } catch {
    feedEvents = [];
  }

  if (feedEvents.length === 0 && keyword) {
    try {
      feedEvents = await resolveEventsForAi({
        query: {
          ...feedQueryBase,
          keyword: "",
        },
      });
    } catch {
      feedEvents = [];
    }
  }

  if (budget != null) {
    try {
      const budgetPoolSize = Math.max(fetchSize, 60);
      const budgetPoolEvents = await resolveEventsForAi({
        query: {
          ...feedQueryBase,
          keyword: "",
          size: budgetPoolSize,
          maxResults: budgetPoolSize,
        },
      });
      if (Array.isArray(budgetPoolEvents) && budgetPoolEvents.length > 0) {
        feedEvents = dedupe([...(Array.isArray(feedEvents) ? feedEvents : []), ...budgetPoolEvents]);
      }
    } catch {
      // Keep primary feed when budget pool fetch fails.
    }
  }

  const candidates = (Array.isArray(feedEvents) ? feedEvents : []).map((e, idx) => {
    const eventKey = buildEventKeyFromApiEvent(e, idx);
    const lat = toNumberOrNull(e.lat);
    const lng = toNumberOrNull(e.lng);
    const distanceKm =
      lat != null && lng != null ? haversineKm(centerLat, centerLng, lat, lng) : null;
    const normalizedTags = Array.isArray(e.tags)
      ? e.tags.map((tag) => normalizeCopilotStyle(tag)).filter(Boolean)
      : [];
    const inferredStyle = inferStyle(`${e.title || ""} ${e.artistName || ""} ${e.genre || ""}`);
    const tags = Array.from(new Set([...(normalizedTags || []), ...(inferredStyle ? [inferredStyle] : [])]));
    const lexicalText = [
      e.title,
      e.artistName,
      e.genre,
      e.venue,
      e.city,
      ...(Array.isArray(e.tags) ? e.tags : []),
    ]
      .filter(Boolean)
      .join(" ");
    const keywordMatch = scoreChatbotTokenMatch(lexicalText, queryTokens);
    const priceInfo = normalizeEventPrice(e);
    const priceTier = cleanText(e.priceTier) || computePriceTier(priceInfo);
    const priceLabel = cleanText(e.priceLabel) || formatPriceLabel(priceInfo);
    const priceConfidence = cleanText(e.priceConfidence) || resolvePriceConfidence(e, priceInfo);
    const budgetSignals = computeFastChatbotBudgetSignals(
      {
        ...e,
        ...priceInfo,
        hasAnyPrice: priceInfo.hasAnyPrice,
        priceTier,
      },
      budget
    );
    const startIso = e.start ? String(e.start) : null;
    const startDate = startIso ? new Date(startIso) : null;

    return {
      eventKey,
      title: e.title || "Untitled event",
      startIso,
      startDate,
      venue: e.venue || null,
      city: e.city || null,
      distanceKm,
      tags,
      cost: priceInfo.cost,
      priceMin: priceInfo.priceMin,
      priceMax: priceInfo.priceMax,
      currency: priceInfo.currency,
      isFree: priceInfo.isFree,
      hasAnyPrice: priceInfo.hasAnyPrice,
      budgetScore: budgetSignals.budgetScore,
      budgetPreferred: budgetSignals.budgetPreferred,
      budgetWithin: budgetSignals.budgetWithin,
      budgetUnknown: budgetSignals.budgetUnknown,
      budgetTooExpensive: budgetSignals.budgetTooExpensive,
      keywordMatchCount: keywordMatch.matchedCount,
      keywordScore: keywordMatch.score,
      priceTier,
      priceLabel,
      priceConfidence,
      source: cleanText(e.source) || null,
      sourceId: cleanText(e.sourceId) || null,
      metadata: e.metadata && typeof e.metadata === "object" ? e.metadata : null,
      ticketUrl: cleanText(e.ticketUrl || e.url),
      url: cleanText(e.url || e.ticketUrl),
      imageUrl: e.imageUrl || null,
      reasons: buildSuggestionReasons({ distanceKm, priceLabel, priceTier }),
    };
  });

  if (candidates.length === 0) return [];

  let filtered = candidates.filter((entry) => eventWithinDistanceFast(entry, maxKm));
  if (filtered.length === 0) filtered = candidates.slice();
  let budgetFallbackPool = filtered.slice();

  if (dateRange) {
    const dateFiltered = filtered.filter((entry) => isDateInRange(entry.startDate, dateRange));
    if (dateFiltered.length > 0) {
      filtered = dateFiltered;
      budgetFallbackPool = dateFiltered.slice();
    }
  }

  if (styles.length > 0) {
    const styleFiltered = filtered.filter((entry) => eventMatchesStyleFast(entry, styles));
    if (styleFiltered.length > 0) filtered = styleFiltered;
  }

  if (budget === "cheap") {
    const cheapPreferred = filtered.filter((entry) => entry?.budgetPreferred === true);
    if (cheapPreferred.length > 0) {
      filtered = cheapPreferred;
    } else {
      const cheapFallback = budgetFallbackPool.filter((entry) => entry?.budgetPreferred === true);
      if (cheapFallback.length > 0) filtered = cheapFallback;
    }
  } else if (typeof budget === "number" && Number.isFinite(budget) && budget > 0) {
    const numericWithin = filtered.filter((entry) => entry?.budgetWithin === true);
    if (numericWithin.length > 0) {
      filtered = numericWithin;
    } else {
      const numericFallback = budgetFallbackPool.filter((entry) => entry?.budgetWithin === true);
      if (numericFallback.length > 0) filtered = numericFallback;
    }
  }

  const postConstraintPool = filtered.slice();

  if (queryTokens.length > 0) {
    const strongKeywordFiltered = filtered.filter((entry) => (entry.keywordMatchCount || 0) >= 2);
    if (strongKeywordFiltered.length >= maxResults) {
      filtered = strongKeywordFiltered;
    } else {
      const weakKeywordFiltered = filtered.filter((entry) => (entry.keywordMatchCount || 0) >= 1);
      if (weakKeywordFiltered.length > 0) filtered = weakKeywordFiltered;
    }
  }

  const sortByScore = (a, b) => {
    const scoreDiff = scoreFastChatbotSuggestion(b, budget) - scoreFastChatbotSuggestion(a, budget);
    if (scoreDiff !== 0) return scoreDiff;
    const ad = typeof a.distanceKm === "number" ? a.distanceKm : 1e9;
    const bd = typeof b.distanceKm === "number" ? b.distanceKm : 1e9;
    if (ad !== bd) return ad - bd;
    const at = a.startDate && !Number.isNaN(a.startDate.getTime()) ? a.startDate.getTime() : Number.MAX_SAFE_INTEGER;
    const bt = b.startDate && !Number.isNaN(b.startDate.getTime()) ? b.startDate.getTime() : Number.MAX_SAFE_INTEGER;
    return at - bt;
  };
  filtered.sort(sortByScore);

  const fallbackPoolForFill =
    budget != null && budgetFallbackPool.length > postConstraintPool.length
      ? budgetFallbackPool
      : postConstraintPool;
  if (filtered.length < maxResults && fallbackPoolForFill.length > filtered.length) {
    const seen = new Set(filtered.map((entry) => entry.eventKey));
    const extras = fallbackPoolForFill
      .filter((entry) => !seen.has(entry.eventKey))
      .sort(sortByScore)
      .slice(0, maxResults - filtered.length);
    filtered = [...filtered, ...extras];
  }

  let selected = filtered.slice(0, maxResults);
  if (selected.some((entry) => !entry?.hasAnyPrice)) {
    try {
      const enriched = await enrichMissingPrices(selected);
      selected = (Array.isArray(enriched?.events) ? enriched.events : selected).map((entry) => {
        const priceInfo = normalizeEventPrice(entry);
        const nextPriceTier = cleanText(entry?.priceTier) || computePriceTier(priceInfo);
        const nextPriceLabel = cleanText(entry?.priceLabel) || formatPriceLabel(priceInfo);
        const nextPriceConfidence =
          cleanText(entry?.priceConfidence) || resolvePriceConfidence(entry, priceInfo);
        return {
          ...entry,
          cost: priceInfo.cost,
          priceMin: priceInfo.priceMin,
          priceMax: priceInfo.priceMax,
          currency: priceInfo.currency,
          isFree: priceInfo.isFree,
          hasAnyPrice: priceInfo.hasAnyPrice,
          priceTier: nextPriceTier,
          priceLabel: nextPriceLabel,
          priceConfidence: nextPriceConfidence,
          reasons: buildSuggestionReasons({
            ...entry,
            priceTier: nextPriceTier,
            priceLabel: nextPriceLabel,
          }),
        };
      });
    } catch {
      // Keep original suggestions when targeted enrich fails.
    }
  }

  return selected.map((entry) => mapCopilotSuggestion(entry));
}

async function buildFastLlmChatbotPayload({
  message,
  originLabel,
  clientNowIso,
  suggestions = [],
}) {
  const safeMessage = String(message || "").slice(0, LLM_CONFIG.maxMessageChars).trim();
  if (!safeMessage) {
    return {
      answer: "Beschrijf kort je plan: dag, stad, vibe, max km en budget.",
      meta: { strategy: "empty_message", model: LLM_CONFIG.model, cached: false },
    };
  }

  if (!LLM_CONFIG.enabled || !LLM_CONFIG.model) {
    return {
      answer: buildChatbotFallbackReply({ message: safeMessage, originLabel, suggestions }),
      meta: { strategy: "fallback_no_llm", model: LLM_CONFIG.model || null, cached: false },
    };
  }

  const safeOrigin = cleanText(originLabel) || "user location";
  const groundedSuggestions = Array.isArray(suggestions) ? suggestions.slice(0, 5) : [];
  const groundedBlock =
    groundedSuggestions.length > 0
      ? groundedSuggestions
          .map((entry, index) => {
            const bits = [
              `title=${entry.title}`,
              `city=${entry.city || "unknown"}`,
              `venue=${entry.venue || "unknown"}`,
              `date=${entry.startIso || "unknown"}`,
              `distanceKm=${
                typeof entry.distanceKm === "number" ? Math.round(entry.distanceKm * 10) / 10 : "unknown"
              }`,
              `price=${entry.priceLabel || "unknown"}`,
              `eventKey=${entry.eventKey || "unknown"}`,
              `ticketUrl=${entry.ticketUrl || "unknown"}`,
            ];
            return `${index + 1}. ${bits.join("; ")}`;
          })
          .join("\n")
      : "No grounded events available.";

  const systemPrompt = [
    "You are Eventify's live events chatbot assistant.",
    "Always answer in the user's language (Dutch, French or English).",
    "Do not start with acknowledgements like 'Oké ik snap je'.",
    "Immediately provide concrete ideas in a compact numbered list with at most 5 items.",
    "If a grounded events list is provided, only mention event names from that list.",
    "Keep answers concise and practical (max 8 short lines).",
    "If constraints are missing, state one short assumption line.",
  ].join(" ");

  const prompt = [
    `User request: ${safeMessage}`,
    `Origin label: ${safeOrigin}`,
    `Client timestamp ISO: ${clientNowIso || new Date().toISOString()}`,
    "Grounded events:",
    groundedBlock,
    "Output style: short, direct ideas + one assumption line when needed.",
  ].join("\n");

  try {
    let content = null;
    if (LLM_CONFIG.provider === "openai") {
      if (!LLM_CONFIG.apiKey) throw new Error("Missing LLM_API_KEY for OpenAI provider");
      const { data } = await axios.post(
        `${LLM_CONFIG.baseUrl}/chat/completions`,
        {
          model: LLM_CONFIG.model,
          temperature: 0.2,
          top_p: 0.9,
          max_tokens: 180,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt },
          ],
        },
        {
          timeout: CHATBOT_CONFIG.timeoutMs,
          headers: {
            Authorization: `Bearer ${LLM_CONFIG.apiKey}`,
            "Content-Type": "application/json",
          },
        }
      );
      content = trimChatbotReply(data?.choices?.[0]?.message?.content);
    } else if (LLM_CONFIG.provider === "ollama") {
      const { data } = await axios.post(
        `${LLM_CONFIG.baseUrl}/api/generate`,
        {
          model: LLM_CONFIG.model,
          stream: false,
          system: systemPrompt,
          prompt,
          options: {
            temperature: 0.2,
            top_p: 0.9,
            num_predict: 180,
          },
        },
        {
          timeout: CHATBOT_CONFIG.timeoutMs,
        }
      );
      content = trimChatbotReply(data?.response);
    } else {
      throw new Error(`Unsupported LLM_PROVIDER: ${LLM_CONFIG.provider}`);
    }

    if (!content) {
      return {
        answer: buildChatbotFallbackReply({ message: safeMessage, originLabel, suggestions }),
        meta: { strategy: "llm_generate_empty", model: LLM_CONFIG.model, cached: false },
      };
    }

    return {
      answer: content,
      meta: { strategy: "llm_generate", model: LLM_CONFIG.model, cached: false },
    };
  } catch (err) {
    const detail = cleanText(
      err?.response?.data?.error?.message ||
        err?.response?.data?.error ||
        err?.message ||
        err?.code ||
        "llm generate failed"
    );
    return {
      answer: buildChatbotFallbackReply({ message: safeMessage, originLabel, suggestions }),
      meta: {
        strategy: "fallback_llm_error",
        model: LLM_CONFIG.model,
        cached: false,
        error: detail ? detail.slice(0, 180) : "unknown",
      },
    };
  }
}

async function buildFastChatbotResponse({
  message,
  originLat,
  originLng,
  originLabel,
  clientNowIso,
} = {}) {
  const suggestions = await buildFastChatbotSuggestions({
    message,
    originLat,
    originLng,
    originLabel,
    clientNowIso,
    limit: 3,
  });

  const cacheKey = buildChatbotCacheKey({ message, originLabel, suggestions });
  const cached = getCachedChatbotReply(cacheKey);
  if (cached?.answer) {
    return {
      answer: cached.answer,
      suggestions: Array.isArray(cached.suggestions) ? cached.suggestions : suggestions,
      meta: { strategy: "llm_generate_cache", model: LLM_CONFIG.model, cached: true },
    };
  }

  const generated = await buildFastLlmChatbotPayload({
    message,
    originLabel,
    clientNowIso,
    suggestions,
  });

  const answer = trimChatbotReply(generated.answer) || buildChatbotFallbackReply({
    message,
    originLabel,
    suggestions,
  });
  setCachedChatbotReply(cacheKey, { answer, suggestions });

  return {
    answer,
    suggestions,
    meta: generated.meta,
  };
}

function sanitizeLlmCopilotIntent(rawIntent, { clientNowIso } = {}) {
  const raw = parseJsonObjectLoose(rawIntent);
  if (!raw) return null;

  const city = resolveCityFromHint(raw.city || raw.cityName || raw.location || raw.place);

  const styleCandidates = [];
  if (Array.isArray(raw.styles)) styleCandidates.push(...raw.styles);
  if (Array.isArray(raw.genres)) styleCandidates.push(...raw.genres);
  if (Array.isArray(raw.vibes)) styleCandidates.push(...raw.vibes);
  for (const single of [raw.style, raw.genre, raw.vibe]) {
    if (single != null) styleCandidates.push(single);
  }

  const styleSet = new Set();
  for (const style of styleCandidates) {
    const normalizedStyle = normalizeCopilotStyle(style);
    if (normalizedStyle) styleSet.add(normalizedStyle);
  }
  const styles = [...styleSet].slice(0, 4);

  let maxKm = null;
  for (const candidate of [raw.maxKm, raw.max_km, raw.radiusKm, raw.radius_km]) {
    const parsed = toClampedInteger(candidate, 1, 200);
    if (parsed != null) {
      maxKm = parsed;
      break;
    }
  }

  const budget = coerceCopilotBudget(
    raw.budget ?? raw.maxBudget ?? raw.budgetEur ?? raw.budget_eur ?? raw.priceLimit
  );

  let friendCount = null;
  for (const candidate of [raw.friendCount, raw.friend_count, raw.friends, raw.groupSize]) {
    const parsed = toClampedInteger(candidate, 0, 20);
    if (parsed != null) {
      friendCount = parsed;
      break;
    }
  }

  const modeRaw = copilotNormalize(raw.mode || raw.intentMode || "");
  const mode = modeRaw === "plan" || modeRaw === "normal" ? modeRaw : null;

  const dateHint = cleanText(raw.dateHint || raw.when || raw.date || raw.day || raw.timeHint);
  const dateRange = parseDateRangeFromHint(dateHint || "", clientNowIso);

  return {
    city,
    styles,
    maxKm,
    budget,
    friendCount,
    mode,
    dateHint: dateHint || null,
    dateRange,
  };
}

async function extractCopilotIntentWithLlm({ message, clientNowIso }) {
  if (!LLM_CONFIG.enabled || !LLM_CONFIG.model) {
    return { intent: null, meta: { used: false, strategy: "disabled", model: null } };
  }

  const safeMessage = String(message || "").slice(0, LLM_CONFIG.maxMessageChars).trim();
  if (!safeMessage) {
    return {
      intent: null,
      meta: { used: false, strategy: "empty_message", model: LLM_CONFIG.model },
    };
  }

  const systemPrompt = [
    "You extract search intent for a music event recommendation assistant.",
    "Reply with one JSON object only. Do not include markdown.",
    "If unsure, use null or empty arrays.",
    `Cities should be one of: ${COPILOT_CITIES.map((city) => city.name).join(", ")}.`,
    `Styles should be chosen from: ${COPILOT_ALLOWED_STYLES.join(", ")}.`,
    `dateHint must be one of: ${COPILOT_LLM_DATE_HINTS.join(", ")}.`,
    "Schema:",
    '{"city": string|null, "styles": string[], "maxKm": number|null, "budget": number|"cheap"|null, "friendCount": number|null, "mode": "normal"|"plan"|null, "dateHint": string|null}',
  ].join(" ");

  const userPrompt = [
    `Message: "${safeMessage}"`,
    `Client time (ISO): ${clientNowIso || new Date().toISOString()}`,
  ].join("\n");

  try {
    let content = null;
    if (LLM_CONFIG.provider === "openai") {
      if (!LLM_CONFIG.apiKey) throw new Error("Missing LLM_API_KEY for OpenAI provider");
      const { data } = await axios.post(
        `${LLM_CONFIG.baseUrl}/chat/completions`,
        {
          model: LLM_CONFIG.model,
          temperature: 0.1,
          top_p: 0.9,
          max_tokens: 220,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        },
        {
          timeout: LLM_CONFIG.timeoutMs,
          headers: {
            Authorization: `Bearer ${LLM_CONFIG.apiKey}`,
            "Content-Type": "application/json",
          },
        }
      );
      content = data?.choices?.[0]?.message?.content;
    } else if (LLM_CONFIG.provider === "ollama") {
      const { data } = await axios.post(
        `${LLM_CONFIG.baseUrl}/api/chat`,
        {
          model: LLM_CONFIG.model,
          stream: false,
          format: "json",
          options: {
            temperature: 0.1,
            top_p: 0.9,
            num_predict: 220,
          },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        },
        {
          timeout: LLM_CONFIG.timeoutMs,
        }
      );
      content = data?.message?.content;
    } else {
      throw new Error(`Unsupported LLM_PROVIDER: ${LLM_CONFIG.provider}`);
    }

    const sanitized = sanitizeLlmCopilotIntent(content, { clientNowIso });
    if (!sanitized) {
      return {
        intent: null,
        meta: { used: false, strategy: "llm_invalid_json", model: LLM_CONFIG.model },
      };
    }

    return {
      intent: sanitized,
      meta: { used: true, strategy: "llm", model: LLM_CONFIG.model },
    };
  } catch (err) {
    const detail = String(
      err?.response?.data?.error?.message ||
        err?.response?.data?.error ||
        err?.message ||
        err?.code ||
        "llm request failed"
    ).slice(0, 180);
    return {
      intent: null,
      meta: {
        used: false,
        strategy: "llm_error",
        model: LLM_CONFIG.model,
        error: detail,
      },
    };
  }
}

async function resolveCopilotIntent({ message, clientNowIso, modeRaw }) {
  const normalizedMessage = copilotNormalize(message);
  const explicitCityFromMessage = findCity(message);
  const heuristicBudget = parseBudget(message);
  const hasDistanceHint = /\b(max(?:imum)?\s*\d{1,3}\s*km|\d{1,3}\s*km|radius)\b/.test(
    normalizedMessage
  );
  const hasBudgetHint = heuristicBudget != null || containsCheapBudgetHint(normalizedMessage);
  const hasFriendHint = /\b(\d+\s*(vriend|vrienden|friends)|we\s*zijn\s*met\s*\d+)\b/.test(
    normalizedMessage
  );
  const hasPlanHint = /\b(plan voor ons|plan for us|group plan)\b/.test(normalizedMessage);

  const heuristicMode =
    normalizedMessage.includes("plan voor ons") ||
    normalizedMessage.includes("plan for us") ||
    copilotNormalize(modeRaw) === "plan"
      ? "plan"
      : "normal";

  const heuristic = {
    city: findCity(message),
    styles: parseRequestedStyles(message),
    maxKm: parseMaxKm(message),
    budget: heuristicBudget,
    friendCount: parseFriendCount(message),
    dateRange: parseDateRange(message, clientNowIso),
    mode: heuristicMode,
  };

  const llmResult = await extractCopilotIntentWithLlm({ message, clientNowIso });
  const llm = llmResult.intent;

  const mode =
    heuristic.mode === "plan"
      ? "plan"
      : hasPlanHint && llm?.mode === "plan"
      ? "plan"
      : "normal";

  return {
    // User-mentioned city in the message always wins over origin/filter context.
    city: explicitCityFromMessage || llm?.city || heuristic.city,
    styles: llm?.styles?.length ? llm.styles : heuristic.styles,
    maxKm: heuristic.maxKm ?? (hasDistanceHint ? llm?.maxKm : null) ?? 30,
    budget: heuristic.budget ?? (hasBudgetHint ? llm?.budget : null),
    friendCount: heuristic.friendCount ?? (hasFriendHint ? llm?.friendCount : null),
    dateRange: llm?.dateRange || heuristic.dateRange,
    mode,
    parser: llm ? "llm+heuristic" : "heuristic",
    parserMeta: llmResult.meta,
  };
}

function clamp01(x) {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

async function getTrendingCountsOptional(eventKeys) {
  if (!pool || !eventKeys || eventKeys.length === 0) return new Map();
  const db = pool;
  const r = await db.query(
    `
    SELECT event_key, COUNT(*)::int AS c
    FROM event_attendance
    WHERE is_going = TRUE AND event_key = ANY($1::text[])
    GROUP BY event_key
    `,
    [eventKeys]
  );
  const map = new Map();
  for (const row of r.rows) map.set(String(row.event_key), Number(row.c) || 0);
  return map;
}

async function getFriendsGoingCountsOptional(userId, eventKeys) {
  if (!pool || !userId || !eventKeys || eventKeys.length === 0) return new Map();
  const db = pool;
  const r = await db.query(
    `
    SELECT a.event_key, COUNT(*)::int AS c
    FROM user_friends f
    JOIN event_attendance a
      ON a.user_id = f.friend_user_id
     AND a.is_going = TRUE
     AND a.event_key = ANY($2::text[])
    WHERE f.user_id = $1
    GROUP BY a.event_key
    `,
    [userId, eventKeys]
  );
  const map = new Map();
  for (const row of r.rows) map.set(String(row.event_key), Number(row.c) || 0);
  return map;
}

function isDateInRange(startDate, dateRange) {
  if (!dateRange) return true;
  if (!startDate || Number.isNaN(startDate.getTime())) return true;
  return startDate >= dateRange.from && startDate <= dateRange.to;
}

function scoreCopilotCandidates(
  candidates,
  { styles, maxKm, dateRange, budget, trendingMap, friendsMap, relaxed = false }
) {
  const list = Array.isArray(candidates) ? candidates : [];
  const styleList = Array.isArray(styles) ? styles : [];
  const trend = trendingMap instanceof Map ? trendingMap : new Map();
  const friends = friendsMap instanceof Map ? friendsMap : new Map();

  const scored = list.map((c) => {
    const reasons = [];

    // Vibe score
    let vibeScore = 0;
    if (styleList.length > 0) {
      const matches = (Array.isArray(c.tags) ? c.tags : []).filter((t) =>
        styleList.includes(t)
      );
      if (matches.length > 0) {
        vibeScore = matches.length * (relaxed ? 2.4 : 3);
        reasons.push(`Vibe: ${matches.join(", ")}`);
      } else if (relaxed) {
        vibeScore = 0.6;
        reasons.push("Dicht bij je vibe (alternatief)");
      }
    } else {
      vibeScore = 1;
      if (c.tags?.[0]) reasons.push(`Vibe: ${c.tags[0]}`);
    }

    // Distance score
    let distScore = 0;
    if (typeof c.distanceKm === "number") {
      const ratio = clamp01(1 - c.distanceKm / Math.max(1, maxKm));
      distScore = ratio * 4;
      reasons.push(`~${Math.round(c.distanceKm)}km away (max ${maxKm}km)`);
    }

    // Popularity
    const goingCount = trend.get(c.eventKey) || 0;
    const trendScore = Math.min(6, Math.log2(goingCount + 1) * 2);
    if (goingCount > 0) reasons.push(`Trending: ${goingCount} going`);

    // Friends
    const friendsGoing = friends.get(c.eventKey) || 0;
    const friendsScore = Math.min(6, friendsGoing * 3);
    if (friendsGoing > 0) reasons.push(`${friendsGoing} friend(s) going`);

    // Date fit
    let dateScore = 0;
    if (dateRange && c.startDate && !Number.isNaN(c.startDate.getTime())) {
      const fits = isDateInRange(c.startDate, dateRange);
      if (fits) {
        dateScore = relaxed ? 1.1 : 1.5;
        reasons.push(`Past: ${dateRange.label}`);
      } else if (relaxed) {
        dateScore = 0.35;
        reasons.push("Andere datum dan gevraagd");
      }
    }

    // Price + budget
    let priceScore = 0;
    const minPrice = toNumberOrNull(c.priceMin);
    const maxPrice = toNumberOrNull(c.priceMax);
    const ticketCost = toNumberOrNull(c.cost);
    const hasPrice = minPrice != null || maxPrice != null || ticketCost != null || c.isFree === true;
    const minComparable =
      minPrice != null ? minPrice : ticketCost != null ? ticketCost : maxPrice;
    const priceLabel = cleanText(c.priceLabel) || formatPriceLabel(c);
    const priceTier = cleanText(c.priceTier);

    if (typeof budget === "number" && Number.isFinite(budget) && budget > 0) {
      if (!hasPrice) {
        reasons.push("Price unknown");
      } else if (c.isFree === true) {
        priceScore += 2.4;
        reasons.push(`Price: ${priceLabel} (under €${Math.round(budget)})`);
      } else if (minComparable != null && minComparable <= budget) {
        const closeness = clamp01(1 - minComparable / Math.max(1, budget));
        priceScore += 1.2 + closeness * 1.6;
        reasons.push(`Price: ${priceLabel} (under €${Math.round(budget)})`);
      } else if (minComparable != null && minComparable > budget) {
        const overshoot = Math.min(2, (minComparable - budget) / Math.max(1, budget));
        priceScore -= 1.1 + overshoot * 1.8;
        reasons.push(`Above budget (€${Math.round(budget)})`);
      }
    } else if (budget === "cheap") {
      if (!hasPrice) {
        reasons.push("Price unknown");
      } else {
        if (priceTier === "free" || priceTier === "low") {
          priceScore += 1.8;
        } else if (priceTier === "mid") {
          priceScore += 0.9;
        } else if (priceTier === "high" || priceTier === "premium") {
          priceScore -= 1.4;
        }
        reasons.push(`Price: ${priceLabel}${priceTier ? ` (${priceTier})` : ""}`);
      }
    } else if (hasPrice) {
      reasons.push(`Price: ${priceLabel}${priceTier ? ` (${priceTier})` : ""}`);
    }

    const total =
      vibeScore * 2.2 +
      distScore * 1.6 +
      trendScore * 1.2 +
      friendsScore * 1.4 +
      dateScore * 1.1 +
      priceScore * 1.5;

    return {
      ...c,
      goingCount,
      friendsGoing,
      score: total,
      reasons: reasons.slice(0, 4),
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

function mapCopilotSuggestion(scoredItem) {
  return {
    eventKey: scoredItem.eventKey,
    title: scoredItem.title,
    startIso: scoredItem.startIso,
    venue: scoredItem.venue,
    city: scoredItem.city,
    distanceKm:
      typeof scoredItem.distanceKm === "number"
        ? Math.round(scoredItem.distanceKm * 10) / 10
        : null,
    reasons: scoredItem.reasons,
    imageUrl: scoredItem.imageUrl || null,
    tags: Array.isArray(scoredItem.tags) ? scoredItem.tags : [],
    cost: toNumberOrNull(scoredItem.cost),
    priceMin: toNumberOrNull(scoredItem.priceMin),
    priceMax: toNumberOrNull(scoredItem.priceMax),
    currency: normalizeCurrencyCode(scoredItem.currency),
    isFree: scoredItem.isFree === true,
    priceTier: scoredItem.priceTier || null,
    priceLabel: scoredItem.priceLabel || null,
    priceConfidence: scoredItem.priceConfidence || "unknown",
    ticketUrl:
      cleanText(
        scoredItem.ticketUrl ||
          scoredItem.url ||
          scoredItem.raw?.ticketUrl ||
          scoredItem.raw?.url
      ) || null,
  };
}

function buildCopilotAnswer({ suggestions, city, originLabel, relaxedFallback }) {
  const place = city ? city.name : originLabel;
  const top = Array.isArray(suggestions) ? suggestions.slice(0, 3) : [];

  if (top.length === 0) {
    return (
      `Ik vind nu geen sterke ideeën rond ${place} met deze filters.\n` +
      "Probeer zonder vaste datum of met iets grotere radius."
    );
  }

  const lines = [];
  lines.push(
    relaxedFallback
      ? `Geen exacte matches gevonden, maar dit zijn goede alternatieve ideeën rond ${place}:`
      : `Top ideeën rond ${place}:`
  );

  for (let i = 0; i < top.length; i += 1) {
    const item = top[i];
    const reason = Array.isArray(item.reasons) && item.reasons[0] ? ` - ${item.reasons[0]}` : "";
    lines.push(`${i + 1}. ${item.title}${reason}`);
  }

  return lines.join("\n");
}

app.post("/chatbot", authOptional, async (req, res) => {
  try {
    const message = safeText(req.body?.message, "").trim();
    const originLat = Number(req.body?.originLat);
    const originLng = Number(req.body?.originLng);
    const originLabel = safeText(req.body?.originLabel, "your location");
    const clientNowIso = safeText(req.body?.clientNowIso, "");

    if (!message) return res.status(400).json({ ok: false, error: "Missing message" });

    const chatbot = await buildFastChatbotResponse({
      message,
      originLat,
      originLng,
      originLabel,
      clientNowIso,
    });

    return res.json({
      ok: true,
      answer: chatbot.answer,
      suggestions: Array.isArray(chatbot.suggestions) ? chatbot.suggestions : [],
      intentParser: {
        strategy: chatbot.meta?.strategy || "llm_generate",
        model: chatbot.meta?.model || null,
        cached: chatbot.meta?.cached === true,
        error: chatbot.meta?.error || null,
        ollamaOnly: true,
      },
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

app.post("/copilot", authOptional, async (req, res) => {
  try {
    const message = safeText(req.body?.message, "").trim();
    const originLat = Number(req.body?.originLat);
    const originLng = Number(req.body?.originLng);
    const originLabel = safeText(req.body?.originLabel, "your location");
    const clientNowIso = safeText(req.body?.clientNowIso, "");
    const modeRaw = safeText(req.body?.mode, "");
    const friendIds = Array.isArray(req.body?.friendIds) ? req.body.friendIds : [];

    if (!message) return res.status(400).json({ ok: false, error: "Missing message" });
    if (!Number.isFinite(originLat) || !Number.isFinite(originLng)) {
      return res.status(400).json({ ok: false, error: "Invalid originLat/originLng" });
    }

    if (CHATBOT_CONFIG.ollamaOnly) {
      const chatbot = await buildFastChatbotResponse({
        message,
        originLat,
        originLng,
        originLabel,
        clientNowIso,
      });

      return res.json({
        ok: true,
        answer: chatbot.answer,
        suggestions: Array.isArray(chatbot.suggestions) ? chatbot.suggestions : [],
        intentParser: {
          strategy: chatbot.meta?.strategy || "llm_generate",
          model: chatbot.meta?.model || null,
          cached: chatbot.meta?.cached === true,
          error: chatbot.meta?.error || null,
          ollamaOnly: true,
        },
      });
    }

    const copilotIntent = await resolveCopilotIntent({
      message,
      clientNowIso,
      modeRaw,
    });

    const city = copilotIntent.city;
    const styles = copilotIntent.styles; // e.g. ["Techno","House"]
    const maxKm = copilotIntent.maxKm;
    const budget = copilotIntent.budget;
    const friendCount = copilotIntent.friendCount;
    const dateRange = copilotIntent.dateRange;
    const mode = copilotIntent.mode;

    const centerLat = city ? city.lat : originLat;
    const centerLng = city ? city.lng : originLng;
    const distanceReferenceLat = city ? city.lat : originLat;
    const distanceReferenceLng = city ? city.lng : originLng;

    // Fetch broad event feed first (Ticketmaster + scraped), then filter + rank ourselves.
    const feedEvents = await resolveEventsForAi({
      query: {
        keyword: "",
        lat: centerLat,
        lng: centerLng,
        radiusKm: COPILOT_FETCH_RADIUS_KM,
        classificationName: "music",
        size: COPILOT_FETCH_SIZE,
        maxResults: COPILOT_FETCH_SIZE,
        includeScraped: 1,
        includeSetlists: 0,
      },
    });

    let candidates = (feedEvents || []).map((e, idx) => {
      const eventKey = buildEventKeyFromApiEvent(e, idx);

      const lat = toNumberOrNull(e.lat);
      const lng = toNumberOrNull(e.lng);

      const distanceKm =
        lat != null && lng != null
          ? haversineKm(distanceReferenceLat, distanceReferenceLng, lat, lng)
          : null;

      const inferredStyle = inferStyle(`${e.title || ""} ${e.artistName || ""} ${e.genre || ""}`);
      const normalizedTags = Array.isArray(e.tags)
        ? e.tags
            .map((tag) => normalizeCopilotStyle(tag))
            .filter(Boolean)
        : [];
      const inferredTags = Array.from(
        new Set([...(normalizedTags || []), ...(inferredStyle ? [inferredStyle] : [])])
      );
      const priceInfo = normalizeEventPrice(e);
      const priceTier = cleanText(e.priceTier) || computePriceTier(priceInfo);
      const priceLabel = cleanText(e.priceLabel) || formatPriceLabel(priceInfo);
      const priceConfidence = cleanText(e.priceConfidence) || resolvePriceConfidence(e, priceInfo);
      const priceSource =
        cleanText(e.priceSource || e.metadata?.priceSource) ||
        (priceInfo.hasAnyPrice ? "api" : "unknown");

      const startIso = e.start ? String(e.start) : null;
      const startDate = startIso ? new Date(startIso) : null;

      return {
        eventKey,
        title: e.title || "Untitled event",
        startIso,
        startDate,
        venue: e.venue || null,
        city: e.city || null,
        lat,
        lng,
        url: e.url || null,
        imageUrl: e.imageUrl || null,
        tags: inferredTags,
        distanceKm,
        cost: priceInfo.cost,
        priceMin: priceInfo.priceMin,
        priceMax: priceInfo.priceMax,
        currency: priceInfo.currency,
        isFree: priceInfo.isFree,
        priceTier,
        priceLabel,
        priceConfidence,
        priceSource,
        raw: e,
      };
    });
    // Admin moderation: remove disabled events from copilot suggestions
    const disabledKeysForCopilot = await getDisabledEventKeysOptional();
    if (disabledKeysForCopilot.size > 0) {
      candidates = candidates.filter((c) => !disabledKeysForCopilot.has(c.eventKey));
    }

    // Remove weird distances up front (for both strict + fallback suggestion flows)
    candidates = candidates.filter(
      (c) => c.distanceKm == null || c.distanceKm <= COPILOT_HARD_DISTANCE_CAP_KM
    );
    const broadCandidates = candidates.slice();

    // Filter by date if user asked (Friday / weekend / tomorrow / ...)
    if (dateRange) {
      candidates = candidates.filter((c) => {
        if (!c.startDate || Number.isNaN(c.startDate.getTime())) return true;
        return c.startDate >= dateRange.from && c.startDate <= dateRange.to;
      });
    }

    // Filter vibe if user asked specific styles
    if (styles.length > 0) {
      candidates = candidates.filter((c) => c.tags.some((t) => styles.includes(t)));
    }

    const withinMaxKm = (entry) =>
      entry && (entry.distanceKm == null || entry.distanceKm <= Math.max(1, maxKm));
    const distanceLimitedCandidates = candidates.filter(withinMaxKm);
    const broadDistanceLimitedCandidates = broadCandidates.filter(withinMaxKm);

    const eventKeys = broadCandidates.map((c) => c.eventKey);

    const me = req.auth?.sub ? Number(req.auth.sub) : null;

    const trendingMap = await getTrendingCountsOptional(eventKeys);
    const friendsMap = await getFriendsGoingCountsOptional(me, eventKeys);

    const strictScored = scoreCopilotCandidates(distanceLimitedCandidates, {
      styles,
      maxKm,
      dateRange,
      budget,
      trendingMap,
      friendsMap,
      relaxed: false,
    });

    let relaxedFallback = false;
    let suggestions = strictScored.slice(0, 5).map((s) => mapCopilotSuggestion(s));

    // If strict constraints return nothing, still provide practical alternatives.
    if (suggestions.length === 0 && broadDistanceLimitedCandidates.length > 0) {
      const relaxedScored = scoreCopilotCandidates(broadDistanceLimitedCandidates, {
        styles,
        maxKm,
        dateRange,
        budget,
        trendingMap,
        friendsMap,
        relaxed: true,
      });
      suggestions = relaxedScored.slice(0, 5).map((s) => mapCopilotSuggestion(s));
      relaxedFallback = suggestions.length > 0;
    }

    const answer = buildCopilotAnswer({
      suggestions,
      city,
      originLabel,
      relaxedFallback,
    });

    // MVP plan-mode: just pick first as "best match" for now (fairness comes later)
    const bestMatchEventKey = mode === "plan" && suggestions.length ? suggestions[0].eventKey : null;

    const shareText =
      suggestions.length > 0
        ? `Vrij om mee te gaan? Ik vond "${suggestions[0].title}" (${suggestions[0].city || ""}). Link: /events/${encodeURIComponent(
            suggestions[0].eventKey
          )}`
        : `Vrij om mee te gaan? Ik zoek iets in ${city ? city.name : originLabel}.`;

    return res.json({
      ok: true,
      intent: {
        city: city ? city.name : null,
        styles,
        maxKm,
        budget,
        friendCount,
        mode,
        friendIdsCount: friendIds.length,
        dateRange: dateRange ? { from: dateRange.from, to: dateRange.to, label: dateRange.label } : null,
      },
      intentParser: {
        strategy: copilotIntent.parser,
        model: copilotIntent.parserMeta?.model || null,
        error: copilotIntent.parserMeta?.error || null,
        relaxedFallback,
      },
      answer,
      suggestions,
      bestMatchEventKey,
      shareText,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

async function startApiServer() {
  try {
    await ensureApiBootstrap();
  } catch (err) {
    console.error(
      `Failed to ensure database schema compatibility: ${String(err?.message || err)}`
    );
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`API running on http://localhost:${PORT}`);
    console.log(
      `Scraper: ${
        SCRAPE_CONFIG.enabled ? "enabled" : "disabled"
      }, sources=${SCRAPE_CONFIG.sourceUrls.length}, countryFilters=${SCRAPE_CONFIG.allowedCountries.length}, cityFilters=${SCRAPE_CONFIG.allowedCities.length}`
    );
    console.log(
      `Scrape cache: ttl=${SCRAPE_CACHE_CONFIG.ttlMs}ms, wait=${SCRAPE_CACHE_CONFIG.requestWaitMs}ms`
    );
    console.log(
      `Chatbot mode: ${
        CHATBOT_CONFIG.ollamaOnly
          ? `fast-only (/chatbot, timeout=${CHATBOT_CONFIG.timeoutMs}ms, cacheTtl=${CHATBOT_CONFIG.cacheTtlMs}ms)`
          : "copilot ranking + optional llm intent"
      }`
    );
    console.log(
      `Copilot intent parser: ${
        LLM_CONFIG.enabled
          ? `heuristic + ${LLM_CONFIG.provider} (${LLM_CONFIG.model} @ ${LLM_CONFIG.baseUrl})`
          : "heuristic only (set LLM_ENABLED=true and configure provider)"
      }`
    );
    console.log(
      `Price enrich: ${
        PRICE_ENRICH_CONFIG.enabled
          ? `enabled (max=${PRICE_ENRICH_CONFIG.maxPerRequest}, tmMax=${PRICE_ENRICH_CONFIG.ticketmasterMaxPerRequest}, concurrency=${PRICE_ENRICH_CONFIG.concurrency}, timeout=${PRICE_ENRICH_CONFIG.timeoutMs}ms, ttl=${PRICE_ENRICH_CONFIG.cacheTtlMs}ms, bg=${PRICE_ENRICH_CONFIG.backgroundEnabled ? `on/${PRICE_ENRICH_CONFIG.backgroundDelayMs}ms` : "off"}, tmProxy=${PRICE_ENRICH_CONFIG.ticketmasterProxyBaseUrl ? "on" : "off"})`
          : "disabled"
      }`
    );

    if (SCRAPE_CONFIG.enabled && SCRAPE_CONFIG.sourceUrls.length > 0) {
      startScrapeRefresh()
        .then((events) => {
          console.log(`Scrape cache warmed with ${events.length} events`);
        })
        .catch((err) => {
          console.warn(`Scrape cache warm-up failed: ${String(err?.message || err)}`);
        });
    }
  });
}

if (require.main === module) {
  startApiServer();
}

module.exports = {
  app,
  ensureApiBootstrap,
  startApiServer,
};
