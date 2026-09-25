'use strict';
// Workflows 05-09: welcome sequence, re-engagement, referral, feedback, weekly analytics.
module.exports = async function run(h) {
  const { test, reset, seed, sheet, post, cli, until, assert, eq, wa, tg, mails, ai, lead, isoAgo, reqs, fault, violations, sleep } = h;
  const byId = (rows, id) => rows.find((r) => r.lead_id === id);
  const optedIn = { opt_in: 'yes', opt_in_source: 'web_form', opt_in_at: isoAgo(24 * 10) };
  const tplNames = (w) => w.map((x) => x.body.template && x.body.template.name).sort();

  // ------------------------------------------------------------------ 05
  await test('05', 'Execution', 'sends welcome day 1/2/3 as approved templates and advances each lead', async () => {
    await reset();
    await seed('Leads', [
      lead({ phone: '15550100301', name: 'Ann', status: 'new', wa_day: '0', ...optedIn }),
      lead({ phone: '15550100302', name: 'Ben', status: 'new', wa_day: '1', last_wa: isoAgo(25), ...optedIn }),
      lead({ phone: '15550100303', name: 'Cat', status: 'new', wa_day: '2', last_wa: isoAgo(25), ...optedIn }),
      lead({ phone: '15550100304', name: 'NoOptIn', status: 'new', wa_day: '0', opt_in: 'no' }),
      lead({ phone: '15550100305', name: 'Unsub', status: 'unsubscribed', wa_day: '0', ...optedIn }),
      lead({ phone: '15550100306', name: 'OptedOut', status: 'new', wa_day: '0', ...optedIn, opt_out_at: isoAgo(48) }),
      lead({ phone: '15550100307', name: 'TooSoon', status: 'new', wa_day: '1', last_wa: isoAgo(2), ...optedIn }),
    ]);
    const r = cli('ekiwf05'); assert(r.ok, 'execution failed: ' + r.error);
    const w = await wa(); eq(tplNames(w), ['eki_test_welcome_d1', 'eki_test_welcome_d2', 'eki_test_welcome_d3'], 'templates sent');
    assert(w.every((x) => x.body.type === 'template'), 'only templates');
    eq(w.map((x) => x.body.to).sort(), ['15550100301', '15550100302', '15550100303'], 'recipients');
    const rows = await sheet('Leads');
    eq(byId(rows, 'P15550100301').wa_day, '1', 'Ann day'); eq(byId(rows, 'P15550100302').wa_day, '2', 'Ben day');
    const cat = byId(rows, 'P15550100303'); assert(cat.wa_day === '3' && cat.status === 'nurturing', 'Cat -> nurturing ' + JSON.stringify([cat.wa_day, cat.status]));
    eq(rows.length, 7, 'no duplicate rows (upsert, not append)');
    for (const id of ['P15550100304', 'P15550100305', 'P15550100306', 'P15550100307']) assert(!w.some((x) => 'P' + x.body.to === id), 'must not contact ' + id);
    assert((await tg()).some((x) => /3 sent, 0 failed/.test(x.body.text)), 'summary');
  });
  await test('05', 'Output', 'rerun in the same window sends nothing (each lead gets each day once)', async () => {
    const before = (await wa()).length; const r = cli('ekiwf05'); assert(r.ok, r.error); eq((await wa()).length, before, 'WA sends after rerun');
  });
  await test('05', 'Errors', 'transient WhatsApp errors are retried (2 failures then success)', async () => {
    await reset(); await seed('Leads', [lead({ phone: '15550100311', name: 'Dee', status: 'new', wa_day: '0', ...optedIn })]); await fault('graph.facebook.com', { status: 500, times: 2 });
    const r = cli('ekiwf05'); assert(r.ok, r.error); eq((await wa()).length, 3, 'attempts'); eq((await sheet('Leads'))[0].wa_day, '1', 'advanced after retry');
  });
  await test('05', 'Errors', 'persistent failure: lead NOT advanced, error recorded, run continues and reports it', async () => {
    await reset(); await seed('Leads', [lead({ phone: '15550100312', name: 'Eve', status: 'new', wa_day: '0', ...optedIn })]); await fault('graph.facebook.com', { status: 500, times: 3 });
    const r = cli('ekiwf05'); assert(r.ok, r.error); const l = (await sheet('Leads'))[0]; assert(l.wa_day === '0' && l.last_wa_error, 'lead state ' + JSON.stringify([l.wa_day, l.last_wa_error]));
    assert((await tg()).some((x) => /0 sent, 1 failed/.test(x.body.text)), 'failure summary');
  });

  await test('05', 'Errors', 'REGRESSION: one lead failing must NOT re-send the leads that already succeeded (no duplicate messages on retry)', async () => {
    await reset();
    await seed('Leads', [1, 2, 3].map((i) => lead({ phone: '1555010032' + i, name: 'Dup' + i, status: 'new', wa_day: '0', ...optedIn })));
    await fault('graph.facebook.com', { status: 500, times: 3 }); // exhausts the retries of the FIRST lead only
    const r = cli('ekiwf05'); assert(r.ok, r.error);
    const all = await wa(); eq(all.length, 5, 'requests: 3 attempts for the failing lead + 1 each for the others (a batch re-run would be 9)');
    const w = all.filter((x) => x.status === 200); eq(w.map((x) => x.body.to).sort(), ['15550100322', '15550100323'], 'successful sends: leads 2 and 3, exactly once each');
    const rows = await sheet('Leads'); eq(rows.map((x) => x.wa_day).sort(), ['0', '1', '1'], 'wa_day per lead'); assert(rows.find((x) => x.phone === '15550100321').last_wa_error, 'failed lead keeps its error and stays eligible for the next run');
    assert((await tg()).some((x) => /2 sent, 1 failed/.test(x.body.text)), 'summary');
  });

  // ------------------------------------------------------------------ 06
  await test('06', 'Execution', 're-engagement 7/14 sent as templates; day-21 template NOT configured -> blocked + one config alert, lead untouched', async () => {
    await reset();
    await seed('Leads', [
      lead({ phone: '15550100401', name: 'A7', status: 'nurturing', reengage_step: '0', last_wa: isoAgo(24 * 8), ...optedIn }),
      lead({ phone: '15550100402', name: 'B14', status: 'nurturing', reengage_step: '1', last_reengage: isoAgo(24 * 8), last_wa: isoAgo(24 * 8), ...optedIn }),
      lead({ phone: '15550100403', name: 'C21', status: 'nurturing', reengage_step: '2', last_reengage: isoAgo(24 * 8), last_wa: isoAgo(24 * 8), ...optedIn }),
      lead({ phone: '15550100404', name: 'Replied', status: 'nurturing', reengage_step: '0', last_wa: isoAgo(24 * 9), last_message: isoAgo(24), ...optedIn }),
      lead({ phone: '15550100405', name: 'Unsub', status: 'unsubscribed', reengage_step: '0', last_wa: isoAgo(24 * 9), ...optedIn }),
      lead({ phone: '15550100406', name: 'NoOptIn', status: 'nurturing', reengage_step: '0', last_wa: isoAgo(24 * 9), opt_in: 'no' }),
    ]);
    const r = cli('ekiwf06'); assert(r.ok, 'execution failed: ' + r.error);
    const w = await wa(); eq(tplNames(w), ['eki_test_reengage_14', 'eki_test_reengage_7'], 'templates'); assert(w.every((x) => x.body.type === 'template'), 'only templates');
    const rows = await sheet('Leads');
    eq(byId(rows, 'P15550100401').reengage_step, '1', 'A step'); eq(byId(rows, 'P15550100402').reengage_step, '2', 'B step');
    const c = byId(rows, 'P15550100403'); assert(c.reengage_step === '2' && c.status === 'nurturing', 'C untouched ' + JSON.stringify([c.reengage_step, c.status]));
    assert((await tg()).some((x) => /WA_TPL_REENGAGE_21/.test(x.body.text.split('\\').join('')) && /blocked/i.test(x.body.text)), 'config alert names the missing template');
  });
  await test('06', 'Output', 'never re-sends the same step (rerun is a no-op for already-contacted leads)', async () => {
    const before = (await wa()).length; const r = cli('ekiwf06'); assert(r.ok, r.error); eq((await wa()).length, before, 'WA sends after rerun');
  });

  // ------------------------------------------------------------------ 07
  const ref = (b, o) => post('track-referral', b, o);
  const waitlistRows = () => [
    { email: 'ada@staging.invalid', whatsapp: '', name: 'Ada', position: '1', referral_code: 'WL-EKI-ADA-AAAA', referrals_count: '2', user_type: 'Vendor', signup_date: '2026-09-01', consent: 'yes' },
    { email: '', whatsapp: '15550100501', name: 'NoMail', position: '2', referral_code: 'WL-EKI-NOM-BBBB', referrals_count: '0', user_type: 'Buyer', signup_date: '2026-09-01', consent: 'yes' },
  ];
  await test('07', 'Security', 'rejects requests without the shared secret (403)', async () => { await reset(); eq((await ref({ referral_code: 'X' }, { secret: null })).status, 403, 'status'); });
  await test('07', 'Execution', 'validation: missing code / invalid new-user email -> 400', async () => { const r = await ref({ referral_code: '', new_user_email: 'nope' }); eq(r.status, 400, 'status'); });
  await test('07', 'Execution', 'valid referral: count 2->3 (VIP Access milestone), referral logged, reward email sent to referrer', async () => {
    await reset(); await seed('Waitlist', waitlistRows());
    const r = await ref({ ref: 'wl-eki-ada-aaaa', new_user_email: 'Kofi@Staging.invalid', new_user_name: 'Kofi' }); eq(r.status, 200, 'status ' + r.text); assert(r.json.status === 'success' && r.json.milestone_unlocked === 'VIP Access', 'response ' + r.text);
    eq((await sheet('Waitlist')).find((x) => x.referral_code === 'WL-EKI-ADA-AAAA').referrals_count, '3', 'count');
    const rf = await sheet('Referrals'); eq(rf.length, 1, 'referral rows'); assert(rf[0].referred_email === 'kofi@staging.invalid' && rf[0].points_credited === '1', 'referral row');
    const m = await until(async () => { const x = await mails(); return x.length ? x : null; }, { what: 'email' }); assert(m[0].body.to[0] === 'ada@staging.invalid' && /milestone/i.test(m[0].body.subject), 'email ' + m[0].body.subject);
  });
  await test('07', 'Output', 'idempotent: same referred email again -> duplicate, no second increment or email', async () => {
    const r = await ref({ referral_code: 'WL-EKI-ADA-AAAA', new_user_email: 'kofi@staging.invalid' }); eq(r.json.status, 'duplicate', 'status');
    eq((await sheet('Waitlist')).find((x) => x.referral_code === 'WL-EKI-ADA-AAAA').referrals_count, '3', 'count unchanged'); await sleep(1500); eq((await mails()).length, 1, 'emails');
  });
  await test('07', 'Output', 'unknown referral code is accepted without crediting anyone', async () => {
    const r = await ref({ referral_code: 'WL-EKI-ZZZ-0000', new_user_email: 'x@staging.invalid' }); eq(r.status, 200, 'status'); eq(r.json.status, 'completed', 'status');
  });
  await test('07', 'Output', 'referrer without an email is credited but not emailed', async () => {
    const before = (await mails()).length; const r = await ref({ referral_code: 'WL-EKI-NOM-BBBB', new_user_email: 'y@staging.invalid' }); eq(r.json.referrals_count, 1, 'count');
    await sleep(1500); eq((await mails()).length, before, 'no email');
  });

  // ------------------------------------------------------------------ 08
  const fb = (b, o) => post('collect-feedback', b, o);
  const today = new Date().toISOString().slice(0, 10);
  await test('08', 'Execution', 'daily request: only ACTIVE users 6-8 days after signup and not yet asked get one email (no PII in the link)', async () => {
    await reset();
    await seed('Leads', [
      lead({ lead_id: 'Eseven@staging.invalid', email: 'seven@staging.invalid', name: 'Seven', status: 'active', signup_date: isoAgo(24 * 7).slice(0, 10) }),
      lead({ lead_id: 'Easked@staging.invalid', email: 'asked@staging.invalid', name: 'Asked', status: 'active', signup_date: isoAgo(24 * 7).slice(0, 10), feedback_requested_date: isoAgo(24).slice(0, 10) }),
      lead({ lead_id: 'Eyoung@staging.invalid', email: 'young@staging.invalid', name: 'Young', status: 'active', signup_date: isoAgo(24 * 2).slice(0, 10) }),
      lead({ lead_id: 'Enew@staging.invalid', email: 'new@staging.invalid', name: 'New', status: 'new', signup_date: isoAgo(24 * 7).slice(0, 10) }),
    ]);
    const r = cli('ekiwf08'); assert(r.ok, 'execution failed: ' + r.error);
    const m = await mails(); eq(m.length, 1, 'emails'); eq(m[0].body.to[0], 'seven@staging.invalid', 'recipient');
    assert(m[0].body.html.includes('https://staging.invalid/feedback"') && !/seven@|Seven/.test(m[0].body.html.match(/href="[^"]*"/)[0]), 'link carries no personal data: ' + m[0].body.html.match(/href="[^"]*"/)[0]);
    eq(byId(await sheet('Leads'), 'Eseven@staging.invalid').feedback_requested_date, today, 'marked requested');
  });
  const byIdRow = (rows, id) => rows.find((r) => r.lead_id === id);
  await test('08', 'Output', 'rerun does not ask the same user twice', async () => { const r = cli('ekiwf08'); assert(r.ok, r.error); eq((await mails()).length, 1, 'emails'); });
  await test('08', 'Security', 'feedback webhook rejects requests without the shared secret (403)', async () => { eq((await fb({ email: 'a@staging.invalid', rating: 5 }, { secret: null })).status, 403, 'status'); });
  await test('08', 'Execution', 'validation: bad rating/email -> 400, nothing stored', async () => {
    await reset(); const r = await fb({ email: 'nope', rating: 9 }); eq(r.status, 400, 'status'); eq((await sheet('Feedback')).length, 0, 'rows');
  });
  await test('08', 'Execution', 'rating 5: stored, thank-you + store-review links emailed, lead marked feedback_received', async () => {
    await reset(); await seed('Leads', [lead({ lead_id: 'Ehappy@staging.invalid', email: 'happy@staging.invalid', status: 'active' })]);
    const r = await fb({ email: 'Happy@Staging.invalid', rating: 5, comments: 'Love it', would_recommend: true }); eq(r.status, 200, 'status ' + r.text); eq(r.json.rating_category, 'positive', 'category');
    const f = await sheet('Feedback'); assert(f.length === 1 && f[0].rating === '5' && f[0].would_recommend === 'TRUE' && f[0].rating_category === 'positive', 'feedback row ' + JSON.stringify(f[0]));
    const m = await until(async () => { const x = await mails(); return x.length ? x : null; }, { what: 'email' }); assert(m[0].body.html.includes('ios-review') && m[0].body.html.includes('android-review'), 'review links'); assert(!/EKIFEEDBACK|10% off/i.test(m[0].body.html), 'no invented reward code');
    await until(async () => (await sheet('Leads'))[0].last_feedback_rating === '5', { what: 'lead updated' }); eq((await tg()).length, 0, 'no alert for positive');
  });
  await test('08', 'Execution', 'rating 2: team alerted on Telegram and the user is still thanked', async () => {
    await reset(); const r = await fb({ email: 'sad@staging.invalid', rating: 2, comments: 'Photo upload timed out', would_recommend: false }); eq(r.json.rating_category, 'negative', 'category');
    await until(async () => (await tg()).some((x) => /Low feedback rating/.test(x.body.text) && /2\/5/.test(x.body.text)), { what: 'alert' }); await until(async () => (await mails()).length === 1, { what: 'thank-you email' });
  });
  await test('08', 'Output', 'rating 3: stored as neutral, no alert', async () => { await reset(); const r = await fb({ email: 'meh@staging.invalid', rating: 3 }); eq(r.json.rating_category, 'neutral', 'category'); await sleep(2500); eq((await tg()).length, 0, 'alerts'); });
  await test('08', 'Errors', 'feedback for an email that is not a lead does not crash the flow', async () => {
    await reset(); const r = await fb({ email: 'stranger@staging.invalid', rating: 4 }); eq(r.status, 200, 'status'); await until(async () => (await mails()).length === 1, { what: 'thank-you' }); eq((await sheet('Feedback')).length, 1, 'stored');
  });

  // ------------------------------------------------------------------ 09
  await test('09', 'Execution', 'weekly report: computes metrics, appends Analytics row, Telegram summary, emails the team (HTML-escaped)', async () => {
    await reset();
    await seed('Leads', [
      lead({ lead_id: 'P1', phone: '1', source: '<script>alert(1)</script>', status: 'active', signup_date: isoAgo(48).slice(0, 10) }),
      lead({ lead_id: 'P2', phone: '2', source: 'referral', status: 'new', signup_date: isoAgo(72).slice(0, 10) }),
      lead({ lead_id: 'P3', phone: '3', source: 'instagram', status: 'converted', signup_date: isoAgo(24 * 10).slice(0, 10) }),
    ]);
    await seed('Feedback', [{ feedback_id: 'F1', email: 'a@staging.invalid', rating: '4', would_recommend: 'TRUE', submitted_date: isoAgo(24).slice(0, 10) }, { feedback_id: 'F2', email: 'b@staging.invalid', rating: '2', would_recommend: 'FALSE', submitted_date: isoAgo(24).slice(0, 10) }]);
    await seed('Waitlist', [{ email: 'w@staging.invalid', name: 'W', position: '1', signup_date: isoAgo(24).slice(0, 10) }]);
    await seed('Content Drafts', [{ draft_id: 'D1', day_number: '1', status: 'Published', created_date: isoAgo(24).slice(0, 10) }, { draft_id: 'D2', day_number: '2', status: 'Draft', created_date: isoAgo(24).slice(0, 10) }]);
    const r = cli('ekiwf09'); assert(r.ok, 'execution failed: ' + r.error);
    const a = await sheet('Analytics'); eq(a.length, 1, 'analytics rows'); assert(a[0].total_leads === '3' && a[0].new_leads === '2' && a[0].waitlist_size === '1' && a[0].avg_feedback_rating === '3.0', 'metrics ' + JSON.stringify(a[0]));
    assert((await tg()).some((x) => /Weekly Growth Report/.test(x.body.text)), 'telegram summary');
    const m = await mails(); eq(m.length, 1, 'emails'); eq(m[0].body.to[0], 'team@staging.invalid', 'recipient'); assert(!m[0].body.html.includes('<script>') && m[0].body.html.includes('&lt;script&gt;'), 'HTML escaped');
  });
  await test('09', 'Errors', 'empty sheets still produce a report (no crash on zero data)', async () => { await reset(); const r = cli('ekiwf09'); assert(r.ok, 'execution failed: ' + r.error); eq((await sheet('Analytics')).length, 1, 'analytics row'); });
};
