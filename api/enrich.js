// Vercel serverless function: LinkedIn URL → person + company data from Enginy.
//
// POST /api/enrich            body {linkedinUrl}
//   → {status:"found", data}                    contact already in Enginy with enough data
//   → {status:"scraping", job}                  scraping started; poll with GET
// GET  /api/enrich?job=<token>
//   → {status:"scraping", job} | {status:"found", data} | {status:"partial", data}
//
// Env vars (Vercel → Settings → Environment Variables):
//   ENGINY_API_KEY   required  Enginy API key (gsk_...), scopes: contacts, companies, actions
//   APP_ACCESS_CODE  required  shared code the SDRs type once in the app
//   ENGINY_API_BASE  optional  defaults to https://openapi.enginy.ai

const crypto = require("node:crypto");
const BASE = () => (process.env.ENGINY_API_BASE || "https://openapi.enginy.ai").replace(/\/+$/, "");
const TERMINAL = new Set(["COMPLETED", "FAILED", "CANCELLED", "PARTIAL"]);
const MAX_JOB_AGE_MS = 8 * 60 * 1000;
const RECENT_SCRAPE_MS = 15 * 60 * 1000; // don't re-spend credits on a contact refreshed this recently

// ---------- helpers ----------
function normalizeLinkedIn(url) {
  if (typeof url !== "string") return null;
  let u = url.trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  let parsed;
  try { parsed = new URL(u); } catch { return null; }
  if (!/(^|\.)linkedin\.com$/i.test(parsed.hostname)) return null;
  let path;
  try { path = decodeURIComponent(parsed.pathname); } catch { path = parsed.pathname; }
  const m = path.match(/^\/in\/([^/?#]+)/i);
  if (!m) return null;
  const slug = m[1].replace(/\/+$/, "");
  if (!slug) return null;
  return { slug: slug.toLowerCase(), url: `https://www.linkedin.com/in/${slug}` };
}
const sameProfile = (a, b) => {
  const x = normalizeLinkedIn(a || ""), y = normalizeLinkedIn(b || "");
  return !!(x && y && x.slug === y.slug);
};
const httpsOnly = (u) => (typeof u === "string" && /^https:\/\//i.test(u.trim()) ? u.trim() : null);
const unwrap = (j) => (j && j.data !== undefined && !Array.isArray(j.data) ? j.data : j);

async function enginy(path, { method = "GET", body } = {}) {
  const res = await fetch(BASE() + path, {
    method,
    headers: { "x-api-key": process.env.ENGINY_API_KEY, "content-type": "application/json", accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const route = method + " " + path.split("?")[0].replace(/\/\d+(?=\/|$)/g, "/{id}");
    const err = new Error(((json && (json.message || json.error)) || `Enginy ${res.status}`) + ` (${route})`);
    err.status = res.status;
    err.route = route;
    throw err;
  }
  return json;
}

// job token: base64url JSON {a: actionsId, c: contactId, p: phase, t: startedAt} + HMAC signature,
// so a client can only poll jobs this server started (no reading arbitrary contact ids).
const secret = () => `${process.env.APP_ACCESS_CODE}|${process.env.ENGINY_API_KEY}`;
const sign = (payload) => crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
const encodeJob = (o) => { const p = Buffer.from(JSON.stringify(o)).toString("base64url"); return `${p}.${sign(p)}`; };
function decodeJob(s) {
  try {
    const [p, sig] = String(s).split(".");
    if (!p || !sig || !safeEqual(sig, sign(p))) return null;
    const o = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
    if (!Number.isFinite(+o.a) || !Number.isFinite(+o.c) || ![1, 2].includes(o.p) || !Number.isFinite(+o.t)) return null;
    return { a: +o.a, c: +o.c, p: o.p, t: +o.t };
  } catch { return null; }
}

// ---------- Enginy reads ----------
// Some single-record routes are singular in Enginy's API (e.g. POST /v1/contact). Try both spellings on a
// 404 and remember the one that answered, so later calls go straight to it.
const routeCache = {};
async function enginyAny(key, paths, opts) {
  const order = routeCache[key] != null ? [routeCache[key], ...paths.keys()].filter((v, i, a) => a.indexOf(v) === i) : [...paths.keys()];
  let last;
  for (const i of order) {
    try { const r = await enginy(paths[i], opts); routeCache[key] = i; return r; }
    catch (e) { last = e; if (e.status !== 404 && e.status !== 405) throw e; }
  }
  throw last;
}
async function findContact(norm) {
  const q = new URLSearchParams({ search: norm.url, pageSize: "10" });
  const j = await enginyAny("list", [`/v1/contacts?${q}`, `/v1/contact?${q}`]);
  const list = Array.isArray(j && j.data) ? j.data : [];
  return list.find((c) => sameProfile(c.linkedInProfileUrl, norm.url)) || null;
}
async function getContact(id) { return unwrap(await enginyAny("contact", [`/v1/contact/${id}`, `/v1/contacts/${id}`])); }
async function getCompany(id) { return unwrap(await enginyAny("company", [`/v1/company/${id}`, `/v1/companies/${id}`])); }
async function startAction(target, type) {
  const body = { actions: [{ type }], ...target };
  const d = unwrap(await enginy(`/v1/actions`, { method: "POST", body }));
  const id = d && (d.actionsId ?? d.id);
  if (!Number.isFinite(+id)) throw Object.assign(new Error("Enginy no devolvió el id del scraping"), { status: 502 });
  return +id;
}
async function actionStatus(id) {
  const d = unwrap(await enginy(`/v1/actions/${id}/status`));
  return (d && d.overallStatus) || "PROCESSING";
}

// ---------- mapping ----------
function salesHeadcount(company) {
  const rows = Array.isArray(company && company.companyHeadcount) ? company.companyHeadcount : [];
  const pick = (name) => rows.find((r) => String(r.department || "").toLowerCase() === name);
  const sales = pick("sales"), bd = pick("business development");
  if (!sales && !bd) return null;
  return { sales: sales ? +sales.employeeCount || 0 : 0, bizDev: bd ? +bd.employeeCount || 0 : 0,
    growth1y: sales && Number.isFinite(+sales.oneYearGrowth) ? +sales.oneYearGrowth : null };
}
function pickSmart(company, names) {
  const s = (company && company.smartFieldExplanations) || {};
  for (const n of names) if (typeof s[n] === "string" && s[n].trim()) return s[n].trim();
  return null;
}
function buildProfile(contact, company) {
  const c = contact || {}, co = company || {};
  const hc = salesHeadcount(co);
  return {
    person: {
      firstName: c.firstName || null, lastName: c.lastName || null,
      fullName: [c.firstName, c.lastName].filter(Boolean).join(" ") || null,
      jobTitle: c.jobTitle || null, headline: c.linkedInHeadline || null,
      country: c.contactCountry || null, linkedInUrl: httpsOnly(c.linkedInProfileUrl),
      imageUrl: httpsOnly(c.imageUrl), appUrl: httpsOnly(c.appUrl),
    },
    company: company ? {
      name: co.name || null, domain: co.domain || null, website: httpsOnly(co.website),
      linkedInUrl: httpsOnly(co.companyLinkedInUrl), industry: co.industry || null,
      employees: Number.isFinite(+co.numberOfEmployees) && co.numberOfEmployees !== null ? +co.numberOfEmployees : null,
      employeeRange: co.rangeOfEmployees || null, country: co.country || null, city: co.city || null,
      description: co.description || null, founded: co.yearfounded || null, revenueRange: co.revenueRange || null,
      hiringOnLinkedIn: typeof co.hiringOnLinkedIn === "boolean" ? co.hiringOnLinkedIn : null,
      openJobs: Number.isFinite(+co.openJobPositions) && co.openJobPositions !== null ? +co.openJobPositions : null,
      salesHeadcount: hc,
      icpReachableNote: pickSmart(co, ["ICP Reachable on LinkedIn"]),
      b2bNote: pickSmart(co, ["B2B or B2C", "B2B/B2C"]),
      appUrl: httpsOnly(co.appUrl),
    } : null,
  };
}
const companyComplete = (co) => !!(co && (co.numberOfEmployees || co.rangeOfEmployees) && co.industry);
const contactComplete = (c) => !!(c && c.jobTitle && c.companyId);

async function profileFor(contactId) {
  const contact = await getContact(contactId);
  const company = contact && contact.companyId ? await getCompany(contact.companyId) : null;
  return { contact, company };
}

// ---------- handler ----------
async function handler(req, res) {
  res.setHeader("cache-control", "no-store");
  const send = (code, obj) => { res.statusCode = code; res.setHeader("content-type", "application/json; charset=utf-8"); res.end(JSON.stringify(obj)); };

  if (!process.env.ENGINY_API_KEY || !process.env.APP_ACCESS_CODE)
    return send(503, { status: "error", code: "not_configured", message: "Falta configurar ENGINY_API_KEY o APP_ACCESS_CODE en Vercel." });
  const code = req.headers["x-access-code"];
  if (!code || !safeEqual(code, process.env.APP_ACCESS_CODE))
    return send(401, { status: "error", code: "bad_code", message: "Código de acceso incorrecto." });

  try {
    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
      const norm = normalizeLinkedIn(body && body.linkedinUrl);
      if (!norm) return send(400, { status: "error", code: "bad_url", message: "Pega una URL de perfil de LinkedIn (linkedin.com/in/…)." });

      let contact = await findContact(norm);
      if (contact) {
        const full = await profileFor(contact.id);
        if (contactComplete(full.contact) && companyComplete(full.company))
          return send(200, { status: "found", source: "enginy", data: buildProfile(full.contact, full.company) });
        const updated = Date.parse((full.contact && full.contact.updatedAt) || "");
        if (Number.isFinite(updated) && Date.now() - updated < RECENT_SCRAPE_MS)
          return send(200, { status: "partial", source: "enginy", data: buildProfile(full.contact, full.company),
            message: "Este perfil se actualizó en Enginy hace menos de 15 min y no se vuelve a scrapear (para no gastar créditos). Completa a mano lo que falte." });
      } else {
        // documented bulk endpoint, one item; merges into an existing record matched by LinkedIn URL
        const out = unwrap(await enginy(`/v1/contacts/bulk`, { method: "POST", body: { contacts: [{ linkedInProfileUrl: norm.url }] } }));
        const r0 = out && Array.isArray(out.results) ? out.results[0] : null;
        const created = r0 && r0.success !== false ? r0.contact : null;
        if (!created || !Number.isFinite(+created.id))
          throw Object.assign(new Error((r0 && (r0.error || r0.message)) || "Enginy no devolvió el contacto creado"), { status: 502 });
        contact = { id: +created.id };
      }
      const a = await startAction({ contactIds: [contact.id] }, "SCRAPE_LEAD_FROM_LINKEDIN");
      return send(202, { status: "scraping", phase: "person", job: encodeJob({ a, c: contact.id, p: 1, t: Date.now() }) });
    }

    if (req.method === "GET") {
      const url = new URL(req.url, "http://x");
      const job = decodeJob(url.searchParams.get("job"));
      if (!job) return send(400, { status: "error", code: "bad_job", message: "Petición de seguimiento no válida." });
      const timedOut = Date.now() - job.t > MAX_JOB_AGE_MS;

      let st = "PROCESSING";
      if (!timedOut) { try { st = await actionStatus(job.a); } catch (e) { if (e.status === 429) throw e; st = "UNKNOWN"; } }
      if (st === "UNKNOWN") return send(200, { status: "scraping", phase: job.p === 1 ? "person" : "company", job: encodeJob(job) });
      if (!TERMINAL.has(st) && !timedOut)
        return send(200, { status: "scraping", phase: job.p === 1 ? "person" : "company", job: encodeJob(job) });

      const full = await profileFor(job.c);
      // phase 1 done: if the company is missing key data and has a LinkedIn page, scrape it too
      if (job.p === 1 && !timedOut && full.company && !companyComplete(full.company) && full.company.companyLinkedInUrl) {
        const a2 = await startAction({ companyIds: [full.company.id] }, "SCRAPE_COMPANY_FROM_LINKEDIN");
        return send(200, { status: "scraping", phase: "company", job: encodeJob({ a: a2, c: job.c, p: 2, t: job.t }) });
      }
      const data = buildProfile(full.contact, full.company);
      const ok = contactComplete(full.contact) && companyComplete(full.company);
      return send(200, { status: ok ? "found" : "partial", source: "scrape", data,
        message: ok ? undefined : timedOut ? "El scraping está tardando; usa lo que hay y completa a mano." : "LinkedIn no devolvió todos los datos; completa a mano lo que falte." });
    }

    res.setHeader("allow", "GET, POST");
    return send(405, { status: "error", code: "method", message: "Método no permitido." });
  } catch (e) {
    const status = e.status === 401 || e.status === 403 ? 502 : e.status === 429 ? 429 : e.status >= 400 && e.status < 600 ? 502 : 500;
    const message = e.status === 401 || e.status === 403 ? "Enginy rechazó la API key. Revisa ENGINY_API_KEY y sus permisos."
      : e.status === 429 ? "Enginy está limitando peticiones. Espera un minuto y reintenta."
      : "No se pudo consultar Enginy: " + (e.message || "error desconocido");
    return send(status, { status: "error", code: "enginy", message });
  }
}

module.exports = handler;
module.exports._internal = { routeCache, normalizeLinkedIn, sameProfile, buildProfile, salesHeadcount, encodeJob, decodeJob };
