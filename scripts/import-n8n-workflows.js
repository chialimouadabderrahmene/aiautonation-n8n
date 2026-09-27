#!/usr/bin/env node
/**
 * The Control Center imports the 22 workflows into n8n AUTOMATICALLY (on
 * start-up, every 5 minutes, and whenever credentials change) — idempotent,
 * never duplicating, never activating. There is normally nothing to run.
 *
 * This script only asks a deployed Control Center to re-sync now (the same as
 * Automations → "Sync with n8n now"), for scripted/CI use:
 *
 *   CONTROL_CENTER_URL=https://your-control-center.up.railway.app \
 *   CONTROL_CENTER_EMAIL=admin@... CONTROL_CENTER_PASSWORD=... \
 *   node scripts/import-n8n-workflows.js
 */
const base = (process.env.CONTROL_CENTER_URL || "http://localhost:3200").replace(/\/+$/, "");

async function main() {
  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: process.env.CONTROL_CENTER_EMAIL, password: process.env.CONTROL_CENTER_PASSWORD }),
  });
  if (!login.ok) throw new Error(`login failed (${login.status})`);
  const { token } = await login.json();
  const res = await fetch(`${base}/api/workflows/sync`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
  const report = await res.json();
  if (!res.ok) throw new Error(report.message || `sync failed (${res.status})`);
  console.log(`present ${report.present}/22 · imported ${report.imported.length} · updated ${report.updated.length} · active ${report.active} · failed ${report.failed.length}`);
  for (const f of report.failed) console.log(`  ✕ ${f.key}: ${f.error}`);
  process.exitCode = report.failed.length ? 1 : 0;
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
