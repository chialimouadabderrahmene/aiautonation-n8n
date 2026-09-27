# Deployment

Four independent services. None of this touches the Eki marketplace's
Vercel projects, database, or domains.

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
