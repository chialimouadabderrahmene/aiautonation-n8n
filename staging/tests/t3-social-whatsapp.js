'use strict';
// Workflows 10, 12, 13, 14 (default staging env: AUTOPILOT_SOCIAL_POSTING=false).
module.exports = async function run(h) {
  const { test, reset, seed, sheet, post, waPost, waInbound, waSignature, cli, until, assert, eq, wa, tg, mails, ai, lead, isoAgo, reqs, fault, queueAi, openSession, violations, sleep, VERIFY_TOKEN } = h;
  const sub = (s) => s.split('\\').join(''); // Telegram legacy-Markdown escaping is invisible to readers
  const logCount = async () => (await sheet('Automation Logs')).length;
  // send an inbound WhatsApp message and wait until workflow 13 has fully finished (its last node logs a row)
  async function chat(phone, text, name) { const n = await logCount(); const r = await waPost(waInbound(phone, text, name)); eq(r.status, 200, 'ack'); await until(async () => (await logCount()) > n, { what: 'workflow 13 to finish', timeout: 45000 }); }

  // ------------------------------------------------------------------ 13 (security first)
  const hook = (q, o) => post('whatsapp-webhook?' + q, null, { secret: null, method: 'GET', ...o });
  await test('13', 'Security', 'GET verification: correct verify token echoes the challenge, wrong/missing token -> 403', async () => {
    const ok = await hook(`hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=424242`); eq(ok.status, 200, 'status'); eq(ok.text, '424242', 'challenge');
    eq((await hook('hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1')).status, 403, 'wrong token'); eq((await hook('hub.mode=subscribe&hub.challenge=1')).status, 403, 'missing token');
  });
  await test('13', 'Security', 'POST without X-Hub-Signature-256 -> 401, nothing processed', async () => {
    await reset(); const r = await waPost(waInbound('15550100601', 'hi'), { signature: null }); eq(r.status, 401, 'status'); await sleep(1500); eq((await sheet('Leads')).length, 0, 'no lead'); eq((await wa()).length, 0, 'no reply');
  });
  await test('13', 'Security', 'POST with a wrong signature or a tampered body -> 401', async () => {
    const p = waInbound('15550100601', 'hi'); const bad = await waPost(p, { signature: 'sha256=' + '0'.repeat(64) }); eq(bad.status, 401, 'wrong sig');
    const signed = waSignature(JSON.stringify(p)); const tampered = await waPost(waInbound('15550100999', 'hi'), { signature: signed }); eq(tampered.status, 401, 'tampered body');
    const noPrefix = await waPost(p, { signature: signed.replace('sha256=', '') }); eq(noPrefix.status, 401, 'missing sha256= prefix'); eq((await sheet('Leads')).length, 0, 'no lead');
  });
  const PH = '15550100602';
  await test('13', 'Execution', 'valid signed greeting: lead created, session reply describes Eki as an African foodstuff marketplace', async () => {
    await reset(); await openSession(PH);
    await chat(PH, 'Hi', 'Chidi QA');
    const b = (await wa())[0].body; assert(b.type === 'text' && b.to === PH && /African foodstuff/.test(b.text.body) && !/automate with AI/i.test(b.text.body), 'reply ' + b.text.body);
    const rows = await sheet('Leads'); eq(rows.length, 1, 'rows'); assert(rows[0].lead_id === 'P' + PH && rows[0].source === 'whatsapp' && rows[0].status === 'new' && rows[0].name === 'Chidi QA' && rows[0].first_contact, 'lead ' + JSON.stringify(rows[0]));
    await until(async () => (await sheet('WhatsApp Conversations')).length === 1, { what: 'conversation log' });
  });
  await test('13', 'Execution', 'BUYER -> opted-in buyer lead_captured (same row, no duplicate)', async () => {
    await chat(PH, 'BUYER');
    const rows = await sheet('Leads'); eq(rows.length, 1, 'rows'); assert(rows[0].opt_in === 'yes' && rows[0].opt_in_source === 'inbound_whatsapp' && rows[0].status === 'lead_captured' && rows[0].reengage_step === '0', 'lead ' + JSON.stringify(rows[0]));
  });
  await test('13', 'Execution', 'VENDOR -> high intent: team alerted on Telegram', async () => {
    const P2 = '15550100603'; await openSession(P2); await chat(P2, 'I am a vendor, I sell garri', 'Ngozi QA');
    await until(async () => (await tg()).some((x) => /HIGH-INTENT/.test(x.body.text)), { what: 'alert' }); assert((await sheet('Leads')).some((l) => l.lead_id === 'P' + P2 && l.intent_level === 'high' && l.user_type === 'vendor'), 'vendor lead');
  });
  await test('13', 'Security', 'STOP persists the unsubscribe on the lead record and confirms once', async () => {
    const before = (await wa()).length; await chat(PH, 'STOP.');
    const l = (await sheet('Leads')).find((x) => x.lead_id === 'P' + PH); assert(l.opt_in === 'no' && /^\d{4}-/.test(l.opt_out_at), 'opt-out fields ' + JSON.stringify([l.opt_in, l.opt_out_at]));
    eq((await wa()).length, before + 1, 'stop confirmation sent'); assert(/unsubscribed/i.test((await wa()).pop().body.text.body), 'confirmation text');
    eq((await sheet('Leads')).filter((x) => x.lead_id === 'P' + PH).length, 1, 'single lead row');
  });
  await test('13', 'Security', 'an unsubscribed lead who writes again is NOT answered', async () => {
    const before = (await wa()).length; await chat(PH, 'hello are you there'); eq((await wa()).length, before, 'WA sends'); eq((await sheet('Leads')).find((x) => x.lead_id === 'P' + PH).status, 'unsubscribed', 'still unsubscribed');
  });
  await test('13', 'Security', 'nurture / welcome / re-engagement workflows never target the unsubscribed lead (verified on the real lead record)', async () => {
    const rows = await sheet('Leads'); const l = rows.find((x) => x.lead_id === 'P' + PH); assert(l.status === 'unsubscribed', 'precondition');
    // make every other eligibility rule pass so ONLY the persisted opt-out can stop the send
    await reset(); await seed('Leads', [{ ...l, user_type: 'buyer', opt_in_at: isoAgo(24 * 20), first_contact: isoAgo(24 * 20), last_wa: isoAgo(24 * 20), last_message: isoAgo(24 * 20), wa_day: '0', nurture_day: '0', reengage_step: '0' }]);
    for (const id of ['ekiwf05', 'ekiwf06', 'ekiwf19']) { const r = cli(id); assert(r.ok, id + ': ' + r.error); }
    eq((await wa()).length, 0, 'WA sends to an unsubscribed lead');
  });
  await test('13', 'Execution', 'START re-subscribes (status new, opt_in yes, opt_out cleared) and is answered', async () => {
    await reset(); await seed('Leads', [lead({ phone: PH, name: 'Chidi', status: 'unsubscribed', opt_in: 'no', opt_out_at: isoAgo(5) })]); await openSession(PH);
    await chat(PH, 'START');
    const l = (await sheet('Leads'))[0]; assert(l.status === 'new' && l.opt_in === 'yes' && l.opt_out_at === '', 'fields ' + JSON.stringify([l.status, l.opt_in, l.opt_out_at])); eq((await wa()).length, 1, 'welcome reply sent');
  });
  await test('13', 'Execution', 'signature is computed over the RAW bytes (non-ASCII text: accented letters + emoji)', async () => {
    await reset(); const P3 = '15550100604'; await openSession(P3); await chat(P3, 'Ciao è un piacere 🌍 vendo garri', 'Zoë QA'); eq((await sheet('WhatsApp Conversations'))[0].message_text, 'Ciao è un piacere 🌍 vendo garri', 'text preserved');
  });
  await test('13', 'Output', 'status-only webhooks (delivery receipts) are acknowledged and ignored', async () => {
    await reset(); const r = await waPost({ object: 'whatsapp_business_account', entry: [{ id: '1', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', statuses: [{ id: 'wamid.X', status: 'delivered' }] } }] }] }); eq(r.status, 200, 'ack'); await sleep(2500); eq((await sheet('Leads')).length, 0, 'no lead'); eq((await wa()).length, 0, 'no reply');
  });
  await test('13', 'Errors', 'reply failure (WhatsApp outage) still saves the lead and the opt-out', async () => {
    await reset(); const P4 = '15550100605'; await seed('Leads', [lead({ phone: P4, status: 'lead_captured', opt_in: 'yes' })]); await openSession(P4); await fault('graph.facebook.com', { status: 500, times: 3 });
    await chat(P4, 'stop'); assert((await sheet('Leads'))[0].status === 'unsubscribed', 'unsubscribed despite outage'); assert((await sheet('Leads'))[0].last_wa_error, 'error recorded'); eq((await wa()).length, 3, 'reply retried 3x');
  });
  await test('13', 'Security', 'compliance: no free-form message was ever sent outside the 24h window (mock enforces Meta rule 131047)', async () => { eq(await violations(), [], 'violations'); });

  // ------------------------------------------------------------------ 10
  const d = (o) => ({ draft_id: 'D-1', day_number: '1', platform: 'X/Twitter', hook: 'h', caption: 'Caption one', hashtags: '#Eki', video_script: '', status: 'Approved', approval_date: isoAgo(48), published: 'FALSE', created_date: '2026-09-20', ...o });
  await test('10', 'Execution', 'autopilot OFF (default): oldest approved draft goes to Telegram for MANUAL posting, marked Notification Sent, no provider call', async () => {
    await reset();
    await seed('Content Drafts', [d(), d({ draft_id: 'D-2', day_number: '2', platform: 'Instagram', caption: 'Caption two', approval_date: isoAgo(24) }), d({ draft_id: 'D-3', day_number: '3', status: 'Draft', caption: 'not approved' }), d({ draft_id: 'D-4', day_number: '4', published: 'TRUE', caption: 'already published' })]);
    const r = cli('ekiwf10'); assert(r.ok, r.error);
    const t = await tg(); eq(t.length, 1, 'telegram'); assert(/Caption one/.test(t[0].body.text) && /TWITTER/.test(t[0].body.text), 'manual alert ' + t[0].body.text.slice(0, 80));
    eq((await sheet('Content Drafts')).find((x) => x.draft_id === 'D-1').status, 'Notification Sent', 'status');
    eq((await reqs('api.twitter.com')).length + (await reqs('api.bufferapp.com')).length, 0, 'no social API calls');
  });
  await test('10', 'Output', 'next run picks the next approved draft; when none are left it does nothing', async () => {
    let r = cli('ekiwf10'); assert(r.ok, r.error); assert((await tg()).some((x) => /Caption two/.test(x.body.text)), 'second draft'); const n = (await tg()).length;
    r = cli('ekiwf10'); assert(r.ok, r.error); eq((await tg()).length, n, 'nothing left to post');
  });

  // ------------------------------------------------------------------ 12
  await test('12', 'Execution', 'daily run: 3 platform posts generated, safety-checked, saved; autopilot OFF -> manual Telegram (no Buffer)', async () => {
    await reset(); const r = cli('ekiwf12'); assert(r.ok, r.error);
    const rows = await sheet('Social Posts'); eq(rows.map((x) => x.platform).sort(), ['facebook', 'instagram', 'tiktok'], 'platforms'); assert(rows.every((x) => x.status === 'approved' && x.autopilot_status === 'pending'), 'statuses ' + JSON.stringify(rows.map((x) => x.status)));
    eq((await tg()).length, 3, 'manual telegram messages'); eq((await reqs('api.bufferapp.com')).length, 0, 'no Buffer calls'); eq((await sheet('Automation Logs')).length, 3, 'log rows');
    const sys = (await ai())[0].body.messages[0].content; assert(/African foodstuff/.test(sys) && !/AI automation/i.test(sys), 'brand in prompt: ' + sys.slice(0, 120));
  });
  await test('12', 'Execution', 'safety net: a caption with a false claim is FLAGGED, not approved', async () => {
    await reset(); await queueAi('Generate social media content for', { tiktok: { hook: 'a', video_script: 'v', caption: 'Egusi that tastes like home', hashtags: '#a' }, instagram: { hook: 'b', video_script: 'v', caption: 'Guaranteed instant results for every vendor', hashtags: '#b' }, facebook: { hook: 'c', caption: 'Join the Eki community today', hashtags: '#c', video_script: '' } });
    const r = cli('ekiwf12'); assert(r.ok, r.error); const rows = await sheet('Social Posts'); const ig = rows.find((x) => x.platform === 'instagram'); assert(ig.status === 'flagged' && /false_claim/.test(ig.flag_reason), 'instagram flagged ' + JSON.stringify([ig.status, ig.flag_reason]));
    eq(rows.filter((x) => x.status === 'approved').length, 2, 'approved count');
  });
  await test('12', 'Errors', 'AI returns invalid JSON: execution fails loudly and nothing is saved', async () => {
    await reset(); await queueAi('Generate social media content for', 'this is not json'); const r = cli('ekiwf12'); assert(!r.ok, 'should fail'); eq((await sheet('Social Posts')).length, 0, 'nothing saved');
    assert(/invalid JSON/.test(r.error), 'clear error: ' + r.error);
  });

  // ------------------------------------------------------------------ 14
  await test('14', 'Execution', 'controller: daily report + config health (lists the unconfigured WhatsApp templates), logs the run, sends NO WhatsApp', async () => {
    await reset(); await seed('Leads', [lead({ phone: '15550100701', status: 'new', opt_in: 'yes', first_contact: isoAgo(1) }), lead({ phone: '15550100702', status: 'unsubscribed', opt_in: 'no', opt_out_at: isoAgo(3) })]);
    const r = cli('ekiwf14'); assert(r.ok, r.error); const t = (await tg()).map((x) => sub(x.body.text)).join('\n');
    assert(/Leads: \+1 today, 2 total, 1 opted-in, 1 unsubscribed/.test(t), 'lead counts: ' + t); assert(/templates missing: 2 \(REENGAGE_21, NURTURE_BUYER_D5\)/.test(t), 'template health: ' + t);
    assert(/Social auto-posting: OFF/.test(t), 'autopilot OFF'); eq((await sheet('Automation Logs')).length, 1, 'log'); eq((await wa()).length, 0, 'no WhatsApp from the controller');
  });
};
