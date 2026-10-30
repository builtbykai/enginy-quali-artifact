// Vercel serverless function: checks the team access code before entering the app.
// POST /api/auth  header x-access-code → 200 {ok:true} | 401 bad_code | 503 not_configured
const crypto = require("node:crypto");

function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

module.exports = function handler(req, res) {
  res.setHeader("cache-control", "no-store");
  res.setHeader("content-type", "application/json; charset=utf-8");
  const send = (code, obj) => { res.statusCode = code; res.end(JSON.stringify(obj)); };
  if (req.method !== "POST") { res.setHeader("allow", "POST"); return send(405, { ok: false, code: "method" }); }
  if (!process.env.APP_ACCESS_CODE) return send(503, { ok: false, code: "not_configured", message: "Falta configurar APP_ACCESS_CODE en Vercel." });
  const code = req.headers["x-access-code"];
  if (!code || !safeEqual(code, process.env.APP_ACCESS_CODE)) return send(401, { ok: false, code: "bad_code", message: "Código de acceso incorrecto." });
  return send(200, { ok: true });
};
