#!/bin/bash
# Shared suggest API (Last.fm + SoundCloud) hosted with Jacob's Music on :8096.
set -euo pipefail
JACOB="/Users/jacobward/jacobsmusic"
exec bash "$JACOB/scripts/ensure-suggest-api.sh"
