#!/usr/bin/env python3
import argparse
import json
import sys
from typing import Any, Dict, Optional

from yt_dlp import YoutubeDL
from yt_dlp.utils import DownloadError


def emit(payload: Dict[str, Any]) -> None:
    print(json.dumps(payload), flush=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="yt-dl metadata probe")
    parser.add_argument("--url", required=True)
    parser.add_argument("--source-kind", required=True)
    return parser.parse_args()


def resolve_primary_info(info: Any) -> Optional[Dict[str, Any]]:
    current = info
    visited_ids = set()

    while isinstance(current, dict):
        current_id = id(current)
        if current_id in visited_ids:
            break
        visited_ids.add(current_id)

        entries = current.get("entries")
        if not entries:
            return current

        next_entry = None
        for entry in entries:
            if entry:
                next_entry = entry
                break

        if next_entry is None:
            return current

        current = next_entry

    return current if isinstance(current, dict) else None


def build_probe_options(source_kind: str) -> Dict[str, Any]:
    opts: Dict[str, Any] = {
        "quiet": True,
        "no_warnings": True,
    }

    if source_kind == "playlist":
        opts["extract_flat"] = "in_playlist"
        opts["noplaylist"] = False
    else:
        opts["noplaylist"] = True

    return opts


def normalize_playlist_entry(entry: Dict[str, Any], index: int) -> Optional[Dict[str, Any]]:
    entry_url = entry.get("url") or entry.get("webpage_url")
    entry_id = entry.get("id")
    ie_key = (entry.get("ie_key") or "").lower()

    if isinstance(entry_url, str):
        entry_url = entry_url.strip()

    if entry_url and not entry_url.startswith(("http://", "https://")) and entry_id and ie_key == "youtube":
        entry_url = f"https://www.youtube.com/watch?v={entry_id}"
    elif not entry_url and entry_id:
        entry_url = f"https://www.youtube.com/watch?v={entry_id}"

    if not entry_url:
        return None

    return {
        "id": entry_id,
        "title": entry.get("title") or entry_url,
        "url": entry_url,
        "sourceKind": "video",
        "playlistIndex": index,
    }


def probe_playlist(args: argparse.Namespace) -> Dict[str, Any]:
    with YoutubeDL(build_probe_options(args.source_kind)) as ydl:
        info = ydl.extract_info(args.url, download=False)

    entries = []
    for index, entry in enumerate(info.get("entries") or [], start=1):
        if not entry:
            continue
        normalized = normalize_playlist_entry(entry, index)
        if normalized:
            entries.append(normalized)

    return {
        "ok": True,
        "sourceKind": "playlist",
        "title": info.get("title") or "Playlist",
        "entryCount": len(entries),
        "entries": entries,
    }


def probe_single(args: argparse.Namespace) -> Dict[str, Any]:
    with YoutubeDL(build_probe_options(args.source_kind)) as ydl:
        info = ydl.extract_info(args.url, download=False)

    primary = resolve_primary_info(info) or {}
    entry_url = primary.get("webpage_url") or primary.get("original_url") or args.url

    return {
        "ok": True,
        "sourceKind": args.source_kind,
        "title": primary.get("title") or entry_url,
        "entryCount": 1,
        "entries": [
            {
                "id": primary.get("id"),
                "title": primary.get("title") or entry_url,
                "url": entry_url,
                "sourceKind": args.source_kind,
            }
        ],
    }


def main() -> int:
    args = parse_args()

    try:
        if args.source_kind == "playlist":
            emit(probe_playlist(args))
        else:
            emit(probe_single(args))
        return 0
    except DownloadError as error:
        emit(
            {
                "ok": False,
                "message": f"Media probe failed: {error}",
            }
        )
        return 1
    except Exception as error:  # noqa: BLE001
        emit(
            {
                "ok": False,
                "message": f"Unexpected media probe error: {error}",
            }
        )
        return 1


if __name__ == "__main__":
    sys.exit(main())
