'use strict';
// Stage "stop-on": n8n restarted with AUTOPILOT_STOP=true (kill switch).
module.exports = async function run(h) {
  const { test, reset, seed, sheet, cli, assert, eq, tg, ai, reqs, isoAgo } = h;
  const sub = (s) => s.split('\\').join('');
  await test('12', 'Security', 'kill switch: no AI call, nothing generated or posted', async () => {
    await reset(); const r = cli('ekiwf12'); assert(r.ok, r.error); eq((await ai()).length, 0, 'AI calls'); eq((await sheet('Social Posts')).length, 0, 'rows'); eq((await reqs('api.bufferapp.com')).length, 0, 'buffer');
  });
  await test('10', 'Security', 'kill switch: approved drafts are left untouched (no alert, no API post)', async () => {
    await reset(); await seed('Content Drafts', [{ draft_id: 'D-1', day_number: '1', platform: 'Instagram', caption: 'c', status: 'Approved', published: 'FALSE', approval_date: isoAgo(24) }]);
    const r = cli('ekiwf10'); assert(r.ok, r.error); eq((await tg()).length, 0, 'telegram'); eq((await sheet('Content Drafts'))[0].status, 'Approved', 'status'); eq((await reqs('api.bufferapp.com')).length, 0, 'buffer');
  });
  await test('14', 'Security', 'kill switch: controller sends the emergency-stop alert', async () => {
    await reset(); const r = cli('ekiwf14'); assert(r.ok, r.error); const t = await tg(); eq(t.length, 1, 'alerts'); assert(/EMERGENCY STOP/.test(t[0].body.text) && /AUTOPILOT_STOP=false/.test(sub(t[0].body.text)), 'text ' + t[0].body.text);
  });
};
