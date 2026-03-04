const { runSyncOnce } = require("../../sync");

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function readBearerToken(authHeader) {
  const header = typeof authHeader === "string" ? authHeader.trim() : "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : "";
}

function inferApiBaseUrl(req) {
  const forwardedHost = req.headers["x-forwarded-host"];
  const host = Array.isArray(forwardedHost)
    ? forwardedHost[0]
    : forwardedHost || req.headers.host || "";
  if (!host) return null;

  const forwardedProto = req.headers["x-forwarded-proto"];
  const protoRaw = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto || "";
  const protocol = String(protoRaw).split(",")[0].trim() || "https";

  return `${protocol}://${String(host).trim().replace(/\/+$/, "")}/api`;
}

module.exports = async function cronSyncHandler(req, res) {
  const method = String(req.method || "GET").toUpperCase();
  if (!["GET", "POST"].includes(method)) {
    res.setHeader("Allow", "GET, POST");
    return sendJson(res, 405, { ok: false, error: "Method not allowed" });
  }

  const expectedSecret = String(process.env.CRON_SECRET || "").trim();
  if (expectedSecret) {
    const bearer = readBearerToken(req.headers.authorization);
    const querySecret = typeof req.query?.secret === "string" ? req.query.secret.trim() : "";
    if (bearer !== expectedSecret && querySecret !== expectedSecret) {
      return sendJson(res, 401, { ok: false, error: "Unauthorized" });
    }
  }

  try {
    const apiBaseUrl = inferApiBaseUrl(req);
    const summary = await runSyncOnce({
      apiBaseUrl: apiBaseUrl || undefined,
    });
    return sendJson(res, 200, {
      ok: true,
      ranAt: new Date().toISOString(),
      apiBaseUrl: apiBaseUrl || null,
      summary,
    });
  } catch (err) {
    const message = String(err?.message || err || "Sync failed");
    console.error("Cron sync failed:", message);
    return sendJson(res, 500, { ok: false, error: message });
  }
};
