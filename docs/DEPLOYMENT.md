# Deployment (one-time, technical)

This is done **once** by whoever deploys the system. After it, the client
configures everything in the Control Center (see `CLIENT_SETUP_CHECKLIST.md`)
— no code, no `.env`, no n8n screens, no restarts.

## Topology

```
                Internet
                   │
        ┌──────────┴───────────┐
        │ web  (PUBLIC)        │  Next.js UI + same-origin proxy for /api/*
        └──────────┬───────────┘  (browser, Telegram webhook, OAuth callbacks,
                   │ private net   signed local media links all enter here)
        ┌──────────┴───────────┐        ┌───────────────────────┐
        │ api  (PRIVATE)       │◄──────►│ n8n (PUBLIC editor +  │
        │ :4100 app            │ :5678  │ webhooks; supervisor   │
        │ :4110 internal only  │◄───────│ pulls config from      │
        └──┬──────┬─────────┬──┘ :4110  │ api:4110, :5690 test-run)
           │      │         │           └───────────┬───────────┘
      Postgres  Redis   S3 bucket                    │
      (PRIVATE)(PRIVATE) (private, signed URLs)   Postgres schema "n8n"
           │      │         │
        ┌──┴──────┴─────────┴──┐
        │ worker (PRIVATE)     │  BullMQ consumer, FFmpeg/ffprobe
        └──────────────────────┘
```

