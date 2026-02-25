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
app.use(cors());
app.use(express.json());

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

function parseDelimitedList(rawValue) {
  if (!rawValue) return [];
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const JWT_SECRET = (process.env.JWT_SECRET || "dev_change_me").trim();
const JWT_EXPIRES_IN = (process.env.JWT_EXPIRES_IN || "7d").trim();

function parseDbSsl(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "require";
}

const DATABASE_URL = (process.env.DATABASE_URL || "").trim();
const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl: parseDbSsl(process.env.DATABASE_SSL) ? { rejectUnauthorized: false } : false,
    })
  : null;

if (!DATABASE_URL) {
  console.warn(
    "⚠️  DATABASE_URL is not set. Auth + admin endpoints will not work until you configure it."
  );
}

if (!process.env.JWT_SECRET) {
  console.warn(
    "⚠️  JWT_SECRET is not set. Using a default dev secret. Set JWT_SECRET in .env for real usage."
  );
}

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

function safeText(v, fallback = "") {
  return typeof v === "string" ? v : fallback;
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
    expiresIn: JWT_EXPIRES_IN,
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
    const payload = jwt.verify(token, JWT_SECRET);
    req.auth = payload;
    return next();
  } catch {
    return res.status(401).json({ ok: false, error: "Invalid or expired token" });
  }
}

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

// -----------------------------
// Auth endpoints
// -----------------------------

/**
 * POST /auth/register
 * body: { name, email, password }
 */
