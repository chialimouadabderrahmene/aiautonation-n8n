'use strict';
/**
 * Staging test harness: drives the LOCAL staging n8n (webhooks over HTTP, scheduled workflows through the
 * Manual Trigger with `n8n execute`) and asserts on the mock's recorded provider traffic + in-memory Google Sheet.
 * Only QA/dummy data is used. Nothing here can reach a real provider.
 */
const { spawnSync } = require('child_process');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const STAGING_DIR = path.resolve(__dirname, '..');
const N8N = 'http://127.0.0.1:5678';
const MOCK = 'http://127.0.0.1:9099/__control';
// fetch with one retry on transport errors (Docker Desktop port-forwarding occasionally resets the first connection)
const rfetch = async (url, opts) => { try { return await fetch(url, opts); } catch (e) { await new Promise((r) => setTimeout(r, 700)); return fetch(url, opts); } };
const SECRET = 'staging-shared-secret';
const TG_SECRET = 'staging-telegram-secret';
const APP_SECRET = 'staging-app-secret-not-real';
const VERIFY_TOKEN = 'staging-verify-token';
const CHAT_ID = '-1009999999901';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];

async function mock(p, method = 'GET', body) {
  const r = await rfetch(MOCK + p, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json' } });
  return r.json();
}
const reset = () => mock('/reset', 'POST');
const seed = (tab, rows) => mock('/seed', 'POST', { tab, rows });
const sheet = async (tab) => (await mock('/sheet/' + encodeURIComponent(tab))).rows;
const reqs = (host, p, since) => mock('/requests?' + new URLSearchParams({ ...(host ? { host } : {}), ...(p ? { path: p } : {}), ...(since ? { since: String(since) } : {}) }));
const fault = (host, opts) => mock('/fault', 'POST', { host, ...opts });
const openSession = (phone, hoursAgo = 0) => mock('/session', 'POST', { phone, hoursAgo });
const queueAi = (match, content) => mock('/ai', 'POST', { match, content });
const violations = () => mock('/violations');
const lastSeq = async () => { const all = await reqs(); return all.length ? all[all.length - 1].seq : 0; };

/** POST JSON to an n8n production webhook */
async function post(p, body, { secret = SECRET, headers = {}, rawBody, method = 'POST', headerName = 'X-Eki-Webhook-Secret' } = {}) {
  const h = { 'content-type': 'application/json', ...(secret === null ? {} : { [headerName]: secret }), ...headers };
  const r = await rfetch(N8N + '/webhook/' + p, { method, headers: h, body: method === 'GET' ? undefined : (rawBody !== undefined ? rawBody : JSON.stringify(body)) });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch (e) { json = null; }
  return { status: r.status, text, json };
}

function waSignature(raw) { return 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(raw).digest('hex'); }
async function waPost(payload, { signature, rawOverride } = {}) {
  const raw = rawOverride !== undefined ? rawOverride : JSON.stringify(payload);
  const headers = {};
  if (signature !== null) headers['X-Hub-Signature-256'] = signature === undefined ? waSignature(raw) : signature;
  return post('whatsapp-webhook', null, { secret: null, headers, rawBody: raw });
}
const waInbound = (from, text, name = 'QA User', id = 'wamid.QA' + Math.random().toString(36).slice(2, 8)) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: '1', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '15550100000', phone_number_id: '100000000000001' }, contacts: [{ profile: { name }, wa_id: from }], messages: [{ from, id, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } }] } }] }],
});

/** Run a workflow with `n8n execute` (starts at its Manual Trigger). Returns {ok, out, error}. */
function cli(id) {
  const env = { ...process.env, MSYS_NO_PATHCONV: '1', LAUNCH_DATE: process.env.LAUNCH_DATE || new Date(Date.now() - 4 * 86400000).toISOString().slice(0, 10) };
  const r = spawnSync('docker', ['compose', '-f', 'docker-compose.staging.yml', 'exec', '-T', '-e', 'N8N_RUNNERS_BROKER_PORT=5680', 'n8n', 'n8n', 'execute', '--id=' + id], { cwd: STAGING_DIR, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 240000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const ok = /"status":\s*"success"/.test(out) && !/Execution error:/.test(out);
  const m = /Execution error:\s*=+\s*\n([\s\S]*?)\n[A-Za-z]*Error:/.exec(out) || /Execution error:\s*=+\s*\n([^\n]+)/.exec(out);
  const error = ok ? '' : ((m && m[1]) || out.split('\n').filter((l) => /error/i.test(l)).slice(0, 2).join(' | ')).replace(/\s+/g, ' ').slice(0, 300);
  return { ok, out, error, exit: r.status };
}

/** poll until fn() returns truthy */
async function until(fn, { timeout = 30000, every = 400, what = 'condition' } = {}) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn(); if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error('timeout waiting for ' + what);
    await sleep(every);
  }
}

function assert(cond, msg) { if (!cond) throw new Error('ASSERT: ' + msg); }
function eq(actual, expected, msg) { if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`ASSERT ${msg}: expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`); }

/** register + run one test case; `area` is the matrix column it evidences */
async function test(wf, area, name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push({ wf, area, name, pass: true, ms: Date.now() - t0 }); console.log(`  PASS  [${wf}] ${area.padEnd(9)} ${name}`); }
  catch (e) { results.push({ wf, area, name, pass: false, detail: String(e.message || e).slice(0, 400), ms: Date.now() - t0 }); console.log(`  FAIL  [${wf}] ${area.padEnd(9)} ${name}\n        ${String(e.message || e).slice(0, 400)}`); }
}

// ---- data builders (QA only: fictional +1 555-01xx numbers, .invalid emails) ----
const LEAD_COLS = JSON.parse(fs.readFileSync(path.join(STAGING_DIR, '..', 'schemas', 'sheet-columns.json'), 'utf8')).Leads;
const isoAgo = (hours) => new Date(Date.now() - hours * 3600000).toISOString();
const lead = (o) => { const base = Object.fromEntries(LEAD_COLS.map((c) => [c, ''])); const l = { ...base, ...o }; if (!l.lead_id && l.phone) l.lead_id = 'P' + l.phone; return l; };
const wa = async () => (await reqs('graph.facebook.com', '/messages')).filter((r) => r.method === 'POST');
const tg = async () => (await reqs('api.telegram.org', '/sendMessage')).filter((r) => r.method === 'POST');
const mails = async () => (await reqs('api.resend.com', '/emails'));
const ai = async () => (await reqs('api.groq.com', '/chat/completions'));

module.exports = { results, mock, reset, seed, sheet, reqs, fault, openSession, queueAi, violations, lastSeq, post, waPost, waInbound, waSignature, cli, until, assert, eq, test, sleep, lead, isoAgo, wa, tg, mails, ai, N8N, SECRET, TG_SECRET, APP_SECRET, VERIFY_TOKEN, CHAT_ID, STAGING_DIR };
