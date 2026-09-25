'use strict';
/**
 * Builds docs/staging-test-report.md from staging/out/results-*.json (written by staging/run-tests.js).
 * Every PASS/FAIL below is copied from an executed check - nothing is inferred or hand-edited.
 * Usage: node tools/make-report.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const outDir = path.join(ROOT, 'staging', 'out');
const results = [];
for (const f of fs.readdirSync(outDir).filter((x) => /^results-t\d.*\.json$/.test(x)).sort()) results.push(...JSON.parse(fs.readFileSync(path.join(outDir, f), 'utf8')).map((r) => ({ ...r, suite: f.replace(/^results-|\.json$/g, '') })));

const wfDir = path.join(ROOT, 'n8n-workflows');
const wfs = fs.readdirSync(wfDir).filter((f) => f.endsWith('.json')).sort().map((f) => {
  const j = JSON.parse(fs.readFileSync(path.join(wfDir, f), 'utf8'));
  return { num: f.slice(0, 2), name: j.name.replace(/^Eki - /, '').replace(/^dd /, ''), file: f, sched: j.nodes.some((n) => n.type.endsWith('scheduleTrigger')), hook: j.nodes.some((n) => n.type.endsWith('webhook')), error: j.nodes.some((n) => n.type.endsWith('errorTrigger')) };
});

const forWf = (num) => results.filter((r) => r.wf === num);
const cell = (list) => { if (!list.length) return '—'; const p = list.filter((r) => r.pass).length; return `${p === list.length ? 'PASS' : 'FAIL'} ${p}/${list.length}`; };
const area = (num, ...areas) => forWf(num).filter((r) => areas.includes(r.area));

let md = '# Staging test report\n\n';
const meta = { date: new Date().toISOString().slice(0, 10), n8n: '2.40.7', total: results.length, failed: results.filter((r) => !r.pass).length };
md += `Generated ${meta.date} by \`node tools/make-report.js\` from the results of \`staging/run-tests.js\` (**${meta.total - meta.failed}/${meta.total} checks passed**, ${meta.failed} failed).\n\n`;
md += '## What "staging" means here — read this before trusting a PASS\n\n';
md += '- **Real:** n8n 2.40.7 (the pinned production image) running in Docker; the real workflow JSON files; real webhook HTTP calls; the real Manual/Schedule triggers; the real Code-node runtime (task runner); real node retry/error behaviour; the real Google Sheets, Telegram, HTTP Request, Crypto and Loop nodes.\n';
md += '- **Mocked:** every external provider (Meta Graph, Google Sheets/OAuth, Telegram, Resend, Groq/OpenAI, Apify, Reddit, Buffer, X). n8n\'s outbound traffic is forced through `staging/mock/server.js`. The mock enforces Meta\'s 24-hour free-form rule (error 131047), template well-formedness, provider authentication, Google Sheet tabs/columns, and supports fault injection. **It is not Meta/Google.** Real-provider acceptance (template approval, OAuth, delivery, Buffer/X request formats, ManyChat reply format, Resend domain) is **not** covered.\n';
md += '- **Data:** QA/dummy only (fictional +1-555-01xx numbers, `.invalid` emails). No production customer data.\n';
md += '- **Trigger evidence:** scheduled workflows run through their Manual Run trigger (`n8n execute`); suite t9 separately proves the real Schedule Triggers fire in production mode using every-minute copies and that all 22 real workflows publish. Error-workflow alerting is verified in production (webhook/trigger) mode; `n8n execute` does not reliably call the error workflow.\n\n';

md += '## Test matrix\n\nCell = result of the checks for that column (`PASS n/m`, `—` = no check in that column). *Trigger*: webhook workflows = authenticated production webhook calls; scheduled = real Schedule Trigger firing (t9). *Overall* = every check of the workflow passed.\n\n';
md += '| Workflow | Import | Trigger | Execution | Output | Error handling | Overall |\n|---|---|---|---|---|---|---|\n';
const overall = [];
for (const w of wfs) {
  const imp = area(w.num, 'Import'); const trig = area(w.num, 'Trigger'); const sec = area(w.num, 'Security');
  const exec = area(w.num, 'Execution'); const outp = area(w.num, 'Output'); const errs = area(w.num, 'Errors');
  let trigList = trig.slice();
  if (w.hook || w.error) trigList = trigList.concat(sec.length ? sec : []).concat(exec.slice(0, 1));
  else if (!trig.length) trigList = [];
  const all = forWf(w.num); const complete = imp.length > 0 && exec.length > 0 && (w.hook || w.error || trig.length > 0); const ok = complete && all.every((r) => r.pass);
  overall.push({ w, ok, n: all.length });
  const secNote = sec.length && !(w.hook || w.error) ? ` (+security ${cell(sec)})` : '';
  md += `| **${w.num}** ${w.name} | ${cell(imp)} | ${cell(trigList)}${secNote} | ${cell(exec)} | ${cell(outp)} | ${cell(errs)} | ${ok ? '**PASS**' : (complete ? '**FAIL**' : '**INCOMPLETE**')} (${all.filter((r) => r.pass).length}/${all.length}) |\n`;
}
const cross = results.filter((r) => r.wf === 'ALL');
md += `| **ALL** cross-cutting | ${cell(cross.filter((r) => r.area === 'Import'))} | — | — | — | — | ${cross.every((r) => r.pass) ? '**PASS**' : '**FAIL**'} |\n\n`;

md += `## Summary\n\n- Workflow files: ${wfs.length} (00 error handler + 21 original workflows; **there is no workflow 11**).\n- Import PASS: ${overall.filter((o) => area(o.w.num, 'Import').every((r) => r.pass) && area(o.w.num, 'Import').length).length}/${wfs.length}\n- Execution PASS (every check of the workflow passed): ${overall.filter((o) => o.ok).length}/${wfs.length}\n- Total checks: ${meta.total}, failed: ${meta.failed}\n\n`;

md += '## Every check\n\n| Wf | Area | Check | Result | Detail |\n|---|---|---|---|---|\n';
for (const r of results) md += `| ${r.wf} | ${r.area} | ${String(r.name).replace(/\|/g, '/')} | ${r.pass ? 'PASS' : '**FAIL**'} | ${r.pass ? '' : String(r.detail || '').replace(/\s+/g, ' ').replace(/\|/g, '/').slice(0, 200)} |\n`;
md += '\n## Not covered by staging (needs real accounts)\n\nMeta template approval and delivery · Google OAuth consent and real Sheets quotas · Resend domain verification · Telegram webhook registration with the real bot · ManyChat External Request/DM format · Buffer/X live APIs · Apify actor · Reddit anti-bot behaviour · production Railway networking/backups.\n';
fs.writeFileSync(path.join(ROOT, 'docs', 'staging-test-report.md'), md);
console.log(`wrote docs/staging-test-report.md (${meta.total - meta.failed}/${meta.total} passed)`);
