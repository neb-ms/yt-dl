# PineDrop

PineDrop is a local-first desktop downloader built for people who want a clean workflow, not a pile of command flags. It wraps proven open-source tools in a single-window app that makes link validation, trimming, queueing, metadata tagging, and output routing feel like one coherent tool.

PineDrop is built with Electron and Python, and it depends on `yt-dlp` for media extraction and `ffmpeg` for trimming, conversion, and muxing. Those tools do the heavy lifting; PineDrop focuses on the local desktop UX around them.

The value is the UX:
- paste a link, choose the format, and queue it
- trim clips without leaving the app
- keep video and audio organized in separate folders
- stay local with no telemetry and no cloud processing
- use packaged Windows builds without asking end users to install Python, `yt-dlp`, or `ffmpeg`

## What PineDrop Does

- Accepts YouTube video, YouTube Music, and playlist URLs.
- Downloads video or audio with preset format and quality choices.
- Trims media with `MM:SS` or `HH:MM:SS` ranges.
- Expands playlists into queue items with pause, resume, and cancel controls.
- Embeds metadata and cover art where the output format supports it.
- Saves separate default folders for video and audio outputs.
- Keeps the UI local-first and single-window.

## Quickstart

### Dev mode

1. Install Node.js 20+ and Python 3.10+.
2. Install Node dependencies:
   - `npm.cmd install`
3. Install Python dependencies:
   - Windows: `powershell -ExecutionPolicy Bypass -File .\scripts\setup-python.ps1`
   - macOS/Linux: `./scripts/setup-python.sh`
4. Start the app:
   - `npm.cmd start`

PowerShell note:
- If execution policy blocks `npm` (`npm.ps1`), use `npm.cmd` instead.

### Local human test from bash

```bash
npm install
bash ./scripts/setup-python.sh
npm start
```

## Packaging

- Windows installer + portable build:
  - `npm.cmd run dist:win`
- Linux artifacts:
  - `npm run dist:linux`
- macOS artifacts:
  - `npm run dist:mac`

Build output is written to `dist/`.

Packaging notes:
- The Electron app bundles the local `python/` and `config/` folders into the packaged app resources.
- Packaged Windows builds now stage and bundle a managed Python runtime, `yt-dlp`, and `ffmpeg`.
- The packaged Windows app auto-checks its managed runtime on startup and updates `yt-dlp` inside the app-owned runtime.
- Windows packaging is the only target verified in this repository on 2026-03-09. macOS and Linux targets are configured but were not smoke-tested in this environment.

## Why It Exists

`yt-dlp` is the engine. PineDrop is the product around it.

This app exists to turn a powerful backend into something easier to live with:
- a compact desktop UI instead of repeated shell commands
- queue visibility instead of guessing what is still running
- trim and routing controls in one place
- safer defaults around paths, validation, and local execution
- packaged Windows builds that own their runtime instead of asking normal users to set one up

## Credits

PineDrop would not exist without the tools it builds on:
- `yt-dlp` for the extraction engine and site support
- `ffmpeg` for trimming, conversion, remuxing, and metadata work
- Electron for the desktop shell and app packaging
- Python for the backend runner and media workflow glue

Respect is due to the maintainers and contributors behind those projects. PineDrop is the UX layer around their work, not a replacement for it.

## Current Features

- URL input validation for YouTube video, YouTube Music, and playlist links.
- Format presets for MP4, MKV, MP3, WAV, and M4A.
- Quality presets for common video resolutions and audio bitrates.
- Optional trim start and end inputs.
- Queue with pending, active, paused, completed, failed, and cancelled states.
- Real-time progress, size, speed, and ETA updates.
- Metadata embedding for title, artist/channel, year, and cover art where supported.
- Saved output routing for separate video and audio folders.
- Strict main-process input sanitization and path validation.
- Manual and background `yt-dlp` maintenance flows depending on runtime mode.
- Forest-themed dark UI with compact single-window layout.

## Verification

- Startup smoke test:
  - `npm.cmd run smoke:start`
- Step 0 verification bundle:
  - `npm.cmd run verify:step0`
- Step 1 verification bundle:
  - `npm.cmd run verify:step1`
- Step 2 verification bundle:
  - `npm.cmd run verify:step2`
- Step 3 verification bundle:
  - `npm.cmd run verify:step3`
- Step 4 verification bundle:
  - `npm.cmd run verify:step4`
- Step 5 verification bundle:
  - `npm.cmd run verify:step5`
- Step 6 verification bundle:
  - `npm.cmd run verify:step6`

Smoke matrix:
- `tests/smoke-matrix.json`

## Troubleshooting

- `npm` is blocked in PowerShell:
  - Use `npm.cmd` instead of `npm`.
- The app reports Python as missing:
  - In dev mode, install Python 3.10+ and rerun `powershell -ExecutionPolicy Bypass -File .\scripts\setup-python.ps1` on Windows or `./scripts/setup-python.sh` on macOS/Linux.
- The app reports `ffmpeg` or `yt-dlp` as missing:
  - In dev mode, ensure the tools are installed and available on PATH, then rerun dependency check from the app.
- A packaged build launches but downloads fail immediately:
  - Reinstall the packaged app so its managed runtime template can be restored into the app-owned runtime directory.
- `yt-dlp` warns that no JavaScript runtime is available:
  - Some extraction paths may be less reliable until a supported JS runtime is installed or configured for `yt-dlp`.
- The `Update yt-dlp` button fails:
  - In packaged Windows builds the app updates `yt-dlp` inside its managed runtime. In dev mode it still uses the detected local Python environment and `pip`.

## Limitations

- Verified packaged-build startup is currently limited to Windows in this repository's local QA run on 2026-03-09.
- macOS and Linux packaging commands are configured but not validated here.
- Only Windows packaged builds currently bundle and manage their own Python/`yt-dlp`/`ffmpeg` runtime in this repository.
- First launch of a fresh packaged Windows profile is slower because the managed runtime is copied into the app data directory.
- The smoke matrix includes known unexecuted edge cases where local automation was not practical in this environment, such as network-drop recovery and very long playlist responsiveness.
