# Implementation Plan (PRD -> Build Plan)

## 1. Delivery Strategy
Build in small, shippable slices so a single agent can execute one step at a time while keeping the app lightweight and easy to use.

Guiding principles:
- Use proven tools (`yt-dlp`, `ffmpeg`) instead of custom media logic.
- Keep UI single-window and minimal (no heavy client framework for v1).
- Keep runtime local-only and privacy-first (no telemetry, no cloud backend).
- Ship MVP first, then harden.

## 1.1 Execution Rules (Single Agent, Required)
For every step in this plan, use this exact loop before moving on:

1. Implement the step fully.
2. Verify the step locally (tests, smoke checks, and manual validation for UX/security behavior).
3. Fix any issues found and re-run verification until passing.
4. Write a step report file under `/reports/`.
5. Move to the next step only after the report is saved.

Report naming convention:
- `reports/step-00-bootstrap-report.md`
- `reports/step-01-input-engine-report.md`
- `reports/step-02-trimmer-report.md`
- `reports/step-03-queue-report.md`
- `reports/step-04-metadata-routing-report.md`
- `reports/step-05-security-update-ux-report.md`
- `reports/step-06-packaging-qa-report.md`

Minimum report contents per step:
- Scope completed
- Files changed
- Verification performed
- Verification results
- Known issues / follow-ups

## 2. Proposed Tech Choices (Optimized for Speed)
- Frontend: Electron + vanilla HTML/CSS/JS (or very light React only if team velocity is higher with it).
- Backend engine: Python 3 wrapper around `yt-dlp` + `ffmpeg`.
- Bridge: Electron IPC + `child_process.spawn` for Python worker process.
- Data/state:
  - Runtime queue in memory (renderer + main sync).
  - Settings in local JSON file (`app.getPath('userData')`).

Why this is time-efficient:
- Avoids building custom download/transcode stack.
- Avoids heavy state management dependencies.
- Keeps architecture simple enough for one agent to implement and verify incrementally.

## 3. Target Repository Structure
```text
/electron
  /main
    main.js
    ipcHandlers.js
    validators.js
    pathSafety.js
  /preload
    preload.js
  /renderer
    index.html
    styles.css
    app.js
    components/
      queueItem.js
      settingsPanel.js
/python
  runner.py
  downloader.py
  metadata.py
  validators.py
  protocol.py
/assets
  pixel-icons/
/config
  default-settings.json
/tests
  unit/
  integration/
```

## 4. Milestones

### Step 0: Project Bootstrap
Deliverables:
- Electron app launches single window with secure defaults:
  - `nodeIntegration: false`
  - `contextIsolation: true`
- Python environment setup and dependency installer script.
- `ffmpeg` + `yt-dlp` availability check on startup with clear UI status.

Acceptance criteria:
- App boots on Windows/macOS/Linux dev machines.
- Missing dependency errors are clear and actionable.

Required verification before report:
- Startup smoke test on current dev OS.
- Dependency detection test for both installed and missing dependency paths.

Required report file:
- `reports/step-00-bootstrap-report.md`

### Step 1: Input Engine + Basic Download
Deliverables:
- URL input and validation for:
  - YouTube video URLs
  - YouTube Music URLs
  - Playlist URLs
- Format dropdown:
  - Video+Audio: MP4, MKV
  - Audio-only: MP3, WAV, M4A
- Quality dropdown:
  - Max/default + common presets (e.g., 1080p, bestaudio 320k)
- Start download action for one item.

Acceptance criteria:
- Invalid URLs are blocked with friendly errors.
- One valid URL can be downloaded in selected format/quality.

Required verification before report:
- URL validation checks for valid/invalid sample URLs.
- End-to-end single item download in each major output type (one video format, one audio format minimum).

Required report file:
- `reports/step-01-input-engine-report.md`

### Step 2: Trimmer
Deliverables:
- Start/End timestamp inputs.
- Time parser for `MM:SS` and `HH:MM:SS`.
- Pass trim args to backend (`ffmpeg`/`yt-dlp` flow).

Acceptance criteria:
- Trimmed output duration matches requested segment.
- Invalid time ranges (end <= start, malformed input) are blocked.

Required verification before report:
- Valid trim checks for both time formats.
- Invalid trim checks (bad format, end <= start, end past media when applicable).

Required report file:
- `reports/step-02-trimmer-report.md`

