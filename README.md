# yt-dl

Local-first desktop app scaffold for YouTube download/trim workflows.

## Step 0 Quickstart

1. Install Node.js 20+ and Python 3.10+.
2. Install Node dependencies:
   - `npm install`
3. Install Python dependencies:
   - Windows: `powershell -ExecutionPolicy Bypass -File .\scripts\setup-python.ps1`
   - macOS/Linux: `./scripts/setup-python.sh`
4. Start the Electron app:
   - `npm start`

PowerShell note:
- If execution policy blocks `npm` (`npm.ps1`), use `npm.cmd` instead.

## Verification

- Startup smoke test:
  - `npm run smoke:start`
- Step 0 verification bundle:
  - `npm run verify:step0`
- Step 1 verification bundle:
  - `npm run verify:step1`
