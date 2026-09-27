#!/usr/bin/env node
/**
 * Imports every workflow in ../n8n-workflows/*.json into a real n8n instance
 * via its public REST API, and writes the resulting n8n workflow ids back
 * into the Control Center's WorkflowConfig rows (so Automations can enable/
 * disable them for real).
 *
 * Every workflow is created INACTIVE. This script never activates anything —
 * activation happens later, per-workflow, only once its readiness is READY
 * (see the Automations screen / POST /api/workflows/:key/enable).
 *
 * Usage:
 *   N8N_BASE_URL=https://your-instance.up.railway.app \
 *   N8N_API_KEY=<from n8n Settings > API> \
 *   AUTOMATION_API_URL=http://localhost:4100 \
 *   AUTOMATION_API_TOKEN=<a Control Center admin JWT, from POST /api/auth/login> \
 *   node scripts/import-n8n-workflows.js
 *
 * NOT YET RUN AGAINST A REAL N8N INSTANCE — this repo's sandbox could not
 * pull the n8n Docker image to test it end-to-end (see
 * AI_AUTOMATION_CONTROL_CENTER_REPORT.md "Testing performed"). The request
 * shape follows n8n's documented Public API (POST /api/v1/workflows,
 * X-N8N-API-KEY header) — verify against your instance's `/api/v1/docs`
 * before relying on it, the same caveat as the rest of the n8n integration.
 */
const fs = require("node:fs");
const path = require("node:path");

const N8N_BASE_URL = process.env.N8N_BASE_URL;
const N8N_API_KEY = process.env.N8N_API_KEY;
const AUTOMATION_API_URL = process.env.AUTOMATION_API_URL || "http://localhost:4100";
const AUTOMATION_API_TOKEN = process.env.AUTOMATION_API_TOKEN;

if (!N8N_BASE_URL || !N8N_API_KEY) {
  console.error("Set N8N_BASE_URL and N8N_API_KEY (from n8n Settings > API) before running this.");
  process.exit(1);
}

const WORKFLOWS_DIR = path.resolve(__dirname, "../n8n-workflows");

async function importOne(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  // n8n's create-workflow endpoint only accepts a specific subset of fields —
  // strip anything else (id, active, tags, versionId, etc. from an exported file).
  const payload = {
    name: raw.name,
    nodes: raw.nodes,
    connections: raw.connections,
    settings: raw.settings ?? {},
  };

  const res = await fetch(`${N8N_BASE_URL.replace(/\/+$/, "")}/api/v1/workflows`, {
    method: "POST",
    headers: { "X-N8N-API-KEY": N8N_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`n8n responded ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

async function linkInControlCenter(key, n8nWorkflowId) {
  if (!AUTOMATION_API_TOKEN) return; // optional — the import still succeeds without this
  await fetch(`${AUTOMATION_API_URL}/api/workflows/${key}/link-n8n`, {
    method: "POST",
    headers: { Authorization: `Bearer ${AUTOMATION_API_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ n8nWorkflowId }),
  }).catch((err) => console.warn(`  (could not link ${key} in the Control Center: ${err.message})`));
}

async function main() {
  const files = fs
    .readdirSync(WORKFLOWS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();

  console.log(`Importing ${files.length} workflows into ${N8N_BASE_URL} (all created INACTIVE)...\n`);

  const results = [];
  for (const file of files) {
    const key = file.replace(/\.json$/, "");
    try {
      const created = await importOne(path.join(WORKFLOWS_DIR, file));
      await linkInControlCenter(key, created.id);
      console.log(`  ✓ ${key} -> n8n id ${created.id}`);
      results.push({ key, ok: true, n8nWorkflowId: created.id });
    } catch (err) {
      console.error(`  ✕ ${key}: ${err.message}`);
      results.push({ key, ok: false, error: err.message });
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} imported.`);
  if (failed.length > 0) {
    console.log("Failed:", failed.map((f) => f.key).join(", "));
    process.exitCode = 1;
  }
}

main();
