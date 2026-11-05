#!/usr/bin/env node
// End-to-end proof that the whole product works in Practice mode with no provider keys:
// make a reel and a carousel, approve both, see them "posted", switch on an autopilot and
// watch a pretend WhatsApp lead get answered by the real engine.
//
//   ADMIN_EMAIL=... ADMIN_PASSWORD=... node scripts/practice-e2e.mjs [http://localhost:4100]
const base = process.argv[2] ?? "http://localhost:4100";
let token = "";

async function call(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

async function until(label, fn, timeoutMs = 240_000) {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (value) {
      console.log(`  ok  ${label} (${Math.round((Date.now() - start) / 1000)}s)`);
      return value;
    }
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out: ${label}`);
    await new Promise((r) => setTimeout(r, 1500));
  }
}

const { token: t } = await call("POST", "/api/auth/login", { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
token = t;

let home = await call("GET", "/api/home");
if (!home.practice) throw new Error("This check only runs in Practice mode.");
console.log(`Practice mode on. Worker ${home.system.worker}, queue ${home.system.queue}.`);

console.log("Reel");
const video = await call("POST", "/api/video/projects", {
  name: "E2E reel", contentType: "Instagram Reel", topic: "Why buying egusi abroad is so hard", prompt: "Why buying egusi abroad is so hard",
  durationSec: 15, publishTargets: ["instagram", "facebook"],
});
await until("reel reaches Review", async () => {
  const job = await call("GET", `/api/video/jobs/${video.job.id}`);
  if (job.state === "FAILED") throw new Error(`Reel failed at ${job.errorStage}: ${job.error}`);
  return job.state === "READY" && job.finalVideo?.playUrl ? job : null;
});
await call("POST", `/api/approvals/video/${video.job.id}/decision`, { decision: "APPROVED" });
await until("reel is posted to both destinations", async () => {
  const job = await call("GET", `/api/video/jobs/${video.job.id}`);
  return job.publications.length === 2 && job.publications.every((p) => p.status === "PUBLISHED");
});

console.log("Carousel");
const carousel = await call("POST", "/api/carousel/projects", {
  name: "E2E carousel", topic: "5 foods every diaspora kitchen needs", prompt: "5 foods every diaspora kitchen needs", slideCount: 5, publishTargets: ["instagram"],
});
await until("carousel reaches Review", async () => {
  const job = await call("GET", `/api/carousel/jobs/${carousel.job.id}`);
  if (job.state === "FAILED") throw new Error(`Carousel failed: ${job.error}`);
  return job.state === "READY";
});
await call("POST", `/api/carousel/jobs/${carousel.job.id}/decision`, { decision: "APPROVED" });
await until("carousel is posted", async () => {
  const job = await call("GET", `/api/carousel/jobs/${carousel.job.id}`);
  return job.publications.some((p) => p.status === "PUBLISHED");
});

console.log("Autopilots");
const { items } = await call("GET", "/api/autopilots");
for (const a of items) await call("POST", `/api/autopilots/${a.id}/on`);
console.log(`  ok  all ${items.length} autopilots switched on`);
for (const a of items) {
  const { executionId } = await call("POST", `/api/autopilots/${a.id}/run`);
  const run = await until(`"${a.title}" runs`, async () => {
    const r = await call("GET", `/api/autopilots/runs/${executionId}`);
    return ["SUCCEEDED", "FAILED", "CANCELLED"].includes(r.status) ? r : null;
  }, 60_000);
  if (run.status !== "SUCCEEDED") throw new Error(`"${a.title}" ended ${run.status}: ${run.error}`);
}

console.log("Lead");
const { phone } = await call("POST", "/api/practice/message", { name: "E2E lead", text: "Hello" });
await until("a pretend lead gets a reply", async () => {
  const people = await call("GET", `/api/people?q=${phone}`);
  if (!people[0]) return null;
  const person = await call("GET", `/api/people/${people[0].id}`);
  return person.conversation.some((m) => m.replySent);
}, 60_000);

home = await call("GET", "/api/home");
console.log("Line:", JSON.stringify(home.counts));
console.log("Guide:", home.guide.map((g) => `${g.done ? "x" : " "} ${g.id}`).join("  "));
for (const a of items) await call("POST", `/api/autopilots/${a.id}/off`);
console.log("All good.");
