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

> Tested against a mock of the Railway CLI v5.62.1 (JSON shapes taken from its
> source) with verification running against the real local stack: first run,
> idempotent re-run (zero changes), and a forced failed deploy.
>
> **Run for real against a live Railway account (2026-09-28).** Two real bugs
> in this script were found and fixed by that run, not by inspection:
> 1. **Windows `spawnSync("railway", ...)` resolution/quoting.** Node spawns
>    only real executables — it cannot resolve the npm `railway.cmd` shim
>    (or a cmd.exe metacharacter/whitespace-containing argument like
>    `--message "Eki Control Center: ..."`) without going through `cmd.exe`,
>    and `shell: true` does not re-quote array arguments for you, so a value
>    with spaces silently got re-split into separate cmd.exe tokens
>    (`railway environment edit ... exited 2: unexpected argument 'Control'`).
>    **Fixed** in `scripts/lib/railway-cli.mjs`: resolve the actual `railway`
>    executable from `PATH` once (following a `.cmd`/`.bat` shim to the real
>    binary it launches, or `RAILWAY_CLI=<path>` as an explicit override) and
>    `spawnSync` that executable directly with the argument array — no shell,
>    so no quoting problem exists to work around. `--check-cli` prints which
>    executable this resolves to on a given machine without changing anything.
> 2. **`railway environment edit --service-config <svc> configFile <path>` is
>    a silent no-op on this CLI/account.** It always exits 0 and prints
>    `{"committed":false,"message":"No changes to apply"}` — reproduced for
>    the `configFile` path itself, for direct schema fields
>    (`build.builder`, `build.dockerfilePath`, `deploy.numReplicas`), and for
>    a deliberately invalid dot-path: all three produced the identical
>    response, before and after linking the target service. The next build
>    then used Railpack instead of the intended Dockerfile ("Railpack could
>    not determine how to build the app — Script start.sh not found").
>    **Fixed**: the script now sets the legacy `RAILWAY_DOCKERFILE_PATH`
>    build variable per service instead (a plain `railway variable set`,
>    confirmed effective — the next build log switched from Railpack to the
>    correct multi-stage Dockerfile). This only replaces
>    `build.dockerfilePath`; **`deploy.healthcheckPath` /
>    `restartPolicyType` / `numReplicas` have no confirmed variable
>    equivalent** (`RAILWAY_HEALTHCHECK_PATH` / `RAILWAY_HEALTHCHECK_TIMEOUT_SEC`
>    / `RAILWAY_RESTART_POLICY_TYPE` were tried on a live service and
>    confirmed *not* honored — the deployment manifest still showed
>    `healthcheckPath: null`, `restartPolicyType: "ON_FAILURE"` after setting
>    them and restarting). Until Railway exposes a working way to set these
>    from the CLI, every service runs with Railway's platform defaults
>    instead of this repo's intended config (TCP-reachability check instead
>    of an HTTP path, `ON_FAILURE` with 10 retries instead of `ALWAYS`, 1
>    replica — the last one matches anyway). Set them by hand in the
>    dashboard (Settings → Deploy) if you need the exact configured values.
>
> That same real run also hit `railway ssh` requiring a registered SSH key
> (`railway ssh keys add --key <path to your public key>`) and Railway's own
> SSH gateway host key not yet being trusted (`ssh-keyscan ssh.railway.com >>
> ~/.ssh/known_hosts`) before `worker`'s FFmpeg self-test could run at all —
> neither is specific to this script, just first-time `railway ssh` setup.
> Once SSH worked, `dist/tools/selftest.js` (full synthetic-clip encode +
> subtitle burn-in + storage round-trip) was killed with exit 137 (SIGKILL)
> on a Trial-plan worker, twice, including wrapped in a shell that would have
> printed a partial log if only the `node` process had died — consistent
> with the whole container hitting its cgroup memory limit (`cat
> /sys/fs/cgroup/memory.max` on that container: `999997440` bytes, ~953 MiB).
> This was **not** worked around or reported as a pass: the self-test result
> is genuinely unproven on this plan. Independent partial evidence that the
> toolchain itself is fine: the worker's own boot-time capability probe (real
> log line, not injected) reported `ffmpeg="ffmpeg version 6.1.1-3ubuntu5"
> ffprobe="ffprobe version 6.1.1-3ubuntu5" subtitles=true fonts=true
> storage="S3 bucket \"eki-media-...\" ... write/delete verified"` — so
> FFmpeg, subtitle rendering and the real S3 bucket all work in this exact
> container; only the heavier full-render self-test binary is unconfirmed,
> likely because libx264 + the `mandelbrot` test source + the subtitle
> filter graph pushes memory past ~950 MiB on this plan's container size
> (ffmpeg does not know about the cgroup limit and may size internal buffers
> off the host's visible CPU count). Re-run
> `railway ssh --service worker node dist/tools/selftest.js` after upgrading
> the plan (bigger container) to get a real pass/fail on this specific check.

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
