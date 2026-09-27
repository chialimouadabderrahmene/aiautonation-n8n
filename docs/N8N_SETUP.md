# n8n setup

There is **no n8n instance deployed anywhere** as of this pass — only the
throwaway local Docker staging stack under `staging/` that was used to
harden the 22 workflow files (see `docs/production-readiness-report.md`).
This document is what actually needs to happen to get a real instance the
Control Center can manage.

## 1. Deploy n8n (Railway)

Following `RAILWAY_N8N_DEPLOYMENT.md` (already in this repo, pre-dating this
project):

1. New Railway service from the `n8nio/n8n` image (pin a version, e.g.
   `1.62.1` — the same one the staging hardening pass validated against).
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

**Status: implemented, not yet run against a real n8n instance** — this
sandbox could not pull the n8n Docker image (network failure, not a code
issue) to verify the round trip. The request shape matches n8n's documented
Public API (`POST /api/v1/workflows`, `X-N8N-API-KEY` header); confirm
against your instance's `/api/v1/docs` before relying on it in production.

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
