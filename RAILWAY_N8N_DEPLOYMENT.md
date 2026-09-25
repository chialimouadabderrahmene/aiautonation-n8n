# n8n on Railway — production deployment

Deploys the Eki automation on Railway with PostgreSQL. Version pin: **n8n 2.40.7** (the version the staging suite in `staging/` was run against). Upgrade deliberately: change the image tag, run `staging/` against it, then redeploy.

## 1. Project and database
1. Railway → **New Project** → **Empty Project**; add **PostgreSQL** (*+ New → Database → Add PostgreSQL*). Turn on backups.
2. Note the reference variables `${{Postgres.PGHOST}}`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD` (internal networking, no public DB access).

## 2. n8n service
1. *+ New → Docker Image* → `docker.n8n.io/n8nio/n8n:2.40.7` (**not** `latest`).
2. Settings → Networking → *Generate Domain*; port `5678`.
3. Variables: paste everything from [`.env.railway.example`](.env.railway.example) and fill the values ([docs/env-vars.md](docs/env-vars.md)). Non-obvious but mandatory:
   - `N8N_ENCRYPTION_KEY` — `openssl rand -hex 32`; generate once, store in a vault, **never change it** (all credentials become unreadable).
   - `N8N_WEBHOOK_URL=https://<your-domain>/` — trailing slash required (replaces the deprecated `WEBHOOK_URL`).
   - `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` — n8n 2.x blocks `$env` in nodes by default; every Eki workflow reads its configuration and secrets through `$env`.
   - `GENERIC_TIMEZONE=Africa/Lagos`, `TZ=Africa/Lagos` — every schedule in the workflows is Lagos time.
   - `EXECUTIONS_DATA_SAVE_ON_SUCCESS=none`, `EXECUTIONS_DATA_SAVE_ON_ERROR=all`, `EXECUTIONS_DATA_PRUNE=true`, `EXECUTIONS_DATA_MAX_AGE=336` — execution data contains phone numbers and message text.
4. Remove obsolete settings if present from older notes: `N8N_RUNNERS_ENABLED` (no longer needed) and `WEBHOOK_URL` (deprecated).

> Earlier notes referenced a Railway hostname `n8n-production-c3b7.up.railway.app`. It is not used anywhere any more — use the domain Railway generated for **your** n8n service.

## 3. First start
Open the domain, create the owner account, then follow [docs/setup-instructions.md](docs/setup-instructions.md) §8-10 (credentials → CLI import → publish order).

CLI access on Railway: `railway run` / a one-off service shell with the same variables:
```bash
n8n import:credentials --input=credentials.json          # ids must match the workflow files (see staging/credentials.staging.json for the shape)
n8n import:workflow --separate --input=n8n-workflows
n8n publish:workflow --id=ekiwf00                        # error handler first
```
(Publish/unpublish via CLI takes effect after an n8n restart; the UI toggle takes effect immediately.)

## 4. Webhook URLs (production)
`https://<domain>/webhook/<path>` for `lead-capture`, `join-waitlist`, `track-referral`, `collect-feedback`, `manychat-comment`, `content-multiply`, `social-proof`, `content-approval`, `whatsapp-webhook`. Test URLs (`/webhook-test/…`) only work while the editor is listening — never configure them in Meta/ManyChat/Telegram.

## 5. Common problems
| Symptom | Cause / fix |
|---|---|
| Webhook 404 | workflow not published, or `N8N_WEBHOOK_URL` mismatch |
| `access to env vars denied` in a node | `N8N_BLOCK_ENV_ACCESS_IN_NODE` is not `false` |
| Webhook 403 | missing/incorrect `X-Eki-Webhook-Secret` (or Telegram secret token) — by design |
| WhatsApp webhook 401 | signature invalid / `WHATSAPP_APP_SECRET` unset — by design (fail closed) |
| "Workflow … is not active and cannot be executed" in logs | the Error Workflow (00) is not published |
| Error alerts never arrive | workflow Settings → Error Workflow is not set (happens after a UI import: ids change) |

## 6. Maintenance
Weekly: failed executions + the daily controller report. Monthly: export workflows (`n8n export:workflow --backup --output=backup/`), check Postgres backup restore, review n8n release notes and re-run `staging/` before upgrading. Quarterly: rotate keys. Keep `N8N_ENCRYPTION_KEY` in a password vault.

Cost (order of magnitude, verify current Railway pricing): PostgreSQL + one n8n service ≈ tens of USD/month at this volume.
