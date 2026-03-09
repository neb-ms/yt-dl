# Product Requirements Document (PRD)
**Product Name:** [App Name TBA]
**Platform:** Desktop (macOS, Windows, Linux)
**Architecture:** Electron (Frontend) + Python (Backend)

---

## 1. App Overview & Objective
A standalone, locally-hosted desktop application designed to download, trim, and manage YouTube media. It allows users to input YouTube URLs (single videos or playlists) and extract either the full video with audio or just the audio track. The app operates entirely locally, prioritizing user privacy, precise media trimming, and high-quality local file management without relying on third-party cloud conversion services.

## 2. Core Functional Requirements

### 2.1 The Input Engine
* **URL Parsing:** Accept and validate standard YouTube URLs, YouTube Music URLs, and Playlist URLs.
* **Format Selection:** Dropdown for Video+Audio (MP4, MKV) or Audio-only (MP3, WAV, M4A).
* **Quality Selection:** Options for maximum available resolution (e.g., 1080p, 4K) or audio bitrate (e.g., 320kbps).

### 2.2 The Trimmer
* **Timestamp Inputs:** Two input fields (Start Time / End Time) allowing the user to crop the media before finalizing the download.
* **Format Handling:** Must accept standard timecode formats (e.g., `MM:SS` or `HH:MM:SS`).

### 2.3 Queue & Batch Management
* **Playlist Handling:** Automatically parse playlist URLs into individual queue items.
* **Active Queue:** Visual list showing pending, active, and completed downloads.
* **Real-time Metrics:** Display download speed, file size, and percentage completion.
* **Queue Controls:** Pause, resume, and cancel buttons for active processes.

### 2.4 Metadata & File Management
* **Tagging:** Automatically fetch and embed YouTube thumbnails (as cover art), video titles, channel names, and release years into the final file metadata.
* **Routing:** Dedicated configuration settings to define and save default local destination directories (e.g., separate default folders for Video outputs vs. Audio outputs).

## 3. UI/UX & Aesthetic Requirements
* **Theme:** High-contrast dark mode to minimize eye strain.
* **Aesthetic:** A minimalist layout accented with subtle pixel-art elements (e.g., custom pixel-art icons, progress bars, or app logo) to create a distinct, personalized character.
* **Layout:** Single-window interface. Top half dedicated to input fields, quality/format dropdowns, and trimming controls. Bottom half dedicated to a dynamic, scrollable download queue.

## 4. Technical Architecture

* **Frontend (GUI):** Electron using JavaScript/HTML/CSS (or lightweight React). 
* **Backend (Engine):** Python 3. This bridges perfectly with current JavaScript and Python development workflows.
* **Media Core:** * `yt-dlp`: For reliable media extraction and bypassing throttling.
    * `FFmpeg`: For media conversion, stitching video/audio streams, and executing precise timecode trims.
* **Communication Bridge:** Electron's Inter-Process Communication (IPC) combined with Node.js `child_process.spawn` to trigger Python scripts and stream `stdout`/`stderr` back to the UI for progress bars.

## 5. Security & Safety Protocols
* **Context Isolation:** Electron must be configured with `nodeIntegration: false` and `contextIsolation: true` to strictly separate the UI renderer from system-level Node.js APIs.
* **Command Injection Prevention:** All URL inputs and timecode strings must be strictly sanitized and validated via Regex in the Node.js main process before being passed as arguments to the Python backend.
* **Path Validation:** Ensure the app only writes to user-approved directories, preventing directory traversal vulnerabilities.
* **Privacy by Design:** Zero telemetry, zero external server pings (other than standard YouTube requests via `yt-dlp`), and completely localized processing.

## 6. Edge Cases & Error Handling
* **Invalid/Private URLs:** Gracefully catch and display clear UI errors for age-restricted, private, or taken-down videos.
* **Network Interruptions:** Support partial download resumption via `yt-dlp`'s native capabilities if the connection drops.
* **Missing Metadata:** Fallback logic to process the download cleanly even if thumbnails or channel data fail to fetch.
* **Dependency Management:** Implement a safe, user-triggered mechanism to update the local `yt-dlp` binary to keep pace with YouTube API changes.