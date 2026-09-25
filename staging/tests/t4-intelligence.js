'use strict';
// Workflows 15-22: intelligence, ManyChat funnel, content multiplication, nurture, A/B, social proof, analyst.
module.exports = async function run(h) {
  const { test, reset, seed, sheet, post, cli, until, assert, eq, wa, tg, mails, ai, lead, isoAgo, reqs, fault, sleep } = h;
  const sub = (s) => s.split('\\').join('');
  const tplNames = (w) => w.map((x) => x.body.template && x.body.template.name).sort();
  const byId = (rows, id) => rows.find((r) => r.lead_id === id);

  // ------------------------------------------------------------------ 15
  await test('15', 'Execution', 'scrapes via the configured Apify actor (Bearer header, not URL token), extracts patterns, saves them, reports on Telegram', async () => {
    await reset(); const r = cli('ekiwf15'); assert(r.ok, r.error);
    const a = await reqs('api.apify.com'); eq(a.length, 1, 'apify calls'); assert(a[0].path === '/v2/acts/staging~trends-actor/run-sync-get-dataset-items' && a[0].headers.authorization === 'Bearer staging-apify-token' && !JSON.stringify(a[0].query).includes('token'), 'apify request ' + a[0].path);
    const rows = await sheet('Intelligence'); eq(rows.length, 6, 'pattern rows'); assert(rows.every((x) => x.source === 'apify' && x.created), 'row fields'); eq(rows.filter((x) => x.type === 'hook').length, 2, 'hooks');
    assert((await tg()).some((x) => /6 new patterns/.test(x.body.text)), 'telegram summary');
  });
  await test('15', 'Errors', 'Apify outage: retried, execution fails (alert path), nothing written', async () => {
    await reset(); await fault('api.apify.com', { status: 500, times: 2 }); const r = cli('ekiwf15'); assert(!r.ok, 'must fail'); eq((await reqs('api.apify.com')).length, 2, 'attempts'); eq((await sheet('Intelligence')).length, 0, 'rows');
  });

  // ------------------------------------------------------------------ 16
  await test('16', 'Execution', 'batch-categorises Reddit pain points with ONE AI call and saves persona/category/intensity', async () => {
    await reset(); const r = cli('ekiwf16'); assert(r.ok, r.error); eq((await ai()).length, 1, 'AI calls (one batch, not one per post)');
    const rows = await sheet('PainPoints'); eq(rows.length, 2, 'rows'); const s = rows.find((x) => x.category === 'Scam_Fear'); assert(s && s.persona === 'buyer' && s.intensity === '9' && s.upvotes === '88' && s.source === 'reddit', 'row ' + JSON.stringify(s));
    assert(/r\/Nigeria\+diaspora\+AfricanFood|Nigeria\+diaspora\+AfricanFood/.test((await reqs('www.reddit.com'))[0].path) || (await reqs('www.reddit.com')).length === 1, 'reddit called');
  });
  await test('16', 'Errors', 'Reddit blocking (429): retried then fails loudly, no rows', async () => {
    await reset(); await fault('www.reddit.com', { status: 429, times: 2 }); const r = cli('ekiwf16'); assert(!r.ok, 'must fail'); eq((await sheet('PainPoints')).length, 0, 'rows');
  });

  // ------------------------------------------------------------------ 17
  const mc = (b, o) => post('manychat-comment', b, o);
  await test('17', 'Security', 'rejects requests without the shared secret (403)', async () => { await reset(); eq((await mc({ keyword: 'VENDOR', username: 'x' }, { secret: null })).status, 403, 'status'); });
  await test('17', 'Execution', 'VENDOR comment: replies with a ManyChat v2 message (vendor link), logs an instagram lead with opt_in=no, alerts the team', async () => {
    const r = await mc({ name: 'Joy', username: '@Joy_QA', keyword: 'vendor' }); eq(r.status, 200, 'status'); assert(r.json.version === 'v2' && /Selling foodstuff online/.test(r.json.content.messages[0].text) && r.json.content.messages[0].text.includes('https://staging.invalid/eki/sell'), 'reply ' + r.text);
    assert(!/eki\.app|eki-marketplace/.test(r.text), 'no legacy domains');
    await until(async () => (await sheet('Leads')).length === 1, { what: 'lead row' }); const l = (await sheet('Leads'))[0]; assert(l.lead_id === 'Ijoy_qa' && l.source === 'instagram' && l.user_type === 'vendor' && l.opt_in === 'no' && l.status === 'new', 'lead ' + JSON.stringify(l));
    await until(async () => (await tg()).some((x) => /New Instagram lead/.test(x.body.text)), { what: 'alert' }); eq((await wa()).length, 0, 'no WhatsApp from an Instagram comment');
  });
  await test('17', 'Output', 'BUY keyword gets the buyer message; same user again updates the same row', async () => {
    const r = await mc({ name: 'Joy', username: 'joy_qa', keyword: 'BUY' }); assert(/Looking for African foodstuff/.test(r.json.content.messages[0].text) && r.json.content.messages[0].text.includes('https://staging.invalid/eki'), 'buyer reply');
    await until(async () => (await sheet('Leads'))[0].user_type === 'buyer', { what: 'lead updated' }); eq((await sheet('Leads')).length, 1, 'single row');
  });
  await test('17', 'Output', 'unknown keyword still gets a friendly reply and is not misclassified', async () => {
    const r = await mc({ name: 'Sam', username: 'sam_qa', keyword: 'hello' }); eq(r.status, 200, 'status'); assert(/Thanks for your comment/.test(r.json.content.messages[0].text), 'generic reply');
  });

  // ------------------------------------------------------------------ 18
  const cm = (b, o) => post('content-multiply', b, o);
  await test('18', 'Security', 'rejects requests without the shared secret (403)', async () => { eq((await cm({ idea: 'x' }, { secret: null })).status, 403, 'status'); });
  await test('18', 'Execution', 'validation: missing idea -> 400 and no AI call', async () => { await reset(); const r = await cm({}); eq(r.status, 400, 'status'); eq((await ai()).length, 0, 'AI calls'); });
  await test('18', 'Execution', 'idea is expanded into 11 pending items in ContentQueue', async () => {
    await reset(); const r = await cm({ idea: 'Why garri quality matters' }); eq(r.status, 200, 'status ' + r.text); eq(r.json.items, 11, 'items'); const rows = await sheet('ContentQueue'); eq(rows.length, 11, 'rows'); assert(rows.every((x) => x.status === 'pending' && x.source === 'multiplication'), 'pending');
    assert(/African foodstuff/.test((await ai())[0].body.messages[0].content), 'brand in prompt');
  });
  await test('18', 'Errors', 'AI outage: caller gets a 5xx, nothing partially queued, team alerted', async () => {
    await reset(); await fault('api.groq.com', { status: 500, times: 3 }); const r = await cm({ idea: 'x y z' }); assert(r.status >= 500, 'status ' + r.status); eq((await sheet('ContentQueue')).length, 0, 'rows');
    await until(async () => (await tg()).some((x) => /workflow error/.test(x.body.text) && /18 Content Multiplication/.test(x.body.text)), { what: 'alert', timeout: 40000 });
  });

  // ------------------------------------------------------------------ 19
  const opt = (days) => ({ opt_in: 'yes', opt_in_source: 'inbound_whatsapp', opt_in_at: isoAgo(24 * days) });
  await test('19', 'Execution', 'segmented nurture: vendor D1/D7/D14 + buyer D1 sent as templates; buyer D5 template not configured -> blocked + alert', async () => {
    await reset();
    await seed('Leads', [
      lead({ phone: '15550100801', name: 'V1', user_type: 'vendor', status: 'lead_captured', nurture_day: '0', ...opt(2) }),
      lead({ phone: '15550100802', name: 'V2', user_type: 'vendor', status: 'lead_captured', nurture_day: '3', last_nurture: isoAgo(48), ...opt(8) }),
      lead({ phone: '15550100803', name: 'V3', user_type: 'vendor', status: 'lead_captured', nurture_day: '7', last_nurture: isoAgo(24 * 8), ...opt(15) }),
      lead({ phone: '15550100804', name: 'B1', user_type: 'buyer', status: 'lead_captured', nurture_day: '3', last_nurture: isoAgo(48), ...opt(6) }),
      lead({ phone: '15550100805', name: 'B2', user_type: 'buyer', status: 'lead_captured', nurture_day: '0', ...opt(2) }),
      lead({ phone: '15550100806', name: 'Unsub', user_type: 'vendor', status: 'unsubscribed', nurture_day: '0', ...opt(5) }),
      lead({ phone: '15550100807', name: 'Churned', user_type: 'vendor', status: 'churned', nurture_day: '0', ...opt(5) }),
      lead({ phone: '15550100808', name: 'NoOptIn', user_type: 'vendor', status: 'lead_captured', nurture_day: '0', opt_in: 'no' }),
      lead({ phone: '15550100809', name: 'Recent', user_type: 'vendor', status: 'lead_captured', nurture_day: '1', last_nurture: isoAgo(2), ...opt(5) }),
      lead({ phone: '15550100810', name: 'OptedOut', user_type: 'vendor', status: 'lead_captured', nurture_day: '0', ...opt(5), opt_out_at: isoAgo(24) }),
    ]);
    const r = cli('ekiwf19'); assert(r.ok, 'execution failed: ' + r.error);
    const w = await wa(); eq(tplNames(w), ['eki_test_buyer_d1', 'eki_test_vendor_d1', 'eki_test_vendor_d14', 'eki_test_vendor_d7'], 'templates'); assert(w.every((x) => x.body.type === 'template'), 'only templates');
    eq(w.map((x) => x.body.to).sort(), ['15550100801', '15550100802', '15550100803', '15550100805'], 'recipients');
    const rows = await sheet('Leads'); eq(byId(rows, 'P15550100801').nurture_day, '1', 'V1'); eq(byId(rows, 'P15550100802').nurture_day, '7', 'V2'); const v3 = byId(rows, 'P15550100803'); assert(v3.nurture_day === '14' && v3.status === 'nurturing', 'V3 finished -> nurturing ' + JSON.stringify([v3.nurture_day, v3.status]));
    const b1 = byId(rows, 'P15550100804'); assert(b1.nurture_day === '3' && b1.status === 'lead_captured', 'B1 untouched'); eq(rows.length, 10, 'no duplicate rows');
    assert((await tg()).some((x) => /NURTURE_BUYER_D5/.test(sub(x.body.text)) && /blocked/i.test(x.body.text)), 'config alert');
  });
  await test('19', 'Output', 'rerun sends nothing new (24h spacing + persisted nurture_day)', async () => { const before = (await wa()).length; const r = cli('ekiwf19'); assert(r.ok, r.error); eq((await wa()).length, before, 'sends after rerun'); });

  // ------------------------------------------------------------------ 20
  const pc = (i, o) => ({ hook: 'Hook ' + i, format: 'reel', platform: 'instagram', comments: String(i), saves: String(i * 2), shares: String(i), published_date: '2026-09-20', ...o });
  await test('20', 'Execution', 'with 6+ published posts: scores winners vs losers, saves insight rows, briefs the team', async () => {
    await reset(); await seed('PublishedContent', [1, 2, 3, 4, 5, 6].map((i) => pc(i))); const r = cli('ekiwf20'); assert(r.ok, r.error);
    const rows = await sheet('Intelligence'); eq(rows.map((x) => x.type).sort(), ['emotion_pattern', 'format_pattern', 'hook_pattern', 'recommendation'], 'insight rows');
    const user = (await ai())[0].body.messages[1].content; assert(/WINNERS:[\s\S]*Hook 6/.test(user) && /LOSERS:[\s\S]*Hook 1/.test(user), 'ranking passed to AI'); assert((await tg()).some((x) => /A\/B test insights/.test(x.body.text) && /Hook 6/.test(x.body.text)), 'briefing');
  });
  await test('20', 'Output', 'with too little data (<6 posts) it skips without calling the AI', async () => { await reset(); await seed('PublishedContent', [pc(1), pc(2)]); const r = cli('ekiwf20'); assert(r.ok, r.error); eq((await ai()).length, 0, 'AI calls'); eq((await sheet('Intelligence')).length, 0, 'rows'); });

  // ------------------------------------------------------------------ 21
  const sp = (b, o) => post('social-proof', b, o);
  await test('21', 'Security', 'rejects requests without the shared secret (403)', async () => { eq((await sp({ vendor: 'X' }, { secret: null })).status, 403, 'status'); });
  await test('21', 'Execution', 'validation: vendor is required -> 400', async () => { await reset(); eq((await sp({ event: 'milestone' })).status, 400, 'status'); eq((await ai()).length, 0, 'AI calls'); });
  await test('21', 'Execution', 'milestone event: content generated from the provided facts only, queued as pending, team notified', async () => {
    await reset(); const r = await sp({ event: 'milestone', vendor: 'Ada QA Stores', metric: 'first_sale', value: 1 }); eq(r.status, 200, 'status ' + r.text);
    const rows = await sheet('SocialProof'); eq(rows.length, 1, 'rows'); assert(rows[0].status === 'pending' && rows[0].vendor === 'Ada QA Stores' && /quote_card_text/.test(rows[0].content), 'row ' + JSON.stringify(rows[0]).slice(0, 200));
    const sys = (await ai())[0].body.messages[0].content; assert(/ONLY the facts provided|never invent/i.test(sys), 'anti-fabrication instruction'); assert((await tg()).some((x) => /Social proof generated for Ada QA Stores/.test(x.body.text)), 'team notified');
  });

  // ------------------------------------------------------------------ 22
  await test('22', 'Execution', 'weekly analyst: computes lead/vendor/buyer/content metrics, AI analysis, saves to Agent Reports (not Analytics), Telegram + team email', async () => {
    await reset();
    await seed('Leads', [lead({ phone: '1', user_type: 'vendor', opt_in: 'yes' }), lead({ phone: '2', user_type: 'vendor' }), lead({ phone: '3', user_type: 'buyer', opt_in: 'yes', opt_out_at: isoAgo(5) })]);
    await seed('PublishedContent', [pc(3, { platform: 'instagram' }), pc(1, { platform: 'instagram' }), pc(2, { platform: 'tiktok' })]);
    const r = cli('ekiwf22'); assert(r.ok, r.error);
    const rows = await sheet('Agent Reports'); eq(rows.length, 1, 'rows'); assert(rows[0].total_leads === '3' && rows[0].vendors === '2' && rows[0].buyers === '1' && rows[0].posts === '3' && /Recruit more buyers/.test(rows[0].recommendations), 'row ' + JSON.stringify(rows[0]));
    eq((await sheet('Analytics')).length, 0, 'Analytics tab untouched'); assert((await tg()).some((x) => /Weekly Performance Report/.test(x.body.text)), 'telegram');
    const m = await mails(); eq(m.length, 1, 'emails'); eq(m[0].body.to[0], 'team@staging.invalid', 'recipient'); assert(/Recruit more buyers/.test(m[0].body.html), 'email body');
  });
};
