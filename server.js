const express = require("express");
const axios = require("axios");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

// -----------------------------
// Config
// -----------------------------
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
  for (const e of events) {
    const day = (e.start || "").slice(0, 10);
    const key = `${e.title}`.toLowerCase().trim() + "|" + day + "|" + (e.city || "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

async function mapSequential(items, fn) {
  const out = [];
  for (const it of items) out.push(await fn(it));
  return out;
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

  return events.map((e) => {
    const venue = e?._embedded?.venues?.[0];
    const attraction = e?._embedded?.attractions?.[0];
    const classification = e?.classifications?.[0];
    const genre =
      classification?.genre?.name ||
      classification?.subGenre?.name ||
      classification?.segment?.name ||
      classificationName ||
      null;

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

app.get("/events", async (req, res) => {
  try {
    const {
      keyword = "",
      lat = "50.8503",
      lng = "4.3517",
      radiusKm = "30",
      classificationName = "music",
      size = "10",
      includeSetlists = "0",
      setlistsPerArtist = "3",
      maxArtists = "5",
    } = req.query;

    const latNum = Number(lat);
    const lngNum = Number(lng);
    const radiusNum = Number(radiusKm);
    const sizeNum = Number(size);

    if (Number.isNaN(latNum) || Number.isNaN(lngNum)) {
      return res.status(400).json({ ok: false, error: "Invalid lat/lng." });
    }
    if (Number.isNaN(radiusNum) || radiusNum <= 0) {
      return res.status(400).json({ ok: false, error: "Invalid radiusKm." });
    }

    const tmEvents = await fetchTicketmaster({
      keyword,
      lat: latNum,
      lng: lngNum,
      radiusKm: radiusNum,
      size: sizeNum,
      classificationName,
    });

    let events = dedupe(tmEvents).slice(0, 30);

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

    return res.json({
      ok: true,
      keyword,
      lat: latNum,
      lng: lngNum,
      radiusKm: radiusNum,
      classificationName,
      includeSetlists: wantSetlists,
      count: events.length,
      events,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

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

// -----------------------------
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