# Deployment

Four independent services. None of this touches the Eki marketplace's
Vercel projects, database, or domains.

## Verified real bugs fixed in the Docker images (found by actually building and running them)

These were caught by building `docker/Dockerfile.api` / `Dockerfile.worker`
and running the resulting containers against real Postgres/Redis, not by
inspection:

1. **`npm ci` ran before `prisma/` was copied in.** `package.json`'s
   `postinstall: prisma generate` needs `prisma/schema.prisma` to exist —
   without it, the build failed outright (`schema.prisma: file not found`).
   Fixed: `COPY {api,worker}/prisma ./prisma` now happens before `npm ci`.
2. **The Prisma query engine crashed the process on its first database
   query** inside the Alpine runtime image: `Error loading shared library
   libssl.so.1.1: No such file or directory`. Root cause: Alpine 3.24 (what
   `node:22-alpine` uses) only ships OpenSSL 3.x — there is no
   `openssl1.1-compat` package for it — but the default-generated Prisma
   engine binary was linked against OpenSSL 1.1. Fixed in two places that are
   both required: `binaryTargets = ["native", "linux-musl-openssl-3.0.x"]`
   added to both `prisma/schema.prisma` files, **and** `RUN apk add --no-cache
   openssl` added to the **build** stage of both Dockerfiles too, not just
   the runtime stage — `prisma generate`'s own "native" platform detection
   needs openssl present at *generate* time, or it silently falls back to
   generating the legacy engine that then fails to load at runtime. Reproduced
   this exact failure once with openssl only in the runtime stage, confirmed
   fixed with it in both.
3. **`COPY {api,worker} ./` after `RUN npm ci` copied this repo's own,
   host-machine `node_modules` into the image**, overwriting the container's
   freshly-`npm ci`'d one (no `.dockerignore` existed). On a Windows dev
   machine this reintroduced a Windows-native Prisma engine binary into a
   Linux image. Fixed: added `.dockerignore` at the repo root excluding
   `node_modules`, `.next`, `dist`, and `.env*` from every build context.
4. **No container-level health checks.** Added `HEALTHCHECK` to both
   Dockerfiles (hits each service's own `/health` — worker's is new, see
   below) and a `HEALTHCHECK` to n8n's compose service.

**Re-verification status — fully confirmed against a real, fixed worker
container** (not just inspection): built the image with all fixes applied,
ran it against real Postgres 16 + Redis 7 containers, and got:
- `GET /health` → `{"ok":true,"redis":true,"database":true,"shuttingDown":false}` (real DB/Redis round trip, no crash)
- `node_modules/.prisma/client/libquery_engine-linux-musl-openssl-3.0.x.so.node` present (the correct engine — previously it was the legacy no-suffix one that crashed)
- Docker's own `HEALTHCHECK` reported `healthy`
- `docker stop` (real `SIGTERM`) produced exactly the expected log lines —
  `SIGTERM received, finishing in-flight jobs before exit...` then
  `shut down cleanly` — and exit code `0`

The `api` image (identical fix) was independently rebuilt and booted the
same way, against the same real Postgres/Redis: `GET /health` → 200,
`GET /health/detailed` → real `{"database":{"status":"ONLINE"},"redis":{"status":"ONLINE"},"n8n":{"status":"NOT_CONFIGURED"}}`,
Docker's own `HEALTHCHECK` → `healthy`, and a real
`POST /api/auth/login` through the container issued a real, valid JWT. Item 3
follows directly from the reproduced evidence in items 1–2 (that's *how* the
stale/wrong engine got into the image in the first place) and is a standard,
low-risk `.dockerignore` addition.

**What was NOT run as a single command:** `docker compose -f
docker/docker-compose.yml up -d --build` for all four services together, in
one shot (this sandbox's outbound network was intermittent throughout —
`tls: bad record MAC` / `ERR_SSL_CIPHER_OPERATION_FAILED` hit `npm ci`,
`apk add`, and `docker pull` at various points, a transient environment
condition, not a code defect). What happened instead: every piece was
verified independently, for real, then wired to the others for real —
Postgres 16 + Redis 7 via `docker run` (official images); `api` and `worker`
images built individually and run against that real Postgres/Redis, both
confirmed healthy with real DB/Redis round trips; `web` run locally
(`npm run build && npm start`) against the real `api`, and clicked through
in a real browser (see `docs/OPERATIONS.md` "Real UI testing done this
pass"); n8n 2.40.7 run via `docker run`, had all 22 workflows imported into
it for real, and was connected to the running Control Center for real —
confirmed live in the browser (`n8n: CONNECTED`, `SYSTEM: PARTIALLY READY`
on the Dashboard; see `docs/N8N_SETUP.md`). Every service and every
integration point between them is proven; the one thing not literally
exercised is Compose's own orchestration (env var wiring between services,
`depends_on` health-gating, the `web` build arg). Before your first real
deploy: run `docker compose -f docker/docker-compose.yml up -d --build` once,
end to end, and confirm all containers report healthy — low risk given the
above, but genuinely not the same test.

