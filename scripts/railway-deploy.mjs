#!/usr/bin/env node
/**
 * Automated, idempotent Railway deployment of the native Eki AI Automation
 * Control Center (web, api, worker + Postgres, Redis, Bucket), followed by
 * live verification. Every command and JSON shape used here was checked
 * against the Railway CLI source (railwayapp crate v5.62.1).
 *
 * The native workflow engine executes all 22 workflows directly — there is
 * NO n8n service in this topology. This script never creates, redeploys, or
 * otherwise requires n8n; if an n8n service still exists in the target
 * Railway project from before the migration, this script does not touch it
 * (removing it, if wanted, is a separate, explicit decision — not this
 * script's job).
 *
 * Run from the repository root, on a machine where `railway login` is done
 * and the target project is linked (`railway link`), or pass --init "<name>"
 * to create a new project:
 *
 *   ADMIN_EMAIL=you@company.com BUCKET_REGION=ams node scripts/railway-deploy.mjs
 *
 * Options / environment:
 *   ADMIN_EMAIL        (required on the first run) Control Center admin
 *                      e-mail; ignored once the deployment is bootstrapped
 *   ADMIN_PASSWORD     current admin password, for verification only — needed
 *                      after the bootstrap password was changed in Settings
 *   BUCKET_REGION      (required if a bucket must be created) sjc | iad | ams | sin
 *   BUCKET_NAME        bucket to use when the environment already has several
 *   GITHUB_REPO        default: derived from `git remote get-url origin`
 *   GITHUB_BRANCH      default: main
 *   --init "<name>"    create a new Railway project first
 *   --verify-only      skip provisioning/deploys, only run the verification
 *   --no-smoke         skip scripts/smoke-test.mjs
 *   --check-cli        read-only: show which Railway executable is used, its
 *                      version, login and linked project/environment, then exit
 *   RAILWAY_CLI        path to the railway executable, if PATH lookup fails
 *                      (see scripts/lib/railway-cli.mjs for the resolution order)
 *
 * Safety:
 *   - Secret values are generated here (crypto.randomBytes), sent to Railway
 *     only via `railway variable set KEY --stdin` (never on a command line),
 *     never printed. Existing secrets are REUSED — re-running never rotates
 *     AUTOMATION_SECRET_KEY (that would orphan stored credentials).
 *   - The generated admin password is written ONCE to
 *     ~/.eki-control-center/<project>-credentials.txt (mode 0600).
 *   - Nothing is duplicated: every resource is looked up before creation.
 */
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRailwayCli } from "./lib/railway-cli.mjs";

// fileURLToPath, not URL.pathname: the latter keeps %20 for spaces and yields
// "/C:/..." on Windows — an invalid cwd, which Node reports as "spawnSync railway ENOENT".
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const flagValue = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const APP_SERVICES = ["api", "worker", "web"];
// `railway environment edit --service-config <svc> configFile <path>` (the
// documented config-as-code mechanism the railway/*.json files were written
// for) was tried against a real Railway account and reproduced as a silent
// no-op: it always exits 0 and prints `{"committed":false,"message":"No
// changes to apply"}` — for that path, for its own build.builder /
// build.dockerfilePath / deploy.numReplicas equivalents, and even for a
// deliberately invalid dot-path, all identically. A subsequent build then
// used Railpack instead of the intended Dockerfile ("Railpack could not
// determine how to build the app"). The actually-effective mechanism,
// confirmed by a real build log switching from Railpack to the correct
// multi-stage Dockerfile: the legacy `RAILWAY_DOCKERFILE_PATH` build
// variable (set like any other var, honored at build time). It only covers
// `build.dockerfilePath`; `deploy.healthcheckPath` / `restartPolicyType` /
// `numReplicas` have no confirmed variable equivalent (see DEPLOYMENT.md) —
// Railway's defaults (TCP-only health check, ON_FAILURE/10 retries, 1
// replica) apply instead until that gap is closed.
const DOCKERFILE_PATHS = { api: "docker/Dockerfile.api", worker: "docker/Dockerfile.worker", web: "docker/Dockerfile.web" };
const SECRET_KEYS = ["AUTOMATION_SECRET_KEY", "JWT_SECRET", "INTERNAL_API_TOKEN"];
const secretTargets = {
  AUTOMATION_SECRET_KEY: ["api", "worker"],
  JWT_SECRET: ["api"],
  INTERNAL_API_TOKEN: ["api"],
};
const report = { startedAt: new Date().toISOString(), steps: [], services: {}, verification: {} };

