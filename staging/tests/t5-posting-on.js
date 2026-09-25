'use strict';
// Stage "posting-on": n8n restarted with AUTOPILOT_SOCIAL_POSTING=true (mock providers only - proves the guarded branch works).
module.exports = async function run(h) {
  const { test, reset, seed, sheet, cli, until, assert, eq, tg, reqs, fault, queueAi, isoAgo } = h;
  const sub = (s) => s.split('\\').join('');
  const d = (o) => ({ draft_id: 'D-1', day_number: '1', platform: 'X/Twitter', hook: 'h', caption: 'Caption one', hashtags: '#Eki', video_script: '', status: 'Approved', approval_date: isoAgo(48), published: 'FALSE', created_date: '2026-09-20', ...o });

  await test('10', 'Execution', 'autopilot ON: X/Twitter draft is posted through the X API (OAuth2 credential) and marked Published', async () => {
    await reset(); await seed('Content Drafts', [d()]); const r = cli('ekiwf10'); assert(r.ok, r.error);
    const x = await reqs('api.twitter.com'); eq(x.length, 1, 'X calls'); assert(x[0].path === '/2/tweets' && x[0].headers.authorization === 'Bearer mock-x-token' && /Caption one/.test(x[0].body.text), 'X request ' + JSON.stringify(x[0].body));
    const row = (await sheet('Content Drafts'))[0]; assert(row.status === 'Published' && row.published === 'TRUE' && row.published_date, 'row ' + JSON.stringify(row)); { const m = await tg(); eq(m.length, 0, 'no manual alert; got: ' + m.map((x) => x.body.text.slice(0, 60)).join(' || ')); }
  });
  await test('10', 'Execution', 'autopilot ON: Instagram draft goes through Buffer with the PER-PLATFORM profile id', async () => {
    await reset(); await seed('Content Drafts', [d({ platform: 'Instagram', caption: 'IG caption' })]); const r = cli('ekiwf10'); assert(r.ok, r.error);
    const b = await reqs('api.bufferapp.com'); eq(b.length, 1, 'Buffer calls'); assert(b[0].headers.authorization === 'Bearer staging-buffer-key' && b[0].body.profile_ids[0] === 'buf_instagram_staging' && /IG caption/.test(b[0].body.text), 'buffer request ' + JSON.stringify(b[0].body));
    eq((await sheet('Content Drafts'))[0].status, 'Published', 'status');
  });
  await test('10', 'Errors', 'autopilot ON but Buffer fails: falls back to a manual Telegram alert (status Notification Sent), never marked Published', async () => {
    await reset(); await seed('Content Drafts', [d({ platform: 'Facebook', caption: 'FB caption' })]); await fault('api.bufferapp.com', { status: 500, times: 2 }); const r = cli('ekiwf10'); assert(r.ok, r.error);
    eq((await reqs('api.bufferapp.com')).length, 2, 'attempts'); assert((await tg()).some((x) => /FB caption/.test(x.body.text)), 'manual alert'); eq((await sheet('Content Drafts'))[0].status, 'Notification Sent', 'status');
  });
  await test('10', 'Output', 'platform without an API route (TikTok) stays manual even when autopilot is ON', async () => {
    await reset(); await seed('Content Drafts', [d({ platform: 'TikTok', caption: 'TT caption' })]); const r = cli('ekiwf10'); assert(r.ok, r.error);
    eq((await reqs('api.bufferapp.com')).length + (await reqs('api.twitter.com')).length, 0, 'no provider calls'); assert((await tg()).some((x) => /TT caption/.test(x.body.text)), 'manual alert');
  });
  await test('12', 'Execution', 'autopilot ON: each platform post is scheduled on ITS OWN Buffer profile; flagged content is never posted', async () => {
    await reset(); await queueAi('Generate social media content for', { tiktok: { hook: 'a', video_script: 'v', caption: 'Egusi from home', hashtags: '#a' }, instagram: { hook: 'b', video_script: 'v', caption: 'Guaranteed 100% results!', hashtags: '#b' }, facebook: { hook: 'c', caption: 'Join the Eki community', hashtags: '#c', video_script: '' } });
    const r = cli('ekiwf12'); assert(r.ok, r.error); const b = await reqs('api.bufferapp.com'); eq(b.map((x) => x.body.profile_ids[0]).sort(), ['buf_facebook_staging', 'buf_tiktok_staging'], 'profiles used (instagram was flagged)');
    const t = (await tg()).map((x) => sub(x.body.text)).join('\n'); assert(/INSTAGRAM/.test(t) && /flagged \(false_claim\)/.test(t), 'flagged post routed to manual with reason: ' + t.slice(0, 200));
    const logs = await sheet('Automation Logs'); eq(logs.filter((x) => x.action === 'buffer_scheduled').length, 2, 'buffer log rows');
  });
  await test('12', 'Errors', 'a Buffer failure for one platform falls back to manual for THAT post only; the others are posted exactly once', async () => {
    await reset(); await fault('api.bufferapp.com', { status: 500, times: 2 }); const r = cli('ekiwf12'); assert(r.ok, r.error);
    const b = await reqs('api.bufferapp.com'); eq(b.length, 4, 'buffer calls = 2 attempts for the failing post + 1 each for the others (no re-posting)');
    eq(b.map((x) => x.body.profile_ids[0]).sort(), ['buf_facebook_staging', 'buf_instagram_staging', 'buf_tiktok_staging', 'buf_tiktok_staging'], 'profiles');
    const logs = await sheet('Automation Logs'); eq(logs.map((x) => x.status).sort(), ['buffer_failed', 'completed', 'completed'], 'log statuses'); assert((await tg()).some((x) => /Buffer post failed/.test(x.body.text)), 'manual fallback alert');
  });
  await test('14', 'Output', 'controller reports social auto-posting ON', async () => {
    await reset(); const r = cli('ekiwf14'); assert(r.ok, r.error); assert((await tg()).some((x) => /Social auto-posting: ON/.test(x.body.text)), 'status line');
  });
};
