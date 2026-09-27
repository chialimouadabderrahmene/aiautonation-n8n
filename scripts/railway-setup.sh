#!/usr/bin/env bash
# One-time Railway provisioning for the Eki AI Automation Control Center.
#
# Run ONCE by the technical person doing the initial deployment, with the
# Railway CLI (v4+) logged in (`railway login`) and this repository pushed to
# GitHub. After this, the client never touches Railway for normal operation.
#
#   RAILWAY_PROJECT_NAME=eki-automation \
#   GITHUB_REPO=owner/repo \
#   ADMIN_EMAIL=you@company.com \
#   bash scripts/railway-setup.sh
#
# What it creates (see docs/DEPLOYMENT.md for the dashboard equivalent):
#   Postgres (private) · Redis (private) · api (private) · worker (private)
#   n8n (public editor + webhooks, persistent volume) · web (public)
# It prints the generated admin/n8n-owner passwords ONCE — store them in a
# password manager. Secrets are generated locally with openssl and sent only
# to Railway's variable store.
#
# Not executed from this repository's sandbox (no Railway account/token was
# available there) — review each command before running it.
set -euo pipefail

: "${GITHUB_REPO:?set GITHUB_REPO=owner/repo}"
: "${ADMIN_EMAIL:?set ADMIN_EMAIL}"
PROJECT="${RAILWAY_PROJECT_NAME:-eki-automation}"
command -v railway >/dev/null || { echo "Install the Railway CLI: https://docs.railway.com/guides/cli"; exit 1; }
command -v openssl >/dev/null || { echo "openssl is required"; exit 1; }

hex() { openssl rand -hex 32; }
password() { echo "Eki-$(openssl rand -base64 18 | tr -dc 'A-Za-z0-9' | head -c 20)9Z"; }

AUTOMATION_SECRET_KEY=$(hex)
JWT_SECRET=$(hex)
INTERNAL_API_TOKEN=$(hex)
N8N_ENCRYPTION_KEY=$(hex)
ADMIN_PASSWORD=$(password)
N8N_OWNER_PASSWORD=$(password)

echo "==> Creating project $PROJECT"
railway init --name "$PROJECT"

echo "==> Databases (private networking only — no public TCP proxy is added)"
railway add --database postgres
railway add --database redis

echo "==> Shared secrets (referenced as \${{shared.NAME}} by the services)"
railway variables --set "AUTOMATION_SECRET_KEY=$AUTOMATION_SECRET_KEY" \
                  --set "JWT_SECRET=$JWT_SECRET" \
                  --set "INTERNAL_API_TOKEN=$INTERNAL_API_TOKEN" \
                  --set "N8N_ENCRYPTION_KEY=$N8N_ENCRYPTION_KEY" \
                  --shared 2>/dev/null || {
  echo "!! This CLI version cannot set shared variables; set the four values above as Shared Variables in the dashboard."
}

for svc in api worker web n8n; do
  echo "==> Service $svc"
  railway add --service "$svc" --repo "$GITHUB_REPO"
done

echo "==> Public domains (web + n8n only)"
railway domain --service web
railway domain --service n8n

echo "==> n8n persistent volume"
railway volume add --service n8n --mount-path /home/node/.n8n

echo "==> Variables: api"
railway variables --service api \
  --set 'RAILWAY_DOCKERFILE_PATH=docker/Dockerfile.api' \
  --set 'PORT=4100' --set 'INTERNAL_PORT=4110' \
  --set 'DATABASE_URL=${{Postgres.DATABASE_URL}}' \
  --set 'REDIS_URL=${{Redis.REDIS_URL}}' \
  --set 'AUTOMATION_SECRET_KEY=${{shared.AUTOMATION_SECRET_KEY}}' \
  --set 'JWT_SECRET=${{shared.JWT_SECRET}}' \
  --set 'INTERNAL_API_TOKEN=${{shared.INTERNAL_API_TOKEN}}' \
  --set "ADMIN_BOOTSTRAP_EMAIL=$ADMIN_EMAIL" \
  --set "ADMIN_BOOTSTRAP_PASSWORD=$ADMIN_PASSWORD" \
  --set 'PUBLIC_WEB_URL=https://${{web.RAILWAY_PUBLIC_DOMAIN}}' \
  --set 'WEB_ORIGIN=https://${{web.RAILWAY_PUBLIC_DOMAIN}}' \
  --set 'N8N_INTERNAL_URL=http://${{n8n.RAILWAY_PRIVATE_DOMAIN}}:5678' \
  --set 'N8N_PUBLIC_URL=https://${{n8n.RAILWAY_PUBLIC_DOMAIN}}' \
  --set 'N8N_SUPERVISOR_URL=http://${{n8n.RAILWAY_PRIVATE_DOMAIN}}:5690' \
  --set "N8N_OWNER_EMAIL=$ADMIN_EMAIL" \
  --set "N8N_OWNER_PASSWORD=$N8N_OWNER_PASSWORD"

