#!/usr/bin/env bash
# Restart ONLY the staging n8n container with a different autopilot configuration (data volume is kept).
# Usage: staging/scripts/stage.sh default | posting-on | stop-on
set -eu
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/.."
export LAUNCH_DATE="${LAUNCH_DATE:-$(date -u -d '4 days ago' +%F)}"
case "${1:-default}" in
  default)    export AUTOPILOT_SOCIAL_POSTING=false AUTOPILOT_STOP=false ;;
  posting-on) export AUTOPILOT_SOCIAL_POSTING=true  AUTOPILOT_STOP=false ;;
  stop-on)    export AUTOPILOT_SOCIAL_POSTING=false AUTOPILOT_STOP=true ;;
  *) echo "usage: $0 default|posting-on|stop-on"; exit 2 ;;
esac
mkdir -p data/sched
docker compose -f docker-compose.staging.yml up -d --force-recreate n8n >/dev/null 2>&1
for i in $(seq 1 90); do curl -fs http://localhost:5678/healthz/readiness >/dev/null 2>&1 && break; sleep 2; done
curl -fs http://localhost:5678/healthz/readiness >/dev/null && echo "stage '$1' ready (AUTOPILOT_SOCIAL_POSTING=$AUTOPILOT_SOCIAL_POSTING AUTOPILOT_STOP=$AUTOPILOT_STOP)" || { echo "n8n not ready"; exit 1; }
