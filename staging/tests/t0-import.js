'use strict';
/**
 * Import validation: every workflow file must (1) pass the static validator, (2) be present in the running n8n after
 * `import:workflow`, and (3) round-trip through n8n's database with the same nodes (name, type, typeVersion) and connections.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

module.exports = async function run(h) {
  const { test, assert, eq, STAGING_DIR } = h;
  const ROOT = path.join(STAGING_DIR, '..');
  const env = { ...process.env, MSYS_NO_PATHCONV: '1', LAUNCH_DATE: process.env.LAUNCH_DATE || new Date(Date.now() - 4 * 86400000).toISOString().slice(0, 10) };
  const dc = (args) => spawnSync('docker', ['compose', '-f', 'docker-compose.staging.yml', ...args], { cwd: STAGING_DIR, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

  await test('ALL', 'Import', 'static validator: 0 errors across all workflow files, docs and env documentation', async () => {
    const r = spawnSync('node', [path.join(ROOT, 'tools', 'validate-workflows.js'), '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const out = JSON.parse(r.stdout); eq(out.errors, [], 'validator errors'); eq(out.workflowsChecked, 22, 'files checked');
  });

  dc(['exec', '-T', 'n8n', 'sh', '-c', 'rm -rf /tmp/exp && mkdir -p /tmp/exp']);
  const ex = dc(['exec', '-T', 'n8n', 'n8n', 'export:workflow', '--all', '--separate', '--output=/tmp/exp/']);
  const dest = path.join(STAGING_DIR, 'out', 'exported'); fs.rmSync(dest, { recursive: true, force: true }); fs.mkdirSync(path.dirname(dest), { recursive: true });
  dc(['cp', 'n8n:/tmp/exp', dest]);
  const exported = {};
  for (const f of fs.existsSync(dest) ? fs.readdirSync(dest) : []) { try { const j = JSON.parse(fs.readFileSync(path.join(dest, f), 'utf8')); exported[j.id] = j; } catch (e) { /* ignore non-json */ } }

  const files = fs.readdirSync(path.join(ROOT, 'n8n-workflows')).filter((f) => f.endsWith('.json')).sort();
  for (const f of files) {
    const src = JSON.parse(fs.readFileSync(path.join(ROOT, 'n8n-workflows', f), 'utf8'));
    await test(f.slice(0, 2), 'Import', `imports into n8n 2.40.7 and round-trips intact (${src.nodes.length} nodes): ${src.name.replace(/^Eki - /, '')}`, async () => {
      const got = exported[src.id]; assert(got, 'workflow ' + src.id + ' is not in n8n after import (export output: ' + (ex.stdout + ex.stderr).slice(-200) + ')');
      const sig = (n) => `${n.name}|${n.type}|${n.typeVersion}`;
      eq(got.nodes.map(sig).sort(), src.nodes.map(sig).sort(), 'nodes (name|type|version)');
      const edges = (w) => Object.entries(w.connections || {}).flatMap(([s, v]) => (v.main || []).flatMap((outs, i) => (outs || []).map((c) => `${s}[${i}]->${c.node}`))).sort();
      eq(edges(got), edges(src), 'connections');
      eq((got.settings || {}).timezone, 'Africa/Lagos', 'timezone');
    });
  }
};
