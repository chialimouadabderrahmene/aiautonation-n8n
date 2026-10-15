#!/usr/bin/env bash
# Logical backup of the whole native Control Center database (public schema:
# integrations, encrypted credentials, jobs, audit log, workflows and usage).
#
#   DATABASE_URL=postgresql://user:pass@host:port/db bash scripts/backup-db.sh [output-dir]
#
# On Railway the database is private; run this with the Postgres service's
# public URL while its TCP proxy is temporarily enabled, or from `railway run`.
# Produces a compressed custom-format dump restorable with scripts/restore-db.sh.
#
# The dump contains credentials encrypted with AUTOMATION_SECRET_KEY. Keep
# that key backed up separately — a restore is only useful with the same key.
set -euo pipefail
: "${DATABASE_URL:?set DATABASE_URL}"
OUT_DIR="${1:-./backups}"
mkdir -p "$OUT_DIR"
FILE="$OUT_DIR/eki-automation-$(date -u +%Y%m%dT%H%M%SZ).dump"
# Prisma-style ?schema=... query parameters are not understood by libpq.
URL="${DATABASE_URL%%\?*}"
pg_dump "$URL" --format=custom --no-owner --no-privileges --file "$FILE"
pg_restore --list "$FILE" > /dev/null   # integrity check: the archive is readable
echo "Backup written: $FILE ($(du -h "$FILE" | cut -f1))"
