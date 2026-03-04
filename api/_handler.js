const { app, ensureApiBootstrap } = require("../server");

let deploySyncPromise = null;
let deploySyncCompleted = false;

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
  return Math.round(n);
}

function stripApiPrefix(rawUrl) {
  const value = typeof rawUrl === "string" && rawUrl.trim() ? rawUrl : "/";
  const withoutPrefix = value.replace(/^\/api(?=\/|$)/i, "");
  if (!withoutPrefix) return "/";
  return withoutPrefix.startsWith("/") ? withoutPrefix : `/${withoutPrefix}`;
}

function applyFailureCors(req, res) {
  const origin = typeof req?.headers?.origin === "string" ? req.headers.origin : "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type");
}

function inferApiBaseUrl(req) {
  const forwardedHost = req?.headers?.["x-forwarded-host"];
  const host = Array.isArray(forwardedHost)
    ? forwardedHost[0]
    : forwardedHost || req?.headers?.host || "";
  if (!host) {
    const vercelUrl = String(process.env.VERCEL_URL || "").trim();
    if (vercelUrl) return `https://${vercelUrl.replace(/\/+$/, "")}/api`;
    return null;
  }

  const forwardedProto = req?.headers?.["x-forwarded-proto"];
  const protoRaw = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto || "";
  const protocol = String(protoRaw).split(",")[0].trim() || "https";
  return `${protocol}://${String(host).trim().replace(/\/+$/, "")}/api`;
}

function withTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`deploy sync timeout (${timeoutMs}ms)`)), timeoutMs);
    Promise.resolve(promise)
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

async function maybeRunDeploySync(req) {
  const enabled = toBool(process.env.SYNC_ON_DEPLOY, false);
  if (!enabled) return;
  if (deploySyncCompleted) return;

  const method = String(req?.method || "GET").toUpperCase();
  if (method === "OPTIONS") return;

  const internalSyncHeader = String(req?.headers?.["x-eventify-sync-internal"] || "").trim();
  if (internalSyncHeader === "1") return;

  const path = stripApiPrefix(req?.url || "/");
  if (path.startsWith("/cron/sync")) return;

  if (!deploySyncPromise) {
    deploySyncPromise = (async () => {
      try {
        const { runSyncOnce } = require("../sync");
        const timeoutMs = Math.max(
          3000,
          toPositiveInt(process.env.SYNC_ON_DEPLOY_TIMEOUT_MS, 45000)
        );
        const apiBaseUrl = inferApiBaseUrl(req) || undefined;
        const startedAt = Date.now();
        const summary = await withTimeout(
          runSyncOnce({ apiBaseUrl, skipConnectionTest: true }),
          timeoutMs
        );
        console.log(
          `Deploy sync completed in ${Date.now() - startedAt}ms: fetched=${summary?.fetched ?? "n/a"}, inserted=${summary?.inserted ?? "n/a"}, updated=${summary?.updated ?? "n/a"}`
        );
      } catch (err) {
        console.warn(`Deploy sync failed: ${String(err?.message || err)}`);
      } finally {
        deploySyncCompleted = true;
      }
    })().finally(() => {
      deploySyncPromise = null;
    });
  }

  const blocking = toBool(process.env.SYNC_ON_DEPLOY_BLOCKING, true);
  if (blocking && deploySyncPromise) {
    await deploySyncPromise;
  }
}

module.exports = async function handler(req, res) {
  try {
    await ensureApiBootstrap();
    await maybeRunDeploySync(req);
  } catch (err) {
    const message = String(err?.message || err || "API bootstrap failed");
    console.error("API bootstrap failed:", message);
    applyFailureCors(req, res);
    if (String(req?.method || "").toUpperCase() === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, error: message }));
    return;
  }

  req.url = stripApiPrefix(req.url);
  return app(req, res);
};
