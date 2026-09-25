'use strict';
/**
 * Static validation of the Eki n8n automation repo (no n8n / Docker needed).
 *   node tools/validate-workflows.js            -> human report, exit 1 on any ERROR
 *   node tools/validate-workflows.js --json     -> machine-readable
 *
 * Checks: JSON validity, node type + version + parameter names against the pinned n8n release catalog,
 * connections/reachability, credential references, webhook authentication, timezone + error workflow,
 * Google Sheets tabs/columns vs schemas/sheet-columns.json, WhatsApp template compliance (no free-form sends
 * outside workflow 13), forbidden brand/domain/placeholder/localhost/file:// patterns, and $env <-> .env.railway.example consistency.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WF_DIR = path.join(ROOT, 'n8n-workflows');
const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, 'n8n-node-catalog.json'), 'utf8'));
const sheetCols = JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas', 'sheet-columns.json'), 'utf8'));
const stagingCreds = JSON.parse(fs.readFileSync(path.join(ROOT, 'staging', 'credentials.staging.json'), 'utf8'));
const KNOWN_CRED_IDS = new Set(stagingCreds.map((c) => c.id));

const errors = []; const warnings = []; const info = [];
const err = (wf, msg) => errors.push({ wf, msg });
const warn = (wf, msg) => warnings.push({ wf, msg });

const TRIGGERS = new Set(['n8n-nodes-base.scheduleTrigger', 'n8n-nodes-base.webhook', 'n8n-nodes-base.manualTrigger', 'n8n-nodes-base.errorTrigger']);
const AUTH_EXEMPT = { 'ekiwf13': new Set(['WA Verify GET', 'WA Incoming POST']) }; // GET = Meta verify-token handshake, POST = HMAC-verified in-flow
const files = fs.readdirSync(WF_DIR).filter((f) => f.endsWith('.json')).sort();
const usedEnv = new Set(); const usedTpl = new Set();
const stringsOf = (v, out = []) => { if (typeof v === 'string') out.push(v); else if (Array.isArray(v)) v.forEach((x) => stringsOf(x, out)); else if (v && typeof v === 'object') Object.values(v).forEach((x) => stringsOf(x, out)); return out; };

const FORBIDDEN = [
  [/AI automation (platform|for businesses)|automate with AI|Eki - AI automation/i, 'wrong brand description (Eki is an African foodstuff marketplace)'],
  [/\beki\.app\b/i, 'legacy/wrong domain eki.app'],
  [/eki-marketplace\.com/i, 'legacy/wrong domain eki-marketplace.com'],
  [/neon\.online/i, 'stale URL neon.online'],
  [/localhost|127\.0\.0\.1/i, 'localhost URL'],
  [/file:\/\//i, 'file:// URL'],
  [/\[APP_NAME\]|\[FEEDBACK_FORM_LINK\]|\[ENTER[^\]]*\]/, 'unfilled template placeholder'],
  [/YOUR_[A-Z_]+|[A-Z_]*_PLACEHOLDER|REPLACE_WITH/, 'placeholder value'],
  [/api\.whatsapp\.com|api\.telegram\.com\/emails/i, 'invalid provider endpoint'],
  [/@example\.(com|org|it)|@eki-marketplace|test@|dummy@/i, 'test/example email address'],
  [/\b1?555\d{7}\b|\+\d{1,3}[\s-]?0{6,}/, 'test phone number'],
];

for (const f of files) {
  const raw = fs.readFileSync(path.join(WF_DIR, f), 'utf8');
  let j;
  try { j = JSON.parse(raw); } catch (e) { err(f, 'invalid JSON: ' + e.message); continue; }
  const wf = f;
  for (const k of ['name', 'nodes', 'connections', 'settings', 'id']) if (j[k] === undefined) err(wf, `missing top-level "${k}"`);
  if (j.active !== false) err(wf, 'workflow file must ship with "active": false (activate per-environment after credentials exist)');
  const nodes = j.nodes || [];
  const names = new Set();
  nodes.forEach((n, i) => {
    if (!n || Array.isArray(n) || typeof n !== 'object') { err(wf, `nodes[${i}] is not a node object`); return; }
    if (!n.type || n.typeVersion === undefined) { err(wf, `node "${n.name}" has no type/typeVersion`); return; }
    if (names.has(n.name)) err(wf, `duplicate node name "${n.name}"`); names.add(n.name);
    const c = catalog.nodes[n.type];
    if (!c || c.missing) err(wf, `node "${n.name}": type ${n.type} does not exist in n8n ${catalog.n8nVersion}`);
    else {
      if (!c.versions.includes(n.typeVersion)) err(wf, `node "${n.name}": ${n.type} has no typeVersion ${n.typeVersion} (valid: ${c.versions.join(',')})`);
      const props = new Set(c.properties);
      for (const k of Object.keys(n.parameters || {})) if (!props.has(k)) err(wf, `node "${n.name}": unknown parameter "${k}" for ${n.type}`);
    }
    // credentials must be {id,name} objects with a known id
    for (const [ctype, cv] of Object.entries(n.credentials || {})) {
      if (!cv || typeof cv !== 'object' || !cv.id || !cv.name) err(wf, `node "${n.name}": credential "${ctype}" must be an object {id,name}`);
      else if (!KNOWN_CRED_IDS.has(cv.id)) err(wf, `node "${n.name}": credential id "${cv.id}" is not in staging/credentials.staging.json (docs must list it)`);
    }
    // webhook authentication
    if (n.type === 'n8n-nodes-base.webhook') {
      const exempt = (AUTH_EXEMPT[j.id] || new Set()).has(n.name);
      if (!exempt && (n.parameters || {}).authentication !== 'headerAuth') err(wf, `webhook "${n.name}" is not authenticated (authentication must be headerAuth)`);
    }
    // Google Sheets
    if (n.type === 'n8n-nodes-base.googleSheets') {
      const p = n.parameters || {}; const tab = p.sheetName && p.sheetName.value;
      if (!sheetCols[tab]) err(wf, `node "${n.name}": unknown sheet tab "${tab}"`);
      else {
        const cols = new Set(sheetCols[tab]);
        for (const k of Object.keys((p.columns && p.columns.value) || {})) if (!cols.has(k)) err(wf, `node "${n.name}": column "${k}" not in tab "${tab}"`);
        for (const m of (p.columns && p.columns.matchingColumns) || []) if (!cols.has(m)) err(wf, `node "${n.name}": match column "${m}" not in tab "${tab}"`);
        for (const fl of ((p.filtersUI || {}).values) || []) if (!cols.has(fl.lookupColumn)) err(wf, `node "${n.name}": filter column "${fl.lookupColumn}" not in tab "${tab}"`);
        if (p.operation !== 'read' && !(p.columns && p.columns.schema && p.columns.schema.length)) err(wf, `node "${n.name}": missing columns.schema`);
        if (p.operation === 'read' && !((p.filtersUI || {}).values || []).length && !n.executeOnce) err(wf, `node "${n.name}": unfiltered read must set executeOnce (chained reads multiply rows)`);
      }
    }
    // bulk HTTP send safety: an HTTP node with retryOnFail + continueRegularOutput must not sit directly after a multi-item source (needs a loop)
    if (n.type === 'n8n-nodes-base.httpRequest' && n.retryOnFail && n.onError === 'continueRegularOutput' && /graph\.facebook\.com|api\.resend\.com|bufferapp/.test(JSON.stringify(n.parameters))) {
      info.push({ wf, msg: `bulk-send guard: "${n.name}" (retry + continue) must be single-item; checked via loop below` });
    }
    // code scanning
    const code = (n.parameters || {}).jsCode;
    if (code) {
      try { new Function('$input', '$env', '$json', '$', `return (async () => {\n${code}\n})();`); } catch (e) { err(wf, `Code node "${n.name}" does not compile: ${e.message}`); }
      if (/text:\s*\{\s*(preview_url[^}]*,\s*)?body\s*:/.test(code) && j.id !== 'ekiwf13') err(wf, `Code node "${n.name}" builds a free-form WhatsApp text message outside workflow 13 (business-initiated messages must be templates)`);
      for (const m of code.matchAll(/buildTemplate\('([A-Z0-9_]+)'/g)) usedTpl.add(m[1]);
      for (const m of code.matchAll(/'([A-Z0-9_]+)'/g)) if (/^(WELCOME_D|REENGAGE_|NURTURE_|WAITLIST_CONFIRM)/.test(m[1])) usedTpl.add(m[1]);
    }
    for (const s of stringsOf(n.parameters)) {
      for (const m of s.matchAll(/\$env\.([A-Z][A-Z0-9_]*)/g)) usedEnv.add(m[1]);
      // dynamic access: $env['BUFFER_PROFILE_ID_' + platform]
      if (s.includes('BUFFER_PROFILE_ID_')) ['TIKTOK', 'INSTAGRAM', 'FACEBOOK', 'LINKEDIN'].forEach((p) => usedEnv.add('BUFFER_PROFILE_ID_' + p));
    }
  });
  // connections
  const conns = j.connections || {};
  const reachable = new Set(); const targets = new Set();
  for (const [src, v] of Object.entries(conns)) {
    if (!names.has(src)) err(wf, `connection from unknown node "${src}"`);
    for (const outs of v.main || []) for (const c of outs || []) { if (!names.has(c.node)) err(wf, `connection "${src}" -> unknown node "${c.node}"`); if (c.index !== 0) err(wf, `connection "${src}" -> "${c.node}" has input index ${c.index} (must be 0 for single-input nodes)`); targets.add(c.node); }
  }
  const queue = nodes.filter((n) => n && TRIGGERS.has(n.type)).map((n) => n.name);
  if (!queue.length) err(wf, 'workflow has no trigger node');
  queue.forEach((q) => reachable.add(q));
  while (queue.length) { const cur = queue.pop(); for (const outs of ((conns[cur] || {}).main) || []) for (const c of outs || []) if (!reachable.has(c.node)) { reachable.add(c.node); queue.push(c.node); } }
  for (const n of nodes) if (n && n.type !== 'n8n-nodes-base.stickyNote' && !reachable.has(n.name)) {
    // a webhook's sibling GET/POST triggers are their own roots: only flag nodes not reachable from ANY trigger
    err(wf, `node "${n.name}" is not reachable from any trigger`);
  }
  // loops around bulk senders: any WhatsApp/Resend/Buffer sender that follows a Code node emitting many items must sit behind a splitInBatches
  const bulkSenders = nodes.filter((n) => n && n.type === 'n8n-nodes-base.httpRequest' && n.retryOnFail && n.onError === 'continueRegularOutput' && /graph\.facebook\.com|api\.resend\.com|bufferapp/.test(JSON.stringify(n.parameters)));
  for (const s of bulkSenders) {
    const parents = Object.entries(conns).filter(([, v]) => (v.main || []).some((o) => (o || []).some((c) => c.node === s.name))).map(([k]) => k);
    const inLoop = parents.some((p) => (nodes.find((n) => n && n.name === p) || {}).type === 'n8n-nodes-base.splitInBatches');
    const single = ['ekiwf03', 'ekiwf13', 'ekiwf10'].includes(j.id) || /Referrer|Thank-you|Report|Confirmation|Email/.test(s.name);
    if (!inLoop && !single) warn(wf, `sender "${s.name}" is not inside a one-item loop: verify it only ever receives a single item`);
  }
  // settings
  const st = j.settings || {};
  if (st.timezone !== 'Africa/Lagos') err(wf, `settings.timezone must be Africa/Lagos (got ${st.timezone})`);
  if (j.id !== 'ekiwf00' && st.errorWorkflow !== 'ekiwf00') err(wf, 'settings.errorWorkflow must point at ekiwf00');
  // schedule cron sanity
  for (const n of nodes) if (n && n.type === 'n8n-nodes-base.scheduleTrigger') for (const it of ((n.parameters || {}).rule || {}).interval || []) if (it.field === 'cronExpression' && !/^(\S+\s+){4}\S+$/.test(it.expression)) err(wf, `schedule "${n.name}": bad cron "${it.expression}"`);
  // forbidden patterns over every string in the workflow
  const all = stringsOf(j);
  for (const [re, why] of FORBIDDEN) { const hit = all.find((s) => re.test(s)); if (hit) err(wf, `${why}: "${hit.match(re)[0]}"`); }
}

// ---- env consistency ($env used by workflows vs .env.railway.example) ----
const envExample = fs.readFileSync(path.join(ROOT, '.env.railway.example'), 'utf8');
const documented = new Set([...envExample.matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]));
for (const v of [...usedEnv].sort()) if (!documented.has(v)) err('env', `$env.${v} is used by a workflow but missing from .env.railway.example`);
for (const t of [...usedTpl].sort()) if (!documented.has('WA_TPL_' + t)) err('env', `WhatsApp template key WA_TPL_${t} is used but missing from .env.railway.example`);
for (const v of documented) if (/^WA_TPL_/.test(v) && !usedTpl.has(v.replace('WA_TPL_', ''))) warn('env', `${v} is documented but no workflow uses it`);
const infra = /^(DB_|N8N_|GENERIC_TIMEZONE|TZ$|WEBHOOK_URL|EXECUTIONS_|NODE_|WEBHOOK_SECRET|TELEGRAM_WEBHOOK_SECRET)/;
for (const v of documented) if (!usedEnv.has(v) && !infra.test(v) && !/^WA_TPL_/.test(v)) warn('env', `${v} is documented but not read by any workflow`);
// n8n 2.x: env access from expressions must be enabled, and must be documented
if (!/N8N_BLOCK_ENV_ACCESS_IN_NODE=false/.test(envExample)) err('env', 'N8N_BLOCK_ENV_ACCESS_IN_NODE=false must be in .env.railway.example (all workflows read $env)');

// ---- documentation scan (Phase 6) ----
const docFiles = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (['node_modules', '.git', 'data', 'out', 'certs'].includes(e.name)) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(md|csv|env|example|yml)$/.test(e.name) || e.name === '.env.railway.example') docFiles.push(p); } };
walk(ROOT);
const DOC_FORBIDDEN = FORBIDDEN.filter(([re, why]) => !/localhost/.test(re.source) && why !== 'test phone number'); // docs may show fictional QA numbers; workflows may not
const PLACEHOLDER_OK = /(^|\/)\.env\.railway\.example$/;
const DOC_SKIP = /(^|[\\/])(staging[\\/]staging\.env|docker-compose\.staging\.yml|docs[\\/]staging-test-report\.md|docs[\\/]production-readiness-report\.md)$/;
for (const p of docFiles) {
  if (DOC_SKIP.test(p)) continue;
  const rel = path.relative(ROOT, p).replace(/\\/g, '/');
  const text = fs.readFileSync(p, 'utf8');
  for (const [re, why] of DOC_FORBIDDEN) { if (/placeholder/.test(why) && PLACEHOLDER_OK.test(rel)) continue; const m = text.match(re); if (m && !/^(docs\/(staging|domain-scan)|tools\/)/.test(rel)) err(rel, `${why}: "${m[0]}"`); }
  if (/localhost/i.test(text) && !/staging|testing-checklist|setup-instructions|RAILWAY_N8N/.test(rel)) warn(rel, 'mentions localhost');
}

const out = { workflowsChecked: files.length, n8nVersion: catalog.n8nVersion, errors, warnings };
if (process.argv.includes('--json')) console.log(JSON.stringify(out, null, 2));
else {
  console.log(`Checked ${files.length} workflow files against n8n ${catalog.n8nVersion}; ${docFiles.length} doc/config files scanned.`);
  for (const e of errors) console.log(`ERROR   [${e.wf}] ${e.msg}`);
  for (const w of warnings) console.log(`WARN    [${w.wf}] ${w.msg}`);
  console.log(`\n${errors.length} error(s), ${warnings.length} warning(s)`);
}
process.exit(errors.length ? 1 : 0);
