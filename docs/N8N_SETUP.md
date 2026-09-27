# n8n setup

There is **no n8n instance deployed anywhere** (no Railway service exists)
as of this pass. There IS strong local evidence n8n itself works correctly
in this exact 22-workflow configuration: the `staging/` stack (see
`docs/staging-test-report.md`) ran a real n8n 2.40.7 instance through 137/137
automated checks — import, webhook triggers, real Schedule Trigger firing,
activation of all 22 workflows — in an earlier session. This document is
what actually needs to happen to get a **Railway-hosted** instance the
Control Center can manage.

**Docker registry note (real, reproduced issue in this sandbox):**
`docker pull n8nio/n8n:<tag>` from Docker Hub (`registry-1.docker.io`)
intermittently failed here with `tls: bad record MAC` / `ERR_SSL_CIPHER_OPERATION_FAILED`
— a network-layer TLS corruption issue in this sandbox, not an n8n or code
defect (the same class of error also hit unrelated `npm ci`/`apk add` calls
during this pass). `docker.n8n.io` (n8n's own registry, identical images)
pulled cleanly on retry and was used for the real import test above.
`docker/docker-compose.yml` pins `docker.n8n.io/n8nio/n8n:2.40.7` for this
reason (also matches the version the 22 workflows were validated against in
`staging/`). This has no bearing on Railway, which pulls images on its own
infrastructure — this note is about local `docker compose up` only, and if
you hit the same error locally, it's worth simply retrying.

## 1. Deploy n8n (Railway)

Following `RAILWAY_N8N_DEPLOYMENT.md` (already in this repo, pre-dating this
project):

1. New Railway service from the `n8nio/n8n` image, pinned to `2.40.7` — the
   exact version validated by `staging/` (137/137 checks; see
   `docs/staging-test-report.md`).
2. Add a Railway Postgres plugin for n8n's own database (separate from the
   Control Center's Postgres — n8n manages its own schema).
3. Environment: `N8N_HOST`, `N8N_PROTOCOL=https`, `WEBHOOK_URL`,
   `N8N_ENCRYPTION_KEY` (generate: `openssl rand -hex 32` — **back this up**,
   losing it makes every n8n credential permanently unreadable, same as this
   project's own `AUTOMATION_SECRET_KEY`), `GENERIC_TIMEZONE=Africa/Lagos`,
   `DB_TYPE=postgresdb` + the Postgres plugin's connection variables.
4. Attach a persistent volume for `/home/node/.n8n` if not using the
   Postgres backend for everything (binary data mode dependent).

## 2. First-run owner setup

Open the deployed URL once — n8n's own onboarding creates the first owner
account (email/password). This is unavoidable manual UI work; nothing here
automates it.

## 3. Generate an API key

n8n Settings → API → **Create an API key**. This is the value the Control
Center's `n8n` integration needs (Integrations → n8n → Configure → paste the
base URL and this key → Test connection).

## 4. Import the 22 workflows

```bash
N8N_BASE_URL=https://your-instance.up.railway.app \
N8N_API_KEY=<the key from step 3> \
node scripts/import-n8n-workflows.js
```

Every workflow is created **INACTIVE**. The script also tries to record
each workflow's new n8n id back into the Control Center (pass
`AUTOMATION_API_URL`/`AUTOMATION_API_TOKEN` too) so Automations can
enable/disable them — this step is optional; you can also do it once from
the Automations screen after importing (a future pass could add a "sync from
n8n" button; not built in this one).

**Status: TESTED — this exact script, run against a real, freshly-provisioned
n8n 2.40.7 instance, imported all 22/22 workflows successfully, every one
confirmed `active: false` afterward via a separate `GET /api/v1/workflows`
call.** Full transcript:

```
Importing 22 workflows into http://localhost:5679 (all created INACTIVE)...
  ✓ 00-global-error-handler -> n8n id iSL4rL1AAVVTvJwh
  ✓ 01-ai-content-generation -> n8n id 2sQHfR4ADk4RndbO
  ... (all 22)
  ✓ 22-performance-analyst-agent -> n8n id D3ZM4KpxDGhmTOsZ
22/22 imported.
```

The Control Center's own `n8n` integration was then pointed at this same
instance and tested live: `{"ok":true,"message":"Connected","latencyMs":25}`,
and the Dashboard (in a real browser) flipped from `n8n: NOT CONFIGURED` /
`SYSTEM: BLOCKED` to **`n8n: CONNECTED` / `SYSTEM: PARTIALLY READY`** in
real time. This is as close to a full production rehearsal as this pass
could get without a paid Railway service: real n8n binary, real Public API,
real Control Center, real UI — the only thing missing is the deployment
target being Railway instead of local Docker.

**How the test instance was bootstrapped** (useful if you want to repeat
this locally): `docker run` the pinned image with
`N8N_API_KEY_ENABLED=true`, then `POST /rest/owner/setup` (the same
undocumented-but-stable endpoint n8n's own first-run UI calls) to create the
owner account non-interactively, `POST /rest/login` for a session cookie, then
`POST /rest/api-keys` with `{"label":...,"expiresAt":null,"scopes":[...]}` —
note the scopes array is validated against a curated subset, not n8n's full
RBAC scope list; `workflow:create`, `workflow:read`, `workflow:update`,
`workflow:list` is confirmed sufficient for this script. None of this
replaces the real, one-time manual owner setup you'll still do on your actual
Railway instance (§2 below) — it's documented here only because it's exactly
what let this pass prove the import script for real instead of leaving it
untested.

## 5. Configure each workflow's own credentials, in n8n

The Control Center does not — and by design should not — hold n8n's own
credentials (Google Sheets OAuth2, Telegram bot, WhatsApp, Resend, Buffer, X,
Apify). Configure those in n8n's own credential UI, following
`docs/api-keys-required.md` and `docs/setup-instructions.md` (both already
in this repo, unchanged by this project).

## 6. Point webhooks at the new instance

Meta (WhatsApp) webhook URL, Telegram `setWebhook`, ManyChat's target URL —
all need updating to the new base URL. See `WHATSAPP_CLOUD_API_SETUP.md` and
`WHATSAPP_FUNNEL_SETUP.md`.

## 7. Verify in the Control Center

Dashboard → n8n status should read **CONNECTED**. Automations should show
real readiness per workflow (still BLOCKED for anything whose *other*
dependencies — WhatsApp templates, Buffer, Runway, etc. — aren't configured
yet; that's correct, not a bug).
