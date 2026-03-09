#!/usr/bin/env python3
import argparse
import json
import os
import sys
from typing import Any, Dict, Optional

from yt_dlp import YoutubeDL
from yt_dlp.utils import DownloadError


def emit(event: str, **payload: Any) -> None:
    message = {"event": event, **payload}
    print(json.dumps(message), flush=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="yt-dl download runner")
    parser.add_argument("--url", required=True)
    parser.add_argument("--source-kind", required=True)
    parser.add_argument("--format-id", required=True)
    parser.add_argument("--quality", default="best")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--download-id", required=False)
    parser.add_argument("--trim-start-seconds", type=float, default=None)
    parser.add_argument("--trim-end-seconds", type=float, default=None)
    return parser.parse_args()


def format_seconds_label(seconds: float) -> str:
    total_seconds = max(0, int(round(seconds)))
    hours = total_seconds // 3600
    minutes = (total_seconds % 3600) // 60
    secs = total_seconds % 60
    if hours > 0:
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"
    return f"{minutes:02d}:{secs:02d}"


def validate_trim_args(args: argparse.Namespace) -> Optional[Dict[str, float]]:
    if args.trim_start_seconds is None and args.trim_end_seconds is None:
        return None

    if args.trim_start_seconds is None or args.trim_end_seconds is None:
        raise ValueError("Both trim start and trim end must be provided together.")

    if args.trim_start_seconds < 0 or args.trim_end_seconds < 0:
        raise ValueError("Trim values must be zero or greater.")

    if args.trim_end_seconds <= args.trim_start_seconds:
        raise ValueError("Trim end must be greater than trim start.")

    return {
        "start": args.trim_start_seconds,
        "end": args.trim_end_seconds,
    }


def build_video_selector(format_id: str, quality: str) -> str:
    if format_id == "video_mp4":
        if quality == "best":
            return "best[ext=mp4]/best/bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio"
        return (
            f"best[ext=mp4][height<={quality}]/best[height<={quality}]/"
            f"bestvideo[height<={quality}][ext=mp4]+bestaudio[ext=m4a]/"
            f"bestvideo[height<={quality}]+bestaudio"
        )

    if quality == "best":
        return "bestvideo+bestaudio/best"
    return f"bestvideo[height<={quality}]+bestaudio/best[height<={quality}]"


def build_audio_selector(format_id: str, quality: str) -> str:
    if quality == "best":
        return "bestaudio"
    return f"bestaudio[abr<={quality}]/bestaudio"


def build_probe_options(args: argparse.Namespace) -> Dict[str, Any]:
    opts: Dict[str, Any] = {
        "quiet": True,
        "no_warnings": True,
    }

    if args.source_kind == "playlist":
        opts["noplaylist"] = False
        opts["playlist_items"] = "1"
    else:
        opts["noplaylist"] = True

    return opts


def build_trim_download_ranges(trim_window: Dict[str, float]):
    def _download_ranges(_info_dict: Dict[str, Any], _ydl: YoutubeDL):
        return [
            {
                "start_time": trim_window["start"],
                "end_time": trim_window["end"],
            }
        ]

    return _download_ranges


def build_ydl_options(
    args: argparse.Namespace,
    seen_files: set[str],
    output_file: Dict[str, Optional[str]],
    trim_window: Optional[Dict[str, float]],
) -> Dict[str, Any]:
    def progress_hook(data: Dict[str, Any]) -> None:
        status = data.get("status")
        if status == "downloading":
            downloaded = data.get("downloaded_bytes") or 0
            total = data.get("total_bytes") or data.get("total_bytes_estimate") or 0
            percent = (downloaded / total * 100.0) if total else None
            emit(
                "progress",
                percent=percent,
                downloadedBytes=downloaded,
                totalBytes=total if total else None,
                speedBps=data.get("speed"),
                etaSeconds=data.get("eta"),
            )
        elif status == "finished":
            filename = data.get("filename")
            if isinstance(filename, str):
                output_file["path"] = filename
            emit("status", message="Download finished. Finalizing output...")

    class JsonLogger:
        def debug(self, _msg: str) -> None:
            return

        def warning(self, msg: str) -> None:
            clean = msg.strip()
            if clean:
                emit("status", level="warning", message=clean)

        def error(self, msg: str) -> None:
            clean = msg.strip()
            if clean:
                emit("status", level="error", message=clean)

    outtmpl = os.path.join(args.output_dir, "%(title).200B [%(id)s].%(ext)s")
    opts: Dict[str, Any] = {
        "outtmpl": outtmpl,
        "quiet": True,
        "no_warnings": True,
        "restrictfilenames": False,
        "logger": JsonLogger(),
        "progress_hooks": [progress_hook],
    }

    if args.source_kind == "playlist":
        opts["noplaylist"] = False
        opts["playlist_items"] = "1"
    else:
        opts["noplaylist"] = True

    if args.format_id in {"video_mp4", "video_mkv"}:
        opts["format"] = build_video_selector(args.format_id, args.quality)
        if args.format_id == "video_mp4":
            opts["merge_output_format"] = "mp4"
        else:
            opts["merge_output_format"] = "mkv"
    elif args.format_id in {"audio_mp3", "audio_wav", "audio_m4a"}:
        opts["format"] = build_audio_selector(args.format_id, args.quality)
        if args.format_id == "audio_mp3":
            opts["postprocessors"] = [
                {
                    "key": "FFmpegExtractAudio",
                    "preferredcodec": "mp3",
                    "preferredquality": args.quality if args.quality != "best" else "320",
                }
            ]
        elif args.format_id == "audio_wav":
            opts["postprocessors"] = [
                {
                    "key": "FFmpegExtractAudio",
                    "preferredcodec": "wav",
                }
            ]
        elif args.format_id == "audio_m4a":
            opts["postprocessors"] = [
                {
                    "key": "FFmpegExtractAudio",
                    "preferredcodec": "m4a",
                    "preferredquality": args.quality if args.quality != "best" else "320",
                }
            ]
    else:
        raise ValueError("Unsupported format id.")

    if trim_window:
        opts["download_ranges"] = build_trim_download_ranges(trim_window)
        opts["force_keyframes_at_cuts"] = True

    opts["_seen_files"] = seen_files
    return opts


