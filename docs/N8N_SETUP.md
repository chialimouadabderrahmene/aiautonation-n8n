# n8n — how it is set up (automatically)

There are no manual n8n steps in normal operation. This page explains what the
Control Center does so a developer can reason about it.

## Image

`docker/Dockerfile.n8n` = `n8nio/n8n:2.40.7` (the version the 22 workflows were
validated against) + `docker/n8n/supervisor.mjs` as PID 1 (under tini).
Storage: Postgres schema `n8n` (created by n8n itself) + a volume at
`/home/node/.n8n`. `N8N_ENCRYPTION_KEY` is a Railway shared variable.

## Connection (owner + API key)

n8n has no environment variable for an owner account or an API key, so the
API performs what an admin would click once, over the private network
(`api/src/modules/n8n/bootstrap.ts`):

1. `GET /rest/settings` → if setup is pending, `POST /rest/owner/setup`
   with `N8N_OWNER_EMAIL` / `N8N_OWNER_PASSWORD`.
2. `POST /rest/login` → `POST /rest/api-keys` with every scope the instance offers.
3. The key is stored encrypted as the `n8n` integration and tested
   (`GET /api/v1/workflows`) → **Connected**.

These `/rest/*` calls are n8n's internal UI API; they were verified against the
pinned 2.40.7 image. If they fail (e.g. the owner was created by hand with a
different password), the n8n card shows **Action required** with the reason and
an API key from n8n → Settings → n8n API can be pasted there instead. An
existing working key is always re-tested and reused — restarts never mint a
new one.

## Configuration delivery (replaces editing n8n's environment)

The workflows read settings through `$env.*`. The API computes that
environment from Integrations + Settings (`modules/n8n/runtimeEnv.ts`) and
serves it only on its internal listener (`:4110`, `x-internal-token`). The
supervisor loads it before starting n8n, polls a version hash every 20 s and
restarts n8n gracefully when it changes. Platform variables (`N8N_*`, `DB_*`,
`EXECUTIONS_*`, `TZ`, …) can never be overridden this way.

## Credentials

Created/updated through n8n's public API from the encrypted vault
(`modules/n8n/credentials.ts`):

| n8n credential | Type | Source |
|---|---|---|
| Eki Telegram Bot | telegramApi | Telegram integration |
| Eki Google Sheets (Service Account) | googleApi | Google Sheets integration (Sheets nodes are switched to service-account auth on import) |
| Eki Webhook Shared Secret | httpHeaderAuth `X-Eki-Webhook-Secret` | Inbound webhook security (auto-generated) |
| Eki Telegram Webhook Secret | httpHeaderAuth `X-Telegram-Bot-Api-Secret-Token` | generated; the API forwards Telegram updates with it |
| Eki X Bearer | httpHeaderAuth `Authorization` | X OAuth connection; refreshed tokens are pushed automatically |

## Workflow import (idempotent)

`modules/n8n/workflows.ts` — on connect, every 5 minutes, after any
integration change, or via Automations → *Sync with n8n now*:

- match each file to n8n by stored id, then by exact name → never duplicates
  (even after a Control Center database loss);
- transform: credential references re-pointed to the managed credentials,
  `errorWorkflow` resolved to workflow 00's real id;
- create **inactive**, or update only when the transformed definition's hash changed;
- a workflow active in n8n but not enabled in the Control Center is deactivated
  and audited.

## Telegram

One bot = one webhook. The Control Center owns it
(`https://<web>/api/telegram/webhook`, registered automatically after Telegram
passes its test). Video APPROVE/REJECT buttons are handled by the Control
Center; every other update is forwarded to workflow 02's webhook with the
secret header workflow 02 already verifies.

## Test runs and executions

- *Test run* (scheduled workflows): the supervisor runs `n8n execute --id=<id>`
  — a real execution, stored by n8n and mirrored into Executions.
- *Test webhook* (webhook workflows): the production webhook is probed without
  credentials (must answer, and reject with 401/403).
- n8n execution metadata (never payload data) is mirrored every 30 s. Successful
  executions are kept by n8n for 7 days (`EXECUTIONS_DATA_MAX_AGE=168`) — they
  used to be discarded, which made success tracking impossible.

## Editor access

`https://<n8n domain>` with the owner email/password (printed once by
`scripts/railway-setup.sh`). Day-to-day use of the editor is not needed;
changes made there to workflows managed by the Control Center are overwritten
on the next sync if the source file changed.