### Step 3: Queue + Playlist Batch
Deliverables:
- Playlist parsing into individual queue items.
- Queue panel with `pending`, `active`, `completed`, `failed`.
- Real-time metrics per active item:
  - percent
  - speed
  - total/downloaded size
- Controls: pause, resume, cancel.

Acceptance criteria:
- Playlist URL populates queue correctly.
- Pause/resume/cancel works for active item.
- Queue processes items reliably after failures.

Required verification before report:
- Playlist expansion smoke test.
- Queue state transition test (`pending -> active -> completed/failed`).
- Pause/resume/cancel behavior test on active download.

Required report file:
- `reports/step-03-queue-report.md`

### Step 4: Metadata + File Routing
Deliverables:
- Embed metadata:
  - title
  - channel/artist
  - year (if available)
  - thumbnail as cover art (for audio where supported)
- Settings UI for separate default output folders:
  - video folder
  - audio folder
- Path validation to allow only user-approved directories.

Acceptance criteria:
- Downloaded files contain expected metadata when available.
- Fallback behavior works when metadata fetch is missing/partial.

Required verification before report:
- Metadata presence check on output files.
- Missing metadata fallback test.
- Output routing and path-validation tests (allowed vs disallowed paths).

Required report file:
- `reports/step-04-metadata-routing-report.md`

### Step 5: Security, Update, and UX Polish
Deliverables:
- Input sanitization in Electron main process with strict regex/validators.
- Command argument passing via safe list (no shell string concatenation).
- User-triggered `yt-dlp` update flow (manual button, explicit confirmation).
- Dark minimalist UI + pixel-art accents (icons/progress styling).

Acceptance criteria:
- No direct shell injection path from URL/time inputs.
- App remains fully local with no telemetry.
- UI matches single-window top controls + bottom queue layout.

Required verification before report:
- Security-focused input fuzz/sanitization checks for URL and time inputs.
- Manual confirmation of `yt-dlp` update flow behavior.
- UI layout smoke test for the specified top/bottom single-window structure.

Required report file:
- `reports/step-05-security-update-ux-report.md`

### Step 6: Packaging + QA
Deliverables:
- Build installers/binaries for Windows/macOS/Linux.
- Smoke test matrix for core flows and edge cases.
- README with setup, troubleshooting, and limitations.

Acceptance criteria:
- Installable build works on target platforms.
- Core user journeys pass end-to-end.

Required verification before report:
- Install and run packaged build on available OS target(s).
- Run full smoke matrix and confirm pass/fail status per case.

Required report file:
- `reports/step-06-packaging-qa-report.md`

## 5. IPC Contract (Recommended)
Use typed JSON messages between renderer <-> main <-> Python worker.

Core commands:
- `validate_input`
- `start_download`
- `pause_download`
- `resume_download`
- `cancel_download`
- `get_queue_state`
- `save_settings`
- `update_ytdlp`

Core events:
- `queue_updated`
- `download_progress`
- `download_completed`
- `download_failed`
- `dependency_status`

## 6. Single-Agent Execution Order
Use this fixed order:

1. Step 0: Bootstrap
2. Step 1: Input Engine + Basic Download
3. Step 2: Trimmer
4. Step 3: Queue + Playlist Batch
5. Step 4: Metadata + File Routing
6. Step 5: Security, Update, and UX Polish
7. Step 6: Packaging + QA

No step is considered complete until:
- Its verification passes.
- Its step report file is written in `/reports/`.

## 7. Edge Cases to Explicitly Test
- Private/age-restricted/removed video URLs.
- Network drop during download and resume behavior.
- Missing thumbnail/year metadata.
- Invalid output path or revoked directory permissions.
- Very long playlists (queue performance and UI responsiveness).

## 8. Definition of Done (PRD Traceability)
- Input engine supports YouTube/YouTube Music/playlist URLs.
- User can select format and quality before download.
- Trimming supports `MM:SS` and `HH:MM:SS`.
- Queue supports pending/active/completed and real-time metrics.
- Pause/resume/cancel implemented.
- Metadata embedding and routing settings implemented.
- Electron security constraints enforced (`nodeIntegration: false`, `contextIsolation: true`).
- Command/path validation and local-only privacy model implemented.
- User-triggered `yt-dlp` update mechanism implemented.

## 9. Nice-to-Have (Only If Time Remains)
- Download presets (e.g., "Podcast MP3 128k", "Archive Video Best").
- Queue persistence across app restarts.
- Basic keyboard shortcuts for accessibility and speed.
