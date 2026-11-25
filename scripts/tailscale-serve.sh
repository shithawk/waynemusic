#!/bin/bash
# Expose Wayne's Music on Tailscale (tailnet only).
#   Wayne's → https://<machine>.<tailnet>.ts.net:8443/  (Caddy :8091)
# Also keeps Jori on HTTPS / if his Caddy is up (:8090).
# Note: Caddy `root * web` is relative to process cwd — always start from the app root.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
JORI="$(cd "$ROOT/../jorismusic" 2>/dev/null && pwd || true)"

echo "Tailscale Serve: Wayne's on :8091 (HTTPS :8443)"
if [[ -n "$JORI" ]]; then
  tailscale serve --bg http://127.0.0.1:8090 >/dev/null 2>&1 || true
fi
tailscale serve --bg --https=8443 "http://127.0.0.1:8091"
tailscale serve status

if ! lsof -iTCP:8091 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Starting Caddy for Wayne's (8091)…"
  mkdir -p "$ROOT/caddy-data"
  (
    cd "$ROOT"
    nohup caddy run --config "$ROOT/Caddyfile" >>"$ROOT/caddy-data/caddy.log" 2>&1 &
    echo $! >"$ROOT/caddy-data/caddy.pid"
  )
  sleep 1
fi

if [[ -n "$JORI" ]] && ! lsof -iTCP:8090 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Starting Caddy for Jori's (8090)…"
  mkdir -p "$JORI/caddy-data"
  (
    cd "$JORI"
    nohup caddy run --config "$JORI/Caddyfile" >>"$JORI/caddy-data/caddy.log" 2>&1 &
    echo $! >"$JORI/caddy-data/caddy.pid"
  )
fi

DNS="$(tailscale status --json 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))' 2>/dev/null || true)"
if [[ -n "$DNS" ]]; then
  echo ""
  echo "Wayne's: https://${DNS}:8443/"
fi
