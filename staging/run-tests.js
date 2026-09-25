'use strict';
/**
 * Usage: node staging/run-tests.js [t1 t2 ...]     (default: all suites in tests/ except the env-stage ones)
 * Requires the staging stack: staging/scripts/up.sh
 * Writes staging/out/results-<suite>.json (gitignored) - docs/staging-test-report.md is produced by tools/make-report.js
 */
const fs = require('fs');
const path = require('path');
const h = require('./lib/harness');

(async () => {
  const wanted = process.argv.slice(2);
  const dir = path.join(__dirname, 'tests');
  const suites = fs.readdirSync(dir).filter((f) => /^t\d.*\.js$/.test(f)).sort().map((f) => f.replace(/\.js$/, ''));
  const pick = wanted.length ? suites.filter((s) => wanted.some((w) => s === w || s.startsWith(w + '-'))) : suites.filter((s) => /^t[0-4]-/.test(s)); // t5/t6/t9 need their own staging stage (see run-all.sh)
  try { await h.mock('/health'); } catch (e) { console.error('mock not reachable on :9099 - run staging/scripts/up.sh first'); process.exit(2); }
  const outDir = path.join(__dirname, 'out'); fs.mkdirSync(outDir, { recursive: true });
  for (const s of pick) {
    console.log(`\n=== suite ${s} ===`);
    const before = h.results.length;
    try { await require(path.join(dir, s + '.js'))(h); } catch (e) { h.results.push({ wf: s, area: 'Suite', name: 'suite crashed', pass: false, detail: String(e.stack || e).slice(0, 500) }); console.log('SUITE CRASH', e); }
    fs.writeFileSync(path.join(outDir, `results-${s}.json`), JSON.stringify(h.results.slice(before), null, 2));
  }
  const failed = h.results.filter((r) => !r.pass);
  console.log(`\n${h.results.length - failed.length}/${h.results.length} checks passed`);
  if (failed.length) { console.log('FAILED:'); failed.forEach((f) => console.log(` - [${f.wf}] ${f.name}: ${f.detail}`)); }
  process.exit(failed.length ? 1 : 0);
})();
