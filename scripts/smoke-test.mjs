#!/usr/bin/env node
/**
 * Production smoke test — the 20-step checklist from the production-readiness
 * brief, run through the PUBLIC web URL exactly like a browser would.
 *
 *   SMOKE_BASE_URL=https://your-control-center.up.railway.app \
 *   SMOKE_EMAIL=admin@... SMOKE_PASSWORD=... \
 *   node scripts/smoke-test.mjs
 *
 * Optional:
 *   SMOKE_PROVIDER=telegram SMOKE_PROVIDER_JSON='{"secrets":{"botToken":"..."},"config":{"approvalChatId":"-100..."}}'
 *       configure + test this integration (step 11-12). Without it, the
 *       already-configured integrations are re-tested (never overwritten).
 *   SMOKE_WORKFLOW=16-pain-discovery-engine
 *       workflow to enable/test-run/disable (default: first READY one).
 *       WARNING: a test run is a REAL run with real side effects.
 *   SMOKE_RESTART_CMD="docker compose -f docker/docker-compose.yml restart api worker n8n"
 *       command that restarts the services for steps 19-20 (on Railway use
 *       `railway redeploy --service api -y && ...` or restart from the dashboard
 *       and re-run with SMOKE_ONLY_PERSISTENCE=1).
 *   SMOKE_EXPECT_ALL_INACTIVE=1   fail step 10 unless 0 workflows are active (fresh deployment).
 *
 * Exit code 0 only if every required step passed. Prints a JSON report at the end.
 */
import { execSync } from "node:child_process";

const BASE = (process.env.SMOKE_BASE_URL || "http://localhost:3200").replace(/\/+$/, "");
const EMAIL = process.env.SMOKE_EMAIL;
const PASSWORD = process.env.SMOKE_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error("Set SMOKE_EMAIL and SMOKE_PASSWORD");
  process.exit(2);
}

const results = [];
let token = "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, path, body, { auth = true } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(auth && token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* html */
  }
  return { status: res.status, json, text };
}

async function step(n, name, fn, { required = true } = {}) {
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({ step: n, name, status: detail?.skipped ? "SKIPPED" : "PASS", detail: detail?.skipped ?? detail ?? "", ms: Date.now() - started });
  } catch (err) {
    results.push({ step: n, name, status: required ? "FAIL" : "WARN", detail: err instanceof Error ? err.message : String(err), ms: Date.now() - started });
  }
  const r = results[results.length - 1];
  console.log(`${String(n).padStart(2)}. ${r.status.padEnd(7)} ${name}${r.detail ? ` — ${typeof r.detail === "string" ? r.detail : JSON.stringify(r.detail)}` : ""}`);
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

async function health() {
  const r = await call("GET", "/api/system/health");
  assert(r.status === 200, `health ${r.status}`);
  return r.json;
}

async function waitForHealthy(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const login = await call("POST", "/api/auth/login", { email: EMAIL, password: PASSWORD }, { auth: false });
      if (login.status === 200) {
        token = login.json.token;
        const h = await health();
        if (["api", "database", "redis", "worker", "n8n"].every((k) => h[k].status === "ONLINE")) return h;
      }
    } catch {
      /* still restarting */
    }
    if (Date.now() > deadline) throw new Error("services did not recover in time");
    await sleep(5000);
  }
}

let snapshotBefore = null;
let chosenWorkflow = null;
let testRunExecutionId = null;
let testRunKind = null;

