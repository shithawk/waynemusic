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
extensions = {".mp3", ".m4a", ".aac", ".wav", ".flac", ".ogg", ".opus", ".webm"}

def collapse_ws(text):
    if not text:
        return ""
    return " ".join(str(text).split())

def clean_field(text):
    text = collapse_ws(text)
    if text.startswith("(") and text.endswith(")"):
        text = text[1:-1].strip()
    return text

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
        return clean_field(quoted[0])
    value = value.strip()
    if value.startswith("("):
        inner = value[1:].rstrip(")").strip()
        parts = [clean_field(part) for part in re.split(r"[,]", inner) if clean_field(part)]
        if not parts:
            parts = [clean_field(part) for part in inner.splitlines() if clean_field(part)]
        if parts:
            return parts[0]
    return clean_field(value.strip('"'))

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

TRACK_NUM = re.compile(r"^(\d{1,2})\.\s+(.+)$")
NUMBERED_STEM = re.compile(r"^\d{1,2}\.\s+(.+?)\s+-\s+(.+)$")

def strip_track_prefix(artist):
    if not artist:
        return artist
    artist = artist.strip()
    m = TRACK_NUM.match(artist)
    return m.group(2).strip() if m else artist

def refine_title_artist(stem, title, artist):
    """Use 'NN. … - …' filenames when tags are wrong or missing."""
    sm = NUMBERED_STEM.match(stem)
    if sm:
        left, right = sm.group(1).strip(), sm.group(2).strip()
        tagged = strip_track_prefix(artist)
        # Title-first: "01. Alter Ego (2020 Mix) - Tame Impala"
        if re.search(r"(?i)\btame impala\b", right):
            return left or title, right
        # Artist-first: "02. Tame Impala - Nangs"
        if re.fullmatch(r"(?i)tame impala", left):
            return right or title, "Tame Impala"
        if tagged and tagged == left and right:
            return right or title, tagged
        if not title and right:
            title = right
        if not artist and left:
            artist = left
    artist = strip_track_prefix(artist)
    if title == artist and sm:
        left, right = sm.group(1).strip(), sm.group(2).strip()
        if re.fullmatch(r"(?i)tame impala", left):
            return right, "Tame Impala"
    return title or stem, artist

def catalog_hints(music_dir):
    names = " ".join(p.name.lower() for p in music_dir.iterdir() if p.is_file())
    return {
        "norah": "norahjones" in names or "norah jones" in names,
        "moody": "moody blues" in names or "the moody blues" in names,
    }

JUNK_TITLES = {
    "tmp",
    "temp",
    "temporary",
    "untitled",
    "unknown",
    "track",
    "audio",
    "null",
    "none",
    "n/a",
    "na",
}

def is_junk_title(text):
    value = clean_field(text)
    if not value:
        return True
    folded = value.casefold()
    if folded in JUNK_TITLES:
        return True
    if len(value) <= 2 and not value.isdigit():
        return True
    return False

def fallback_from_filename(stem, title, artist, hints):
    """Fill missing or junk metadata from filename patterns."""
    title = clean_field(title)
    artist = clean_field(artist)
    if is_junk_title(title):
        title = ""

    # Archive.org style: johnmayall-summer1990d1t01_All_Your_Love_I_Miss_Loving
    m = re.match(r"(?i)^john\s*mayall[-_].*?[dt]\d+_(.+)$", stem)
    if not m:
        m = re.match(r"(?i)^johnmayall[-_].*?[dt]\d+_(.+)$", stem)
    if m:
        raw = m.group(1).replace("_", " ").strip()
        raw = re.sub(r"\s+", " ", raw)
        return raw or title or stem, "John Mayall"

    m = re.search(r"(?i)(.+?)_+\s*(the moody blues)\b", stem)
    if m:
        t = clean_field(m.group(1).replace("_", " "))
        t = re.sub(r"\s+n$", "", t, flags=re.I)
        return t or title or stem, "The Moody Blues"

    if hints.get("moody") and not artist and re.search(
        r"(?i)tuesday afternoon|time to get away|lovely to see you", stem
    ):
        t = clean_field(stem.replace("_", " "))
        t = re.sub(r"\s+n$", "", t, flags=re.I)
        return t or title, "The Moody Blues"

    m = re.match(r"^Adele\s*-\s*(.+)$", stem, re.I)
    if m:
        return clean_field(m.group(1)), "Adele"

    m = re.match(r"^(\d{2})Space Oddity$", stem, re.I)
    if m:
        return "Space Oddity", "David Bowie"
    m = re.match(r"^(\d{2})Starman$", stem, re.I)
    if m:
        return "Starman", "David Bowie"

    m = re.match(r"^LedZeppelin(\d+)$", stem, re.I)
    if m:
        return f"Led Zeppelin {m.group(1)}", "Led Zeppelin"

    parts = [clean_field(p) for p in stem.split(" - ")]
    if len(parts) >= 4 and re.match(r"^\d{1,2}\.?$", parts[-2]):
        return parts[-1] or title, parts[0] or artist

    if len(parts) == 3 and not artist:
        return parts[2] or title, parts[0]

    if len(parts) == 2 and not artist:
        left, right = parts
        if len(left) <= 48 and not re.match(r"^\d{2}\s", left):
            return right or title, left

    if (
        hints.get("norah")
        and re.match(r"^\d{2}\s+", stem)
        and " - " not in stem
        and not artist
        and not re.search(r"(?i)children of rock|into to", stem)
    ):
        return re.sub(r"^\d{2}\s+", "", stem).strip() or title, "Norah Jones"

    m = re.match(r"^(\d{2})(.+)$", stem)
    if m and not title and not artist and " - " not in stem:
        return m.group(2).strip(), artist

    return title, artist

hints = catalog_hints(dest)
songs = []
for path in sorted(dest.iterdir()):
    if not path.is_file() or path.suffix.lower() not in extensions:
        continue
    stem = path.stem
    title, artist = id3(path)
    mdls_title = mdls(path, "kMDItemTitle")
    mdls_artist = mdls(path, "kMDItemAuthors")
    if not title or is_junk_title(title):
        title = mdls_title if mdls_title and not is_junk_title(mdls_title) else ""
    elif mdls_title and not is_junk_title(mdls_title) and len(mdls_title.strip()) > len((title or "").strip()):
        title = mdls_title
    if not artist:
        artist = mdls_artist
    elif mdls_artist:
        tag_artist = (artist or "").strip()
        spot_artist = mdls_artist.strip()
        # ID3v1 artist is capped at 30 characters — prefer Spotlight when it fills in the rest.
        if len(tag_artist) == 30 and (
            len(spot_artist) > len(tag_artist)
            or spot_artist.lower().startswith(tag_artist[: min(24, len(tag_artist))].lower())
        ):
            artist = spot_artist
        elif len(spot_artist) > len(tag_artist):
            artist = spot_artist
    if (not title or is_junk_title(title)) and " - " in stem:
        artist_part, title_part = stem.split(" - ", 1)
        title = title_part.strip()
        if not artist:
            artist = artist_part.strip()
    if not title or is_junk_title(title):
        title = stem.replace("_", " ").strip() or "Song"
    title, artist = refine_title_artist(stem, title, artist)
    title, artist = fallback_from_filename(stem, title, artist, hints)
    title = clean_field(title) or stem.replace("_", " ").strip() or "Song"
    if is_junk_title(title):
        title = stem.replace("_", " ").strip() or "Song"
    artist = clean_field(artist)
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
