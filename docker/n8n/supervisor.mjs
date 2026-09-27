#!/usr/bin/env node
/**
 * Eki n8n supervisor — PID 1 (under tini) of the n8n container.
 *
 * Why it exists: the 22 workflows read their configuration through `$env.*`,
 * and n8n only reads its environment at process start. Rather than anyone
 * editing n8n's environment variables, this supervisor:
 *
 *   1. fetches the runtime environment the Control Center computes from
 *      Integrations/Settings (GET <CONTROL_CENTER_INTERNAL_URL>/internal/n8n/runtime-env,
 *      private network, shared INTERNAL_API_TOKEN);
 *   2. starts `n8n start` with it;
 *   3. polls the environment's version hash and gracefully restarts n8n when
 *      an admin changes something (n8n's own graceful shutdown lets running
 *      executions finish);
 *   4. restarts n8n if it crashes (bounded — repeated crashes exit the
 *      container so the platform's restart policy takes over);
 *   5. serves an internal HTTP endpoint (SUPERVISOR_PORT, token-protected)
 *      used by the Control Center's TEST RUN button to run a workflow once
 *      with `n8n execute --id=<id>`.
 *
 * Platform variables (N8N_*, DB_*, EXECUTIONS_*, TZ, ...) always come from
 * the container's own environment and can never be overridden by the
 * runtime environment.
 *
 * Plain Node, no dependencies (runs on the node binary inside the n8n image).
 */
import { spawn } from "node:child_process";
import http from "node:http";

const CC_URL = (process.env.CONTROL_CENTER_INTERNAL_URL || "").replace(/\/+$/, "");
const TOKEN = process.env.INTERNAL_API_TOKEN || "";
const POLL_MS = Number(process.env.N8N_ENV_POLL_SECONDS || 20) * 1000;
const BOOT_WAIT_MS = Number(process.env.N8N_ENV_WAIT_SECONDS || 90) * 1000;
const PORT = Number(process.env.SUPERVISOR_PORT || 5690);
const LISTEN = process.env.SUPERVISOR_LISTEN_ADDRESS || "::";
const PROTECTED = /^(N8N_|DB_|EXECUTIONS_|QUEUE_|GENERIC_TIMEZONE$|TZ$|NODE_|PATH$|HOME$|CONTROL_CENTER_|INTERNAL_API_TOKEN$|SUPERVISOR_|WEBHOOK_URL$)/;
const ALLOWED = /^[A-Z][A-Z0-9_]{1,63}$/;

const log = (msg, extra = "") => console.log(`[supervisor] ${new Date().toISOString()} ${msg}${extra ? " " + extra : ""}`);

let child = null;
let runtimeEnv = {};
let envVersion = null;
let restarting = false;
let stopping = false;
let crashes = [];
let restarts = 0;
let lastEnvFetchOk = null;
let runInProgress = false;

