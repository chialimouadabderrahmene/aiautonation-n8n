#!/usr/bin/env bash
# Start a FRESH local staging stack (mock + n8n): import credentials + ALL workflows, publish the webhook workflows.
# Usage: staging/scripts/up.sh                                   (AUTOPILOT_SOCIAL_POSTING=false, the production default)
#        AUTOPILOT_SOCIAL_POSTING=true staging/scripts/up.sh     (mock-only test of the Buffer/X posting branch)
set -eu
export MSYS_NO_PATHCONV=1   # Git Bash on Windows must not rewrite /import/... container paths
cd "$(dirname "$0")/.."
bash scripts/gen-cert.sh
export LAUNCH_DATE="${LAUNCH_DATE:-$(date -u -d '4 days ago' +%F)}"
DC="docker compose -f docker-compose.staging.yml"

$DC down --remove-orphans >/dev/null 2>&1 || true
rm -rf data/n8n
mkdir -p data/n8n data/sched
$DC up -d --force-recreate mock

# Import BEFORE the server starts so the DB is migrated exactly once (a concurrent CLI + server start corrupts the migration).
$DC run --rm -T --no-deps n8n import:credentials --input=/import/credentials.json 2>&1 | grep -Ei "success|error|imported" || true
$DC run --rm -T --no-deps n8n import:workflow --separate --input=/workflows 2>&1 | grep -Ei "success|error|imported|not " || true
# Webhook-triggered workflows must be published so their production URLs are registered.
for id in ekiwf00 ekiwf02 ekiwf03 ekiwf04 ekiwf07 ekiwf08 ekiwf13 ekiwf17 ekiwf18 ekiwf21; do
  $DC run --rm -T --no-deps n8n publish:workflow --id="$id" 2>&1 | grep -Ei "error|publish" | head -2 || true
done

$DC up -d n8n
echo "waiting for n8n..."
for i in $(seq 1 120); do
  if curl -fs http://localhost:5678/healthz/readiness >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -fs http://localhost:5678/healthz/readiness >/dev/null || { echo "n8n did not become ready"; $DC logs n8n | tail -30; exit 1; }
echo "staging ready: n8n http://localhost:5678  mock http://localhost:9099/__control/health  LAUNCH_DATE=$LAUNCH_DATE"