def find_newest_output(output_dir: str, seen_files: set[str], fallback_path: Optional[str]) -> Optional[str]:
    if fallback_path and os.path.exists(fallback_path):
        return fallback_path

    try:
        entries = []
        for name in os.listdir(output_dir):
            full_path = os.path.join(output_dir, name)
            if name in seen_files or not os.path.isfile(full_path):
                continue
            entries.append(full_path)
        if not entries:
            return None
        entries.sort(key=lambda p: os.path.getmtime(p), reverse=True)
        return entries[0]
    except OSError:
        return fallback_path


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


def validate_trim_against_media(args: argparse.Namespace, trim_window: Optional[Dict[str, float]]) -> None:
    if not trim_window:
        return

    emit(
        "status",
        message=(
            f"Validating trim range "
            f"{format_seconds_label(trim_window['start'])} -> {format_seconds_label(trim_window['end'])}..."
        ),
    )

    with YoutubeDL(build_probe_options(args)) as ydl:
        info = ydl.extract_info(args.url, download=False)

    primary_info = resolve_primary_info(info)
    if not primary_info:
        return

    duration = primary_info.get("duration")
    if duration is None:
        return

    duration_seconds = float(duration)
    if trim_window["start"] >= duration_seconds:
        raise ValueError(
            f"Trim start {format_seconds_label(trim_window['start'])} exceeds media duration "
            f"{format_seconds_label(duration_seconds)}."
        )

    if trim_window["end"] > duration_seconds:
        raise ValueError(
            f"Trim end {format_seconds_label(trim_window['end'])} exceeds media duration "
            f"{format_seconds_label(duration_seconds)}."
        )


def main() -> int:
    args = parse_args()

    os.makedirs(args.output_dir, exist_ok=True)
    seen_files = set(os.listdir(args.output_dir))
    output_file: Dict[str, Optional[str]] = {"path": None}

    try:
        trim_window = validate_trim_args(args)
    except ValueError as error:
        emit("error", message=str(error))
        return 1

    try:
        validate_trim_against_media(args, trim_window)
    except DownloadError as error:
        emit("error", message=f"Download failed: {error}")
        return 1
    except ValueError as error:
        emit("error", message=str(error))
        return 1
    except Exception as error:  # noqa: BLE001
        emit("error", message=f"Unexpected runner error: {error}")
        return 1

    emit("status", message="Preparing download...")
    if trim_window:
        emit(
            "status",
            message=(
                f"Applying trim {format_seconds_label(trim_window['start'])} -> "
                f"{format_seconds_label(trim_window['end'])}."
            ),
        )

    try:
        ydl_opts = build_ydl_options(args, seen_files, output_file, trim_window)
    except ValueError as error:
        emit("error", message=str(error))
        return 1

    try:
        with YoutubeDL(ydl_opts) as ydl:
            ydl.extract_info(args.url, download=True)
    except DownloadError as error:
        emit("error", message=f"Download failed: {error}")
        return 1
    except Exception as error:  # noqa: BLE001
        emit("error", message=f"Unexpected runner error: {error}")
        return 1

    output_path = find_newest_output(args.output_dir, seen_files, output_file["path"])
    emit("complete", outputPath=output_path, message="Download completed successfully.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
