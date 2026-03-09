function byId(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatTimestamp(value) {
  if (!value) {
    return "";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(parsed);
}

function shortPath(value, maxLength = 88) {
  if (typeof value !== "string" || value.length <= maxLength) {
    return value;
  }

  const trailingLength = 28;
  return `${value.slice(0, maxLength - trailingLength - 3)}...${value.slice(-trailingLength)}`;
}

function folderLabel(value) {
  if (typeof value !== "string" || !value.trim()) {
    return "your saved folder";
  }

  const parts = value.split(/[/\\]+/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : value;
}

function renderDependency(check) {
  const badgeClass = check.available ? "badge badge-ok" : "badge badge-missing";
  const badgeLabel = check.available ? "Ready" : "Needs setup";
  const titles = {
    python: "Python",
    "yt-dlp": "yt-dlp",
    ffmpeg: "ffmpeg"
  };

  let summary = "Ready to go.";
  let detail = check.path ? `Detected at <code>${escapeHtml(shortPath(check.path, 72))}</code>.` : "Detected automatically.";

  if (!check.available) {
    if (check.name === "python") {
      summary = "Install Python before starting downloads.";
    } else if (check.name === "yt-dlp") {
      summary = "Install or repair yt-dlp so links can be fetched.";
    } else if (check.name === "ffmpeg") {
      summary = "Install ffmpeg so the app can finish and convert files.";
    }

    detail = check.installHint ? escapeHtml(check.installHint) : "Install the missing tool, then refresh this panel.";
  } else if (check.name === "python") {
    summary = "Python is ready for downloads and updates.";
  } else if (check.name === "yt-dlp") {
    summary = check.path
      ? "The download engine is installed and ready."
      : "The download engine is available inside your Python environment.";
  } else if (check.name === "ffmpeg") {
    summary = "Media conversion tools are ready.";
  }

  return `
    <li class="dependency-item">
      <div class="dependency-header">
        <span class="dependency-name">${escapeHtml(titles[check.name] || check.name)}</span>
        <span class="${badgeClass}">${badgeLabel}</span>
      </div>
      <p class="dependency-summary">${escapeHtml(summary)}</p>
      <p class="dependency-meta">${detail}</p>
    </li>
  `;
}

function renderStatus(status) {
  const messageEl = byId("status-message");
  const listEl = byId("dependency-list");

  if (!status || !Array.isArray(status.checks)) {
    messageEl.textContent = "Dependency status unavailable.";
    listEl.innerHTML = "";
    return;
  }

  const checkedAt = formatTimestamp(status.checkedAt);
  const summary = status.ok
    ? "Your machine is ready for downloads."
    : "A few tools still need attention before downloads can start.";
  messageEl.textContent = checkedAt ? `${summary} Checked ${checkedAt}.` : summary;
  listEl.innerHTML = status.checks.map(renderDependency).join("");
}

const QUALITY_OPTIONS = {
  video_mp4: [
    { value: "best", label: "Max Available" },
    { value: "2160", label: "4K (2160p)" },
    { value: "1440", label: "1440p" },
    { value: "1080", label: "1080p" },
    { value: "720", label: "720p" },
    { value: "480", label: "480p" }
  ],
  video_mkv: [
    { value: "best", label: "Max Available" },
    { value: "2160", label: "4K (2160p)" },
    { value: "1440", label: "1440p" },
    { value: "1080", label: "1080p" },
    { value: "720", label: "720p" },
    { value: "480", label: "480p" }
  ],
  audio_mp3: [
    { value: "best", label: "Max Available" },
    { value: "320", label: "320 kbps" },
    { value: "256", label: "256 kbps" },
    { value: "192", label: "192 kbps" },
    { value: "128", label: "128 kbps" }
  ],
  audio_wav: [
    { value: "best", label: "Max Available" },
    { value: "320", label: "320 kbps" },
    { value: "256", label: "256 kbps" },
    { value: "192", label: "192 kbps" },
    { value: "128", label: "128 kbps" }
  ],
  audio_m4a: [
    { value: "best", label: "Max Available" },
    { value: "320", label: "320 kbps" },
    { value: "256", label: "256 kbps" },
    { value: "192", label: "192 kbps" },
    { value: "128", label: "128 kbps" }
  ]
};

const FORMAT_LABELS = {
  video_mp4: "Video + Audio (MP4)",
  video_mkv: "Video + Audio (MKV)",
  audio_mp3: "Audio Only (MP3)",
  audio_wav: "Audio Only (WAV)",
  audio_m4a: "Audio Only (M4A)"
};

const STATUS_LABELS = {
  pending: "Pending",
  active: "Active",
  paused: "Paused",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled"
};

let latestQueueSnapshot = {
  queue: [],
  activeItemId: null,
  counts: {
    total: 0,
    pending: 0,
    active: 0,
    paused: 0,
    completed: 0,
    failed: 0,
    cancelled: 0
  }
};
let latestSettings = null;

const NOISY_QUEUE_MESSAGES = [
  /no supported javascript runtime could be found/i,
  /some android_vr client https formats have been skipped/i
];

function qualityLabel(formatId, quality) {
  const options = QUALITY_OPTIONS[formatId] || [];
  const matched = options.find((option) => option.value === quality);
  return matched ? matched.label : quality;
}

function prettifyStatusMessage(message) {
  const value = typeof message === "string" ? message.trim() : "";
  if (!value) {
    return "";
  }

  if (NOISY_QUEUE_MESSAGES.some((pattern) => pattern.test(value))) {
    return "";
  }

  if (/^queued\.?$/i.test(value)) {
    return "Waiting in line.";
  }
  if (/download started/i.test(value)) {
    return "Download started.";
  }
  if (/resuming download/i.test(value)) {
    return "Picking back up where you left off.";
  }
  if (/pausing/i.test(value)) {
    return "Pausing...";
  }
  if (/paused\./i.test(value)) {
    return "Paused. Resume whenever you're ready.";
  }
  if (/cancelling/i.test(value)) {
    return "Cancelling...";
  }
  if (/cancelled by user/i.test(value)) {
    return "Cancelled.";
  }
  if (/preparing download/i.test(value)) {
    return "Getting everything ready...";
  }
  if (/validating trim range/i.test(value)) {
    return "Checking your trim range...";
  }
  if (/applying trim/i.test(value)) {
    return "Trimming to your selected range...";
  }
  if (/preparing metadata tags/i.test(value)) {
    return "Adding title, artist, and artwork...";
  }
  if (/metadata was incomplete/i.test(value)) {
    return "Some track details were missing. The download can still finish.";
  }
  if (/download finished\. finalizing output/i.test(value)) {
    return "Wrapping up your file...";
  }

  return value;
}

function prettifyErrorMessage(message) {
  const value = typeof message === "string" ? message.trim() : "";
  if (!value) {
    return "";
  }

  if (/requested format is not available/i.test(value)) {
    return "That exact source version is not available right now. Try Max Available or pick another format.";
  }
  if (/ffprobe and ffmpeg not found/i.test(value)) {
    return "ffmpeg is missing, so the file could not be finished.";
  }
  if (/python 3 was not found/i.test(value)) {
    return "Python is not available yet. Install it, then try again.";
  }
  if (/outside the approved output folders/i.test(value)) {
    return "Pick one of your saved folders before starting this download.";
  }
  if (/private video/i.test(value)) {
    return "This video is private and cannot be downloaded.";
  }
  if (/age restricted/i.test(value)) {
    return "This video is age restricted and could not be downloaded in the current setup.";
  }

  return value;
}

function setInlineFeedback(elementId, message, type = "neutral") {
  const feedbackEl = byId(elementId);
  feedbackEl.textContent = message;
  feedbackEl.classList.remove("feedback-ok", "feedback-error", "feedback-warn");

  if (type === "ok") {
    feedbackEl.classList.add("feedback-ok");
  } else if (type === "error") {
    feedbackEl.classList.add("feedback-error");
  } else if (type === "warn") {
    feedbackEl.classList.add("feedback-warn");
  }
}

function setFeedback(message, type = "neutral") {
  setInlineFeedback("input-feedback", message, type);
}

function setSettingsFeedback(message, type = "neutral") {
  setInlineFeedback("settings-feedback", message, type);
}

function setUpdateFeedback(message, type = "neutral") {
  setInlineFeedback("update-feedback", message, type);
}

function setDownloadMetrics(message) {
  byId("download-metrics").textContent = message;
}

function updateProgress(percent) {
  const progressEl = byId("download-progress");
  const safePercent =
    typeof percent === "number" && Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;
  progressEl.value = safePercent;
}

function populateQualityOptions() {
  const formatId = byId("format-select").value;
  const qualitySelect = byId("quality-select");
  const options = QUALITY_OPTIONS[formatId] || [{ value: "best", label: "Max Available" }];

  qualitySelect.innerHTML = options
    .map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`)
    .join("");
}

function collectInputPayload() {
  return {
    url: byId("url-input").value,
    formatId: byId("format-select").value,
    quality: byId("quality-select").value,
    trimStart: byId("trim-start-input").value,
    trimEnd: byId("trim-end-input").value
  };
}

function formatTrimLabel(trim) {
  return trim ? `${trim.startInput} -> ${trim.endInput}` : "Full download";
}

async function validateInput(showSuccessMessage = true) {
  if (!window.appApi) {
    setFeedback("Desktop bridge is unavailable in this renderer.", "error");
    return null;
  }

  const payload = collectInputPayload();
  const validation = await window.appApi.validateDownloadInput(payload);

  if (!validation.ok) {
    const firstError =
      validation.errors && validation.errors.length > 0 ? validation.errors[0] : "Input validation failed.";
    setFeedback(firstError, "error");
    return validation;
  }

  if (showSuccessMessage) {
    const trimMessage = validation.data.trim ? ` Trim: ${formatTrimLabel(validation.data.trim)}.` : "";

    if (validation.data.sourceKind === "playlist") {
      setFeedback(`Playlist URL is valid.${trimMessage} Adding it will expand the queue.`, "ok");
    } else {
      setFeedback(`Input is valid.${trimMessage}`, "ok");
    }
  }

  return validation;
}

function humanBytes(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return "n/a";
  }
  const units = ["B", "KB", "MB", "GB"];
  let unitIndex = 0;
  let current = value;
  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024;
    unitIndex += 1;
  }
  return `${current.toFixed(current >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function humanSpeed(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return "n/a";
  }
  return `${humanBytes(value)}/s`;
}

function humanEta(seconds) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) {
    return "n/a";
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (mins === 0) {
    return `${secs}s`;
  }
  return `${mins}m ${secs}s`;
}

function getActiveItem(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.queue)) {
    return null;
  }

  if (snapshot.activeItemId) {
    const activeById = snapshot.queue.find((item) => item.id === snapshot.activeItemId);
    if (activeById) {
      return activeById;
    }
  }

  return snapshot.queue.find((item) => item.status === "active") || null;
}

function renderQueueCounts(snapshot) {
  const counts = snapshot.counts || {};
  const entries = [
    { label: "Pending", value: counts.pending || 0 },
    { label: "Active", value: counts.active || 0 },
    { label: "Paused", value: counts.paused || 0 },
    { label: "Completed", value: counts.completed || 0 },
    { label: "Failed", value: counts.failed || 0 }
  ];

  byId("queue-counts").innerHTML = entries
    .map(
      (entry) =>
        `<span class="count-chip"><span>${escapeHtml(entry.label)}</span><strong>${entry.value}</strong></span>`
    )
    .join("");
}

function renderActiveDownload(snapshot) {
  const titleEl = byId("active-download-title");
  const subtitleEl = byId("active-download-subtitle");
  const activeItem = getActiveItem(snapshot);

  if (!activeItem) {
    titleEl.textContent = "No active download";
    subtitleEl.textContent = "Queue is quiet. Add a link whenever you are ready.";
    updateProgress(0);
    setDownloadMetrics("No active download.");
    return;
  }

  const percent =
    typeof activeItem.progress.percent === "number" && Number.isFinite(activeItem.progress.percent)
      ? activeItem.progress.percent
      : 0;
  titleEl.textContent = activeItem.title || activeItem.url;
  subtitleEl.textContent = [
    FORMAT_LABELS[activeItem.formatId] || activeItem.formatId,
    qualityLabel(activeItem.formatId, activeItem.quality),
    activeItem.trim ? `Trim ${formatTrimLabel(activeItem.trim)}` : "Full download",
    `To ${folderLabel(activeItem.outputDir)}`
  ].join(" • ");
  updateProgress(percent);
  const note = prettifyStatusMessage(activeItem.latestMessage);
  const metrics = [
    `${percent.toFixed(1)}% complete`,
    `${humanBytes(activeItem.progress.downloadedBytes)} of ${humanBytes(activeItem.progress.totalBytes)}`,
    `${humanSpeed(activeItem.progress.speedBps)}`,
    `${humanEta(activeItem.progress.etaSeconds)} left`
  ];
  setDownloadMetrics(note ? `${note} ${metrics.join(" • ")}` : metrics.join(" • "));
}

function renderQueueItem(item) {
  const subtitleBits = [
    FORMAT_LABELS[item.formatId] || item.formatId,
    qualityLabel(item.formatId, item.quality)
  ];

  if (item.trim) {
    subtitleBits.push(`Trim ${formatTrimLabel(item.trim)}`);
  }

  if (item.playlistTitle && item.playlistIndex) {
    subtitleBits.push(`${item.playlistTitle} #${item.playlistIndex}`);
  }

  if (item.attemptCount > 1) {
    subtitleBits.push(`Attempt ${item.attemptCount}`);
  }

  const statusLabel = STATUS_LABELS[item.status] || item.status;
  const statusClass = `queue-status queue-status-${item.status}`;
  const percent =
    typeof item.progress.percent === "number" && Number.isFinite(item.progress.percent)
      ? item.progress.percent
      : item.status === "completed"
        ? 100
        : 0;
  const friendlyMessage =
    item.status === "failed" || item.status === "cancelled"
      ? prettifyErrorMessage(item.errorMessage || item.latestMessage)
      : prettifyStatusMessage(item.latestMessage);
  const metricsText =
    item.status === "active"
      ? `${humanSpeed(item.progress.speedBps)} • ${humanBytes(item.progress.downloadedBytes)} of ${humanBytes(item.progress.totalBytes)} • ${humanEta(item.progress.etaSeconds)} left`
      : item.status === "paused"
        ? `${percent.toFixed(1)}% saved so far`
        : item.status === "completed"
          ? "Finished and saved."
          : item.status === "failed"
            ? "Needs attention."
            : item.status === "cancelled"
              ? "Stopped before completion."
              : "Waiting for its turn.";

  let controls = "";
  if (item.status === "active") {
    controls = `
      <div class="queue-item-actions">
        <button type="button" data-action="pause" data-item-id="${escapeHtml(item.id)}">Pause</button>
        <button type="button" data-action="cancel" data-item-id="${escapeHtml(item.id)}">Cancel</button>
      </div>
    `;
  } else if (item.status === "paused") {
    controls = `
      <div class="queue-item-actions">
        <button type="button" data-action="resume" data-item-id="${escapeHtml(item.id)}">Resume</button>
        <button type="button" data-action="cancel" data-item-id="${escapeHtml(item.id)}">Cancel</button>
      </div>
    `;
  } else if (item.status === "pending") {
    controls = `
      <div class="queue-item-actions">
        <button type="button" data-action="cancel" data-item-id="${escapeHtml(item.id)}">Cancel</button>
      </div>
    `;
  }

  const outputLine =
    item.outputPath && item.status === "completed"
      ? `<div class="queue-item-path" title="${escapeHtml(item.outputPath)}">Saved to ${escapeHtml(shortPath(item.outputPath, 110))}</div>`
      : "";
  const routeLine = item.outputDir && item.status !== "completed"
    ? `<div class="queue-item-route" title="${escapeHtml(item.outputDir)}">Going to ${escapeHtml(shortPath(item.outputDir, 96))}</div>`
    : "";
  const errorLine =
    item.errorMessage && (item.status === "failed" || item.status === "cancelled")
      ? `<div class="queue-item-error">${escapeHtml(prettifyErrorMessage(item.errorMessage))}</div>`
      : "";
  const messageLine = friendlyMessage
    ? `<p class="queue-item-message">${escapeHtml(friendlyMessage)}</p>`
    : "";

  return `
    <article class="queue-item">
      <div class="queue-item-top">
        <div>
          <h4>${escapeHtml(item.title || item.url)}</h4>
          <p class="queue-item-subtitle">${escapeHtml(subtitleBits.join(" | "))}</p>
        </div>
        <span class="${statusClass}">${escapeHtml(statusLabel)}</span>
      </div>
      <div class="queue-item-progress">
        <div class="mini-progress">
          <span class="mini-progress-fill" style="width:${Math.max(0, Math.min(100, percent))}%"></span>
        </div>
        <p class="queue-item-metrics">${escapeHtml(metricsText)}</p>
      </div>
      ${messageLine}
      ${routeLine}
      ${outputLine}
      ${errorLine}
      ${controls}
    </article>
  `;
}

function renderQueueSection(title, items) {
  if (!items.length) {
    return "";
  }

  return `
    <section class="queue-section">
      <div class="queue-section-header">
        <h3>${escapeHtml(title)}</h3>
        <span>${items.length}</span>
      </div>
      <div class="queue-section-items">
        ${items.map(renderQueueItem).join("")}
      </div>
    </section>
  `;
}

function renderQueue(snapshot) {
  const queueContainer = byId("queue-sections");
  const emptyEl = byId("queue-empty");
  const items = Array.isArray(snapshot.queue) ? snapshot.queue : [];

  if (items.length === 0) {
    queueContainer.innerHTML = "";
    emptyEl.hidden = false;
    return;
  }

  emptyEl.hidden = true;

  const active = items.filter((item) => item.status === "active");
  const pending = items.filter((item) => item.status === "pending");
  const paused = items.filter((item) => item.status === "paused");
  const completed = items.filter((item) => item.status === "completed");
  const failed = items.filter((item) => item.status === "failed");
  const cancelled = items.filter((item) => item.status === "cancelled");

  queueContainer.innerHTML = [
    renderQueueSection("Active", active),
    renderQueueSection("Pending", pending),
    renderQueueSection("Paused", paused),
    renderQueueSection("Completed", completed),
    renderQueueSection("Failed", failed),
    renderQueueSection("Cancelled", cancelled)
  ].join("");
}

function setQueueSnapshot(snapshot) {
  latestQueueSnapshot = snapshot || latestQueueSnapshot;
  renderQueueCounts(latestQueueSnapshot);
  renderActiveDownload(latestQueueSnapshot);
  renderQueue(latestQueueSnapshot);
}

function renderSettings(settings) {
  latestSettings = settings || latestSettings;

  if (!latestSettings) {
    return;
  }

  byId("video-output-input").value = latestSettings.outputDirectories?.video || "";
  byId("audio-output-input").value = latestSettings.outputDirectories?.audio || "";
}

function collectSettingsPayload() {
  return {
    videoOutputDir: byId("video-output-input").value,
    audioOutputDir: byId("audio-output-input").value
  };
}

async function browseForDirectory(kind) {
  const inputId = kind === "audio" ? "audio-output-input" : "video-output-input";
  const result = await window.appApi.pickDirectory({
    kind,
    currentPath: byId(inputId).value
  });

  if (!result.ok) {
    return;
  }

  byId(inputId).value = result.path;
  setSettingsFeedback(
    `${kind === "audio" ? "Audio" : "Video"} folder selected. Save folders to apply new routing.`,
    "warn"
  );
}

async function saveSettings() {
  const saveButton = byId("save-settings-btn");
  saveButton.disabled = true;
  saveButton.textContent = "Saving...";

  try {
    const result = await window.appApi.saveSettings(collectSettingsPayload());
    if (!result.ok) {
      setSettingsFeedback(result.message || "Settings could not be saved.", "error");
      return;
    }

    renderSettings(result.settings);
    setSettingsFeedback("Output folders saved. New queue items will route to these approved paths.", "ok");
  } catch (error) {
    setSettingsFeedback(`Settings save failed: ${error.message}`, "error");
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = "Save Folders";
  }
}

async function resetSettings() {
  const result = await window.appApi.resetSettings();
  if (!result.ok) {
    setSettingsFeedback(result.message || "Settings could not be reset.", "error");
    return;
  }

  renderSettings(result.settings);
  setSettingsFeedback("Output folders reset to their default approved locations.", "ok");
}

async function addToQueue() {
  const validation = await validateInput(false);
  if (!validation || !validation.ok) {
    return;
  }

  const result = await window.appApi.startDownload(collectInputPayload());
  if (!result.ok) {
    setFeedback(result.message || "Queue add failed.", "error");
    return;
  }

  if (result.addedCount > 1) {
    const playlistSuffix = result.playlistTitle ? ` from ${result.playlistTitle}` : "";
    setFeedback(`Added ${result.addedCount} items to the queue${playlistSuffix}.`, "ok");
  } else {
    setFeedback("Added item to the queue.", "ok");
  }
}

async function handleQueueAction(action, itemId) {
  let result;

  if (action === "pause") {
    result = await window.appApi.pauseDownload(itemId);
  } else if (action === "resume") {
    result = await window.appApi.resumeDownload(itemId);
  } else if (action === "cancel") {
    result = await window.appApi.cancelDownload(itemId);
  } else {
    return;
  }

  if (!result.ok) {
    setFeedback(result.message || "Queue action failed.", "warn");
    return;
  }

  if (action === "pause") {
    setFeedback("Queue item paused.", "warn");
  } else if (action === "resume") {
    setFeedback("Queue item resumed.", "ok");
  } else if (action === "cancel") {
    setFeedback("Queue item cancelled.", "warn");
  }
}

async function loadInitialStatus() {
  if (!window.appApi) {
    renderStatus(null);
    return;
  }

  const initialStatus = await window.appApi.getDependencyStatus();
  renderStatus(initialStatus);
}

async function loadInitialQueue() {
  if (!window.appApi) {
    setQueueSnapshot({
      queue: [],
      activeItemId: null,
      counts: {
        total: 0,
        pending: 0,
        active: 0,
        paused: 0,
        completed: 0,
        failed: 0,
        cancelled: 0
      }
    });
    return;
  }

  const queueState = await window.appApi.getQueueState();
  setQueueSnapshot(queueState);
}

async function loadInitialSettings() {
  if (!window.appApi) {
    setSettingsFeedback("Desktop bridge is unavailable in this renderer.", "error");
    return;
  }

  const settings = await window.appApi.getSettings();
  renderSettings(settings);
  setSettingsFeedback("Set these once and new downloads will keep using them.", "neutral");
}

async function recheckDependencies() {
  const button = byId("recheck-btn");
  button.disabled = true;
  button.textContent = "Checking...";

  try {
    const status = await window.appApi.checkDependencies();
    renderStatus(status);
  } catch (error) {
    renderStatus({
      message: `Dependency check failed: ${error.message}`,
      checks: [],
      checkedAt: new Date().toISOString()
    });
  } finally {
    button.disabled = false;
    button.textContent = "Recheck";
  }
}

async function updateYtdlp() {
  const button = byId("update-ytdlp-btn");
  button.disabled = true;
  button.textContent = "Awaiting...";
  setUpdateFeedback("Awaiting confirmation in the desktop app...", "warn");

  try {
    const result = await window.appApi.updateYtdlp();
    if (!result.ok) {
      if (result.cancelled) {
        setUpdateFeedback("yt-dlp update cancelled.", "warn");
      } else {
        setUpdateFeedback(result.message || "yt-dlp update failed.", "error");
      }
      return;
    }

    setUpdateFeedback("yt-dlp update completed. Dependency status was refreshed.", "ok");
  } catch (error) {
    setUpdateFeedback(`yt-dlp update failed: ${error.message}`, "error");
  } finally {
    button.disabled = false;
    button.textContent = "Update yt-dlp";
  }
}

window.addEventListener("DOMContentLoaded", () => {
  populateQualityOptions();
  renderQueueCounts(latestQueueSnapshot);

  byId("format-select").addEventListener("change", populateQualityOptions);
  byId("validate-btn").addEventListener("click", () => {
    validateInput(true).catch((error) => {
      setFeedback(`Validation failed: ${error.message}`, "error");
    });
  });
  byId("download-btn").addEventListener("click", () => {
    addToQueue().catch((error) => {
      setFeedback(`Queue add failed: ${error.message}`, "error");
    });
  });
  byId("queue-sections").addEventListener("click", (event) => {
    const target = event.target.closest("button[data-action]");
    if (!target) {
      return;
    }

    handleQueueAction(target.dataset.action, target.dataset.itemId).catch((error) => {
      setFeedback(`Queue action failed: ${error.message}`, "error");
    });
  });
  byId("recheck-btn").addEventListener("click", recheckDependencies);
  byId("update-ytdlp-btn").addEventListener("click", () => {
    updateYtdlp().catch((error) => {
      setUpdateFeedback(`yt-dlp update failed: ${error.message}`, "error");
    });
  });
  byId("browse-video-btn").addEventListener("click", () => {
    browseForDirectory("video").catch((error) => {
      setSettingsFeedback(`Folder picker failed: ${error.message}`, "error");
    });
  });
  byId("browse-audio-btn").addEventListener("click", () => {
    browseForDirectory("audio").catch((error) => {
      setSettingsFeedback(`Folder picker failed: ${error.message}`, "error");
    });
  });
  byId("save-settings-btn").addEventListener("click", () => {
    saveSettings().catch((error) => {
      setSettingsFeedback(`Settings save failed: ${error.message}`, "error");
    });
  });
  byId("reset-settings-btn").addEventListener("click", () => {
    resetSettings().catch((error) => {
      setSettingsFeedback(`Settings reset failed: ${error.message}`, "error");
    });
  });

  if (window.appApi) {
    window.appApi.onDependencyStatus((status) => {
      renderStatus(status);
    });
    window.appApi.onQueueUpdated((snapshot) => {
      setQueueSnapshot(snapshot);
    });
    window.appApi.onSettingsUpdated((settings) => {
      renderSettings(settings);
    });
  }

  loadInitialStatus().catch((error) => {
    renderStatus({
      message: `Dependency check failed: ${error.message}`,
      checks: [],
      checkedAt: new Date().toISOString()
    });
  });
  loadInitialQueue().catch((error) => {
    setFeedback(`Queue state failed to load: ${error.message}`, "error");
  });
  loadInitialSettings().catch((error) => {
    setSettingsFeedback(`Settings failed to load: ${error.message}`, "error");
  });
  setUpdateFeedback("Updates stay manual and local to this machine.", "neutral");
});
