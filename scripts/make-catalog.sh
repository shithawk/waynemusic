#!/bin/bash
# Rebuild ~/Music/WaynesMusic/catalog.json from the MP3s in that folder.
# Copies the three starter recordings once, if they are not already there.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${HOME}/Music/WaynesMusic"
mkdir -p "$DEST"

for file in PreludeInCMajor.mp3 Badinerie.mp3 Contrapunctus1.mp3; do
  if [[ ! -e "$DEST/$file" ]]; then
    cp "$ROOT/WayneMusic/BundledMusic/$file" "$DEST/$file"
  fi
done

python3 - "$DEST" <<'PY'
import json
import re
import subprocess
import sys
from pathlib import Path

dest = Path(sys.argv[1])
extensions = {".mp3", ".m4a", ".aac", ".wav"}
known = {
    "PreludeInCMajor": ("Prelude in C Major", "Johann Sebastian Bach"),
    "Badinerie": ("Badinerie", "Johann Sebastian Bach"),
    "Contrapunctus1": ("Contrapunctus 1", "Johann Sebastian Bach"),
}

def mdls(path, name):
    try:
        value = subprocess.check_output(
            ["mdls", "-name", name, "-raw", str(path)],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return ""
    if value in {"", "(null)"}:
        return ""
    quoted = re.findall(r'"([^"]*)"', value)
    if quoted:
        return quoted[0].strip()
    return value.strip().strip('"')

songs = []
for path in sorted(dest.iterdir()):
    if not path.is_file() or path.suffix.lower() not in extensions:
        continue
    stem = path.stem
    title = mdls(path, "kMDItemTitle")
    artist = mdls(path, "kMDItemAuthors")
    fallback = known.get(stem)
    if not title:
        title = fallback[0] if fallback else stem.replace("_", " ").replace("-", " ").strip() or "Song"
    if not artist and fallback:
        artist = fallback[1]
    songs.append({
        "id": path.name,
        "title": title,
        "artist": artist,
        "file": path.name,
        "bytes": path.stat().st_size,
    })

songs.sort(key=lambda song: (song["title"].casefold(), song["file"].casefold()))
payload = json.dumps(songs, indent=2, ensure_ascii=False) + "\n"
tmp = dest / "catalog.json.tmp"
tmp.write_text(payload, encoding="utf-8")
tmp.replace(dest / "catalog.json")
print(f"Wrote {len(songs)} songs to {dest / 'catalog.json'}")
PY
