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

## Current Features

- Step 1 input engine for YouTube video, YouTube Music, and playlist URLs.
- Format and quality presets for video and audio downloads.
- Step 2 trim inputs with optional `MM:SS` / `HH:MM:SS` start and end timestamps.
- Step 3 in-memory queue with playlist expansion plus pause/resume/cancel controls.

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