app.post("/auth/register", async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = safeText(req.body?.password, "");
    const name = safeText(req.body?.name, "").trim();

    if (!email) return res.status(400).json({ ok: false, error: "Email is required." });
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ ok: false, error: "Invalid email." });
    }
    if (password.length < 8) {
      return res.status(400).json({ ok: false, error: "Password must be at least 8 characters." });
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
app.post("/auth/login", async (req, res) => {
  try {
    const identifierRaw = safeText(req.body?.emailOrUsername, "") || safeText(req.body?.email, "");
    const identifier = String(identifierRaw || "").trim();
    const password = safeText(req.body?.password, "");

    if (!identifier) return res.status(400).json({ ok: false, error: "Email or username is required." });
    if (!password) return res.status(400).json({ ok: false, error: "Password is required." });

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
    const userId = String(req.params.id || "").trim();
    const role = String(req.body?.role || "").trim();

    if (!userId) return res.status(400).json({ ok: false, error: "Missing user id" });
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
    const userId = String(req.params.id || "").trim();
    const isActive = Boolean(req.body?.isActive);

    if (!userId) return res.status(400).json({ ok: false, error: "Missing user id" });

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
    req.auth = jwt.verify(token, JWT_SECRET);
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
app.post("/friends/requests", authRequired, async (req, res) => {
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
app.post("/friends/requests/:id/accept", authRequired, async (req, res) => {
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

app.post("/friends/requests/:id/decline", authRequired, async (req, res) => {
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
app.delete("/friends/:friendId", authRequired, async (req, res) => {
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
    const eventKey = String(req.params.eventKey || "");
    if (!eventKey) return res.status(400).json({ ok: false, error: "Missing eventKey" });

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

// --- Set going + notify friends (real-time)
app.put("/events/:eventKey/going", authRequired, async (req, res) => {
  try {
    const me = mustInt(req.auth?.sub, "user id");
    const eventKey = String(req.params.eventKey || "");
    const going = Boolean(req.body?.going);
    const eventMeta = req.body?.event && typeof req.body.event === "object" ? req.body.event : null;

    if (!eventKey) return res.status(400).json({ ok: false, error: "Missing eventKey" });

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
app.post("/events/:eventKey/invite", authRequired, async (req, res) => {
  try {
    const me = mustInt(req.auth?.sub, "user id");
    const eventKey = String(req.params.eventKey || "");
    const inviteeId = mustInt(req.body?.inviteeId, "inviteeId");
    const eventMeta = req.body?.event && typeof req.body.event === "object" ? req.body.event : null;

    if (!eventKey) return res.status(400).json({ ok: false, error: "Missing eventKey" });
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

app.post("/invites/:id/respond", authRequired, async (req, res) => {
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

    const payload = jwt.verify(token, JWT_SECRET);
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

function dedupe(events) {
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
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
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

const scrapeCache = {
  events: [],
  fetchedAt: 0,
  inFlight: null,
  lastError: null,
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

async function getScrapedEventsForRequest() {
  if (!SCRAPE_CONFIG.enabled || SCRAPE_CONFIG.sourceUrls.length === 0) {
    return { events: [], cacheMode: "disabled", ageMs: null, timedOut: false };
  }

  if (isScrapeCacheFresh()) {
    return {
      events: scrapeCache.events,
      cacheMode: "fresh",
      ageMs: getScrapeCacheAgeMs(),
      timedOut: false,
      lastError: scrapeCache.lastError,
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
        }, SCRAPE_CACHE_CONFIG.requestWaitMs)
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
      min: 0,
      max: 0,
      cost: 0,
      currency: topLevel.currency || null,
      isFree: true,
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

  const freeHint = normalizeKeyPart(
    [
      cleanText(event?.name),
      cleanText(event?.info),
      cleanText(event?.description),
      cleanText(event?.pleaseNote),
      cleanText(event?.additionalInfo),
    ]
      .filter(Boolean)
      .join(" ")
  );
  const explicitFree = /\b(free (entry|admission|event|concert|show|ticket)|entry free|admission free|gratis (toegang|inkom|concert|event)|gratuit(e)? (entree|acces|concert|evenement)|kostenlos(e)? (eintritt|ticket)|vrije toegang)\b/i.test(
    freeHint || ""
  );
  if (explicitFree) {
    return {
      min: 0,
      max: 0,
      cost: 0,
      currency: nestedCurrency || null,
      isFree: true,
    };
  }

  return {
    min: null,
    max: null,
    cost: null,
    currency: nestedCurrency || null,
    isFree: false,
  };
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
    currency: priceInfo.currency,
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
  return events.map((e) => mapTicketmasterEvent(e, { classificationName }));
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
    return {
      source: "ticketmaster",
      sourceId: String(e.id),
      title: e.name,
      start: e.dates?.start?.dateTime || e.dates?.start?.localDate || null,
      venue: venue?.name || null,
      city: venue?.city?.name || null,
      lat: venue?.location?.latitude ? Number(venue.location.latitude) : null,
      lng: venue?.location?.longitude ? Number(venue.location.longitude) : null,
      url: e.url || null,
      imageUrl: pickTicketmasterImage(e?.images),
      genre,
      artistName: attraction?.name || null,
    };
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

async function resolveEventsForAi({ events, query = {} } = {}) {
  if (Array.isArray(events) && events.length > 0) {
    return dedupe(events).slice(0, 300);
  }

  const safeQuery = objectOrEmpty(query);
  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  const endpoint = `http://127.0.0.1:${port}/events`;

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

  const { data } = await axios.get(endpoint, {
    params,
    timeout: 45000,
  });

  if (!data || data.ok !== true || !Array.isArray(data.events)) {
    throw new Error("Failed to resolve events for AI endpoints.");
  }

  return data.events;
}

// -----------------------------
// Endpoints
// -----------------------------

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
      ? getScrapedEventsForRequest().catch((err) => {
          sourceErrors.push({ source: "webscrape", error: String(err.message || err) });
          return {
            events: [],
            cacheMode: "error",
            ageMs: null,
            timedOut: false,
            lastError: String(err.message || err),
          };
        })
      : Promise.resolve({
          events: [],
          cacheMode: "disabled",
          ageMs: null,
          timedOut: false,
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
        waitMs: SCRAPE_CACHE_CONFIG.requestWaitMs,
      },
      includeSetlists: wantSetlists,
      sourceCounts: summarizeSources(events),
      sourceWarnings: sourceErrors.length > 0 ? sourceErrors : undefined,
      count: events.length,
      events,
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

    return res.json({ ok: true, event });
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

// -----------------------------
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
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
// Health
// -----------------------------
app.get("/health", async (_req, res) => {
  try {
    if (!pool) return res.json({ ok: true, db: "not_configured" });
    await pool.query("SELECT 1");
    return res.json({ ok: true, db: "ok" });
  } catch (err) {
    return res.status(500).json({ ok: false, db: "error", error: String(err) });
  }
});

app.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`));

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

function copilotNormalize(s) {
  return String(s || "").trim().toLowerCase();
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

function inferStyle(text) {
  const t = copilotNormalize(text);
  if (!t) return "Electronic";
  if (t.includes("techno")) return "Techno";
  if (t.includes("house")) return "House";
  if (t.includes("drum") || t.includes("dnb")) return "Drum & Bass";
  if (t.includes("hip hop") || t.includes("hip-hop") || t.includes("rap")) return "Hip-Hop";
  if (t.includes("jazz")) return "Jazz";
  if (t.includes("metal")) return "Metal";
  if (t.includes("rock")) return "Rock";
  if (t.includes("indie")) return "Indie";
  if (t.includes("r&b") || t.includes("rnb")) return "R&B";
  if (t.includes("pop")) return "Pop";
  return "Electronic";
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
  const m = copilotNormalize(message);
  const r = m.match(/(\d{1,4})\s*€|€\s*(\d{1,4})/);
  const n = Number(r?.[1] || r?.[2]);
  if (Number.isFinite(n) && n > 0) return n;
  if (m.includes("niet te duur") || m.includes("pas cher") || m.includes("cheap")) return "cheap";
  return null;
}

function parseRequestedStyles(message) {
  const m = copilotNormalize(message);
  const styles = new Set();

  if (m.includes("techno")) styles.add("Techno");
  if (m.includes("house")) styles.add("House");
  if (m.includes("drum") || m.includes("dnb")) styles.add("Drum & Bass");
  if (m.includes("hip hop") || m.includes("hip-hop") || m.includes("rap")) styles.add("Hip-Hop");
  if (m.includes("jazz")) styles.add("Jazz");
  if (m.includes("metal")) styles.add("Metal");
  if (m.includes("rock")) styles.add("Rock");
  if (m.includes("indie")) styles.add("Indie");
  if (m.includes("r&b") || m.includes("rnb")) styles.add("R&B");
  if (m.includes("pop")) styles.add("Pop");
  if (m.includes("electronic") || m.includes("edm")) styles.add("Electronic");

  return Array.from(styles);
}

function findCity(message) {
  const m = copilotNormalize(message);
  for (const c of COPILOT_CITIES) {
    for (const a of c.aliases) {
      if (m.includes(a)) return c;
    }
  }
  return null;
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

function parseDateRange(message, clientNowIso) {
  const m = copilotNormalize(message);
  const now = clientNowIso ? new Date(clientNowIso) : new Date();

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

  for (const d of days) {
    if (d.keys.some((k) => m.includes(k))) {
      return nextWeekdayRange(now, d.dow);
    }
  }

  return null; // no explicit date constraint
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

    const city = findCity(message);
    const styles = parseRequestedStyles(message); // e.g. ["Techno","House"]
    const maxKm = parseMaxKm(message) ?? 30;
    const budget = parseBudget(message);
    const friendCount = parseFriendCount(message);
    const dateRange = parseDateRange(message, clientNowIso);
    const mode =
      copilotNormalize(message).includes("plan voor ons") ||
      copilotNormalize(message).includes("plan for us") ||
      modeRaw === "plan"
        ? "plan"
        : "normal";

    const centerLat = city ? city.lat : originLat;
    const centerLng = city ? city.lng : originLng;

    // Fetch a bit more, then we filter + rank ourselves.
    const tmEvents = await fetchTicketmaster({
      keyword: "", // keep broad; we do filtering ourselves
      lat: centerLat,
      lng: centerLng,
      radiusKm: maxKm,
      size: 60,
      classificationName: "music",
    });

    let candidates = (tmEvents || []).map((e, idx) => {
      const eventKey = buildEventKeyFromApiEvent(e, idx);

      const lat = typeof e.lat === "number" ? e.lat : null;
      const lng = typeof e.lng === "number" ? e.lng : null;

      const distanceKm =
        lat != null && lng != null ? haversineKm(originLat, originLng, lat, lng) : null;

      const inferredStyle = inferStyle(`${e.title || ""} ${e.artistName || ""} ${e.genre || ""}`);
      const inferredTags = inferredStyle ? [inferredStyle] : [];

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
        raw: e,
      };
    });

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

    // Remove weird distances
    candidates = candidates.filter((c) => c.distanceKm == null || c.distanceKm <= maxKm * 2);

    const eventKeys = candidates.map((c) => c.eventKey);

    const me = req.auth?.sub ? Number(req.auth.sub) : null;

    const trendingMap = await getTrendingCountsOptional(eventKeys);
    const friendsMap = await getFriendsGoingCountsOptional(me, eventKeys);

    // Score + reasons
    const scored = candidates.map((c) => {
      const reasons = [];

      // vibe score
      let vibeScore = 0;
      if (styles.length > 0) {
        const matches = c.tags.filter((t) => styles.includes(t));
        vibeScore = matches.length * 3;
        if (matches.length) reasons.push(`Matches vibe: ${matches.join(", ")}`);
      } else {
        vibeScore = 1;
        if (c.tags[0]) reasons.push(`Vibe: ${c.tags[0]}`);
      }

      // distance score
      let distScore = 0;
      if (typeof c.distanceKm === "number") {
        const ratio = clamp01(1 - c.distanceKm / Math.max(1, maxKm));
        distScore = ratio * 4;
        reasons.push(`~${Math.round(c.distanceKm)}km away (max ${maxKm}km)`);
      }

      // trending
      const goingCount = trendingMap.get(c.eventKey) || 0;
      const trendScore = Math.min(6, Math.log2(goingCount + 1) * 2);
      if (goingCount > 0) reasons.push(`Trending: ${goingCount} going`);

      // friends going
      const friendsGoing = friendsMap.get(c.eventKey) || 0;
      const friendsScore = Math.min(6, friendsGoing * 3);
      if (friendsGoing > 0) reasons.push(`${friendsGoing} friend(s) going`);

      // date hint
      if (dateRange && c.startDate && !Number.isNaN(c.startDate.getTime())) {
        reasons.push(`Fits: ${dateRange.label}`);
      }

      // budget hint (Ticketmaster doesn’t always have price, so keep it a soft reason)
      if (budget === "cheap") reasons.push("Prefer not too expensive (soft match)");

      const total =
        vibeScore * 2.2 +
        distScore * 1.6 +
        trendScore * 1.2 +
        friendsScore * 1.4;

      return {
        ...c,
        goingCount,
        friendsGoing,
        score: total,
        reasons: reasons.slice(0, 4),
      };
    });

    scored.sort((a, b) => b.score - a.score);

    const suggestions = scored.slice(0, 5).map((s) => ({
      eventKey: s.eventKey,
      title: s.title,
      startIso: s.startIso,
      venue: s.venue,
      city: s.city,
      distanceKm: typeof s.distanceKm === "number" ? Math.round(s.distanceKm * 10) / 10 : null,
      reasons: s.reasons,
    }));

    const intentBits = [
      dateRange ? `when: ${dateRange.label}` : null,
      city ? `city: ${city.name}` : null,
      styles.length ? `vibe: ${styles.join("/")}` : null,
      `max ${maxKm}km`,
      budget ? `budget: ${budget === "cheap" ? "not too expensive" : `€${budget}`}` : null,
      typeof friendCount === "number" ? `friends: ${friendCount}` : null,
      mode === "plan" ? `mode: plan` : null,
    ].filter(Boolean);

    const answer =
      `Oké — ik snap je. (${intentBits.join(", ")})\n` +
      `Hier zijn mijn beste matches rond ${city ? city.name : originLabel}.`;

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
      answer,
      suggestions,
      bestMatchEventKey,
      shareText,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});
