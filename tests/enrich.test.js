// Run: node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const handler = require("../api/enrich.js");
const { normalizeLinkedIn, buildProfile, decodeJob } = handler._internal;

// ---- fake Enginy ----
function fakeEnginy(state) {
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    const u = new URL(url), method = opts.method || "GET", body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ method, path: u.pathname + u.search, body, key: opts.headers["x-api-key"] });
    const json = (code, obj) => ({ ok: code < 400, status: code, json: async () => obj });
    if (state.fail) return json(state.fail, { message: "nope" });
    if (method === "GET" && u.pathname === "/v1/contacts") return json(200, { data: state.contacts.filter((c) => state.searchHit !== false), meta: {} });
    if (method === "GET" && /^\/v1\/contacts\/\d+$/.test(u.pathname)) return json(200, { status: "success", data: state.contacts.find((c) => c.id === +u.pathname.split("/").pop()) });
    if (method === "GET" && /^\/v1\/companies\/\d+$/.test(u.pathname)) return json(200, { status: "success", data: state.companies.find((c) => c.id === +u.pathname.split("/").pop()) });
    if (method === "POST" && u.pathname === "/v1/contacts/bulk") { const c = { id: 900, linkedInProfileUrl: body.contacts[0].linkedInProfileUrl, companyId: null }; state.contacts.push(c); return json(201, { status: "success", data: { results: [{ index: 0, success: true, contact: { id: 900, linkedinProfileUrl: c.linkedInProfileUrl } }], summary: { total: 1, created: 1 } } }); }
    if (method === "POST" && u.pathname === "/v1/actions") { state.actions.push(body); return json(201, { status: "success", data: { actionsId: 500 + state.actions.length } }); }
    if (method === "GET" && /^\/v1\/actions\/\d+\/status$/.test(u.pathname)) return json(200, { status: "success", data: { overallStatus: state.runStatus || "PROCESSING" } });
    return json(404, { message: "not found " + u.pathname });
  };
  return calls;
}
function call(method, { body, query = "", code = "secret" } = {}) {
  return new Promise((resolve) => {
    const req = { method, url: "/api/enrich" + query, headers: code ? { "x-access-code": code } : {}, body };
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(s) { resolve({ code: this.statusCode, json: JSON.parse(s) }); } };
    handler(req, res);
  });
}
const COMPANY = { id: 77, name: "Acme", industry: "Software Development", numberOfEmployees: 120, rangeOfEmployees: "51-200", country: "Spain", city: "Madrid",
  companyLinkedInUrl: "https://www.linkedin.com/company/acme", description: "B2B SaaS", hiringOnLinkedIn: true, openJobPositions: 4,
  companyHeadcount: [{ department: "Sales", employeeCount: 9, oneYearGrowth: 50 }, { department: "Business Development", employeeCount: 3 }, { department: "Total", employeeCount: 120 }],
  smartFieldExplanations: { "ICP Reachable on LinkedIn": "CUSTOMER: retailers…" } };
const PERSON = { id: 11, firstName: "Marta", lastName: "Ruiz", jobTitle: "VP Sales", contactCountry: "Spain", linkedInProfileUrl: "https://www.linkedin.com/in/marta-ruiz-123/", companyId: 77 };

test.beforeEach(() => { process.env.ENGINY_API_KEY = "gsk_test"; process.env.APP_ACCESS_CODE = "secret"; delete process.env.ENGINY_API_BASE; });

test("normalizes LinkedIn URLs", () => {
  assert.equal(normalizeLinkedIn("linkedin.com/in/Marta-Ruiz-123/?utm=x").slug, "marta-ruiz-123");
  assert.equal(normalizeLinkedIn("https://es.linkedin.com/in/luisa-l%C3%B3pez").slug, "luisa-lópez");
  assert.equal(normalizeLinkedIn("https://www.linkedin.com/company/acme"), null);
  assert.equal(normalizeLinkedIn("https://evil.com/in/x"), null);
  assert.equal(normalizeLinkedIn("https://linkedin.com.evil.com/in/x"), null);
  assert.equal(normalizeLinkedIn(""), null);
});

