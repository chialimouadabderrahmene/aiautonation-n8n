#!/usr/bin/env node
/**
 * Disposable local carousel E2E. Requires docker/docker-compose.test.yml and
 * CAROUSEL_PUBLISH_TEST_MODE=true on the worker. It never calls WhatsApp or a
 * real social provider; publication uses the explicit mock adapter.
 */
const BASE = process.env.E2E_BASE_URL || "http://localhost:3200";
let token = "";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function call(method, path, body) {
  const response = await fetch(`${BASE}${path}`, { method, headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text(); let json = null; try { json = JSON.parse(text); } catch { /* diagnostic below */ }
  return { status: response.status, json, text };
}
function assert(condition, message) { if (!condition) throw new Error(message); }
async function waitForJob(id) {
  for (let i = 0; i < 120; i += 1) { const result = await call("GET", `/api/carousels/jobs/${id}`); assert(result.status === 200, result.text); if (["READY", "FAILED", "CANCELLED"].includes(result.json.state)) return result.json; await sleep(1000); }
  throw new Error("carousel timed out");
}
const login = await call("POST", "/api/auth/login", { email: process.env.E2E_EMAIL, password: process.env.E2E_PASSWORD });
assert(login.status === 200 && login.json?.token, `login failed: ${login.status}`); token = login.json.token;
const settings = await call("PUT", "/api/settings/marketplaceTruth", { value: "Approved test fact: EKI connects buyers and vendors." });
assert(settings.status === 200, `truth setting failed: ${settings.text}`);
const created = await call("POST", "/api/carousels/projects", { name: "Local carousel E2E", topic: "Approved marketplace story", prompt: "Explain the approved marketplace fact without adding claims.", slideCount: 3, publishTargets: ["instagram"] });
assert(created.status === 201, `create failed: ${created.text}`);
const ready = await waitForJob(created.json.job.id);
assert(ready.state === "READY" && ready.slides.length === 3 && ready.assets.length === 3, `generation failed: ${ready.state} ${ready.error ?? ""}`);
const approved = await call("POST", `/api/carousels/jobs/${ready.id}/decision`, { decision: "APPROVED" });
assert(approved.status === 200, `approval failed: ${approved.text}`);
const published = await waitForJob(ready.id);
assert(published.publications?.every((publication) => publication.status === "PUBLISHED"), JSON.stringify(published.publications));
const usage = await call("GET", "/api/usage");
assert(usage.status === 200, `usage failed: ${usage.text}`);
console.log(JSON.stringify({ generation: "PASS", approval: "PASS", publication: "PASS", usage: "PASS", jobId: ready.id }, null, 2));
