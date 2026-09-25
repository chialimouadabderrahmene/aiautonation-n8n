#!/usr/bin/env bash
# Re-import the workflow JSON files into the RUNNING staging n8n, re-publish the webhook workflows
# (+ the global error handler, which must be active for n8n to call it) and restart n8n so the changes take effect.
set -eu
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/.."
export LAUNCH_DATE="${LAUNCH_DATE:-$(date -u -d '4 days ago' +%F)}"
DC="docker compose -f docker-compose.staging.yml"
$DC exec -T n8n n8n import:workflow --separate --input=/workflows 2>&1 | grep -E "Successfully|rror" || true
for id in ekiwf00 ekiwf02 ekiwf03 ekiwf04 ekiwf07 ekiwf08 ekiwf13 ekiwf17 ekiwf18 ekiwf21; do
  $DC exec -T n8n n8n publish:workflow --id="$id" 2>&1 | grep -E "rror" || true
done
$DC restart n8n >/dev/null 2>&1
for i in $(seq 1 90); do curl -fs http://localhost:5678/healthz/readiness >/dev/null 2>&1 && break; sleep 2; done
curl -fs http://localhost:5678/healthz/readiness >/dev/null && echo "staging n8n reloaded" || { echo "n8n not ready"; exit 1; }
