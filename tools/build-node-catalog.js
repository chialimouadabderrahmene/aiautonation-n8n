'use strict';
/**
 * Builds tools/n8n-node-catalog.json from the PINNED n8n image (docker.n8n.io/n8nio/n8n:<version>):
 * for every node type used by n8n-workflows/*.json it records the valid typeVersions and the top-level parameter names.
 * validate-workflows.js uses it to prove that every node type/version/parameter exists in that n8n release.
 *
 * Usage: node tools/build-node-catalog.js [n8n-version]      (needs Docker; default 2.40.7)
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const version = process.argv[2] || '2.40.7';
const image = `docker.n8n.io/n8nio/n8n:${version}`;
const r = spawnSync('docker', ['run', '--rm', '--entrypoint', 'cat', image, '/usr/local/lib/node_modules/n8n/node_modules/n8n-nodes-base/dist/types/nodes.json'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
const all = JSON.parse(r.stdout);

const used = new Set();
const wfDir = path.join(__dirname, '..', 'n8n-workflows');
for (const f of fs.readdirSync(wfDir).filter((x) => x.endsWith('.json'))) for (const n of JSON.parse(fs.readFileSync(path.join(wfDir, f), 'utf8')).nodes) if (n && n.type) used.add(n.type);
// also allow the node types the staging harness / docs mention
['n8n-nodes-base.code', 'n8n-nodes-base.webhook', 'n8n-nodes-base.scheduleTrigger'].forEach((t) => used.add(t));

const catalog = { n8nVersion: version, generatedFrom: image, nodes: {} };
for (const type of [...used].sort()) {
  const short = type.replace(/^n8n-nodes-base\./, '');
  const defs = all.filter((n) => n.name === short);
  if (!defs.length) { catalog.nodes[type] = { versions: [], properties: [], missing: true }; continue; }
  const versions = new Set(); const props = new Set();
  for (const d of defs) { [].concat(d.version).flat().forEach((v) => versions.add(v)); (d.properties || []).forEach((p) => props.add(p.name)); }
  catalog.nodes[type] = { versions: [...versions].sort((a, b) => a - b), properties: [...props].sort() };
}
fs.writeFileSync(path.join(__dirname, 'n8n-node-catalog.json'), JSON.stringify(catalog, null, 1) + '\n');
console.log(`wrote tools/n8n-node-catalog.json for ${Object.keys(catalog.nodes).length} node types (n8n ${version})`);