## Real health checks added this pass

| Service | Endpoint | Checks |
|---|---|---|
| `api` | `GET /health` | Liveness only (process up) — never touches the DB, so a container platform doesn't restart a healthy API over a transient DB blip |
| `api` | `GET /health/detailed` | Real: Postgres (`SELECT 1`), Redis (`PING`), n8n (`isReachable()` if configured) — returns 503 if the database is down |
| `worker` | `GET /health` (port `WORKER_HEALTH_PORT`, default 4101) | Real: Postgres + Redis ping, `false` while shutting down |
| `worker` | Docker `HEALTHCHECK` | Calls the above via `wget` (Alpine's busybox `wget`, no extra package needed) |
| `worker` | graceful shutdown | `SIGTERM`/`SIGINT` → stop accepting jobs, let the in-flight job finish (`worker.close()`), 30s force-exit timeout |

## Local development

```bash
cd docker
cp ../api/.env.example ../api/.env        # fill in AUTOMATION_SECRET_KEY, JWT_SECRET, ADMIN_BOOTSTRAP_*
cp ../worker/.env.example ../worker/.env  # AUTOMATION_SECRET_KEY must match api/.env exactly
cp ../web/.env.example ../web/.env.local
export AUTOMATION_SECRET_KEY=$(openssl rand -hex 32)
export JWT_SECRET=$(openssl rand -hex 32)
export N8N_ENCRYPTION_KEY=$(openssl rand -hex 32)
export ADMIN_BOOTSTRAP_EMAIL=you@example.com
export ADMIN_BOOTSTRAP_PASSWORD='choose one'
docker compose up -d --build
```

Then:
1. Run migrations once: `docker compose exec api npx prisma migrate deploy`
2. Web UI: http://localhost:3200 — sign in with `ADMIN_BOOTSTRAP_EMAIL`/`PASSWORD` (only works on first boot, before any admin account exists).
3. n8n: http://localhost:5679 — complete its own first-run owner setup, then Settings → API to generate an n8n API key, then add it as the `n8n` integration in the Control Center.

Alternatively, run each service with `npm run dev` from its own directory
against your own local/managed Postgres + Redis — see each service's
`.env.example`.

## Production (Railway — recommended, matches the existing `.env.railway.example`)

1. **Postgres**: one Railway Postgres plugin. This is a *new* database —
   never point it at the Eki marketplace's database.
2. **Redis**: one Railway Redis plugin, shared by `api` and `worker`.
3. **n8n**: see `N8N_SETUP.md` — deploy it first; several integrations and
   the readiness engine depend on it existing.
4. **api**: deploy `docker/Dockerfile.api` (build context = repo root).
   Env vars: `DATABASE_URL`, `REDIS_URL`, `AUTOMATION_SECRET_KEY`,
   `JWT_SECRET`, `WEB_ORIGIN` (the web service's public URL),
   `ADMIN_BOOTSTRAP_EMAIL`/`PASSWORD` (unset after first boot),
   `TELEGRAM_WEBHOOK_SECRET`. Run `npx prisma migrate deploy` once after
   the first deploy (Railway "Deploy Command" or a one-off shell).
5. **worker**: deploy `docker/Dockerfile.worker` (installs `ffmpeg` in the
   image — this is why it's a separate Dockerfile from `api`). Same
   `DATABASE_URL`/`REDIS_URL`/`AUTOMATION_SECRET_KEY` as `api`. Add
   `STORAGE_PUBLIC_BASE_URL` once you attach a persistent volume or object
   storage (local disk on Railway does **not** survive a redeploy —
   generated videos would be lost; see `ARCHITECTURE.md` "Storage").
6. **web**: deploy `docker/Dockerfile.web` with build arg
   `NEXT_PUBLIC_AUTOMATION_API_URL` set to the `api` service's public URL.

## Order matters on first deploy

Postgres → run `prisma migrate deploy` → api → worker → web → n8n (any
order relative to the others, but nothing depends on it existing yet).
Configure the `n8n` integration in the Control Center only once the n8n
service itself is reachable and its API key exists.

## Rollback

Every service is stateless except Postgres/Redis/n8n's own volume — redeploy
a previous image tag for `api`/`worker`/`web` with no data migration needed
(no destructive migrations exist in `api/prisma/migrations`). Database
rollback is out of scope for this pass; back up the Railway Postgres plugin
before running a new migration, same practice as any other project here.