test("rejects missing config, wrong code and bad URL", async () => {
  delete process.env.ENGINY_API_KEY;
  assert.equal((await call("POST", { body: { linkedinUrl: PERSON.linkedInProfileUrl } })).code, 503);
  process.env.ENGINY_API_KEY = "gsk_test";
  assert.equal((await call("POST", { body: { linkedinUrl: PERSON.linkedInProfileUrl }, code: "wrong" })).code, 401);
  assert.equal((await call("POST", { body: { linkedinUrl: PERSON.linkedInProfileUrl }, code: null })).code, 401);
  fakeEnginy({ contacts: [], companies: [], actions: [] });
  const r = await call("POST", { body: { linkedinUrl: "https://google.com" } });
  assert.equal(r.code, 400); assert.equal(r.json.code, "bad_url");
});

test("found in Enginy with full data → no scraping", async () => {
  const st = { contacts: [{ ...PERSON }], companies: [{ ...COMPANY }], actions: [] };
  const calls = fakeEnginy(st);
  const r = await call("POST", { body: JSON.stringify({ linkedinUrl: "linkedin.com/in/MARTA-RUIZ-123" }) });
  assert.equal(r.code, 200); assert.equal(r.json.status, "found");
  assert.equal(r.json.data.person.fullName, "Marta Ruiz");
  assert.equal(r.json.data.company.employees, 120);
  assert.deepEqual(r.json.data.company.salesHeadcount, { sales: 9, bizDev: 3, growth1y: 50 });
  assert.equal(st.actions.length, 0);
  assert.ok(calls.every((c) => c.key === "gsk_test"));
});

test("search hit with a different profile is not treated as a match", async () => {
  const st = { contacts: [{ ...PERSON, linkedInProfileUrl: "https://www.linkedin.com/in/marta-ruiz-999" }], companies: [COMPANY], actions: [] };
  fakeEnginy(st);
  const r = await call("POST", { body: { linkedinUrl: PERSON.linkedInProfileUrl } });
  assert.equal(r.json.status, "scraping");
  assert.equal(st.contacts.length, 2, "creates a new contact");
});

test("not in Enginy → create contact, scrape person, then company, then found", async () => {
  const st = { contacts: [], companies: [], actions: [], runStatus: "PROCESSING" };
  const calls = fakeEnginy(st);
  const r1 = await call("POST", { body: { linkedinUrl: "https://www.linkedin.com/in/new-person/" } });
  assert.equal(r1.code, 202); assert.equal(r1.json.status, "scraping");
  assert.deepEqual(st.actions[0], { actions: [{ type: "SCRAPE_LEAD_FROM_LINKEDIN" }], contactIds: [900] });
  assert.equal(calls.find((c) => c.method === "POST" && c.path === "/v1/contacts/bulk").body.contacts[0].linkedInProfileUrl, "https://www.linkedin.com/in/new-person");

  // still processing
  let r = await call("GET", { query: "?job=" + r1.json.job });
  assert.equal(r.json.status, "scraping"); assert.equal(r.json.phase, "person");

  // person done, company exists but is thin → company scrape starts
  st.runStatus = "COMPLETED";
  Object.assign(st.contacts[0], { firstName: "Nuevo", lastName: "Perfil", jobTitle: "Head of SDR", companyId: 78 });
  st.companies.push({ id: 78, name: "Thin Co", companyLinkedInUrl: "https://www.linkedin.com/company/thin" });
  r = await call("GET", { query: "?job=" + r.json.job });
  assert.equal(r.json.phase, "company");
  assert.deepEqual(st.actions[1], { actions: [{ type: "SCRAPE_COMPANY_FROM_LINKEDIN" }], companyIds: [78] });
  assert.equal(decodeJob(r.json.job).p, 2);

  // company done
  Object.assign(st.companies[0], { industry: "Logistics", numberOfEmployees: 45 });
  r = await call("GET", { query: "?job=" + r.json.job });
  assert.equal(r.json.status, "found");
  assert.equal(r.json.data.person.jobTitle, "Head of SDR");
  assert.equal(r.json.data.company.employees, 45);
});

test("scrape finishes without company data → partial with message", async () => {
  const st = { contacts: [], companies: [], actions: [], runStatus: "FAILED" };
  fakeEnginy(st);
  const r1 = await call("POST", { body: { linkedinUrl: "https://www.linkedin.com/in/ghost" } });
  const r = await call("GET", { query: "?job=" + r1.json.job });
  assert.equal(r.json.status, "partial"); assert.ok(r.json.message);
  assert.equal(r.json.data.company, null);
});