echo "==> Variables: worker"
railway variables --service worker \
  --set 'RAILWAY_DOCKERFILE_PATH=docker/Dockerfile.worker' \
  --set 'PORT=4101' \
  --set 'DATABASE_URL=${{Postgres.DATABASE_URL}}' \
  --set 'REDIS_URL=${{Redis.REDIS_URL}}' \
  --set 'AUTOMATION_SECRET_KEY=${{shared.AUTOMATION_SECRET_KEY}}' \
  --set 'VIDEO_WORKER_CONCURRENCY=1'

echo "==> Variables: web"
railway variables --service web \
  --set 'RAILWAY_DOCKERFILE_PATH=docker/Dockerfile.web' \
  --set 'PORT=3200' \
  --set 'API_INTERNAL_URL=http://${{api.RAILWAY_PRIVATE_DOMAIN}}:4100'

echo "==> Variables: n8n"
railway variables --service n8n \
  --set 'RAILWAY_DOCKERFILE_PATH=docker/Dockerfile.n8n' \
  --set 'PORT=5678' \
  --set 'RAILWAY_RUN_UID=0' \
  --set 'DB_TYPE=postgresdb' \
  --set 'DB_POSTGRESDB_HOST=${{Postgres.PGHOST}}' \
  --set 'DB_POSTGRESDB_PORT=${{Postgres.PGPORT}}' \
  --set 'DB_POSTGRESDB_DATABASE=${{Postgres.PGDATABASE}}' \
  --set 'DB_POSTGRESDB_USER=${{Postgres.PGUSER}}' \
  --set 'DB_POSTGRESDB_PASSWORD=${{Postgres.PGPASSWORD}}' \
  --set 'DB_POSTGRESDB_SCHEMA=n8n' \
  --set 'N8N_ENCRYPTION_KEY=${{shared.N8N_ENCRYPTION_KEY}}' \
  --set 'N8N_HOST=${{RAILWAY_PUBLIC_DOMAIN}}' \
  --set 'N8N_PROTOCOL=https' \
  --set 'N8N_PROXY_HOPS=1' \
  --set 'N8N_EDITOR_BASE_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}/' \
  --set 'N8N_WEBHOOK_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}/' \
  --set 'WEBHOOK_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}/' \
  --set 'CONTROL_CENTER_INTERNAL_URL=http://${{api.RAILWAY_PRIVATE_DOMAIN}}:4110' \
  --set 'INTERNAL_API_TOKEN=${{shared.INTERNAL_API_TOKEN}}'

cat <<EOT

==> Remaining one-time dashboard steps (Railway does not expose these in the CLI yet):
  1. Project → New → Bucket (name it e.g. "media"). Then on the api AND worker services add:
       STORAGE_DRIVER=s3
       S3_ENDPOINT=<bucket endpoint>   S3_REGION=<bucket region>   S3_BUCKET=<bucket name>
       S3_ACCESS_KEY_ID=<access key>   S3_SECRET_ACCESS_KEY=<secret key>
     (reference them from the bucket's Credentials tab, e.g. \${{media.ENDPOINT}}).
     Any S3-compatible bucket works (Cloudflare R2, AWS S3) with the same five values.
  2. For each of api/worker/web/n8n: Settings → Config-as-code → /railway/<service>.json
     (healthchecks + restart policy + watch paths).
  3. Deploy. The API applies migrations, creates the admin account, connects n8n,
     imports the 22 workflows (inactive) — no further steps.

Store these now (shown once):
  Control Center login : $ADMIN_EMAIL / $ADMIN_PASSWORD
  n8n owner login      : $ADMIN_EMAIL / $N8N_OWNER_PASSWORD
  Back up AUTOMATION_SECRET_KEY and N8N_ENCRYPTION_KEY from Railway's shared variables:
  losing them makes every stored credential unreadable.
EOT
