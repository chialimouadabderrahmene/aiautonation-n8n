#!/usr/bin/env node
/** Safe native-runtime smoke test. It never enables workflows or sends messages. */
const BASE = (process.env.SMOKE_BASE_URL || "http://localhost:3200").replace(/\/+$/, "");
const EMAIL = process.env.SMOKE_EMAIL;
const PASSWORD = process.env.SMOKE_PASSWORD;
if (!EMAIL || !PASSWORD) { console.error("Set SMOKE_EMAIL and SMOKE_PASSWORD"); process.exit(2); }
let token = "";
const results = [];
async function call(method, path, body, auth = true) {
  const r = await fetch(`${BASE}${path}`, { method, headers: { "content-type": "application/json", ...(auth && token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: r.status, text, json };
}
async function step(name, fn) {
  try { const detail = await fn(); results.push({ name, status: "PASS", detail }); console.log(`PASS ${name}${detail ? ` — ${detail}` : ""}`); }
  catch (e) { results.push({ name, status: "FAIL", detail: e instanceof Error ? e.message : String(e) }); console.log(`FAIL ${name} — ${results.at(-1).detail}`); }
}
const assert = (ok, message) => { if (!ok) throw new Error(message); };
await step("public login page", async () => { const r = await call("GET", "/login", undefined, false); assert(r.status === 200 && /<html/i.test(r.text), `status ${r.status}`); return "served"; });
await step("authentication", async () => { const bad = await call("POST", "/api/auth/login", { email: EMAIL, password: `${PASSWORD}-wrong` }, false); assert(bad.status === 401, `bad login ${bad.status}`); const good = await call("POST", "/api/auth/login", { email: EMAIL, password: PASSWORD }, false); assert(good.status === 200 && good.json?.token, `login ${good.status}`); token = good.json.token; return "wrong password rejected; JWT issued"; });
await step("native dashboard health", async () => { const r = await call("GET", "/api/dashboard"); assert(r.status === 200 && r.json?.health?.nativeAutomation, `dashboard ${r.status}`); return r.json.health.nativeAutomation.message; });
for (const [key, label] of [["database", "database"], ["redis", "redis"], ["worker", "worker"], ["storage", "storage"], ["nativeAutomation", "native automation"]]) await step(`${label} health`, async () => { const r = await call("GET", "/api/system/health"); assert(r.status === 200 && r.json[key]?.status === "ONLINE", `${key}: ${r.json?.[key]?.status ?? r.status}`); return r.json[key].message; });
await step("workflow state is native", async () => { const r = await call("GET", "/api/workflows"); assert(r.status === 200 && Array.isArray(r.json), `workflows ${r.status}`); return `${r.json.length} workflow records readable without external orchestrator`; });
await step("authentication and webhook rejection", async () => { const unauth = await fetch(`${BASE}/api/integrations`); assert(unauth.status === 401, `unauthenticated ${unauth.status}`); const tg = await fetch(`${BASE}/api/telegram/webhook`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); assert(tg.status === 403, `unsigned Telegram ${tg.status}`); return "401 and 403"; });
await step("usage endpoint", async () => { const r = await call("GET", "/api/usage"); assert(r.status === 200, `usage ${r.status}`); return "reachable"; });
await step("internal route boundary", async () => { const r = await fetch(`${BASE}/internal/automation-runtime`); assert(r.status === 404 || r.status === 403, `internal route ${r.status}`); return "no public internal runtime route"; });
const failed = results.filter((r) => r.status === "FAIL");
console.log(JSON.stringify({ base: BASE, at: new Date().toISOString(), results }, null, 2));
process.exitCode = failed.length ? 1 : 0;
