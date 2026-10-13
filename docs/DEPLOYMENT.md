# Deployment (one-time, technical)

This is done **once** by whoever deploys the system. After it, the client
configures everything in the Control Center (see `CLIENT_SETUP_CHECKLIST.md`)
— no code, no `.env`, no restarts.

**There is no n8n service in this topology.** The native workflow engine
(`api/src/modules/engine/`) executes all 22 workflows directly against
Postgres + Redis/BullMQ — nothing here starts, configures, or depends on n8n
at runtime. If an n8n service happens to still exist in a given Railway
project from before this migration, nothing in this document or its scripts
creates, redeploys, or requires it; removing it is a separate, explicit
decision for whoever owns that project.

## Topology

```
                Internet
                   │
        ┌──────────┴───────────┐
        │ web  (PUBLIC)        │  Next.js UI + same-origin proxy for /api/*
        └──────────┬───────────┘  (browser, Telegram webhook, OAuth callbacks,
                   │ private net   webhook ingestion, signed local media links
        ┌──────────┴───────────┐  all enter here)
        │ api  (PRIVATE)       │
        │ :4100 app            │
        │ :4110 internal only  │
        └──┬──────┬─────────┬──┘
           │      │         │
      Postgres  Redis   S3 bucket
      (PRIVATE)(PRIVATE) (private, signed URLs)
           │      │         │
        ┌──┴──────┴─────────┴──┐
        │ worker (PRIVATE)     │  BullMQ consumer, FFmpeg/ffprobe, video pipeline
        └──────────────────────┘
```

| Service | Public? | Why |
|---|---|---|
| web | **yes** | the only UI; proxies `/api/*` to the API at request time |
| api | no | reached by web over private networking; owns the native workflow engine, scheduler, and webhook routes (which Meta/ManyChat/Telegram/Resend/etc. reach through the web proxy) |
| worker | no | no inbound traffic at all (health endpoint for the platform only) |
| Postgres | no | private networking only (no TCP proxy) |
| Redis | no | private networking only; BullMQ queues live here |
| Bucket | S3 endpoint | objects are private; access only through short-lived signed URLs |

One Postgres schema (`public`) serves the whole application — workflow
definitions/versions, execution history, leads, content drafts, integrations,
audit log, everything.

## Railway — automated path

Prerequisites: Railway CLI **v5+** logged in (`railway login`), Node.js 20+,
this repository pushed to GitHub with Railway's GitHub app allowed to read it,
and the target Railway project already linked (or created with `--init`).

```bash
railway link                     # the target project (or add --init "Eki AI Automation" below)
ADMIN_EMAIL=you@company.com BUCKET_REGION=ams bash scripts/railway-setup.sh
```

(`scripts/railway-setup.sh` runs `node scripts/railway-deploy.mjs`; options in
that file's header: `BUCKET_NAME`, `GITHUB_REPO`, `GITHUB_BRANCH`, `--init`,
`--verify-only`, `--no-smoke`. `BUCKET_REGION`: `sjc`, `iad`, `ams` or `sin`.)

What it does — everything looked up first, nothing duplicated, safe to re-run:

1. Postgres and Redis (`railway add --database`), their public TCP proxies
   removed; a Bucket (`railway bucket create`) unless one exists.
2. Empty services `api`, `worker`, `web`; config-as-code path
   `/railway/<service>.json` on each (`railway environment edit --service-config`).
3. A public domain for **web** only (port 3200). `api`/`worker` stay private.
4. Secrets `AUTOMATION_SECRET_KEY`, `JWT_SECRET`, `INTERNAL_API_TOKEN`
   generated locally and sent via `railway variable set --stdin` (never on a
   command line, never printed). Existing values are reused, never rotated.
   The admin password goes to
   `~/.eki-control-center/<project>-credentials.txt` (mode 600).
5. All variables below, S3 values read from `railway bucket credentials`.
6. Deploys api → worker → web from GitHub, waiting for each to reach SUCCESS;
   on a failed build/deploy it prints that deployment's build and deploy logs
   and stops.
7. Verifies the live deployment: admin login, core components (api, database,
   redis, worker) ONLINE, the native engine reachable with all 22 workflows
   registered and 0 enabled on a fresh deploy, FFmpeg render + storage
   round-trip on the worker (`railway ssh --service worker node dist/tools/selftest.js`),
   no secrets in the frontend bundle or `/api/integrations`, private services
   unreachable, then `scripts/smoke-test.mjs` with `SMOKE_EXPECT_ALL_INACTIVE=1`.
   A report without secrets is written to `~/.eki-control-center/`.

Once the admin has changed the password in Settings, re-run verification with
`ADMIN_PASSWORD=<current> bash scripts/railway-setup.sh --verify-only`.

