#!/usr/bin/env bash
# Restores a dump made by scripts/backup-db.sh into an EMPTY database.
#
#   TARGET_DATABASE_URL=postgresql://user:pass@host:port/db bash scripts/restore-db.sh backups/eki-automation-....dump
#
# Procedure (docs/BACKUP_RESTORE.md): stop api, worker and n8n → restore →
# start them again with the SAME AUTOMATION_SECRET_KEY and N8N_ENCRYPTION_KEY.
# The API then re-verifies every table, reconnects to n8n and reconciles the
# 22 workflows (no duplicates, nothing activated that was not enabled).
set -euo pipefail
: "${TARGET_DATABASE_URL:?set TARGET_DATABASE_URL}"
DUMP="${1:?path to .dump file}"
URL="${TARGET_DATABASE_URL%%\?*}"
EXISTING=$(psql "$URL" -tAc "select count(*) from information_schema.tables where table_schema in ('public','n8n')")
if [ "$EXISTING" != "0" ] && [ "${FORCE_RESTORE:-}" != "1" ]; then
  echo "Target database is not empty ($EXISTING tables). Restore into a fresh database, or set FORCE_RESTORE=1 to use --clean." >&2
  exit 1
fi
pg_restore --dbname "$URL" --no-owner --no-privileges ${FORCE_RESTORE:+--clean --if-exists} --exit-on-error "$DUMP"
echo "Restored $DUMP"
psql "$URL" -tAc "select 'control-center tables: ' || count(*) from information_schema.tables where table_schema='public'"
psql "$URL" -tAc "select 'n8n workflows: ' || count(*) from n8n.workflow_entity" 2>/dev/null || true
