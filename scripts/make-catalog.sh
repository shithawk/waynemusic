#!/bin/bash
# Rebuild music/catalog.json from the audio files in music/.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/music"
mkdir -p "$DEST"

python3 - "$DEST" <<'PY'
import json
import re
import subprocess
import sys
from pathlib import Path

dest = Path(sys.argv[1])
extensions = {".mp3", ".m4a", ".aac", ".wav"}

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

def syncsafe(data, offset):
    return ((data[offset] & 0x7F) << 21) | ((data[offset + 1] & 0x7F) << 14) | ((data[offset + 2] & 0x7F) << 7) | (data[offset + 3] & 0x7F)

def be32(data, offset):
    return int.from_bytes(data[offset:offset + 4], "big")

def decode_text(frame):
    if not frame:
        return ""
    encoding = frame[0]
    raw = frame[1:]
    if encoding == 0:
        text = raw.split(b"\x00", 1)[0].decode("latin1", "replace")
    elif encoding == 1:
        text = raw.decode("utf-16", "replace")
    elif encoding == 2:
        text = raw.decode("utf-16-be", "replace")
    else:
        text = raw.split(b"\x00", 1)[0].decode("utf-8", "replace")
    return text.replace("\x00", "").strip()

def id3(path):
    title = ""
    artist = ""
    try:
        with path.open("rb") as handle:
            head = handle.read(256 * 1024)
            tail = b""
            handle.seek(0, 2)
            size = handle.tell()
            if size >= 128:
                handle.seek(size - 128)
                tail = handle.read(128)
    except OSError:
        return title, artist
    if head[:3] == b"ID3" and len(head) >= 10:
        version = head[3]
        offset = 10
        tag_size = syncsafe(head, 6)
        if head[5] & 0x40 and offset + 4 <= len(head):
            extended = syncsafe(head, offset) if version == 4 else be32(head, offset)
            offset += extended if version == 4 else extended + 4
        end = min(len(head), 10 + tag_size)
        while offset + 10 < end:
            frame_id = head[offset:offset + 4]
            if not frame_id or frame_id[:1] == b"\x00":
                break
            frame_size = syncsafe(head, offset + 4) if version == 4 else be32(head, offset + 4)
            start = offset + 10
            if frame_size <= 0 or start + frame_size > len(head):
                break
            name = frame_id.decode("latin1", "replace")
            if name in {"TIT2", "TPE1"}:
                text = decode_text(head[start:start + frame_size])
                if name == "TIT2":
                    title = text
                else:
                    artist = text
            offset = start + frame_size
    if tail[:3] == b"TAG":
        if not title:
            title = tail[3:33].decode("latin1", "replace").replace("\x00", "").strip()
        if not artist:
            artist = tail[33:63].decode("latin1", "replace").replace("\x00", "").strip()
    return title, artist

songs = []
for path in sorted(dest.iterdir()):
    if not path.is_file() or path.suffix.lower() not in extensions:
        continue
    stem = path.stem
    title, artist = id3(path)
    if not title:
        title = mdls(path, "kMDItemTitle")
    if not artist:
        artist = mdls(path, "kMDItemAuthors")
    if not title and " - " in stem:
        artist_part, title_part = stem.split(" - ", 1)
        title = title_part.strip()
        if not artist:
            artist = artist_part.strip()
    if not title:
        title = stem.replace("_", " ").strip() or "Song"
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
