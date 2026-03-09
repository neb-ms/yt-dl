from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Iterable, Optional

from yt_dlp.postprocessor.common import PostProcessor


def _first_text(info: Dict[str, Any], keys: Iterable[str]) -> Optional[str]:
    for key in keys:
        value = info.get(key)
        if value is None:
            continue
        if isinstance(value, (list, tuple)):
            joined = ", ".join(str(item).strip() for item in value if str(item).strip())
            if joined:
                return joined
            continue

        text = str(value).strip()
        if text:
            return text

    return None


def extract_year(info: Dict[str, Any]) -> Optional[str]:
    release_year = info.get("release_year")
    if release_year not in (None, ""):
        return str(release_year)

    for key in ("release_date", "upload_date"):
        value = info.get(key)
        if value is None:
            continue
        digits = "".join(character for character in str(value) if character.isdigit())
        if len(digits) >= 4:
            return digits[:4]

    timestamp = info.get("timestamp")
    if timestamp in (None, ""):
        return None

    try:
        return datetime.fromtimestamp(int(timestamp), tz=timezone.utc).strftime("%Y")
    except (TypeError, ValueError, OSError):
        return None


def build_metadata_overrides(info: Dict[str, Any]) -> Dict[str, str]:
    title = _first_text(
        info,
        ("track", "title", "fulltitle", "alt_title", "webpage_url", "original_url", "id"),
    )
    artist = _first_text(
        info,
        ("artist", "artists", "channel", "uploader", "creator", "creators", "channel_id"),
    )
    year = extract_year(info)
    date_value = _first_text(info, ("release_date", "upload_date"))

    overrides: Dict[str, str] = {}
    if title:
        overrides["meta_title"] = title
    if artist:
        overrides["meta_artist"] = artist
    if date_value:
        overrides["meta_date"] = date_value
    elif year:
        overrides["meta_date"] = year
    if year:
        overrides["meta_year"] = year

    return overrides


def summarize_metadata(info: Dict[str, Any]) -> Dict[str, Any]:
    overrides = build_metadata_overrides(info)

    return {
        "title": overrides.get("meta_title"),
        "artist": overrides.get("meta_artist"),
        "year": overrides.get("meta_year"),
        "thumbnailAvailable": bool(info.get("thumbnails")),
    }


class PrepareMetadataPP(PostProcessor):
    def __init__(self, downloader, status_callback=None):
        super().__init__(downloader)
        self._status_callback = status_callback

    def run(self, info):
        overrides = build_metadata_overrides(info)
        info.update(overrides)

        if self._status_callback:
            present = [
                label
                for label, key in (("title", "meta_title"), ("artist", "meta_artist"), ("year", "meta_year"))
                if overrides.get(key)
            ]
            if present:
                self._status_callback(f"Preparing metadata tags: {', '.join(present)}.")
            else:
                self._status_callback("Metadata was incomplete. Download will continue with available fields only.")

        return [], info