async function fetchJson(path) {
  if (!CC_URL || !TOKEN) throw new Error("CONTROL_CENTER_INTERNAL_URL / INTERNAL_API_TOKEN not set");
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`${CC_URL}${path}`, { headers: { "x-internal-token": TOKEN }, signal: controller.signal });
    if (!res.ok) throw new Error(`Control Center responded ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function sanitize(env) {
  const out = {};
  for (const [k, v] of Object.entries(env || {})) {
    if (!ALLOWED.test(k) || PROTECTED.test(k) || typeof v !== "string") continue;
    out[k] = v;
  }
  return out;
}

async function loadEnv() {
  const body = await fetchJson("/internal/n8n/runtime-env");
  runtimeEnv = sanitize(body.env);
  envVersion = body.version;
  lastEnvFetchOk = new Date().toISOString();
  log(`runtime environment loaded`, `version=${envVersion} keys=${Object.keys(runtimeEnv).length}`);
}

function childEnv(extra = {}) {
  return { ...process.env, ...runtimeEnv, ...extra };
}

function startN8n() {
  log("starting n8n");
  child = spawn("n8n", ["start"], { env: childEnv(), stdio: "inherit" });
  const me = child;
  me.on("exit", (code, signal) => {
    if (child === me) child = null;
    if (stopping || restarting) return;
    log(`n8n exited unexpectedly`, `code=${code} signal=${signal}`);
    const now = Date.now();
    crashes = crashes.filter((t) => now - t < 120_000);
    crashes.push(now);
    if (crashes.length > 5) {
      log("n8n crashed more than 5 times in 2 minutes — exiting so the platform restarts the container");
      process.exit(1);
    }
    setTimeout(startN8n, 3000 * crashes.length);
  });
}

function stopN8n(timeoutMs = 60_000) {
  return new Promise((resolve) => {
    const c = child;
    if (!c) return resolve();
    const timer = setTimeout(() => {
      log("n8n did not stop in time — killing");
      c.kill("SIGKILL");
    }, timeoutMs);
    c.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    c.kill("SIGTERM");
  });
}

async function restartN8n(reason) {
  if (restarting) return;
  restarting = true;
  try {
    log(`restarting n8n: ${reason}`);
    await stopN8n();
    restarts += 1;
    startN8n();
  } finally {
    restarting = false;
  }
}

async function pollLoop() {
  for (;;) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    if (stopping) return;
    try {
      const { version } = await fetchJson("/internal/n8n/runtime-env/version");
      lastEnvFetchOk = new Date().toISOString();
      if (version && version !== envVersion) {
        // Debounce: admins often save several integrations in a row.
        await new Promise((r) => setTimeout(r, 5000));
        await loadEnv();
        await restartN8n(`configuration changed (version ${envVersion})`);
      }
    } catch (err) {
      // Control Center temporarily unreachable: keep n8n running as-is.
    }
  }
}

/** Pulls a readable message out of `n8n execute` output (its error block is JSON). */
function extractError(out) {
  const missing = /(The workflow with the id "[^"]+" does not exist\.)/.exec(out);
  if (missing) return missing[1];
  const idx = out.search(/Execution error:/);
  if (idx >= 0) {
    const jsonStart = out.indexOf("{", idx);
    if (jsonStart >= 0) {
      try {
        const parsed = JSON.parse(out.slice(jsonStart, out.lastIndexOf("}") + 1));
        const err = parsed?.data?.resultData?.error || parsed?.error || {};
        const node = err.node?.name || parsed?.data?.resultData?.lastNodeExecuted;
        const msg = [err.message, err.description].filter(Boolean).join(" — ");
        if (msg) return `${node ? `[${node}] ` : ""}${msg}`.replace(/\s+/g, " ").slice(0, 600);
      } catch {
        /* fall through */
      }
    }
    return out.slice(idx, idx + 600).replace(/\s+/g, " ");
  }
  return out.split("\n").filter((l) => /error/i.test(l)).slice(-3).join(" | ").replace(/\s+/g, " ").slice(0, 600);
}

function runOnce(workflowId) {
  return new Promise((resolve) => {
    const startedAt = new Date().toISOString();
    const p = spawn("n8n", ["execute", `--id=${workflowId}`], {
      env: childEnv({ N8N_RUNNERS_BROKER_PORT: process.env.SUPERVISOR_RUN_BROKER_PORT || "5680" }),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    p.stdout.on("data", (c) => (out += c.toString()));
    p.stderr.on("data", (c) => (out += c.toString()));
    const timer = setTimeout(() => p.kill("SIGKILL"), 5 * 60_000);
    p.on("close", (code) => {
      clearTimeout(timer);
      const success = /Execution was successful:/.test(out) && /"status":\s*"success"/.test(out);
      let error = null;
      if (!success) {
        error = extractError(out) || `n8n execute exited ${code}`;
      }
      resolve({ ok: success, status: success ? "success" : "error", error, startedAt, finishedAt: new Date().toISOString() });
    });
  });
}

function serve() {
  const server = http.createServer(async (req, res) => {
    const send = (status, body) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
    if (req.method === "GET" && req.url === "/health") {
      return send(child ? 200 : 503, { n8nRunning: Boolean(child), envVersion, lastEnvFetchOk, restarts, runInProgress });
    }
    if (req.headers["x-internal-token"] !== TOKEN || !TOKEN) return send(403, { message: "Forbidden" });
    if (req.method === "POST" && req.url === "/run") {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", async () => {
        let workflowId;
        try {
          workflowId = JSON.parse(raw || "{}").workflowId;
        } catch {
          return send(400, { message: "Invalid JSON" });
        }
        if (!/^[A-Za-z0-9]{8,40}$/.test(String(workflowId || ""))) return send(400, { message: "Invalid workflowId" });
        if (runInProgress) return send(409, { message: "Another test run is in progress" });
        runInProgress = true;
        try {
          send(200, await runOnce(workflowId));
        } finally {
          runInProgress = false;
        }
      });
      return;
    }
    if (req.method === "POST" && req.url === "/reload") {
      try {
        await loadEnv();
        send(202, { accepted: true, envVersion });
        void restartN8n("reload requested by the Control Center");
      } catch (err) {
        send(502, { message: String(err && err.message) });
      }
      return;
    }
    send(404, { message: "Not found" });
  });
  server.listen(PORT, LISTEN, () => log(`internal endpoint on ${LISTEN}:${PORT}`));
}

async function main() {
  const deadline = Date.now() + BOOT_WAIT_MS;
  for (;;) {
    try {
      await loadEnv();
      break;
    } catch (err) {
      if (Date.now() > deadline) {
        log(`could not load runtime environment (${err.message}) — starting n8n without it; will apply it as soon as the Control Center answers`);
        break;
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  serve();
  startN8n();
  void pollLoop();
}

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, async () => {
    stopping = true;
    log(`${sig} received — stopping n8n gracefully`);
    await stopN8n();
    process.exit(0);
  });
}

main();