async function main() {
  console.log(`Smoke test against ${BASE}\n`);
  const onlyPersistence = process.env.SMOKE_ONLY_PERSISTENCE === "1";

  if (!onlyPersistence) {
    await step(1, "Open web", async () => {
      const r = await call("GET", "/login", undefined, { auth: false });
      assert(r.status === 200 && /<html/i.test(r.text), `GET /login → ${r.status}`);
      return "login page served";
    });
    await step(2, "Login", async () => {
      const bad = await call("POST", "/api/auth/login", { email: EMAIL, password: `${PASSWORD}-wrong` }, { auth: false });
      assert(bad.status === 401, `wrong password should be 401, got ${bad.status}`);
      const r = await call("POST", "/api/auth/login", { email: EMAIL, password: PASSWORD }, { auth: false });
      assert(r.status === 200 && r.json?.token, `login → ${r.status}`);
      token = r.json.token;
      return "JWT issued; wrong password rejected (401)";
    });
    let h;
    await step(3, "Dashboard loads", async () => {
      const r = await call("GET", "/api/dashboard");
      assert(r.status === 200 && r.json?.health, `dashboard → ${r.status}`);
      h = r.json.health;
      return `system=${r.json.system}${r.json.testModeOverrides ? " (TEST MODE)" : ""}`;
    });
    const comp = (n, key, label) =>
      step(n, `${label} connected`, async () => {
        assert(h?.[key]?.status === "ONLINE", `${key}: ${h?.[key]?.status} — ${h?.[key]?.message}`);
        return h[key].message;
      });
    await comp(4, "n8n", "n8n");
    await comp(5, "database", "Database");
    await comp(6, "redis", "Redis");
    await comp(7, "worker", "Worker");
    await step(8, "FFmpeg verified on worker", async () => {
      assert(h?.worker?.details?.ffmpeg && h?.worker?.details?.ffprobe, "worker did not report ffmpeg/ffprobe");
      return `${h.worker.details.ffmpeg} | ${h.worker.details.ffprobe}`;
    });
    await step(9, "22 workflows present in n8n", async () => {
      assert(h?.n8n?.details?.present === 22, `present=${h?.n8n?.details?.present}`);
      return "22/22";
    });
    await step(10, "Workflows inactive unless enabled", async () => {
      const wfs = (await call("GET", "/api/workflows")).json;
      const unexpected = wfs.filter((w) => w.n8nActive && !w.enabled).map((w) => w.key);
      assert(unexpected.length === 0, `active in n8n but not enabled: ${unexpected.join(", ")}`);
      const active = h.n8n.details.active;
      if (process.env.SMOKE_EXPECT_ALL_INACTIVE === "1") assert(active === 0, `${active} active`);
      return `${active} active in n8n, all of them enabled on purpose`;
    });

    snapshotBefore = (await call("GET", "/api/workflows")).json.map((w) => ({ key: w.key, readiness: w.readiness, failing: w.readinessDetail.filter((d) => !d.ok).length }));

    const provider = process.env.SMOKE_PROVIDER;
    await step(11, "Configure an integration", async () => {
      if (!provider) return { skipped: "SMOKE_PROVIDER not set — existing integrations are re-tested in step 12 instead" };
      const r = await call("PUT", `/api/integrations/${provider}`, JSON.parse(process.env.SMOKE_PROVIDER_JSON || "{}"));
      assert(r.status === 200, `save → ${r.status} ${r.json?.message ?? ""}`);
      const list = (await call("GET", "/api/integrations")).json;
      const row = list.find((i) => i.provider === provider);
      const leaked = JSON.stringify(row).includes(Object.values(JSON.parse(process.env.SMOKE_PROVIDER_JSON || "{}").secrets ?? {})[0] ?? "\u0000none");
      assert(!leaked, "secret value appeared in the API response");
      return `${provider} saved → ${row.status}; secret masked (${row.fields.find((f) => f.secret)?.maskedPreview ?? "n/a"})`;
    });
    await step(12, "Test provider", async () => {
      const list = (await call("GET", "/api/integrations")).json;
      const targets = provider ? [provider] : list.filter((i) => i.configured && i.authType !== "INFRA").map((i) => i.provider);
      if (!targets.length) return { skipped: "no configured integrations to test" };
      const out = [];
      for (const p of targets) {
        const r = await call("POST", `/api/integrations/${p}/test`);
        out.push(`${p}: ${r.json?.ok ? "CONNECTED" : "TEST FAILED"} (${r.json?.message ?? r.status})`);
      }
      return out.join(" | ");
    });
    await step(13, "Readiness recalculated", async () => {
      const after = (await call("GET", "/api/workflows")).json;
      const changed = after.filter((w) => {
        const b = snapshotBefore.find((x) => x.key === w.key);
        return b && (b.readiness !== w.readiness || b.failing !== w.readinessDetail.filter((d) => !d.ok).length);
      });
      const ready = after.filter((w) => w.readiness === "READY").map((w) => w.key);
      return `${changed.length} workflow(s) changed readiness; READY now: ${ready.length ? ready.join(", ") : "none"}`;
    });

    await step(14, "Enable a READY workflow", async () => {
      const wfs = (await call("GET", "/api/workflows")).json;
      chosenWorkflow = wfs.find((w) => w.key === process.env.SMOKE_WORKFLOW) ?? wfs.find((w) => w.readiness === "READY" && w.triggerKind === "manual") ?? wfs.find((w) => w.readiness === "READY");
      if (!chosenWorkflow) {
        const blocked = wfs.find((w) => w.readiness !== "READY");
        const r = await call("POST", `/api/workflows/${blocked.key}/enable`);
        assert(r.status === 409, `enabling a BLOCKED workflow must be refused, got ${r.status}`);
        return { skipped: `no READY workflow (configure providers first); verified BLOCKED ${blocked.key} is refused: ${r.json.message.slice(0, 120)}` };
      }
      const r = await call("POST", `/api/workflows/${chosenWorkflow.key}/enable`);
      assert(r.status === 200, `enable → ${r.status} ${r.json?.message ?? ""}`);
      const wf = (await call("GET", "/api/workflows")).json.find((w) => w.key === chosenWorkflow.key);
      assert(wf.enabled && wf.n8nActive, "n8n does not report it active");
      return `${chosenWorkflow.key} active in n8n`;
    });
    await step(15, "Execute workflow (TEST RUN)", async () => {
      if (!chosenWorkflow) return { skipped: "no READY workflow" };
      const r = await call("POST", `/api/workflows/${chosenWorkflow.key}/test-run`);
      assert(r.status === 200, `test-run → ${r.status}`);
      testRunExecutionId = r.json.executionId ?? null;
      testRunKind = r.json.kind;
      return `${r.json.kind}: ${r.json.ok ? "OK" : "FAILED"} — ${r.json.message.slice(0, 200)}`;
    });
    await step(16, "Execution visible in UI data", async () => {
      if (!chosenWorkflow || testRunKind !== "execution") return { skipped: `no execution to look for (test kind: ${testRunKind ?? "none"})` };
      for (let i = 0; i < 12; i++) {
        const list = (await call("GET", `/api/executions?workflowKey=${chosenWorkflow.key}&limit=10`)).json.items;
        if (list.length && (!testRunExecutionId || list.some((e) => e.externalId === testRunExecutionId))) return `${list[0].status} ${list[0].trigger ?? ""} ${list[0].error ?? ""}`.slice(0, 200);
        await sleep(5000);
      }
      throw new Error("execution did not appear in /api/executions");
    });
    await step(17, "Error paths are safe", async () => {
      const blocked = (await call("GET", "/api/workflows")).json.find((w) => w.readiness !== "READY");
      if (blocked) {
        const r = await call("POST", `/api/workflows/${blocked.key}/enable`);
        assert(r.status === 409 && r.json.message, "blocked enable not refused with a reason");
      }
      const unauth = await fetch(`${BASE}/api/integrations`);
      assert(unauth.status === 401, `unauthenticated call → ${unauth.status}`);
      const tg = await fetch(`${BASE}/api/telegram/webhook`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      assert(tg.status === 403, `unsigned Telegram webhook → ${tg.status}`);
      const internal = await fetch(`${BASE}/internal/n8n/runtime-env`);
      assert(internal.status === 404 || internal.status === 403, `internal route reachable publicly (${internal.status})`);
      const listing = (await call("GET", "/api/integrations")).text;
      assert(!/-----BEGIN [A-Z ]*PRIVATE KEY-----|"apiKey":"(sk|gsk|re)_/.test(listing), "secret material in /api/integrations");
      return "blocked enable → 409 with reason; unauthenticated → 401; forged Telegram webhook → 403; internal routes not public; no secrets in responses";
    });
    await step(18, "Disable workflow", async () => {
      if (!chosenWorkflow) return { skipped: "nothing was enabled" };
      const r = await call("POST", `/api/workflows/${chosenWorkflow.key}/disable`);
      assert(r.status === 200, `disable → ${r.status}`);
      const wf = (await call("GET", "/api/workflows")).json.find((w) => w.key === chosenWorkflow.key);
      assert(!wf.enabled && !wf.n8nActive, "still active");
      return `${chosenWorkflow.key} inactive in n8n`;
    });
  }

  const before = { integrations: (await call("GET", "/api/integrations")).json?.map((i) => `${i.provider}:${i.status}`).sort(), active: (await call("GET", "/api/workflows")).json?.filter((w) => w.n8nActive).map((w) => w.key).sort() };
  await step(19, "Restart services", async () => {
    if (!process.env.SMOKE_RESTART_CMD) return { skipped: "SMOKE_RESTART_CMD not set — restart from the platform, then run again with SMOKE_ONLY_PERSISTENCE=1" };
    execSync(process.env.SMOKE_RESTART_CMD, { stdio: "inherit" });
    await sleep(10_000);
    await waitForHealthy(6 * 60_000);
    return "all core services back ONLINE";
  });
  await step(20, "Persistence after restart", async () => {
    const h = await waitForHealthy(3 * 60_000);
    assert(h.n8n.details.present === 22, `n8n workflows present: ${h.n8n.details.present}`);
    const after = { integrations: (await call("GET", "/api/integrations")).json.map((i) => `${i.provider}:${i.status}`).sort(), active: (await call("GET", "/api/workflows")).json.filter((w) => w.n8nActive).map((w) => w.key).sort() };
    assert(JSON.stringify(after.integrations) === JSON.stringify(before.integrations), "integration states changed across restart");
    assert(JSON.stringify(after.active) === JSON.stringify(before.active), `active workflows changed: ${before.active} → ${after.active}`);
    return `22/22 workflows, ${after.active.length} active (unchanged), ${after.integrations.length} integration states unchanged`;
  });

  const failed = results.filter((r) => r.status === "FAIL");
  console.log(`\n${results.filter((r) => r.status === "PASS").length} passed, ${results.filter((r) => r.status === "SKIPPED").length} skipped, ${failed.length} failed`);
  console.log(JSON.stringify({ base: BASE, at: new Date().toISOString(), results }, null, 2));
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
