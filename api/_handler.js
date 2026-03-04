const { app, ensureApiBootstrap } = require("../server");

function stripApiPrefix(rawUrl) {
  const value = typeof rawUrl === "string" && rawUrl.trim() ? rawUrl : "/";
  const withoutPrefix = value.replace(/^\/api(?=\/|$)/i, "");
  if (!withoutPrefix) return "/";
  return withoutPrefix.startsWith("/") ? withoutPrefix : `/${withoutPrefix}`;
}

module.exports = async function handler(req, res) {
  try {
    await ensureApiBootstrap();
  } catch (err) {
    const message = String(err?.message || err || "API bootstrap failed");
    console.error("API bootstrap failed:", message);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, error: message }));
    return;
  }

  req.url = stripApiPrefix(req.url);
  return app(req, res);
};
