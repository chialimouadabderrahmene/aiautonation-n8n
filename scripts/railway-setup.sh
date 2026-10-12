#!/usr/bin/env bash
# Railway provisioning + deployment for the Eki AI Automation Control Center.
#
# Thin wrapper around scripts/railway-deploy.mjs (the tested, idempotent
# implementation — see its header for every option). Run from the repository
# root with the Railway CLI v5+ logged in:
#
#   railway login
#   railway link                       # or pass --init "Eki AI Automation"
#   ADMIN_EMAIL=you@company.com BUCKET_REGION=ams bash scripts/railway-setup.sh
#
# Creates what is missing (never duplicates): Postgres, Redis, a Bucket, and the
# services api, worker, n8n, web; wires every variable; deploys in order
# (api → worker → n8n → web) stopping with logs on any failure; then verifies
# health, the 22 workflows in n8n, FFmpeg on the worker, security and runs the
# smoke test. Secrets are generated locally and sent via stdin, never printed.
# Safe to re-run: existing secrets are reused, never rotated.
set -euo pipefail
cd "$(dirname "$0")/.."
command -v railway >/dev/null || [ -n "${RAILWAY_CLI:-}" ] || { echo "Install the Railway CLI (v5+): https://docs.railway.com/guides/cli (or set RAILWAY_CLI)"; exit 1; }
command -v node >/dev/null || { echo "Node.js 20+ is required"; exit 1; }
exec node scripts/railway-deploy.mjs "$@"