## Railway — manual path (dashboard)

Create: Postgres, Redis, a Bucket, and three services from this repo, each
with **Settings → Config-as-code** pointing at `railway/api.json`,
`railway/worker.json`, `railway/web.json`. Generate a public domain for
**web** only.

Shared variables (generate each with `openssl rand -hex 32`):
`AUTOMATION_SECRET_KEY`, `JWT_SECRET`, `INTERNAL_API_TOKEN`.

**api**
```
PORT=4100
INTERNAL_PORT=4110
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
AUTOMATION_SECRET_KEY=${{shared.AUTOMATION_SECRET_KEY}}
JWT_SECRET=${{shared.JWT_SECRET}}
INTERNAL_API_TOKEN=${{shared.INTERNAL_API_TOKEN}}
ADMIN_BOOTSTRAP_EMAIL=<admin email>
ADMIN_BOOTSTRAP_PASSWORD=<strong password — change it in Settings after first login>
PUBLIC_WEB_URL=https://${{web.RAILWAY_PUBLIC_DOMAIN}}
WEB_ORIGIN=https://${{web.RAILWAY_PUBLIC_DOMAIN}}
STORAGE_DRIVER=s3 + S3_* (bucket)
```

**worker**
```
PORT=4101
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
AUTOMATION_SECRET_KEY=${{shared.AUTOMATION_SECRET_KEY}}
VIDEO_WORKER_CONCURRENCY=1
STORAGE_DRIVER=s3 + S3_* (bucket)
```

**web**
```
PORT=3200
API_INTERNAL_URL=http://${{api.RAILWAY_PRIVATE_DOMAIN}}:4100
```

Do **not** set `ALLOW_PROVIDER_OVERRIDES` / `PROVIDER_API_OVERRIDES` in
production — they exist only for the local test overlay (the Dashboard shows a
red TEST MODE banner if they are ever on).

## What happens automatically on every deploy / restart

1. **api** entrypoint runs `prisma migrate deploy` (idempotent, retried while
   Postgres starts), then the server verifies the required tables exist,
   bootstraps the admin (first boot only), creates integration rows, generates
   the inbound webhook secret and the Telegram webhook secret, verifies them,
   recomputes workflow readiness against the native engine, starts the
   workflow-trigger/execution BullMQ workers and the outbox-relay/cron-
   scheduler/stalled-execution background ticks, and starts listening
   (`:4100`, internal `:4110`).
2. **worker** waits for Postgres, removes stale temp files, detects
   ffmpeg/ffprobe/subtitle support/storage, reports a heartbeat every 30 s.
3. Every workflow ships **disabled**. An admin enables one from the Control
   Center's Automations page only once its readiness check (required
   providers connected and tested, required settings filled in, a published
   native engine version) is READY — enabling toggles the engine's own
   `EngineWorkflow.enabled` flag directly; nothing external needs to be
   configured or restarted for that to take effect.
4. After an admin changes an integration or setting, readiness is
   recalculated immediately — no restart, no external supervisor involved.

Verified locally with the same images: fresh stack → all of the above with no
manual step; full restart of every service → back ONLINE with the same 22
workflows and the same enabled set (see the report's test evidence).

## Verify the deployment

```bash
# 20-step production smoke test through the public web URL
SMOKE_BASE_URL=https://<web domain> SMOKE_EMAIL=... SMOKE_PASSWORD=... \
SMOKE_EXPECT_ALL_INACTIVE=1 node scripts/smoke-test.mjs

# FFmpeg/ffprobe + real assembly + storage round-trip on the deployed worker
railway ssh --service worker -- node dist/tools/selftest.js
```

## Local stack (same topology)

```bash
cp docker/.env.example docker/.env      # fill with `openssl rand -hex 32` values
docker compose -f docker/docker-compose.yml --env-file docker/.env up -d --build
# http://localhost:3200 (Control Center)
```

The compose file also defines an optional `n8n` service purely for operators
who want to browse the original n8n workflow diagrams side-by-side as
migration reference — it is not started by default and the application does
not read or write anything through it.

Test mode (mock providers, for exercising the whole pipeline without real
accounts — never for production):

```bash
docker compose -f docker/docker-compose.yml -f docker/docker-compose.test.yml --env-file docker/.env up -d --build
E2E_EMAIL=... E2E_PASSWORD=... node scripts/local-e2e-test-mode.mjs
```

## Secrets that must be backed up outside Railway

`AUTOMATION_SECRET_KEY` — encrypts every stored provider credential. Losing
it makes every stored credential unreadable (the admin would have to re-enter
them all). Backups and restore: `docs/BACKUP_RESTORE.md`.