// ------------------------------------------------------------------ helpers
function log(msg) {
  console.log(`\x1b[36m[deploy]\x1b[0m ${msg}`);
}
function warn(msg) {
  console.log(`\x1b[33m[deploy] WARN\x1b[0m ${msg}`);
}
function fail(msg) {
  console.error(`\x1b[31m[deploy] FAILED\x1b[0m ${msg}`);
  writeReport("failed", msg);
  process.exit(1);
}
function step(name, detail) {
  report.steps.push({ at: new Date().toISOString(), name, detail });
  log(`${name}${detail ? ` — ${detail}` : ""}`);
}

let cli;
/** The Railway executable, resolved once from PATH without a shell (Windows: .exe or npm .cmd shim target). */
function railwayCli() {
  if (!cli) {
    try {
      cli = resolveRailwayCli();
    } catch (err) {
      fail(err.message);
    }
  }
  return cli;
}

/** Runs the Railway CLI. `secret: true` = output may contain secrets: never echoed. */
function rw(cliArgs, { input, allowFail = false, secret = false, interactive = false } = {}) {
  const { command, args: prefix } = railwayCli();
  const res = spawnSync(command, [...prefix, ...cliArgs], {
    cwd: ROOT,
    input,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
    stdio: interactive ? ["inherit", "pipe", "inherit"] : ["pipe", "pipe", "pipe"],
  });
  if (res.error) fail(`could not run railway ${cliArgs[0]} (${command}): ${res.error.message}`);
  if (res.status !== 0 && !allowFail) {
    const detail = secret ? "(output suppressed: may contain secrets)" : `${res.stderr ?? ""}${res.stdout ?? ""}`.trim().slice(-1500);
    fail(`railway ${cliArgs.filter((a) => !a.includes("=")).join(" ")} exited ${res.status}\n${detail}`);
  }
  return { ok: res.status === 0, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}
function rwJson(cliArgs, opts = {}) {
  const out = rw([...cliArgs, "--json"], opts);
  if (!out.ok) return null;
  try {
    return JSON.parse(out.stdout);
  } catch {
    if (opts.secret) fail(`railway ${cliArgs[0]} returned non-JSON output (suppressed)`);
    fail(`railway ${cliArgs.join(" ")} returned non-JSON output:\n${out.stdout.slice(0, 500)}`);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const secret = () => crypto.randomBytes(32).toString("hex");
function password() {
  // 8+ chars incl. an uppercase letter and a digit.
  return `Eki-${crypto.randomBytes(18).toString("base64url").replace(/[-_]/g, "x")}9Z`;
}

function writeReport(status, error) {
  report.finishedAt = new Date().toISOString();
  report.status = status;
  if (error) report.error = error;
  const dir = path.join(os.homedir(), ".eki-control-center");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `deploy-report-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(`\nReport (no secrets): ${file}`);
}

function listServices() {
  const rows = rwJson(["service", "list"]) ?? [];
  // status/deploymentId = the deployment currently SERVING; latest = the newest
  // one (may still be building, or FAILED while the previous one keeps serving).
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status ?? null,
    deploymentId: r.deploymentId ?? null,
    latest: r.latestDeployment ? { id: r.latestDeployment.id, status: r.latestDeployment.status } : null,
    source: r.source ?? null,
    url: r.url ?? null,
  }));
}
/** `domain list --json` returns { domains: [{ domain: "<host>", ... }] } (bare host names). */
function domainUrls(svc) {
  const rows = rwJson(["domain", "list", "--service", svc], { allowFail: true })?.domains ?? [];
  return rows.map((d) => (typeof d === "string" ? d : d.domain)).filter(Boolean).map((h) => (h.startsWith("http") ? h : `https://${h}`));
}
const byName = (services, name) => services.find((s) => s.name === name);
const byImage = (services, re) => services.find((s) => re.test(JSON.stringify(s.source ?? {})));

function getVars(service) {
  // Raw values stay in memory only — never printed. Values are RENDERED (what the
  // service sees at deploy time, references resolved); SEALED variables are
  // present with a null value — they exist and must never be recreated.
  return rwJson(["variable", "list", "--service", service], { secret: true }) ?? {};
}
const has = (vars, key) => Object.prototype.hasOwnProperty.call(vars, key);

function githubRepo() {
  if (process.env.GITHUB_REPO) return process.env.GITHUB_REPO;
  const r = spawnSync("git", ["remote", "get-url", "origin"], { cwd: ROOT, encoding: "utf8" });
  const m = /github\.com[:/]([^/]+\/[^/.\s]+?)(?:\.git)?\s*$/.exec(r.stdout ?? "");
  if (!m) fail("Could not derive the GitHub repo from `git remote get-url origin`; set GITHUB_REPO=owner/repo");
  return m[1];
}

// ------------------------------------------------------------ provisioning
async function provision() {
  const version = rw(["--version"]).stdout.trim();
  step("Railway CLI", `${version} — ${railwayCli().source}`);
  const major = Number(/(\d+)\.\d+\.\d+/.exec(version)?.[1] ?? 0);
  if (major < 5) fail(`this script needs Railway CLI v5+ (bucket, tcp-proxy, service source, environment edit). Run: railway upgrade`);
  const who = rw(["whoami"], { allowFail: true });
  if (!who.ok) fail("not logged in — run `railway login` first");
  step("Authenticated", who.stdout.trim().split("\n").pop());

  if (flagValue("--init")) {
    const linked = rw(["status", "--json"], { allowFail: true });
    if (linked.ok) warn("--init ignored: a project is already linked in this directory");
    else rw(["init", "--name", flagValue("--init")]);
  }
  const status = rw(["status", "--json"], { allowFail: true });
  if (!status.ok) fail("no Railway project is linked here. Run `railway link` (existing project) or re-run with --init \"Eki AI Automation\"");
  const project = JSON.parse(status.stdout);
  report.project = project.name;
  step("Linked project", `${project.name} (${project.id})`);

  let adminEmail = process.env.ADMIN_EMAIL;
  const repo = githubRepo();
  const branch = process.env.GITHUB_BRANCH || "main";
  step("Source", `${repo}@${branch}`);

  // ---- databases (never duplicated)
  let services = listServices();
  step("Existing services", services.map((s) => `${s.name}${s.status ? `(${s.status})` : ""}`).join(", ") || "none");
  let pg = byName(services, "Postgres") ?? byImage(services, /postgres/i);
  if (!pg) {
    rw(["add", "--database", "postgres"]);
    services = listServices();
    pg = byName(services, "Postgres") ?? byImage(services, /postgres/i);
    if (!pg) fail("Postgres was added but could not be found in `railway service list`");
    step("Created Postgres", pg.name);
  } else step("Postgres exists", pg.name);
  let redis = byName(services, "Redis") ?? byImage(services, /redis/i);
  if (!redis) {
    rw(["add", "--database", "redis"]);
    services = listServices();
    redis = byName(services, "Redis") ?? byImage(services, /redis/i);
    if (!redis) fail("Redis was added but could not be found in `railway service list`");
    step("Created Redis", redis.name);
  } else step("Redis exists", redis.name);
  report.services.Postgres = { name: pg.name };
  report.services.Redis = { name: redis.name };

  // ---- databases private: remove public TCP proxies
  for (const db of [pg, redis]) {
    const proxies = rwJson(["tcp-proxy", "list", "--service", db.name], { allowFail: true })?.proxies ?? [];
    for (const p of proxies) {
      rw(["tcp-proxy", "delete", p.id, "--service", db.name, "--yes"]);
      step(`Removed public TCP proxy from ${db.name}`, `${p.domain}:${p.proxyPort}`);
    }
  }

  // ---- bucket
  const buckets = rwJson(["bucket", "list"]) ?? [];
  let bucket;
  if (process.env.BUCKET_NAME) {
    bucket = buckets.find((b) => b.name === process.env.BUCKET_NAME);
    if (!bucket) fail(`BUCKET_NAME=${process.env.BUCKET_NAME} not found; existing: ${buckets.map((b) => b.name).join(", ") || "none"}`);
  } else if (buckets.length === 1) {
    bucket = buckets[0];
  } else if (buckets.length > 1) {
    fail(`several buckets exist (${buckets.map((b) => b.name).join(", ")}); set BUCKET_NAME`);
  } else {
    const region = process.env.BUCKET_REGION;
    if (!["sjc", "iad", "ams", "sin"].includes(region ?? "")) fail("no bucket exists: set BUCKET_REGION to one of sjc (US West), iad (US East), ams (EU West), sin (Asia Pacific)");
    bucket = rwJson(["bucket", "create", "eki-media", "--region", region]);
    step("Created bucket", `${bucket.name} in ${bucket.region}`);
  }
  report.services.Bucket = { name: bucket.name };
  step("Bucket", bucket.name);

  // ---- app services (empty first, so nothing deploys before it is configured)
  for (const name of APP_SERVICES) {
    if (!byName(services, name)) {
      rw(["add", "--service", name]);
      step(`Created service ${name}`);
    }
  }
  services = listServices();
  for (const name of APP_SERVICES) if (!byName(services, name)) fail(`service ${name} missing after creation`);

  // ---- Dockerfile selection (see DOCKERFILE_PATHS comment above for why
  // this is a plain build variable and not `environment edit --service-config`)
  for (const name of APP_SERVICES) {
    if (getVars(name).RAILWAY_DOCKERFILE_PATH !== DOCKERFILE_PATHS[name]) {
      rw(["variable", "set", `RAILWAY_DOCKERFILE_PATH=${DOCKERFILE_PATHS[name]}`, "--service", name, "--skip-deploys"]);
    }
  }
  step("Dockerfile path", APP_SERVICES.map((n) => `${n}→${DOCKERFILE_PATHS[n]}`).join(", "));

  // ---- public domain (web only — api/worker stay on the private network)
  const domainOf = (svc) => domainUrls(svc)[0] ?? null;
  for (const [svc, port] of [["web", "3200"]]) {
    if (!domainOf(svc)) rwJson(["domain", "--service", svc, "--port", port]);
    report.services[svc] = { ...(report.services[svc] ?? {}), url: domainOf(svc) };
    step(`Public domain ${svc}`, `${report.services[svc].url} → port ${port}`);
  }

  // ---- secrets: reuse existing values, generate only what is missing
  const current = Object.fromEntries(APP_SERVICES.map((s) => [s, getVars(s)]));
  const existsAnywhere = (key) => APP_SERVICES.some((s) => has(current[s], key));
  const pick = (key) => APP_SERVICES.map((s) => current[s][key]).find((v) => v) || null;
  for (const k of SECRET_KEYS) {
    // A sealed secret cannot be read back, so it cannot be copied to a service that lacks it.
    if (existsAnywhere(k) && !pick(k)) {
      const needs = APP_SERVICES.filter((s) => k in secretTargets && secretTargets[k].includes(s) && !has(current[s], k));
      if (needs.length) fail(`${k} is sealed on Railway and missing on ${needs.join(", ")}; unseal it or copy it there manually (a new value would orphan encrypted data)`);
    }
  }
  const secrets = Object.fromEntries(SECRET_KEYS.map((k) => [k, pick(k) || (existsAnywhere(k) ? null : secret())]));
  for (const k of SECRET_KEYS) {
    const values = new Set(secretTargets[k].map((s) => current[s]?.[k]).filter((x) => typeof x === "string" && x));
    if (values.size > 1) warn(`${k} differed between ${secretTargets[k].join(" and ")} (services could not talk to each other / decrypt); aligning all to the ${secretTargets[k][0]} value`);
  }
  const generated = SECRET_KEYS.filter((k) => !existsAnywhere(k));

  // Admin e-mail: once bootstrapped it must not change.
  const existingEmail = current.api.ADMIN_BOOTSTRAP_EMAIL;
  if (existingEmail && adminEmail && existingEmail.toLowerCase() !== adminEmail.toLowerCase()) warn(`ADMIN_EMAIL ignored: the deployment is already bootstrapped with ${existingEmail}`);
  adminEmail = existingEmail || adminEmail;
  if (!adminEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adminEmail)) fail("set ADMIN_EMAIL=<admin email>");

  const adminPassword = has(current.api, "ADMIN_BOOTSTRAP_PASSWORD") ? current.api.ADMIN_BOOTSTRAP_PASSWORD : password();
  if (!has(current.api, "ADMIN_BOOTSTRAP_PASSWORD")) {
    const dir = path.join(os.homedir(), ".eki-control-center");
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, `${project.name.replace(/[^\w.-]+/g, "_")}-credentials.txt`);
    fs.writeFileSync(
      file,
      [
        `Railway project: ${project.name}`,
        `Control Center login: ${adminEmail} / ${adminPassword ?? "(unchanged: existing value kept)"}`,
        "Change the Control Center password in Settings after the first login.",
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
    report.credentialsFile = file;
    step("Admin password", `written to ${file} (0600) — not printed`);
  }
  step("Secrets", generated.length ? `generated ${generated.join(", ")}; reused the rest` : "all reused (never rotated)");

  // ---- bucket credentials (read from Railway, never printed)
  const creds = rwJson(["bucket", "credentials", "--bucket", bucket.name], { secret: true });
  const s3 = {
    STORAGE_DRIVER: "s3",
    S3_ENDPOINT: creds.endpoint,
    S3_REGION: creds.region,
    S3_BUCKET: creds.bucketName,
    S3_FORCE_PATH_STYLE: /path/i.test(creds.urlStyle ?? "") ? "true" : "false",
  };
  const s3Secret = { S3_ACCESS_KEY_ID: creds.accessKeyId, S3_SECRET_ACCESS_KEY: creds.secretAccessKey };

  const PG = pg.name;
  const RD = redis.name;
  const plain = {
    api: {
      PORT: "4100",
      INTERNAL_PORT: "4110",
      DATABASE_URL: `\${{${PG}.DATABASE_URL}}`,
      REDIS_URL: `\${{${RD}.REDIS_URL}}`,
      ADMIN_BOOTSTRAP_EMAIL: adminEmail,
      PUBLIC_WEB_URL: "https://${{web.RAILWAY_PUBLIC_DOMAIN}}",
      WEB_ORIGIN: "https://${{web.RAILWAY_PUBLIC_DOMAIN}}",
      ...s3,
    },
    worker: {
      PORT: "4101",
      DATABASE_URL: `\${{${PG}.DATABASE_URL}}`,
      REDIS_URL: `\${{${RD}.REDIS_URL}}`,
      VIDEO_WORKER_CONCURRENCY: "1",
      ...s3,
    },
    web: {
      PORT: "3200",
      API_INTERNAL_URL: "http://${{api.RAILWAY_PRIVATE_DOMAIN}}:4100",
    },
  };
  const secretVars = {
    api: {
      AUTOMATION_SECRET_KEY: secrets.AUTOMATION_SECRET_KEY,
      JWT_SECRET: secrets.JWT_SECRET,
      INTERNAL_API_TOKEN: secrets.INTERNAL_API_TOKEN,
      ADMIN_BOOTSTRAP_PASSWORD: adminPassword,
      ...s3Secret,
    },
    worker: { AUTOMATION_SECRET_KEY: secrets.AUTOMATION_SECRET_KEY, ...s3Secret },
    web: {},
  };

  const changed = {};
  for (const svc of APP_SERVICES) {
    const setPlain = Object.entries(plain[svc]).filter(([k, v]) => {
      if (!has(current[svc], k)) return true;
      // References (${{...}}) are listed resolved, so they cannot be compared
      // textually: an existing non-empty value is kept (no redeploy on re-runs).
      if (v.includes("${{")) return current[svc][k] === "";
      return current[svc][k] !== null && current[svc][k] !== v;
    });
    if (setPlain.length) rw(["variable", "set", ...setPlain.map(([k, v]) => `${k}=${v}`), "--service", svc, "--skip-deploys"]);
    let secretCount = 0;
    for (const [k, v] of Object.entries(secretVars[svc])) {
      // Sealed (null) or already equal → leave untouched.
      if (has(current[svc], k) && (current[svc][k] === null || current[svc][k] === v)) continue;
      if (!v) fail(`internal: no value available for ${k} on ${svc}`);
      rw(["variable", "set", k, "--stdin", "--service", svc, "--skip-deploys"], { input: v, secret: true });
      secretCount += 1;
    }
    changed[svc] = setPlain.length + secretCount > 0;
    const leaked = Object.keys(current[svc]).filter((k) => k.startsWith("NEXT_PUBLIC_") || /^(OPENAI|RUNWAY|ELEVENLABS|GROQ|WHATSAPP|TELEGRAM_BOT|META|X_|TWITTER|RESEND|APIFY|BUFFER)/.test(k));
    if (leaked.length) warn(`${svc} has provider/browser variables that should not be set on Railway: ${leaked.join(", ")} (enter provider keys in Control Center → Integrations instead)`);
    step(`Variables ${svc}`, `${setPlain.length} plain + ${secretCount} secret updated (values not shown)`);
  }
  return { repo, branch, changed };
}

// ------------------------------------------------------------ deployment
async function waitForDeploy(svcName, previousDeploymentId, timeoutMin = 25) {
  const deadline = Date.now() + timeoutMin * 60_000;
  let last = "";
  for (;;) {
    const s = byName(listServices(), svcName);
    // Track the NEWEST deployment: the serving one stays SUCCESS while a new one fails.
    const dep = s?.latest;
    const st = dep?.status ?? "NONE";
    if (st !== last) log(`  ${svcName}: ${st}`);
    last = st;
    const fresh = dep?.id && dep.id !== previousDeploymentId;
    if (fresh && st === "SUCCESS") return { ...s, status: st, deploymentId: dep.id };
    if (fresh && ["FAILED", "CRASHED", "REMOVED", "SKIPPED"].includes(st)) {
      // Without an id, `railway logs` shows the last SUCCESSFUL deployment.
      console.log(`\n----- ${svcName} build logs (tail) -----`);
      console.log(rw(["logs", dep.id, "--service", svcName, "--build", "--lines", "80"], { allowFail: true }).stdout);
      console.log(`----- ${svcName} deploy logs (tail) -----`);
      console.log(rw(["logs", dep.id, "--service", svcName, "--deployment", "--lines", "80"], { allowFail: true }).stdout);
      fail(`${svcName} deployment ${dep.id} ${st}. Diagnose with the logs above before continuing.`);
    }
    if (Date.now() > deadline) fail(`${svcName} did not reach SUCCESS within ${timeoutMin} minutes (last status ${st})`);
    await sleep(10_000);
  }
}

async function waitForDatabase(name) {
  const deadline = Date.now() + 10 * 60_000;
  for (;;) {
    const s = byName(listServices(), name);
    if (s?.status === "SUCCESS") return;
    if (Date.now() > deadline) fail(`${name} is not running (status ${s?.status ?? "unknown"})`);
    await sleep(10_000);
  }
}

async function deploy({ repo, branch, changed }) {
  await waitForDatabase(report.services.Postgres.name);
  step("Postgres", "running");
  await waitForDatabase(report.services.Redis.name);
  step("Redis", "running");
  for (const svc of APP_SERVICES) {
    const before = byName(listServices(), svc);
    const connected = JSON.stringify(before.source ?? {}).includes(repo);
    if (!connected) {
      rwJson(["service", "source", "connect", "--service", svc, "--repo", repo, "--branch", branch]);
      step(`Deploy ${svc}`, `connected ${repo}@${branch} (build started)`);
    } else if (!changed[svc] && ["BUILDING", "DEPLOYING", "INITIALIZING", "QUEUED", "WAITING"].includes(before.latest?.status)) {
      step(`Deploy ${svc}`, `deployment ${before.latest.id} already in progress — waiting for it`);
      const done = await waitForDeploy(svc, null);
      report.services[svc] = { ...(report.services[svc] ?? {}), status: done.status, deploymentId: done.deploymentId };
      continue;
    } else if (changed[svc] || before.status !== "SUCCESS" || before.latest?.status !== "SUCCESS") {
      rw(["redeploy", "--service", svc, "--from-source", "--yes"]);
      step(`Deploy ${svc}`, `redeploy from ${branch} (configuration changed or last deploy not healthy)`);
    } else {
      step(`Deploy ${svc}`, "already SUCCESS and unchanged — skipped");
      report.services[svc] = { ...(report.services[svc] ?? {}), status: "SUCCESS" };
      continue;
    }
    const done = await waitForDeploy(svc, before.latest?.id ?? null);
    report.services[svc] = { ...(report.services[svc] ?? {}), status: done.status, deploymentId: done.deploymentId };
    console.log(`----- ${svc} deploy logs (tail) -----`);
    console.log(rw(["logs", done.deploymentId, "--service", svc, "--deployment", "--lines", "30"], { allowFail: true }).stdout);
  }
}

// ------------------------------------------------------------ verification
async function http(url, init = {}, attempt = 1) {
  let res;
  try {
    res = await fetch(url, { redirect: "manual", ...init, signal: AbortSignal.timeout(20_000) });
  } catch (err) {
    // Network-level error (e.g. a keep-alive socket the server already closed,
    // or the edge briefly unavailable): retry on a fresh connection.
    if (attempt >= 4) throw new Error(`${url}: ${err.cause?.code ?? err.cause?.message ?? err.message}`);
    await sleep(2_000 * attempt);
    return http(url, init, attempt + 1);
  }
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* html */
  }
  return { status: res.status, text, json };
}

async function verify() {
  const v = report.verification;
  const domain = (svc) => domainUrls(svc);
  const web = domain("web")[0];
  if (!web) fail("web has no public domain");
  report.services.web = { ...(report.services.web ?? {}), url: web };

  // Private services must have no public domain and databases no TCP proxy.
  const services = listServices();
  v.privateNetworking = {};
  for (const svc of ["api", "worker"]) v.privateNetworking[svc] = domain(svc).length === 0 ? "no public domain" : `PUBLIC: ${domain(svc).join(", ")}`;
  for (const db of [report.services.Postgres.name, report.services.Redis.name]) {
    const proxies = rwJson(["tcp-proxy", "list", "--service", db], { allowFail: true })?.proxies ?? [];
    v.privateNetworking[db] = proxies.length === 0 ? "no TCP proxy" : `PUBLIC TCP PROXY: ${proxies.map((p) => p.endpoint).join(", ")}`;
  }
  for (const s of services) report.services[s.name] = { ...(report.services[s.name] ?? {}), status: s.status };

  // Login with the bootstrap admin (read from Railway, not printed).
  // ADMIN_PASSWORD overrides: the bootstrap password stops working once the
  // admin changes it in Settings (and cannot be read if sealed).
  const apiVars = getVars("api");
  const email = apiVars.ADMIN_BOOTSTRAP_EMAIL || process.env.ADMIN_EMAIL;
  const pass = process.env.ADMIN_PASSWORD || apiVars.ADMIN_BOOTSTRAP_PASSWORD;
  if (!email || !pass) fail("cannot read the admin login from Railway (sealed?) — set ADMIN_PASSWORD for verification");
  let token = "";
  const until = Date.now() + 5 * 60_000;
  for (;;) {
    const login = await http(`${web}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: pass }) }).catch(() => null);
    if (login?.status === 200) {
      token = login.json.token;
      break;
    }
    if (login?.status === 401) fail(`admin login rejected at ${web} — if the password was changed in Settings, re-run with ADMIN_PASSWORD=<current password>`);
    if (Date.now() > until) fail(`cannot log in at ${web} (last status ${login?.status ?? "no response"})`);
    await sleep(10_000);
  }
  step("Control Center login", "OK");
  const auth = { authorization: `Bearer ${token}` };

  // Health: wait for every core component to be ONLINE. n8n (if the component still
  // appears at all) is deliberately excluded — it is optional legacy infrastructure
  // the native engine never requires, and must never block a healthy deployment.
  let health;
  const hDeadline = Date.now() + 8 * 60_000;
  for (;;) {
    health = (await http(`${web}/api/system/health`, { headers: auth })).json;
    const coreOnline = health && ["api", "database", "redis", "worker"].every((k) => health[k]?.status === "ONLINE");
    if (coreOnline) break;
    if (Date.now() > hDeadline) break;
    await sleep(15_000);
  }
  v.health = Object.fromEntries(Object.entries(health ?? {}).map(([k, c]) => [k, `${c.status} — ${c.message}`]));
  step("Health", Object.entries(health ?? {}).map(([k, c]) => `${k}=${c.status}`).join(" "));

  const workflows = (await http(`${web}/api/workflows`, { headers: auth })).json ?? [];
  v.workflows = { total: workflows.length, enabled: workflows.filter((w) => w.enabled).length, ready: workflows.filter((w) => w.readiness === "READY").length };
  step("Workflows (native engine view)", JSON.stringify(v.workflows));

  // Directly against the native engine's own API, from inside the api container.
  const engineCheck = await http(`${web}/api/engine/workflows`, { headers: auth });
  v.engineWorkflows = Array.isArray(engineCheck.json) ? { total: engineCheck.json.length, enabled: engineCheck.json.filter((w) => w.enabled).length } : `unexpected response (${engineCheck.status})`;
  step("Native engine workflows", JSON.stringify(v.engineWorkflows));

  // FFmpeg on the deployed worker.
  const st = rw(["ssh", "--service", "worker", "node", "dist/tools/selftest.js"], { allowFail: true, interactive: true });
  try {
    const r = JSON.parse(st.stdout.slice(st.stdout.indexOf("{")));
    v.ffmpeg = { ffmpeg: r.ffmpeg, ffprobe: r.ffprobe, subtitlesFilter: r.subtitlesFilter, qaOk: r.qa?.ok, checks: r.qa?.checks, output: r.output ? `${r.output.video?.width}x${r.output.video?.height} ${r.output.video?.codec}/${r.output.audio?.codec} ${r.output.durationSec}s` : null, storage: r.storage ? { uploadedBytes: r.storage.uploadedBytes, downloadMatches: r.storage.downloadMatches } : r.storageDriver };
  } catch {
    v.ffmpeg = `self-test did not return JSON: ${st.stdout.slice(-300)}`;
  }
  step("FFmpeg self-test", typeof v.ffmpeg === "string" ? v.ffmpeg : `QA ${v.ffmpeg.qaOk ? "PASS" : "FAIL"} — ${v.ffmpeg.output}`);

  // Security checks against the live deployment.
  const integrations = await http(`${web}/api/integrations`, { headers: auth });
  const html = (await http(`${web}/login`)).text;
  const chunks = [...new Set([...html.matchAll(/\/_next\/static\/[^"']+\.js/g)].map((m) => m[0]))];
  let bundle = "";
  for (const c of chunks) bundle += (await http(`${web}${c}`).catch(() => ({ text: "" }))).text;
  // Generic key shapes + this deployment's REAL secret values (held in memory only).
  const keyShapes = /(sk-[A-Za-z0-9]{20,}|gsk_[A-Za-z0-9]{20,}|re_[A-Za-z0-9]{20,}|\d{8,10}:AA[A-Za-z0-9_-]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;
  const realSecrets = ["AUTOMATION_SECRET_KEY", "JWT_SECRET", "INTERNAL_API_TOKEN", "ADMIN_BOOTSTRAP_PASSWORD", "S3_SECRET_ACCESS_KEY"]
    .map((k) => apiVars[k])
    .filter((x) => typeof x === "string" && x.length >= 12);
  const containsSecret = (text) => keyShapes.test(text) || realSecrets.some((x) => text.includes(x));
  v.security = {
    frontendBundle: containsSecret(bundle + html) || /[\w-]+\.railway\.internal/.test(bundle + html) ? "FOUND SECRET OR INTERNAL HOSTNAME" : `clean (${chunks.length} chunks scanned for ${realSecrets.length} deployment secrets + key shapes)`,
    nextPublicVars: Object.keys(getVars("web")).filter((k) => k.startsWith("NEXT_PUBLIC_")),
    integrationsResponse: integrations.status !== 200 ? `CHECK (${integrations.status})` : containsSecret(integrations.text) ? "FOUND SECRET VALUE" : "masked (no secret values)",
    unauthenticatedApi: (await http(`${web}/api/integrations`)).status,
    forgedTelegramWebhook: (await http(`${web}/api/telegram/webhook`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status,
    internalRoutesViaWeb: (await http(`${web}/internal/n8n/runtime-env`)).status,
  };
  step("Security", JSON.stringify(v.security));

  // Smoke test (the repository's 20-step checklist).
  if (!flag("--no-smoke")) {
    const smoke = spawnSync("node", ["scripts/smoke-test.mjs"], {
      cwd: ROOT,
      encoding: "utf8",
      env: { ...process.env, SMOKE_BASE_URL: web, SMOKE_EMAIL: email, SMOKE_PASSWORD: pass, SMOKE_EXPECT_ALL_INACTIVE: "1" },
      maxBuffer: 16 * 1024 * 1024,
    });
    const lines = (smoke.stdout ?? "").split("\n").filter((l) => /^\s?\d+\.\s|passed/.test(l));
    console.log(lines.join("\n"));
    v.smokeTest = { exitCode: smoke.status, summary: lines.find((l) => /passed/.test(l)) ?? null, steps: lines.filter((l) => /^\s?\d+\./.test(l)) };
  }
}

// ------------------------------------------------------------------ main
async function checkCli() {
  const { command, args: prefix, source } = railwayCli();
  step("Railway executable", `${[command, ...prefix].join(" ")} (from ${source})`);
  step("railway --version", rw(["--version"]).stdout.trim());
  const who = rw(["whoami"], { allowFail: true });
  step("railway whoami", who.ok ? who.stdout.trim().split("\n").pop() : "NOT logged in — run `railway login`");
  const status = rw(["status"], { allowFail: true });
  if (!status.ok) fail(`railway status failed — ${who.ok ? `run \`railway link\` in ${ROOT}` : "run `railway login` first"}\n${(status.stderr + status.stdout).trim().slice(0, 300)}`);
  const lines = status.stdout.split("\n").map((l) => l.replace(/\x1b\[[0-9;]*m/g, "").trim());
  for (const l of lines.filter((l) => /^(Project|Environment|Service)\s*:/i.test(l))) step("railway status", l);
  const projects = rwJson(["project", "list"], { allowFail: true });
  step("railway project list", Array.isArray(projects) ? `${projects.length} project(s) visible to this login` : "not available");
  log("CLI check passed — nothing was created or changed.");
}

(async () => {
  if (flag("--check-cli")) return checkCli();
  if (!flag("--verify-only")) {
    const ctx = await provision();
    await deploy(ctx);
  } else {
    const status = rw(["status", "--json"], { allowFail: true });
    if (!status.ok) fail("no Railway project is linked here");
    report.project = JSON.parse(status.stdout).name;
    const services = listServices();
    report.services.Postgres = { name: (byName(services, "Postgres") ?? byImage(services, /postgres/i))?.name };
    report.services.Redis = { name: (byName(services, "Redis") ?? byImage(services, /redis/i))?.name };
  }
  await verify();
  writeReport("completed");
  console.log("\n==================== SUMMARY ====================");
  console.log(`Project:  ${report.project}`);
  for (const [name, s] of Object.entries(report.services)) console.log(`${name.padEnd(9)} ${s.status ?? ""} ${s.url ?? ""}`);
  console.log(`Health:   ${Object.entries(report.verification.health ?? {}).map(([k, v]) => `${k}=${v.split(" ")[0]}`).join("  ")}`);
  console.log(`Workflows: ${JSON.stringify(report.verification.workflows)}`);
  if (report.credentialsFile) console.log(`Admin password: ${report.credentialsFile}`);
})().catch((err) => fail(err instanceof Error ? err.stack ?? err.message : String(err)));
