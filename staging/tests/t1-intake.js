'use strict';
// Workflows 00-04: error handler, content generation/approval, lead capture, waitlist.
module.exports = async function run(h) {
  const { test, reset, seed, sheet, post, cli, until, assert, eq, wa, tg, mails, ai, lead, reqs, fault, violations, CHAT_ID, TG_SECRET, sleep } = h;
  const day5 = { day_number: '5', phase: 'Pre-Launch Hype', pillar: 'Education', suggested_platform: 'TikTok, Instagram Reels', topic_brief: 'How to store garri', suggested_hook: 'Store garri like a pro', cta: 'Join the waitlist', target_audience: 'Buyers' };

  // ------------------------------------------------------------------ 01
  await test('01', 'Execution', 'daily run: drafts a post for LAUNCH_DATE day, saves it, asks for approval on Telegram', async () => {
    await reset(); await seed('Content Calendar', [day5]);
    const r = cli('ekiwf01'); assert(r.ok, 'execution failed: ' + r.error);
    const rows = await sheet('Content Drafts'); eq(rows.length, 1, 'draft rows');
    assert(rows[0].status === 'Draft' && rows[0].day_number === '5' && rows[0].draft_id.startsWith('D-005-'), 'draft fields ' + JSON.stringify(rows[0]));
    const t = await tg(); assert(t.length === 1 && /\/approve 5/.test(t[0].body.text) && t[0].body.chat_id === CHAT_ID, 'telegram approval request');
    const sys = (await ai())[0].body.messages[0].content;
    assert(/African foodstuff/.test(sys) && !/AI automation/i.test(sys), 'AI system prompt must describe an African foodstuff marketplace: ' + sys.slice(0, 80));
  });
  await test('01', 'Output', 'is idempotent: second run does not create a duplicate draft or call the AI again', async () => {
    const before = (await ai()).length;
    const r = cli('ekiwf01'); assert(r.ok, 'execution failed: ' + r.error);
    eq((await sheet('Content Drafts')).length, 1, 'draft rows after rerun'); eq((await ai()).length, before, 'AI calls after rerun');
  });
  await test('01', 'Errors', 'AI provider outage: retried 3x, execution fails loudly, no partial draft (alerting is verified in production mode: see 00/02/04/18 and the trigger-mode stage)', async () => {
    await reset(); await seed('Content Calendar', [day5]); await fault('api.groq.com', { status: 500, times: 3 });
    const r = cli('ekiwf01'); assert(!r.ok, 'must fail when AI is down');
    eq((await ai()).length, 3, 'AI attempts (retry x3)');
    eq((await sheet('Content Drafts')).length, 0, 'no partial draft');
  });
  await test('01', 'Errors', 'missing calendar row fails loudly (no silent skip)', async () => {
    await reset();
    const r = cli('ekiwf01'); assert(!r.ok && /No Content Calendar row/.test(r.error), 'expected clear error, got: ' + r.error);
  });

  // ------------------------------------------------------------------ 02
  const draft = (o = {}) => ({ draft_id: 'D-005-20260925', day_number: '5', platform: 'TikTok', hook: 'Old hook', caption: 'Old caption', hashtags: '#Eki', video_script: 'old script', status: 'Draft', published: 'FALSE', created_date: '2026-09-25', ...o });
  const tgUpdate = (text, chat = CHAT_ID) => ({ update_id: 1, message: { message_id: 1, chat: { id: Number(chat) }, text } });
  const approve = (body, opts = {}) => post('content-approval', body, { headerName: 'X-Telegram-Bot-Api-Secret-Token', secret: TG_SECRET, ...opts });
  await test('02', 'Trigger', 'rejects calls without the Telegram secret token (403)', async () => {
    await reset(); const r = await approve(tgUpdate('/approve 5'), { secret: null }); eq(r.status, 403, 'status');
    const r2 = await approve(tgUpdate('/approve 5'), { secret: 'wrong' }); eq(r2.status, 403, 'wrong secret status');
  });
  await test('02', 'Execution', '/approve marks the draft Approved (+approval_date) and confirms on Telegram', async () => {
    await reset(); await seed('Content Drafts', [draft()]);
    const r = await approve(tgUpdate('/approve 5')); eq(r.status, 200, 'status');
    await until(async () => (await sheet('Content Drafts'))[0].status === 'Approved', { what: 'status Approved' });
    const row = (await sheet('Content Drafts'))[0]; assert(/^\d{4}-\d{2}-\d{2}T/.test(row.approval_date), 'approval_date ' + row.approval_date);
    await until(async () => (await tg()).some((x) => /approved for day 5/i.test(x.body.text)), { what: 'telegram confirm' });
  });
  await test('02', 'Execution', '/reject marks the draft Rejected', async () => {
    await reset(); await seed('Content Drafts', [draft()]);
    await approve(tgUpdate('/reject 5'));
    await until(async () => (await sheet('Content Drafts'))[0].status === 'Rejected', { what: 'status Rejected' });
  });
  await test('02', 'Execution', '/edit revises the draft through the AI and returns it as Draft', async () => {
    await reset(); await seed('Content Drafts', [draft({ status: 'Approved' })]);
    await approve(tgUpdate('/edit 5 make it warmer'));
    await until(async () => /Revised/.test((await sheet('Content Drafts'))[0].hook), { what: 'revised hook' });
    const row = (await sheet('Content Drafts'))[0]; eq(row.status, 'Draft', 'status back to Draft');
    assert((await ai()).some((x) => /make it warmer/.test(x.body.messages[1].content)), 'feedback reached the AI');
    await until(async () => (await tg()).some((x) => /Revised Eki content draft/.test(x.body.text)), { what: 'revised draft telegram' });
  });
  await test('02', 'Security', 'ignores commands from any chat other than TELEGRAM_CHAT_ID', async () => {
    await reset(); await seed('Content Drafts', [draft()]);
    await approve(tgUpdate('/approve 5', '-1005555555555')); await sleep(6000);
    eq((await sheet('Content Drafts'))[0].status, 'Draft', 'status unchanged'); eq((await tg()).length, 0, 'no telegram output');
  });
  await test('02', 'Errors', 'Code-node failure in production mode (edit of a draft that does not exist) alerts the team with workflow, node and message', async () => {
    await reset(); await approve(tgUpdate('/edit 99 make it shorter'));
    const t = await until(async () => (await tg()).find((x) => /workflow error/.test(x.body.text)), { what: 'error alert', timeout: 40000 });
    assert(/02 Content Approval/.test(t.body.text) && /Build Revision Request/.test(t.body.text) && /Original draft not found/.test(t.body.text), 'alert text ' + t.body.text.slice(0, 200));
    assert(/Workflow: /.test(t.body.text) && /Node: /.test(t.body.text) && /Error: /.test(t.body.text) && !/draft_id|caption|hook/i.test(t.body.text), 'sanitized alert format (workflow, node, error only)');
    h.results.push({ wf: '00', area: 'Execution', name: 'global error handler: sanitized alert (workflow, node, message) reaches the team chat on a production-mode failure', pass: true, ms: 0 });
  });
  await test('02', 'Errors', 'non-command chatter and edit-without-feedback are ignored safely', async () => {
    await reset(); await seed('Content Drafts', [draft()]);
    await approve(tgUpdate('hello team')); await approve(tgUpdate('/edit 5')); await approve({ update_id: 3 }); await sleep(6000);
    eq((await sheet('Content Drafts'))[0].status, 'Draft', 'status unchanged'); eq((await ai()).length, 0, 'no AI call');
  });

  // ------------------------------------------------------------------ 03
  const P1 = '15550100101';
  const lc = (b, o) => post('lead-capture', b, o);
  await test('03', 'Security', 'rejects requests without / with a wrong shared secret (403)', async () => {
    await reset(); eq((await lc({ name: 'QA', phone: P1 }, { secret: null })).status, 403, 'no secret'); eq((await lc({ name: 'QA', phone: P1 }, { secret: 'nope' })).status, 403, 'wrong secret');
    eq((await sheet('Leads')).length, 0, 'no lead written');
  });
  await test('03', 'Execution', 'validation: bad payload -> 400 with reasons, nothing written', async () => {
    await reset(); const r = await lc({ name: '', phone: '12' }); eq(r.status, 400, 'status'); assert(r.json.errors.length >= 2, 'errors listed'); eq((await sheet('Leads')).length, 0, 'no lead');
  });
  await test('03', 'Execution', 'consented lead: saved (opt_in=yes), welcome sent as an approved TEMPLATE, team alerted', async () => {
    await reset();
    const r = await lc({ name: 'Ada QA', phone: '+1 (555) 010-0101', email: 'ada@staging.invalid', source: 'landing', user_type: 'vendor', consent: true }); eq(r.status, 200, 'status ' + r.text);
    eq(r.json.welcome_whatsapp, 'sent', 'welcome flag');
    const rows = await sheet('Leads'); eq(rows.length, 1, 'lead rows'); const l = rows[0];
    assert(l.lead_id === 'P' + P1 && l.opt_in === 'yes' && l.opt_in_source === 'web_form' && l.status === 'new' && l.wa_day === '1' && l.last_wa && !l.last_wa_error && l.user_type === 'vendor', 'lead fields ' + JSON.stringify(l));
    const w = await wa(); eq(w.length, 1, 'WA sends'); const b = w[0].body;
    assert(b.type === 'template' && b.template.name === 'eki_test_welcome_d1' && b.to === P1 && b.template.components[0].parameters[0].text === 'Ada QA', 'template payload ' + JSON.stringify(b));
    assert((await tg()).some((x) => /New lead captured/.test(x.body.text)), 'team alert');
  });
  await test('03', 'Output', 'duplicate submission updates the same row and does NOT send a second welcome', async () => {
    const r = await lc({ name: 'Ada QA', phone: P1, consent: true }); eq(r.status, 200, 'status'); eq(r.json.duplicate, true, 'duplicate flag'); assert(/welcome_already_sent/.test(r.json.welcome_whatsapp), 'welcome skipped: ' + r.json.welcome_whatsapp);
    eq((await sheet('Leads')).length, 1, 'still one row'); eq((await wa()).length, 1, 'still one WA send');
  });
  await test('03', 'Security', 'without consent: lead is stored with opt_in=no and nothing is sent on WhatsApp', async () => {
    await reset(); const r = await lc({ name: 'Bo QA', phone: '15550100102', source: 'ad' }); eq(r.status, 200, 'status');
    const l = (await sheet('Leads'))[0]; eq(l.opt_in, 'no', 'opt_in'); eq((await wa()).length, 0, 'WA sends'); assert(/no_consent/.test(r.json.welcome_whatsapp), 'flag ' + r.json.welcome_whatsapp);
  });
  await test('03', 'Output', 'email-only lead is keyed by email and never messaged on WhatsApp', async () => {
    await reset(); const r = await lc({ name: 'Eve QA', email: 'Eve@Staging.invalid', consent: true }); eq(r.status, 200, 'status');
    const l = (await sheet('Leads'))[0]; eq(l.lead_id, 'Eeve@staging.invalid', 'lead_id'); eq((await wa()).length, 0, 'WA sends'); assert(/no_phone/.test(r.json.welcome_whatsapp), 'flag');
  });
  await test('03', 'Errors', 'WhatsApp outage: retried 3x, lead still saved with last_wa_error, no crash', async () => {
    await reset(); await fault('graph.facebook.com', { status: 500, times: 3 });
    const r = await lc({ name: 'Cy QA', phone: '15550100103', consent: true }); eq(r.status, 200, 'status ' + r.text); assert(/failed/.test(r.json.welcome_whatsapp), 'flag ' + r.json.welcome_whatsapp);
    eq((await wa()).length, 3, 'attempts'); const l = (await sheet('Leads'))[0]; assert(l.wa_day === '0' && l.last_wa_error, 'lead marked with error, wa_day unchanged ' + JSON.stringify(l));
  });
  await test('03', 'Errors', 'transient WhatsApp failure recovers on retry (2 failures then success -> sent)', async () => {
    await reset(); await fault('graph.facebook.com', { status: 500, times: 2 });
    const r = await lc({ name: 'Di QA', phone: '15550100104', consent: true }); assert(r.json.welcome_whatsapp === 'sent', 'flag ' + r.text);
    eq((await sheet('Leads'))[0].wa_day, '1', 'wa_day');
  });

  // ------------------------------------------------------------------ 04
  const wl = (b, o) => post('join-waitlist', b, o);
  await test('04', 'Security', 'rejects requests without / with a wrong shared secret (403)', async () => {
    await reset(); eq((await wl({ name: 'A', email: 'a@staging.invalid' }, { secret: null })).status, 403, 'no secret'); eq((await sheet('Waitlist')).length, 0, 'nothing written');
  });
  await test('04', 'Execution', 'validation: missing name/contact -> 400', async () => {
    await reset(); const r = await wl({ user_type: 'Buyer' }); eq(r.status, 400, 'status'); assert(r.json.errors.length >= 2, 'errors');
  });
  await test('04', 'Execution', 'signup: row + position + referral code, confirmation email (Resend) and WhatsApp TEMPLATE', async () => {
    await reset(); const r = await wl({ name: 'Chiara Rossi', email: 'chiara@staging.invalid', whatsapp: '15550100201', user_type: 'Buyer', consent: true }); eq(r.status, 200, 'status ' + r.text);
    assert(r.json.position === 1 && /^WL-EKI-CHI-[A-Z0-9]{4}$/.test(r.json.referral_code), 'response ' + r.text);
    const rows = await sheet('Waitlist'); eq(rows.length, 1, 'rows'); assert(rows[0].position === '1' && rows[0].user_type === 'Buyer' && rows[0].consent === 'yes' && rows[0].referrals_count === '0', 'row ' + JSON.stringify(rows[0]));
    const m = await until(async () => { const x = await mails(); return x.length ? x : null; }, { what: 'email' }); eq(m[0].body.to[0], 'chiara@staging.invalid', 'email recipient'); assert(/#1/.test(m[0].body.subject) && m[0].body.html.includes(r.json.referral_code), 'email content');
    const w = await until(async () => { const x = await wa(); return x.length ? x : null; }, { what: 'wa template' }); assert(w[0].body.type === 'template' && w[0].body.template.name === 'eki_test_waitlist_confirm', 'template ' + JSON.stringify(w[0].body));
  });
  await test('04', 'Output', 'second signup gets position 2; duplicate returns already_registered without a new row', async () => {
    const r2 = await wl({ name: 'Dan Obi', email: 'dan@staging.invalid', user_type: 'Vendor' }); eq(r2.json.position, 2, 'position');
    const d = await wl({ name: 'Chiara R', email: 'CHIARA@staging.invalid' }); eq(d.json.status, 'already_registered', 'dup status'); eq(d.json.position, 1, 'dup position'); eq((await sheet('Waitlist')).length, 2, 'rows');
  });
  await test('04', 'Security', 'no WhatsApp message without consent (email-only confirmation still sent)', async () => {
    await reset(); await wl({ name: 'Eli QA', email: 'eli@staging.invalid', whatsapp: '15550100202', consent: false });
    await until(async () => (await mails()).length === 1, { what: 'email' }); await sleep(2500); eq((await wa()).length, 0, 'WA sends');
  });
  await test('04', 'Errors', 'email provider outage after signup: API still answers 200, execution error alerts the team', async () => {
    await reset(); await fault('api.resend.com', { status: 500, times: 3 });
    const r = await wl({ name: 'Fay QA', email: 'fay@staging.invalid' }); eq(r.status, 200, 'status'); eq((await sheet('Waitlist')).length, 1, 'row saved');
    await until(async () => (await tg()).some((x) => /workflow error/.test(x.body.text) && /04 Waitlist/.test(x.body.text)), { what: 'error alert', timeout: 40000 }); eq((await mails()).length, 3, 'email attempts');
  });
};