| Service | Public? | Why |
|---|---|---|
| web | **yes** | the only UI; proxies `/api/*` to the API at request time |
| api | no | reached by web (and n8n's supervisor) over private networking |
| worker | no | no inbound traffic at all (health endpoint for the platform only) |
| n8n | editor + webhooks only | leads/WhatsApp/ManyChat webhooks must reach n8n; the editor is behind n8n's own owner login |
| Postgres | no | private networking only (no TCP proxy) |
| Redis | no | private networking only |
| Bucket | S3 endpoint | objects are private; access only through short-lived signed URLs |

One Postgres serves both: schema `public` = Control Center, schema `n8n` =
n8n (n8n creates its schema itself — verified).

## Railway — automated path

Prerequisites: Railway CLI **v5+** logged in (`railway login`), Node.js 20+,
this repository pushed to GitHub with Railway's GitHub app allowed to read it.

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
2. Empty services `api`, `worker`, `n8n`, `web`; config-as-code path
   `/railway/<service>.json` on each (`railway environment edit --service-config`).
3. Public domains for **web** (port 3200) and **n8n** (port 5678) only; volume
   on n8n at `/home/node/.n8n`.
4. Secrets `AUTOMATION_SECRET_KEY`, `JWT_SECRET`, `INTERNAL_API_TOKEN`,
   `N8N_ENCRYPTION_KEY` generated locally and sent via `railway variable set --stdin`
   (never on a command line, never printed). Existing values are reused, never
   rotated. Admin and n8n-owner passwords go to
   `~/.eki-control-center/<project>-credentials.txt` (mode 600).
5. All variables below, S3 values read from `railway bucket credentials`.
6. Deploys api → worker → n8n → web from GitHub, waiting for each to reach
   SUCCESS; on a failed build/deploy it prints that deployment's build and
   deploy logs and stops.
7. Verifies the live deployment: admin login, all 6 components ONLINE, 22/22
   workflows in n8n and 0 active (read directly from n8n's API by
   `railway ssh --service api node dist/tools/n8n-verify.js`), n8n rejects
   unauthenticated API calls, FFmpeg render + storage round-trip on the worker
   (`railway ssh --service worker node dist/tools/selftest.js`), no secrets in
   the frontend bundle or `/api/integrations`, private services unreachable,
   then `scripts/smoke-test.mjs` with `SMOKE_EXPECT_ALL_INACTIVE=1`.
   A report without secrets is written to `~/.eki-control-center/`.

Once the admin has changed the password in Settings, re-run verification with
`ADMIN_PASSWORD=<current> bash scripts/railway-setup.sh --verify-only`.

> Tested against a mock of the Railway CLI v5.62.1 (JSON shapes taken from its
> source) with verification running against the real local stack: first run,
> idempotent re-run (zero changes), and a forced failed deploy. It has not yet
> been run against a real Railway account.

## Railway — manual path (dashboard)

Create: Postgres, Redis, a Bucket, and four services from this repo, each with
**Settings → Config-as-code** pointing at `railway/api.json`, `railway/worker.json`,
`railway/web.json`, `railway/n8n.json`. Generate public domains for **web** and
**n8n** only. Add a volume to **n8n** mounted at `/home/node/.n8n`.

Shared variables (generate each with `openssl rand -hex 32`):
`AUTOMATION_SECRET_KEY`, `JWT_SECRET`, `INTERNAL_API_TOKEN`, `N8N_ENCRYPTION_KEY`.

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
N8N_INTERNAL_URL=http://${{n8n.RAILWAY_PRIVATE_DOMAIN}}:5678
N8N_PUBLIC_URL=https://${{n8n.RAILWAY_PUBLIC_DOMAIN}}
N8N_SUPERVISOR_URL=http://${{n8n.RAILWAY_PRIVATE_DOMAIN}}:5690
N8N_OWNER_EMAIL=<admin email>
N8N_OWNER_PASSWORD=<8+ chars incl. an uppercase letter and a digit>
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

**n8n**
```
PORT=5678
RAILWAY_RUN_UID=0                     # lets n8n write the mounted volume
N8N_USER_FOLDER=/home/node            # REQUIRED with RAILWAY_RUN_UID=0: as root n8n would
                                      # otherwise use /root/.n8n and the volume stays empty
DB_TYPE=postgresdb
DB_POSTGRESDB_HOST=${{Postgres.PGHOST}}
DB_POSTGRESDB_PORT=${{Postgres.PGPORT}}
DB_POSTGRESDB_DATABASE=${{Postgres.PGDATABASE}}
DB_POSTGRESDB_USER=${{Postgres.PGUSER}}
DB_POSTGRESDB_PASSWORD=${{Postgres.PGPASSWORD}}
DB_POSTGRESDB_SCHEMA=n8n
N8N_ENCRYPTION_KEY=${{shared.N8N_ENCRYPTION_KEY}}
N8N_HOST=${{RAILWAY_PUBLIC_DOMAIN}}
N8N_PROTOCOL=https
N8N_PROXY_HOPS=1
N8N_EDITOR_BASE_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}/
N8N_WEBHOOK_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}/
WEBHOOK_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}/
CONTROL_CENTER_INTERNAL_URL=http://${{api.RAILWAY_PRIVATE_DOMAIN}}:4110
INTERNAL_API_TOKEN=${{shared.INTERNAL_API_TOKEN}}
```

Do **not** set `ALLOW_PROVIDER_OVERRIDES` / `PROVIDER_API_OVERRIDES` in
production — they exist only for the local test overlay (the Dashboard shows a
red TEST MODE banner if they are ever on).

## What happens automatically on every deploy / restart

1. **api** entrypoint runs `prisma migrate deploy` (idempotent, retried while
   Postgres starts), then the server verifies all 16 tables exist, bootstraps
   the admin (first boot only), creates integration rows, generates the inbound
   webhook secret and the Telegram webhook secret, verifies them, recomputes
   readiness, and starts listening (`:4100`, internal `:4110`).
2. **n8n**'s supervisor waits for the API, loads the runtime configuration
   (whatever the admin entered — nothing on first boot), starts n8n.
3. **api** background tasks (every 15 s until done, then periodically):
   create the n8n owner (first boot only) → log in → mint an API key → store
   it encrypted → test it → import the 22 workflows **inactive** (idempotent;
   matched by stored id then by name) → create the n8n credentials from the
   vault → mirror executions every 30 s → re-sync every 5 min → deactivate any
   workflow active in n8n but not enabled in the Control Center.
4. **worker** waits for Postgres, removes stale temp files, detects
   ffmpeg/ffprobe/subtitle support/storage, reports a heartbeat every 30 s.
5. After an admin changes an integration or setting, n8n credentials are
   re-synced (seconds) and the supervisor restarts n8n with the new
   configuration (≤ ~30 s). Nobody restarts anything by hand.

Verified locally with the same images: fresh stack → all of the above with no
manual step; full restart of every service → back ONLINE in ~60 s with the same
22 workflows and the same active set (see the report's test evidence).

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
# http://localhost:3200 (Control Center)   http://localhost:5679 (n8n editor)
```

Test mode (mock providers, for exercising the whole pipeline without real
accounts — never for production):

```bash
docker compose -f docker/docker-compose.yml -f docker/docker-compose.test.yml --env-file docker/.env up -d --build
E2E_EMAIL=... E2E_PASSWORD=... node scripts/local-e2e-test-mode.mjs
```

## Secrets that must be backed up outside Railway

`AUTOMATION_SECRET_KEY` (all Control Center credentials) and
`N8N_ENCRYPTION_KEY` (all n8n credentials). Losing either makes the matching
stored credentials unreadable (the admin would have to re-enter them). Backups
and restore: `docs/BACKUP_RESTORE.md`.
