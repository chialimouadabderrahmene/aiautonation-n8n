# Operations

## Real UI testing done this pass

Earlier passes flagged the web UI as "implemented, not visually tested in a
browser." This pass built `web`, ran it locally against a real running
`api` (real Postgres + Redis), and drove it with an actual browser:

- **Login** with the bootstrapped admin account — real JWT issued, real
  redirect to Dashboard.
- **Dashboard** — read real, live data (`0/13` integrations, `0/22`
  automations, `SYSTEM: BLOCKED`, `n8n: NOT CONFIGURED`) matching the API
  exactly. Later, after connecting a real n8n instance, re-checked and saw
  it flip live to `n8n: CONNECTED` / `SYSTEM: PARTIALLY READY` — no page
  reload needed beyond the dashboard's own polling.
- **Integrations** — clicked "Configure" on OpenAI, typed a fake key into
  the real password field, clicked "Save credentials" (status → `CONFIGURED`),
  clicked "Test connection" (real call to `api.openai.com`, real 401,
  status → `TEST FAILED — ✕ Unauthorized API key` with a live timestamp,
  all through the UI, not the API directly).
- **Automations** — confirmed the full 22-workflow readiness matrix renders
  correctly, each with its own named blockers, matching the API.
- **Content Studio, Video Generator, Approvals, Executions, Reports,
  Settings** — all render correctly with real (empty) data, no crashes, no
  stuck "Loading..." states, no console errors across the whole click-through.
- **Video Generator readiness banner** specifically confirmed real, not
  hardcoded: shows the exact missing providers (`openai or groq`, `runway`,
  `elevenlabs`) matching `GET /api/video/readiness`.

**A real, reproducible bug was found and fixed this way** (not by code
inspection — by actually resizing the browser): `ControlCenterLayout.tsx`'s
sidebar had no responsive breakpoint at all. At 375×812 (a phone), the fixed
`w-64` sidebar left roughly half the viewport for content, clipping every
page's headings and stat cards mid-word. Fixed: the sidebar is now an
off-canvas drawer below the `md` breakpoint, with a hamburger toggle, a
tap-outside-to-close backdrop, and auto-close on navigation; confirmed fixed
by re-taking the same screenshot at the same width (clean layout, all text
visible) and confirmed the drawer opens/closes correctly. Also checked at
tablet width (768×1024) — sidebar returns to its normal static position,
2-column integration card grid, no overlap.

**Still not done:** clicking through with a *real* provider account (Runway,
ElevenLabs, WhatsApp, etc. — all correctly show `NOT_CONFIGURED` since none
were available), and a full mobile pass on every other screen beyond
Dashboard (only Dashboard was screenshotted at 375px; Integrations was
checked at tablet width only). The responsive *mechanism* (the layout
component every page shares) is fixed and verified, which is the part most
likely to have been broken per-page; a full per-page mobile screenshot pass
is still worth doing before calling this "pixel-polished."

## Daily use

1. **Dashboard** — check `System` and `Action required` first. Anything
   listed there names the exact blocker (e.g. "openai/groq is not connected",
   never a generic "error").
2. **Integrations** — Configure → Test connection → status flips to
   `CONNECTED` only on a real successful call. Never assume a saved
   credential works until it's been tested.
3. **Automations** — a workflow can only be enabled once every one of its
   listed requirements shows ✓. "Activate ready automations" enables every
   currently-READY workflow in one action and reports exactly which ones it
   skipped and why.
4. **Video Generator / AI Content Studio** — create a project, watch its
   progress bar, review the result (Preview/Script/Storyboard/Captions
   tabs), then "Send to Telegram" for human approval.
5. **Approvals** — read-only view of what's pending/approved/rejected;
   the actual decision happens in Telegram (inline Approve/Reject buttons).
6. **Executions** — every n8n run and every video job, filterable by status.
7. **Reports** — daily/weekly/monthly rollups.

## Rotating a credential

Integrations → the provider → Configure → enter the new value → Save →
Test connection. Saving never deletes the old value's *effect* until you
save a new one; there is no separate "rotate" flow because save already is
one (the old ciphertext row is overwritten, not versioned).

## If `AUTOMATION_SECRET_KEY` is lost

Every stored credential becomes permanently undecryptable (this is the same
trade-off n8n itself makes with `N8N_ENCRYPTION_KEY` — see
`api/src/lib/crypto.ts`). Recovery is: generate a new key, then re-enter
every credential from scratch in Integrations. There is no backdoor and
there should not be one.

## If a workflow keeps failing

1. Executions → filter by that workflow → open the failed run → read
   `error` (never truncated to hide the real cause, but also never a raw
   stack trace — provider error messages only).
2. If it's an n8n workflow, the existing global error handler (workflow 00)
   still owns retries/alerting *inside* n8n — this Control Center reads
   n8n's execution history, it does not replace n8n's own retry logic.
3. If it's a video job, `errorStage` says which pipeline stage failed;
   `POST /api/video/jobs/:id/retry` re-runs the whole job (see
   `VIDEO_PIPELINE.md` "Retry" for why it's whole-job, not per-stage, in
   this pass).

## Audit log

Every credential save/test, integration disconnect, workflow enable/disable,
activation, setting change, and video job action is recorded in `AuditLog`
(`actor`, `action`, `entityType`/`entityId`, safe `metadata` — never a
secret value). There is no UI page for it yet in this pass; query it via
`GET /api/audit` (admin-authenticated) or Postgres directly.

## Safety switches already in the existing n8n workflows (unchanged by this project)

- `AUTOPILOT_SOCIAL_POSTING` (n8n env var) — keep `false` until a week of
  human-reviewed output has passed. Mirrored here as the
  `autopilotSocialPostingEnabled` setting, which the readiness engine checks
  for workflow 12 (AI Social Autopilot) — but the actual enforcement inside
  the n8n workflow is n8n's own env var, not this setting; keep both in sync
  manually until a future pass wires them together.
- `AUTOPILOT_STOP` — n8n-side emergency stop, untouched by this project.

## What this pass does not give you

- No per-stage video retry (whole-job only).
- No background/custom music in generated videos.
- No object-storage-backed video assets (local disk only — see
  `VIDEO_PIPELINE.md` "Storage").
- No UI for the audit log (API only).
- Buffer and Runway integrations are implemented against documented APIs but
  unverified against real accounts — see `INTEGRATIONS.md` and
  `VIDEO_PIPELINE.md`.
