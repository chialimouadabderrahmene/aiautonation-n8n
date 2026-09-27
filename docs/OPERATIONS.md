# Operations

## Daily use (client)

See `CLIENT_SETUP_CHECKLIST.md`: Dashboard → Integrations (configure, test) →
Automations (activate ready) → Video Generator / AI Content Studio →
Approvals (Telegram) → Executions / Reports.

## Health

Dashboard → System health (auto-refresh 15 s), or `GET /api/system/health`:

| Component | ONLINE means | DEGRADED | OFFLINE / NOT CONFIGURED |
|---|---|---|---|
| API | process answering | — | web shows "API not reachable" |
| Video worker | heartbeat < 90 s old and ffmpeg + ffprobe + storage OK | heartbeat fine but a capability missing | no heartbeat |
| Database | `SELECT 1` + migration count | — | unreachable |
| Queue (Redis) | `PING` | — | unreachable / REDIS_URL missing |
| n8n | `/healthz` + public API answers; shows present/active counts | process up, API failing or key missing | not answering |
| Media storage | write + delete of a probe object (cached 60 s) | local-disk driver | unreachable / not configured |

Platform health checks: api `/health` (liveness) and `/health/ready`
(database), worker `/health` (Redis + DB), web `/login`, n8n `/healthz`.

## Failure handling

- Every provider error is converted into a safe message (no keys, tokens or
  raw request dumps) and stored on the integration / job / execution.
- Automatic retries are bounded (adapter 3×, video job `videoMaxAttempts`,
  delivery 3×); final failures create an audit entry and a Telegram alert
  (Settings → Notifications).
- Unhandled API errors return `{"message": "...", "requestId"}`, are logged
  with the request id and recorded in the audit log (`error.unhandled`).
- n8n workflow failures are alerted by workflow 00 (when enabled) and mirrored
  into Executions with the failing node and message.

## Routine checks after a deployment

```bash
SMOKE_BASE_URL=https://<web> SMOKE_EMAIL=... SMOKE_PASSWORD=... node scripts/smoke-test.mjs
railway ssh --service worker -- node dist/tools/selftest.js
```

## Audit trail

`GET /api/audit` (latest 300): logins (incl. failed), credential saves/tests/
rotations (field names only), OAuth connects, workflow enable/disable/
test-run/activate-ready/drift deactivations, settings, video lifecycle,
approvals, publications, unhandled errors.

## Scaling

- worker: raise `VIDEO_WORKER_CONCURRENCY` or add replicas (BullMQ distributes
  jobs; heartbeats are per replica).
- api: stateless apart from the in-process scheduler; keep 1 replica (the
  scheduler tasks are idempotent but would duplicate work).
- n8n: single instance (queue mode not configured).

## Known limitations

- Real provider accounts were not available: every provider adapter is
  implemented against the provider's documented API/SDK but only Google Sheets
  answered for real (error path). Status per provider: see the report.
- Buffer's legacy API (used by workflows 10/12/14) is unverified and Buffer no
  longer issues new OAuth apps.
- LinkedIn organization posting requires LinkedIn partner approval; Meta
  publishing for non-admin accounts requires App Review.
- The n8n owner/API-key bootstrap uses n8n's internal UI API (verified on
  2.40.7); re-verify when upgrading n8n (fallback: paste an API key).
