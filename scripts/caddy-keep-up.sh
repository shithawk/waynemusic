#!/bin/bash
# Keep Wayne's Music Caddy on :8091 and Tailscale HTTPS :8443 pointed at it.
# WorkingDirectory must be waynesmusic (LaunchAgent sets it) so relative roots work.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$ROOT/caddy-data"
bash "$ROOT/scripts/ensure-suggest-api.sh" >/dev/null 2>&1 || true
cd "$ROOT"

# Ensure Tailscale Serve proxies here. Ignore failures if Tailscale is off.
tailscale serve --bg --https=8443 http://127.0.0.1:8091 >/dev/null 2>&1 || true

exec /usr/bin/caffeinate -is /opt/homebrew/bin/caddy run --config "$ROOT/Caddyfile"
