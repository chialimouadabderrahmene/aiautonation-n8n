#!/bin/sh
# API start-up: apply database migrations (idempotent; Prisma takes an
# advisory lock so parallel replicas are safe), then start the server.
# The server itself verifies every required table before accepting traffic.
set -e
attempt=1
until node node_modules/prisma/build/index.js migrate deploy; do
  if [ "$attempt" -ge 15 ]; then
    echo "[entrypoint] migrations failed after $attempt attempts — giving up" >&2
    exit 1
  fi
  echo "[entrypoint] database not ready or migration failed (attempt $attempt), retrying in 4s" >&2
  attempt=$((attempt + 1))
  sleep 4
done
exec node dist/server.js
