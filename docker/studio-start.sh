#!/bin/bash
# Runs web, API and worker together. If any one of them stops, the whole container exits so
# the platform restarts it, rather than leaving a half-working product that looks healthy.
set -e

PUBLIC_PORT="${PORT:-3200}"
export PUBLIC_WEB_URL="${PUBLIC_WEB_URL:-${RENDER_EXTERNAL_URL:-${RAILWAY_PUBLIC_DOMAIN:+https://$RAILWAY_PUBLIC_DOMAIN}}}"
export WEB_ORIGIN="${WEB_ORIGIN:-$PUBLIC_WEB_URL}"

cd /app/api
attempt=1
until node node_modules/prisma/build/index.js migrate deploy; do
  if [ "$attempt" -ge 15 ]; then
    echo "[studio] database migrations failed after $attempt attempts, giving up" >&2
    exit 1
  fi
  echo "[studio] database not ready (attempt $attempt), retrying in 4s" >&2
  attempt=$((attempt + 1))
  sleep 4
done

(cd /app/api && PORT=4100 exec node dist/server.js) &
(cd /app/worker && WORKER_HEALTH_PORT=4101 exec node dist/index.js) &
(cd /app/web && PORT="$PUBLIC_PORT" HOSTNAME=0.0.0.0 API_INTERNAL_URL=http://127.0.0.1:4100 exec node server.js) &

trap 'kill 0' TERM INT
wait -n
status=$?
echo "[studio] a process stopped with status $status, restarting the container" >&2
kill 0
exit "$status"
