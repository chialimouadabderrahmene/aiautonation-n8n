#!/usr/bin/env bash
# Generates the throw-away self-signed TLS cert used by the staging mock (never used outside staging).
set -eu
DIR="$(cd "$(dirname "$0")/.." && pwd)/mock/certs"
mkdir -p "$DIR"
if [ ! -f "$DIR/cert.pem" ]; then
  MSYS_NO_PATHCONV=1 openssl req -x509 -newkey rsa:2048 -nodes -keyout "$DIR/key.pem" -out "$DIR/cert.pem" -days 30 -subj "/CN=eki-staging-mock" >/dev/null 2>&1 || { echo "openssl failed"; exit 1; }
  echo "generated $DIR/cert.pem"
fi
