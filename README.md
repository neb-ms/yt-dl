# yt-dl

Local-first desktop app scaffold for YouTube download/trim workflows.

## Quickstart

1. Install Node.js 20+ and Python 3.10+.
2. Install Node dependencies:
   - `npm.cmd install`
3. Install Python dependencies:
   - Windows: `powershell -ExecutionPolicy Bypass -File .\scripts\setup-python.ps1`
   - macOS/Linux: `./scripts/setup-python.sh`
4. Start the Electron app:
   - `npm.cmd start`

PowerShell note:
- If execution policy blocks `npm` (`npm.ps1`), use `npm.cmd` instead.

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
- The packaged app still expects a working local Python 3 installation plus `yt-dlp` and `ffmpeg` on PATH.
- Windows packaging is the only target verified in this repository on 2026-03-09. macOS and Linux targets are configured but were not smoke-tested in this environment.

## Current Features

- Step 1 input engine for YouTube video, YouTube Music, and playlist URLs.
- Format and quality presets for video and audio downloads.
- Step 2 trim inputs with optional `MM:SS` / `HH:MM:SS` start and end timestamps.
- Step 3 in-memory queue with playlist expansion plus pause/resume/cancel controls.
- Step 4 metadata embedding for title/artist/year plus cover art on supported audio outputs.
- Step 4 saved output routing with separate approved video and audio folders.
- Step 5 stricter main-process sanitization for URL/time/queue-action payloads.
- Step 5 user-triggered local `yt-dlp` update flow with explicit confirmation.
- Step 5 refreshed single-window layout with top controls, bottom queue, and pixel-style accents.
- Step 6 packaging scripts for Windows, macOS, and Linux targets.
- Step 6 recorded smoke matrix for core flows and known edge cases.
- Local-only privacy model with no telemetry.

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
  - Install Python 3.10+ and rerun `powershell -ExecutionPolicy Bypass -File .\scripts\setup-python.ps1` on Windows or `./scripts/setup-python.sh` on macOS/Linux.
- The app reports `ffmpeg` or `yt-dlp` as missing:
  - Ensure the tools are installed and available on PATH, then rerun dependency check from the app.
- A packaged build launches but downloads fail immediately:
  - The packaged app does not bundle a Python runtime or `ffmpeg`; it still depends on the local machine environment.
- `yt-dlp` warns that no JavaScript runtime is available:
  - Some YouTube extraction paths may be less reliable until a supported JS runtime is installed or configured for `yt-dlp`.
- The `Update yt-dlp` button fails:
  - The update flow uses the detected local Python environment and `pip`, so the selected interpreter must have permission to install packages.

## Limitations

- Verified packaged-build startup is currently limited to Windows in this repository's local QA run on 2026-03-09.
- macOS and Linux packaging commands are configured but not validated here.
- Python, `yt-dlp`, and `ffmpeg` are not bundled as native runtimes inside the packaged application.
- The smoke matrix includes known unexecuted edge cases where local automation was not practical in this environment, such as network-drop recovery and very long playlist responsiveness.
