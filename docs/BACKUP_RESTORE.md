# Backup and restore

## What holds state

| Store | Contents | Backed up by |
|---|---|---|
| Postgres schema `public` | integrations + **encrypted** credentials, workflow state, executions, video jobs, approvals, publications, settings, audit log | database dump |
| Postgres schema `n8n` | n8n workflows, n8n credentials (encrypted with `N8N_ENCRYPTION_KEY`), execution history | database dump (same one) |
| Bucket | generated videos, scene clips, voice files, music library | bucket versioning / provider snapshots, or `rclone sync` |
| Redis | only in-flight queue entries | not needed — jobs are also in Postgres; a lost queue entry is re-run with **Retry** |
| n8n volume | n8n local config/cache | not needed (config is in env + Postgres) |
| Railway variables | `AUTOMATION_SECRET_KEY`, `N8N_ENCRYPTION_KEY`, `JWT_SECRET`, `INTERNAL_API_TOKEN` | **copy into a password manager at deployment time** |

A database backup is only useful together with the two encryption keys.

## Automatic backups

Enable Railway's scheduled backups on the Postgres service (Postgres →
Backups). Keep at least 7 daily copies.

## Manual backup (logical, both schemas)

```bash
# Temporarily enable the Postgres TCP proxy (or run inside `railway run`), then:
DATABASE_URL="$DATABASE_PUBLIC_URL" bash scripts/backup-db.sh ./backups
# → backups/eki-automation-<UTC timestamp>.dump   (custom format, integrity-checked)
```
Disable the TCP proxy again afterwards.

## Restore

1. Stop **api**, **worker** and **n8n** (Railway: remove replicas / pause).
2. Restore into an **empty** database (a new Postgres service, or the same one
   with `FORCE_RESTORE=1`):
   ```bash
   TARGET_DATABASE_URL=postgresql://... bash scripts/restore-db.sh backups/eki-automation-....dump
   ```
3. Point `DATABASE_URL` / `DB_POSTGRESDB_*` at it if it is a new service; keep
   the **same** `AUTOMATION_SECRET_KEY` and `N8N_ENCRYPTION_KEY`.
4. Start the services. The API applies any newer migrations, verifies the
   tables, reconnects to n8n with the stored key and reconciles the 22
   workflows (no duplicates; only workflows enabled in the Control Center stay
   active).
5. Run `node scripts/smoke-test.mjs` against the web URL.

## Verified

Drill performed on the local stack (same images, Postgres 16):
`backup-db.sh` → 760 KB dump; `restore-db.sh` into a fresh Postgres → 17
Control Center tables + 22 n8n workflows; the API image against the restored
database reported `migrate status: up to date`, 15 integrations (7 connected),
the Telegram bot token decrypted with the same key, 22 workflow links, 5 ready
videos. (Railway's own scheduled backups were not exercised — no Railway
project was available.)
