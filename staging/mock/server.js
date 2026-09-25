'use strict';
/**
 * Eki staging mock: HTTP(S) forward proxy + fake external providers.
 *
 * n8n (staging container) is started with HTTPS_PROXY pointing here and NODE_TLS_REJECT_UNAUTHORIZED=0,
 * so every outbound call the workflows make (Meta Graph, Telegram, Resend, Google Sheets, AI, Apify,
 * Reddit, Buffer, X) lands in this process instead of the real provider. Nothing here talks to the internet.
 *
 * It ENFORCES the rules that matter for production safety:
 *  - Meta Graph: free-form (`type: text`) messages are rejected (error 131047, recorded as a violation)
 *    unless the recipient messaged us in the last 24h. Template messages must be well-formed.
 *  - Google Sheets: only known tabs/columns exist; writes go to a real in-memory grid.
 * Control API (plain HTTP, path /__control/*) is used by staging/run-tests.js to seed data and assert.
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.MOCK_PORT || '9099', 10);
const EXPECTED_SHEET_ID = process.env.GOOGLE_SHEETS_ID || 'staging-sheet-id';
const WA_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN || 'staging-wa-token';
const WA_PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '100000000000001';
const RESEND_KEY = process.env.RESEND_API_KEY || 're_staging_key';
const SCHEMA = JSON.parse(fs.readFileSync(process.env.SHEET_COLUMNS_PATH || path.join(__dirname, 'sheet-columns.json'), 'utf8'));
const tlsOpts = { key: fs.readFileSync(path.join(__dirname, 'certs', 'key.pem')), cert: fs.readFileSync(path.join(__dirname, 'certs', 'cert.pem')) };

const state = { requests: [], sheets: {}, sessions: {}, faults: [], aiQueue: [], counters: { wa: 0, tg: 0, email: 0, ai: 0 }, violations: [] };
function resetSheets() {
  state.sheets = {};
  for (const [tab, cols] of Object.entries(SCHEMA)) state.sheets[tab] = [cols.slice()];
}
function resetAll() { state.requests = []; state.sessions = {}; state.faults = []; state.aiQueue = []; state.violations = []; state.counters = { wa: 0, tg: 0, email: 0, ai: 0 }; resetSheets(); }
resetAll();

// ------------------------------------------------------------------ helpers
const readBody = (req) => new Promise((resolve) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => resolve(Buffer.concat(c).toString('utf8'))); });
const tryJson = (s) => { try { return JSON.parse(s); } catch (e) { return s; } };
const send = (res, code, obj, headers = {}) => { const b = typeof obj === 'string' ? obj : JSON.stringify(obj); res.writeHead(code, { 'Content-Type': typeof obj === 'string' ? 'text/plain' : 'application/json', ...headers }); res.end(b); };
const colLetters = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const colNum = (l) => l.split('').reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0);

function parseRange(range) {
  const r = decodeURIComponent(range);
  const bang = r.lastIndexOf('!');
  let tab = bang >= 0 ? r.slice(0, bang) : r;
  let a1 = bang >= 0 ? r.slice(bang + 1) : '';
  tab = tab.replace(/^'(.*)'$/, '$1').replace(/''/g, "'");
  if (bang < 0 && !state.sheets[tab]) { tab = r; a1 = ''; }
  let r1 = 1, c1 = 1, r2 = Infinity, c2 = Infinity;
  if (a1) {
    const parts = a1.split(':');
    const cell = (p) => { const m = /^([A-Z]*)(\d*)$/.exec(p); return { c: m && m[1] ? colNum(m[1]) : null, r: m && m[2] ? parseInt(m[2], 10) : null }; };
    const s = cell(parts[0]); const e = parts[1] ? cell(parts[1]) : s;
    if (s.r) r1 = s.r; if (s.c) c1 = s.c;
    r2 = e.r || (parts[1] ? Infinity : r1); c2 = e.c || (parts[1] ? Infinity : c1);
  }
  return { tab, r1, c1, r2, c2 };
}
const getRows = (tab) => state.sheets[tab];
const trimRow = (row) => { const r = row.slice(); while (r.length && (r[r.length - 1] === '' || r[r.length - 1] === undefined)) r.pop(); return r; };
function readValues(rg) {
  const rows = getRows(rg.tab); const out = [];
  const last = Math.min(rg.r2, rows.length);
  for (let r = rg.r1; r <= last; r++) { const row = rows[r - 1] || []; const c2 = Number.isFinite(rg.c2) ? rg.c2 : row.length; out.push(trimRow(row.slice(rg.c1 - 1, c2))); }
  while (out.length && out[out.length - 1].length === 0) out.pop();
  return out;
}
function writeValues(rg, values) {
  const rows = getRows(rg.tab);
  values.forEach((vals, i) => {
    const r = rg.r1 + i; while (rows.length < r) rows.push([]);
    const row = rows[r - 1];
    vals.forEach((v, j) => { const c = rg.c1 + j; while (row.length < c - 1) row.push(''); row[c - 1] = v === null || v === undefined ? '' : String(v); });
  });
}
const toObjects = (tab) => { const rows = getRows(tab); const h = rows[0]; return rows.slice(1).map((r) => Object.fromEntries(h.map((k, i) => [k, r[i] === undefined ? '' : r[i]]))); };

function takeFault(host, p) {
  const f = state.faults.find((x) => x.times > 0 && x.host === host && (!x.path || p.includes(x.path)));
  if (!f) return null; f.times -= 1; return f;
}

// ------------------------------------------------------------------ providers
function graph(req, res, url, body) {
  const m = /^\/v\d+\.\d+\/(\d+)\/messages$/.exec(url.pathname);
  if (!m || req.method !== 'POST') return send(res, 404, { error: { message: 'unknown graph path', code: 100 } });
  if (req.headers.authorization !== 'Bearer ' + WA_TOKEN) return send(res, 401, { error: { message: 'Invalid OAuth access token', code: 190 } });
  if (m[1] !== WA_PHONE_ID) return send(res, 400, { error: { message: 'Unsupported post request. Object with ID does not exist (phone number id)', code: 100 } });
  const to = String(body.to || '');
  if (body.messaging_product !== 'whatsapp' || !/^\d{8,15}$/.test(to)) return send(res, 400, { error: { message: 'Invalid parameter: to / messaging_product', code: 100 } });
  if (body.type === 'template') {
    const t = body.template || {};
    const comps = t.components || [];
    const ok = t.name && t.language && t.language.code && Array.isArray(comps) && comps.every((c) => c.type === 'body' && Array.isArray(c.parameters) && c.parameters.every((p) => p.type === 'text' && typeof p.text === 'string' && p.text.length > 0 && !/[\n\t]/.test(p.text)));
    if (!ok) return send(res, 400, { error: { message: 'Invalid template payload', code: 132000 } });
  } else if (body.type === 'text') {
    const opened = state.sessions[to];
    if (!opened || Date.now() - opened > 24 * 3600 * 1000) {
      state.violations.push({ to, text: (body.text && body.text.body) || '', ts: Date.now() });
      return send(res, 400, { error: { message: 'Re-engagement message: more than 24 hours since the customer last replied', type: 'OAuthException', code: 131047 } });
    }
  } else return send(res, 400, { error: { message: 'Unsupported message type in staging mock', code: 100 } });
  state.counters.wa += 1;
  return send(res, 200, { messaging_product: 'whatsapp', contacts: [{ input: to, wa_id: to }], messages: [{ id: 'wamid.STAGING' + state.counters.wa }] });
}

function telegram(req, res, url, body) {
  const m = /^\/bot([^/]+)\/(\w+)$/.exec(url.pathname);
  if (!m) return send(res, 404, { ok: false });
  if (m[2] === 'sendMessage') { state.counters.tg += 1; return send(res, 200, { ok: true, result: { message_id: state.counters.tg, chat: { id: body.chat_id }, text: body.text } }); }
  return send(res, 200, { ok: true, result: {} });
}

function resend(req, res, url, body) {
  if (req.headers.authorization !== 'Bearer ' + RESEND_KEY) return send(res, 401, { statusCode: 401, name: 'validation_error', message: 'API key is invalid' });
  if (!body.from || !Array.isArray(body.to) || !body.to.length || !body.subject || !body.html) return send(res, 422, { statusCode: 422, name: 'validation_error', message: 'Missing from/to/subject/html' });
  state.counters.email += 1; return send(res, 200, { id: 're_' + state.counters.email });
}

const AI_CANNED = [
  [/Today's Content Plan/, () => ({ hook: 'Missing your favourite garri from home?', caption: 'Sourcing authentic African foodstuff should feel easy. Discover trusted vendors on Eki.', hashtags: '#EkiMarket #AfricanFood #Garri', video_script: '[Visual: vendor packing garri] Audio: Authentic taste, delivered.' })],
  [/Feedback for revision/, () => ({ hook: 'Revised: home flavours, delivered', caption: 'Revised caption: warm, community-first sourcing of African foodstuff on Eki.', hashtags: '#EkiMarket #Revised', video_script: '[Visual: revised] Audio: revised script.' })],
  [/Generate social media content for/, () => ({
    tiktok: { hook: 'Where do you buy egusi abroad?', video_script: 'Scene 1: pantry. Scene 2: Eki app.', caption: 'Find egusi from trusted African vendors.', hashtags: '#egusi #EkiMarket #AfricanFood #foodtok #cooking' },
    instagram: { hook: 'Palm oil, but make it easy', video_script: 'Reel: unboxing palm oil.', caption: 'Real vendors, real ingredients. Find them on Eki.', hashtags: '#palmoil #EkiMarket #AfricanFood #naijafood #cooking #recipes #foodie #diaspora #market #vendors' },
    facebook: { hook: 'A community for African food lovers', caption: 'Join the Eki community and discover vendors near you and around the world.', hashtags: '#Eki #AfricanFood #Community', video_script: '' },
  })],
  [/Analyze these trending posts/, () => ({ hooks: ['POV: your mum ships you jollof spices', 'Stop buying the wrong palm oil'], emotions: ['nostalgia', 'pride'], formats: ['pov-reel', 'unboxing'], creators: ['@foodie1'] })],
  [/numbered post/, () => ({ items: [{ index: 1, persona: 'vendor', category: 'No_Buyers', intensity: 7, keywords: ['buyers', 'reach'] }, { index: 2, persona: 'buyer', category: 'Scam_Fear', intensity: 9, keywords: ['scam', 'trust'] }] })],
  [/expand it into ALL formats/, () => ({ reel_script: 'Reel script', tiktok_adaptation: 'TikTok script', carousel: ['s1', 's2', 's3', 's4', 's5'], story_sequence: ['f1', 'f2', 'f3'], fb_post: 'FB post', hook_variations: ['h1', 'h2', 'h3'], caption_variations: ['c1', 'c2', 'c3'] })],
  [/winners vs losers/, () => ({ top_hooks: ['Question hooks'], top_formats: ['POV reel'], top_emotions: ['nostalgia'], recommendations: ['Post more POV reels'] })],
  [/social proof content/, () => ({ reel_script: 'proof reel', carousel_slides: ['1', '2', '3', '4', '5'], caption: 'Congrats to the vendor!', quote_card_text: 'A big first step on Eki.', hashtags: '#EkiMarket' })],
  [/weekly performance/, () => ({ top_3_insights: ['Leads growing', 'Vendors outnumber buyers', 'POV reels win'], recommendations: ['Recruit more buyers'], content_brief_for_next_week: 'Buyer trust', risk_flags: ['Low opt-in rate'] })],
];
function ai(req, res, url, body) {
  if (!/^Bearer .+/.test(req.headers.authorization || '')) return send(res, 401, { error: { message: 'Invalid API key' } });
  if (url.pathname !== '/openai/v1/chat/completions' && url.pathname !== '/v1/chat/completions') return send(res, 404, { error: { message: 'unknown ai path' } });
  const msgs = body.messages || [];
  const user = (msgs.filter((m) => m.role === 'user').pop() || {}).content || '';
  state.counters.ai += 1;
  const q = state.aiQueue.findIndex((x) => user.includes(x.match) || (msgs[0] && String(msgs[0].content).includes(x.match)));
  let content;
  if (q >= 0) content = state.aiQueue.splice(q, 1)[0].content;
  else { const hit = AI_CANNED.find(([re]) => re.test(user)); content = hit ? JSON.stringify(hit[1]()) : JSON.stringify({ note: 'unmatched prompt' }); }
  return send(res, 200, { id: 'chatcmpl-staging', object: 'chat.completion', model: body.model, choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }] });
}

function sheets(req, res, url, body) {
  const m = /^\/v4\/spreadsheets\/([^/:]+)(.*)$/.exec(url.pathname);
  if (!m) return send(res, 404, { error: { code: 404, message: 'unknown sheets path ' + url.pathname } });
  if (m[1] !== EXPECTED_SHEET_ID) return send(res, 404, { error: { code: 404, message: 'Requested entity was not found. (spreadsheet id ' + m[1] + ')', status: 'NOT_FOUND' } });
  const rest = m[2];
  if (rest === '' && req.method === 'GET') return send(res, 200, { spreadsheetId: m[1], properties: { title: 'Eki Launch Database (staging)' }, sheets: Object.keys(state.sheets).map((t, i) => ({ properties: { sheetId: 1000 + i, title: t, index: i, sheetType: 'GRID', gridProperties: { rowCount: 1000, columnCount: 40 } } })) });
  // Structural batchUpdate (n8n's append issues appendDimension before writing values). The in-memory grid grows on write, so a no-op ack is faithful.
  if (rest === ':batchUpdate' && req.method === 'POST') return send(res, 200, { spreadsheetId: m[1], replies: (body.requests || []).map(() => ({})) });
  const bad = (rg) => (!state.sheets[rg.tab] ? send(res, 400, { error: { code: 400, message: 'Unable to parse range: ' + rg.tab, status: 'INVALID_ARGUMENT' } }) : null);
  let mm;
  if (rest === '/values:batchUpdate' && req.method === 'POST') {
    const out = [];
    for (const d of body.data || []) { const rg = parseRange(d.range); if (bad(rg)) return; writeValues(rg, d.values || []); out.push({ updatedRange: d.range, updatedRows: (d.values || []).length }); }
    return send(res, 200, { spreadsheetId: m[1], totalUpdatedRows: out.length, responses: out });
  }
  if (rest === '/values:batchGet' && req.method === 'GET') {
    const ranges = [].concat(url.searchParams.getAll('ranges'));
    return send(res, 200, { spreadsheetId: m[1], valueRanges: ranges.map((r) => { const rg = parseRange(r); return { range: r, majorDimension: 'ROWS', values: state.sheets[rg.tab] ? readValues(rg) : [] }; }) });
  }
  if ((mm = /^\/values\/(.+):append$/.exec(rest)) && req.method === 'POST') {
    const rg = parseRange(mm[1]); if (bad(rg)) return;
    const rows = getRows(rg.tab); const start = rows.length + 1;
    (body.values || []).forEach((vals, i) => writeValues({ tab: rg.tab, r1: start + i, c1: 1 }, [vals]));
    return send(res, 200, { spreadsheetId: m[1], tableRange: rg.tab, updates: { spreadsheetId: m[1], updatedRange: rg.tab + '!A' + start, updatedRows: (body.values || []).length, updatedColumns: ((body.values || [[]])[0] || []).length, updatedCells: (body.values || []).reduce((a, v) => a + v.length, 0) } });
  }
  if ((mm = /^\/values\/(.+)$/.exec(rest))) {
    const rg = parseRange(mm[1]); if (bad(rg)) return;
    if (req.method === 'GET') return send(res, 200, { range: mm[1], majorDimension: 'ROWS', values: readValues(rg) });
    if (req.method === 'PUT') { writeValues(rg, body.values || []); return send(res, 200, { spreadsheetId: m[1], updatedRange: mm[1], updatedRows: (body.values || []).length }); }
  }
  return send(res, 404, { error: { code: 404, message: 'unhandled sheets call ' + req.method + ' ' + rest } });
}

function misc(host, req, res, url, body) {
  if (host === 'oauth2.googleapis.com') return send(res, 200, { access_token: 'mock-access-token', expires_in: 3600, token_type: 'Bearer' });
  if (host === 'api.apify.com') return send(res, 200, [{ text: 'POV: unboxing garri from home', likesCount: 120, commentsCount: 14 }, { caption: 'Palm oil mistakes to avoid', likes: 90, comments: 9 }]);
  if (host === 'www.reddit.com') return send(res, 200, { data: { children: [{ data: { title: 'Nobody buys from my online food shop', selftext: 'I sell spices but get no buyers', ups: 44 } }, { data: { title: 'Scared of scams buying food abroad', selftext: 'Fake payment alerts everywhere', ups: 88 } }] } });
  if (host === 'api.bufferapp.com') return send(res, 200, { success: true, updates: [{ id: 'buf1' }] });
  if (host === 'api.twitter.com') return send(res, 201, { data: { id: '1900000000000000000', text: (body || {}).text } });
  return send(res, 404, { error: 'mock has no handler for host ' + host });
}

// ------------------------------------------------------------------ dispatcher
async function handle(req, res, forcedHost) {
  const rawBody = await readBody(req);
  const host = (forcedHost || req.headers.host || '').split(':')[0];
  const url = new URL(req.url, 'http://' + (req.headers.host || 'mock'));
  if (url.pathname.startsWith('/__control')) return control(req, res, url, rawBody);
  const ct = req.headers['content-type'] || '';
  const body = ct.includes('json') ? tryJson(rawBody) : ct.includes('form') ? Object.fromEntries(new URLSearchParams(rawBody)) : rawBody;
  const entry = { seq: state.requests.length + 1, ts: Date.now(), host, method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: { authorization: req.headers.authorization, 'content-type': ct }, body, status: 0 };
  state.requests.push(entry);
  const origWrite = res.writeHead.bind(res);
  res.writeHead = (code, ...a) => { entry.status = code; return origWrite(code, ...a); };
  const fault = takeFault(host, url.pathname);
  if (fault) return send(res, fault.status || 500, fault.body || { error: { message: 'injected fault' } });
  try {
    if (host === 'graph.facebook.com') return graph(req, res, url, body);
    if (host === 'api.telegram.org') return telegram(req, res, url, body);
    if (host === 'api.resend.com') return resend(req, res, url, body);
    if (host === 'api.groq.com' || host === 'api.openai.com') return ai(req, res, url, body);
    if (host === 'sheets.googleapis.com') return sheets(req, res, url, body);
    return misc(host, req, res, url, body);
  } catch (e) { return send(res, 500, { error: String(e && e.stack || e) }); }
}

function control(req, res, url, rawBody) {
  const b = rawBody ? tryJson(rawBody) : {};
  const p = url.pathname.replace('/__control', '');
  if (p === '/health') return send(res, 200, { ok: true });
  if (p === '/reset') { resetAll(); return send(res, 200, { ok: true }); }
  if (p === '/seed' && req.method === 'POST') {
    const rows = getRows(b.tab); if (!rows) return send(res, 400, { error: 'unknown tab ' + b.tab });
    for (const o of b.rows || []) { const unknown = Object.keys(o).filter((k) => !rows[0].includes(k)); if (unknown.length) return send(res, 400, { error: 'unknown columns for ' + b.tab + ': ' + unknown.join(',') }); rows.push(rows[0].map((h) => (o[h] === undefined ? '' : String(o[h])))); }
    return send(res, 200, { ok: true, count: (b.rows || []).length });
  }
  if (p.startsWith('/sheet/')) { const tab = decodeURIComponent(p.slice(7)); if (!state.sheets[tab]) return send(res, 404, { error: 'unknown tab' }); return send(res, 200, { header: state.sheets[tab][0], rows: toObjects(tab) }); }
  if (p === '/requests') {
    let list = state.requests;
    const h = url.searchParams.get('host'); const pp = url.searchParams.get('path'); const since = parseInt(url.searchParams.get('since') || '0', 10);
    if (h) list = list.filter((r) => r.host === h); if (pp) list = list.filter((r) => r.path.includes(pp)); if (since) list = list.filter((r) => r.seq > since);
    return send(res, 200, list);
  }
  if (p === '/fault' && req.method === 'POST') { state.faults.push({ host: b.host, path: b.path, status: b.status || 500, times: b.times || 1, body: b.body }); return send(res, 200, { ok: true }); }
  if (p === '/session' && req.method === 'POST') { state.sessions[String(b.phone)] = Date.now() - (b.hoursAgo || 0) * 3600 * 1000; return send(res, 200, { ok: true }); }
  if (p === '/ai' && req.method === 'POST') { state.aiQueue.push({ match: b.match, content: typeof b.content === 'string' ? b.content : JSON.stringify(b.content) }); return send(res, 200, { ok: true }); }
  if (p === '/violations') return send(res, 200, state.violations);
  if (p === '/counters') return send(res, 200, state.counters);
  return send(res, 404, { error: 'unknown control path' });
}

// plain HTTP (control API + absolute-URI proxy requests)
const proxy = http.createServer((req, res) => handle(req, res));
// TLS terminator for CONNECT tunnels
const tlsServer = https.createServer(tlsOpts, (req, res) => handle(req, res));
proxy.on('connect', (req, socket, head) => {
  socket.on('error', () => {});
  socket.write('HTTP/1.1 200 Connection Established\r\nProxy-Agent: eki-mock\r\n\r\n');
  if (head && head.length) socket.unshift(head);
  tlsServer.emit('connection', socket);
});
proxy.listen(PORT, '0.0.0.0', () => console.log('eki mock listening on :' + PORT + ' (sheet id ' + EXPECTED_SHEET_ID + ')'));
