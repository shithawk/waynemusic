#!/bin/bash
# Quick syntax gate for PWA assets (run before deploy).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

node --check web/app.js
node --check web/sw.js

for f in scripts/*.sh; do
  [[ -f "$f" ]] || continue
  bash -n "$f"
done

if [[ -f Caddyfile ]]; then
  caddy validate --config Caddyfile >/dev/null
fi

echo "Syntax OK: $ROOT"