'use strict';
/**
 * Trigger-mode verification. `n8n execute` runs workflows from their Manual Trigger, so this stage proves the REAL
 * schedule triggers fire: for every workflow with a Schedule Trigger it imports a copy whose cron is "* * * * *",
 * publishes it, lets n8n's scheduler run it, and reads the resulting executions (mode = trigger) from n8n's database.
 * It also proves the global error workflow alerts on a Code-node failure inside a scheduled (trigger-mode) run,
 * and that ALL real workflows publish (activate) without errors.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

module.exports = async function run(h) {
  const { test, reset, tg, until, assert, eq, sleep, STAGING_DIR } = h;
  const WF_DIR = path.join(STAGING_DIR, '..', 'n8n-workflows');
  const OUT = path.join(STAGING_DIR, 'data', 'sched');
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT)) fs.rmSync(path.join(OUT, f));
  const env = { ...process.env, MSYS_NO_PATHCONV: '1', LAUNCH_DATE: process.env.LAUNCH_DATE || new Date(Date.now() - 4 * 86400000).toISOString().slice(0, 10) };
  const dc = (args, opts = {}) => spawnSync('docker', ['compose', '-f', 'docker-compose.staging.yml', ...args], { cwd: STAGING_DIR, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
  const n8n = (args) => dc(['exec', '-T', 'n8n', 'n8n', ...args]);

  const real = [];
  const copies = [];
  for (const f of fs.readdirSync(WF_DIR).filter((x) => x.endsWith('.json')).sort()) {
    const j = JSON.parse(fs.readFileSync(path.join(WF_DIR, f), 'utf8'));
    real.push({ id: j.id, name: j.name });
    const trig = j.nodes.find((n) => n.type === 'n8n-nodes-base.scheduleTrigger');
    if (!trig) continue;
    const c = JSON.parse(JSON.stringify(j));
    c.id = 'sched' + j.id.replace('ekiwf', ''); c.name = '[TRIGGER CHECK] ' + j.name;
    c.nodes.find((n) => n.type === 'n8n-nodes-base.scheduleTrigger').parameters.rule = { interval: [{ field: 'cronExpression', expression: '* * * * *' }] };
    // webhook trigger nodes inside a copy would collide with the real ones
    c.nodes = c.nodes.filter((n) => n.type !== 'n8n-nodes-base.webhook');
    const names = new Set(c.nodes.map((n) => n.name)); for (const k of Object.keys(c.connections)) { if (!names.has(k)) delete c.connections[k]; }
    fs.writeFileSync(path.join(OUT, `${c.id}.json`), JSON.stringify(c, null, 2));
    copies.push({ id: c.id, wf: j.id, name: j.name });
  }
  await reset();
  // The compose volume for /sched is defined at container creation: recreate n8n if the directory was empty then.
  const r0 = n8n(['import:workflow', '--separate', '--input=/sched']);
  assert(/Successfully imported \d+ workflow/.test(r0.stdout + r0.stderr), 'import copies: ' + (r0.stdout + r0.stderr).slice(-200));
  const failedPublish = [];
  for (const id of [...real.map((r) => r.id), ...copies.map((c) => c.id)]) { const r = n8n(['publish:workflow', '--id=' + id]); const o = r.stdout + r.stderr; if (/rror/.test(o) && !/Publishing workflow/.test(o.replace(/rror/g, ''))) failedPublish.push(id + ': ' + o.slice(-120)); else if (/Error/.test(o)) failedPublish.push(id + ': ' + o.slice(-160)); }

  dc(['restart', 'n8n'], { stdio: 'ignore' });
  await until(async () => { try { return (await fetch(h.N8N + '/healthz/readiness')).ok; } catch (e) { return false; } }, { timeout: 120000, what: 'n8n readiness' });
  const t0 = Date.now();

  await test('ALL', 'Import', 'all real workflows publish (activate) without errors: schedule crons and webhook registrations are valid', async () => {
    eq(failedPublish, [], 'publish failures');
    await sleep(8000);
    const logs = dc(['logs', 'n8n']).stdout;
    const bad = logs.split('\n').filter((l) => /(problem|unable|error).*activat|activat.*(problem|unable|error|fail)/i.test(l));
    eq(bad, [], 'activation errors in n8n log');
    const active = n8n(['list:workflow', '--active=true']).stdout.split('\n').filter((l) => /^ekiwf\d\d\|/.test(l));
    assert(active.length === real.length, 'active real workflows ' + active.length + ' of ' + real.length);
  });

  // wait for every copy to run at least once (cron fires on the minute)
  const query = () => {
    const js = "const s=require('/usr/local/lib/node_modules/n8n/node_modules/.pnpm/sqlite3@5.1.7_bluebird@3.7.2_supports-color@8.1.1/node_modules/sqlite3');const db=new s.Database('/home/node/.n8n/database.sqlite',s.OPEN_READONLY);db.all('select workflowId,mode,status,count(*) c from execution_entity group by workflowId,mode,status',(e,r)=>{console.log('ROWS'+JSON.stringify(r||e))})";
    const o = dc(['exec', '-T', 'n8n', 'node', '-e', js]).stdout; const m = /ROWS(.*)/.exec(o); return m ? JSON.parse(m[1]) : [];
  };
  let rows = [];
  await until(async () => { rows = query(); return copies.every((c) => rows.some((r) => r.workflowId === c.id && r.mode === 'trigger')); }, { timeout: 200000, every: 10000, what: 'all scheduled copies to fire' }).catch(() => {});
  for (const c of copies) {
    const mine = rows.filter((r) => r.workflowId === c.id);
    await test(c.wf.replace('ekiwf', ''), 'Trigger', 'real Schedule Trigger fires in production (trigger) mode: ' + c.name.replace(/^Eki - /, ''), async () => {
      assert(mine.some((r) => r.mode === 'trigger'), 'no trigger-mode execution found within ' + Math.round((Date.now() - t0) / 1000) + 's: ' + JSON.stringify(mine));
    });
  }
  await test('01', 'Errors', 'trigger mode: a Code-node failure in a SCHEDULED run reaches the team via the global error workflow', async () => {
    const t = await until(async () => (await tg()).find((x) => /workflow error/.test(x.body.text) && /01 AI Content Generation/.test(x.body.text)), { timeout: 90000, what: 'error alert for scheduled 01' });
    assert(/No Content Calendar row|Node:/.test(t.body.text), 'alert text ' + t.body.text.slice(0, 160));
  });

  // cleanup: stop the every-minute copies
  for (const c of copies) n8n(['unpublish:workflow', '--id=' + c.id]);
  dc(['restart', 'n8n'], { stdio: 'ignore' });
  await until(async () => { try { return (await fetch(h.N8N + '/healthz/readiness')).ok; } catch (e) { return false; } }, { timeout: 120000, what: 'n8n readiness' });
};