test("Enginy errors are reported without leaking the key", async () => {
  fakeEnginy({ fail: 401, contacts: [], companies: [], actions: [] });
  const r = await call("POST", { body: { linkedinUrl: PERSON.linkedInProfileUrl } });
  assert.equal(r.code, 502); assert.match(r.json.message, /API key/); assert.doesNotMatch(JSON.stringify(r.json), /gsk_test/);
  fakeEnginy({ fail: 429, contacts: [], companies: [], actions: [] });
  assert.equal((await call("POST", { body: { linkedinUrl: PERSON.linkedInProfileUrl } })).code, 429);
});

test("bad job token and wrong method", async () => {
  fakeEnginy({ contacts: [], companies: [], actions: [] });
  assert.equal((await call("GET", { query: "?job=garbage" })).code, 400);
  assert.equal((await call("PUT")).code, 405);
});

test("buildProfile tolerates missing pieces", () => {
  const p = buildProfile({ firstName: "A" }, null);
  assert.equal(p.person.fullName, "A"); assert.equal(p.company, null);
  assert.equal(buildProfile({}, { numberOfEmployees: null, name: "X" }).company.employees, null);
});

test("forged or tampered job tokens are rejected", async () => {
  fakeEnginy({ contacts: [{ ...PERSON }], companies: [COMPANY], actions: [] });
  const forged = Buffer.from(JSON.stringify({ a: 1, c: 11, p: 2, t: Date.now() })).toString("base64url");
  assert.equal((await call("GET", { query: "?job=" + forged })).code, 400);
  assert.equal((await call("GET", { query: "?job=" + forged + ".AAAA" })).code, 400);
  const good = handler._internal.encodeJob({ a: 1, c: 11, p: 2, t: Date.now() });
  const [p, sig] = good.split(".");
  const other = Buffer.from(JSON.stringify({ a: 1, c: 12, p: 2, t: Date.now() })).toString("base64url");
  assert.equal((await call("GET", { query: "?job=" + other + "." + sig })).code, 400);
  assert.equal((await call("GET", { query: "?job=" + good })).code, 200);
});

test("a contact refreshed in the last 15 min is not scraped again", async () => {
  const st = { contacts: [{ ...PERSON, companyId: null, updatedAt: new Date().toISOString() }], companies: [], actions: [] };
  fakeEnginy(st);
  const r = await call("POST", { body: { linkedinUrl: PERSON.linkedInProfileUrl } });
  assert.equal(r.json.status, "partial"); assert.equal(st.actions.length, 0);
  st.contacts[0].updatedAt = new Date(Date.now() - 3600e3).toISOString();
  assert.equal((await call("POST", { body: { linkedinUrl: PERSON.linkedInProfileUrl } })).json.status, "scraping");
  assert.equal(st.actions.length, 1);
});

test("status endpoint failing keeps polling, and the job ends after the time limit", async () => {
  const st = { contacts: [{ ...PERSON }], companies: [COMPANY], actions: [] };
  fakeEnginy(st);
  const { encodeJob } = handler._internal;
  // status 404s (unknown path behaviour) → still scraping, no crash
  global.fetch = (orig => async (url, o) => /\/status$/.test(url) ? { ok: false, status: 502, json: async () => ({}) } : orig(url, o))(global.fetch);
  let r = await call("GET", { query: "?job=" + encodeJob({ a: 9, c: 11, p: 1, t: Date.now() }) });
  assert.equal(r.json.status, "scraping");
  r = await call("GET", { query: "?job=" + encodeJob({ a: 9, c: 11, p: 1, t: Date.now() - 9 * 60e3 }) });
  assert.equal(r.json.status, "found");
});

test("malformed URLs and non-https links are handled safely", async () => {
  assert.doesNotThrow(() => normalizeLinkedIn("https://www.linkedin.com/in/%E0%A4%A"));
  fakeEnginy({ contacts: [], companies: [], actions: [] });
  assert.notEqual((await call("POST", { body: { linkedinUrl: "https://www.linkedin.com/in/%E0%A4%A" } })).code, 500);
  const p = buildProfile({ appUrl: "javascript:alert(1)", linkedInProfileUrl: "https://www.linkedin.com/in/x" }, { appUrl: "javascript:x" });
  assert.equal(p.person.appUrl, null); assert.equal(p.company.appUrl, null); assert.equal(p.person.linkedInUrl, "https://www.linkedin.com/in/x");
});
