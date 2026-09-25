#!/usr/bin/env bash
set -eu
export MSYS_NO_PATHCONV=1   # Git Bash on Windows must not rewrite /import/... container paths
cd "$(dirname "$0")/.."
LAUNCH_DATE=unused docker compose -f docker-compose.staging.yml down
