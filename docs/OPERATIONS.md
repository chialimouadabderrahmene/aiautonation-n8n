# Operations

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
