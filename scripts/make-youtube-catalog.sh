#!/bin/bash
# Build youtube/catalog.json from youtube/videos.txt (YouTube or SoundCloud, one per line).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/youtube/videos.txt"
OUT_DIR="$ROOT/youtube"
mkdir -p "$OUT_DIR"

FETCH_OEMBED="${FETCH_OEMBED:-1}"

python3 - "$SRC" "$OUT_DIR/catalog.json" "$FETCH_OEMBED" <<'PY'
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

src = Path(sys.argv[1])
dest = Path(sys.argv[2])
fetch_oembed = sys.argv[3] not in {"0", "false", "False", "no"}

def youtube_id_from_text(line: str):
    raw = line.strip()
    if not raw:
        return None
    if re.fullmatch(r"[A-Za-z0-9_-]{6,20}", raw):
        return raw
    match = re.search(r"https?://[^\s]+", raw, re.I)
    candidate = match.group(0).rstrip("),.;") if match else ("https://" + raw if "://" not in raw else raw)
    try:
        url = urllib.parse.urlparse(candidate)
    except ValueError:
        return None
    host = (url.hostname or "").lower()
    if host in {"youtu.be"} or host.endswith(".youtu.be"):
        part = url.path.strip("/").split("/")[0] if url.path else ""
        return sanitize_id(part)
    if "youtube.com" not in host and "youtube-nocookie.com" not in host:
        return None
    q = urllib.parse.parse_qs(url.query).get("v", [""])[0]
    if q:
        return sanitize_id(q)
    parts = [p for p in url.path.split("/") if p]
    for marker in ("embed", "shorts", "live", "v"):
        if marker in parts:
            idx = parts.index(marker)
            if idx + 1 < len(parts):
                return sanitize_id(parts[idx + 1])
    return None

def sanitize_id(raw: str):
    raw = (raw or "").strip()
    if re.fullmatch(r"[A-Za-z0-9_-]{6,20}", raw):
        return raw
    return None

def soundcloud_url_from_text(line: str):
    raw = line.strip()
    if not raw:
        return None
    match = re.search(r"https?://[^\s]+", raw, re.I)
    candidate = match.group(0).rstrip("),.;") if match else ""
    if not candidate:
        return None
    try:
        url = urllib.parse.urlparse(candidate)
    except ValueError:
        return None
    host = (url.hostname or "").lower()
    if host.startswith("www."):
        host = host[4:]
    path = (url.path or "").rstrip("/")
    if not path.strip("/"):
        return None
    if host in {"soundcloud.com", "m.soundcloud.com"}:
        return "https://soundcloud.com" + path
    if host == "on.soundcloud.com":
        return "https://on.soundcloud.com" + path
    return None

def media_token(part: str):
    return youtube_id_from_text(part) or soundcloud_url_from_text(part)

def split_artist_title(text: str) -> tuple[str, str]:
    text = (text or "").strip()
    if not text:
        return "", ""
    parts = re.split(r"\s+[-–—]\s+", text, maxsplit=1)
    if len(parts) == 2 and parts[0].strip() and parts[1].strip():
        return parts[0].strip(), parts[1].strip()
    return "", text

def parse_manual_labels(line: str) -> tuple[str, str, str]:
    """Return (url_part, artist, title). Empty artist/title if not set."""
    stripped = line.strip()
    artist = ""
    title = ""
    url_part = stripped

    if "\t" in stripped:
        cols = [c.strip() for c in stripped.split("\t") if c.strip()]
        if len(cols) >= 3 and media_token(cols[0]):
            return cols[0], cols[1], cols[2]
        if len(cols) >= 3 and media_token(cols[-1]):
            return cols[-1], cols[0], cols[1]

    if "|" not in stripped:
        return url_part, artist, title

    parts = [p.strip() for p in stripped.split("|") if p.strip()]
    if len(parts) == 1:
        return url_part, artist, title

    url_idx = next((i for i, p in enumerate(parts) if media_token(p)), None)
    if url_idx is None:
        return url_part, artist, title

    url_part = parts[url_idx]
    rest = [parts[i] for i in range(len(parts)) if i != url_idx]

    if len(rest) >= 2:
        artist, title = rest[0], rest[1]
    elif len(rest) == 1:
        artist, title = split_artist_title(rest[0])
    return url_part, artist, title

def soundcloud_oembed(page: str) -> tuple[str, str]:
    url = "https://soundcloud.com/oembed?format=json&url=" + urllib.parse.quote(page, safe="")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, json.JSONDecodeError, TimeoutError, OSError):
        return "SoundCloud", ""
    title = str(data.get("title") or "").strip() or "SoundCloud"
    artist = str(data.get("author_name") or "").strip()
    return title, artist

def oembed_meta(video_id: str) -> tuple[str, str]:
    page = "https://www.youtube.com/watch?v=" + urllib.parse.quote(video_id, safe="")
    url = "https://www.youtube.com/oembed?format=json&url=" + urllib.parse.quote(page, safe="")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, json.JSONDecodeError, TimeoutError, OSError):
        return "YouTube video", ""
    title = str(data.get("title") or "").strip() or "YouTube video"
    artist = str(data.get("author_name") or "").strip()
    return title, artist

def parse_names(title: str, artist: str) -> tuple[str, str]:
    raw = re.sub(r"\s+", " ", title or "").strip()
    if not raw:
        return "YouTube video", artist
    pieces = re.split(r"\s+[-–—]\s+", raw, maxsplit=1)
    if len(pieces) == 2:
        left, right = pieces[0].strip(), pieces[1].split("|")[0].strip()
        if left and right:
            channel = artist.lower()
            if channel and right.lower() == channel:
                return left, right
            return right, left
    return raw.split("|")[0].strip() or "YouTube video", artist

lines = src.read_text(encoding="utf-8").splitlines() if src.is_file() else []
seen: set[str] = set()
entries = []
for line in lines:
    stripped = line.strip()
    if not stripped or stripped.startswith("#"):
        continue
    url_part, manual_artist, manual_title = parse_manual_labels(stripped)
    vid = youtube_id_from_text(url_part)
    soundcloud = None if vid else soundcloud_url_from_text(url_part)
    key = vid or soundcloud
    if not key or key in seen:
        continue
    seen.add(key)

    title = (manual_title or "").strip()
    artist = (manual_artist or "").strip()

    if vid:
        if not title and fetch_oembed:
            t, a = oembed_meta(vid)
            title, artist = parse_names(t, a)
        if not title:
            title = "YouTube video"
        entries.append({
            "videoId": vid,
            "title": title,
            "artist": artist,
            "url": "https://www.youtube.com/watch?v=" + vid,
        })
        continue

    if not title and fetch_oembed:
        title, artist = soundcloud_oembed(soundcloud)
    if not title:
        title = "SoundCloud"
    entries.append({
        "source": "soundcloud",
        "title": title,
        "artist": artist,
        "url": soundcloud,
    })

entries.sort(key=lambda e: ((e.get("title") or "").casefold(), e.get("videoId") or e.get("url") or ""))
payload = json.dumps(entries, indent=2, ensure_ascii=False) + "\n"
tmp = dest.with_suffix(".json.tmp")
tmp.write_text(payload, encoding="utf-8")
tmp.replace(dest)
print(f"Wrote {len(entries)} videos to {dest}")
if not entries:
    print("Tip: add YouTube or SoundCloud URLs to youtube/videos.txt, then run this script again.")
PY

chmod +x "$ROOT/scripts/make-youtube-catalog.sh"