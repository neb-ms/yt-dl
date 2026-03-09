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

function renderDependency(check) {
  const badgeClass = check.available ? "badge badge-ok" : "badge badge-missing";
  const badgeLabel = check.available ? "Available" : "Missing";
  const pathText = check.path ? `<code>${escapeHtml(check.path)}</code>` : "not found";
  const hintText = check.installHint ? escapeHtml(check.installHint) : "n/a";

  return `
    <li class="dependency-item">
      <div class="dependency-header">
        <span class="dependency-name">${escapeHtml(check.name)}</span>
        <span class="${badgeClass}">${badgeLabel}</span>
      </div>
      <div class="dependency-meta">Path: ${pathText}</div>
      <div class="dependency-meta">Install hint: ${hintText}</div>
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

  const checkedAt = status.checkedAt ? `Last checked: ${status.checkedAt}` : "Not checked yet";
  messageEl.textContent = `${status.message} ${checkedAt}`;
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

let activeDownloadId = null;

function setFeedback(message, type = "neutral") {
  const feedbackEl = byId("input-feedback");
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

function setDownloadMetrics(message) {
  byId("download-metrics").textContent = message;
}

function updateProgress(percent) {
  const progressEl = byId("download-progress");
  const safePercent =
    typeof percent === "number" && Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0;
  progressEl.value = safePercent;
}

function setDownloadControlsState(isActive) {
  byId("download-btn").disabled = isActive;
  byId("cancel-btn").disabled = !isActive;
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

async function validateInput(showSuccessMessage = true) {
  if (!window.appApi) {
    setFeedback("Desktop bridge is unavailable in this renderer.", "error");
    return null;
  }

  const payload = collectInputPayload();
  const validation = await window.appApi.validateDownloadInput(payload);

  if (!validation.ok) {
    const firstError = validation.errors && validation.errors.length > 0
      ? validation.errors[0]
      : "Input validation failed.";
    setFeedback(firstError, "error");
    return validation;
  }

  if (showSuccessMessage) {
    const trim = validation.data.trim;
    const trimMessage = trim ? ` Trim range: ${trim.startInput} -> ${trim.endInput}.` : "";

    if (validation.data.sourceKind === "playlist") {
      setFeedback(
        `Playlist URL is valid.${trimMessage} Current flow downloads the first item only.`,
        "warn"
      );
    } else if (trim) {
      setFeedback(`Input is valid.${trimMessage}`, "ok");
    } else {
      setFeedback("Input is valid. Ready to download.", "ok");
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

async function startDownload() {
  const validation = await validateInput(false);
  if (!validation || !validation.ok) {
    return;
  }

  if (activeDownloadId) {
    setFeedback("A download is already active.", "warn");
    return;
  }

  const startResult = await window.appApi.startDownload(collectInputPayload());
  if (!startResult.ok) {
    setFeedback(startResult.message || "Download could not be started.", "error");
    return;
  }

  activeDownloadId = startResult.downloadId;
  updateProgress(0);
  setDownloadControlsState(true);
  const trim = validation.data.trim;
  const trimSuffix = trim ? ` | Trim: ${trim.startInput} -> ${trim.endInput}` : "";
  setDownloadMetrics(`Download started. Output folder: ${startResult.outputDir}${trimSuffix}`);

  if (startResult.note) {
    setFeedback(startResult.note, "warn");
  } else {
    setFeedback("Download started.", "ok");
  }
}

async function cancelDownload() {
  if (!activeDownloadId) {
    return;
  }

  const result = await window.appApi.cancelDownload();
  if (!result.ok) {
    setFeedback(result.message || "No active download to cancel.", "warn");
    return;
  }

  activeDownloadId = null;
  setDownloadControlsState(false);
  setFeedback("Download cancelled.", "warn");
  setDownloadMetrics("Download cancelled by user.");
}

function handleDownloadEvent(payload) {
  if (!payload) {
    return;
  }

  if (activeDownloadId && payload.downloadId && payload.downloadId !== activeDownloadId) {
    return;
  }

  if (payload.event === "progress") {
    const percent =
      typeof payload.percent === "number" && Number.isFinite(payload.percent)
        ? payload.percent
        : 0;
    updateProgress(percent);
    setDownloadMetrics(
      `Progress: ${percent.toFixed(1)}% | Speed: ${humanSpeed(payload.speedBps)} | ` +
        `Downloaded: ${humanBytes(payload.downloadedBytes)} / ${humanBytes(payload.totalBytes)} | ` +
        `ETA: ${humanEta(payload.etaSeconds)}`
    );
    return;
  }

  if (payload.event === "status") {
    const level = payload.level === "error" ? "error" : payload.level === "warning" ? "warn" : "neutral";
    setFeedback(payload.message || "Status updated.", level);
    return;
  }

  if (payload.event === "complete") {
    activeDownloadId = null;
    setDownloadControlsState(false);
    updateProgress(100);
    setFeedback(payload.message || "Download complete.", "ok");
    const pathText = payload.outputPath ? `Saved to: ${payload.outputPath}` : "Saved to output directory.";
    setDownloadMetrics(pathText);
    return;
  }

  if (payload.event === "error") {
    activeDownloadId = null;
    setDownloadControlsState(false);
    setFeedback(payload.message || "Download failed.", "error");
    setDownloadMetrics("Download failed. Review message above and retry.");
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

window.addEventListener("DOMContentLoaded", () => {
  populateQualityOptions();
  byId("format-select").addEventListener("change", populateQualityOptions);
  byId("validate-btn").addEventListener("click", () => {
    validateInput(true).catch((error) => {
      setFeedback(`Validation failed: ${error.message}`, "error");
    });
  });
  byId("download-btn").addEventListener("click", () => {
    startDownload().catch((error) => {
      setFeedback(`Download start failed: ${error.message}`, "error");
    });
  });
  byId("cancel-btn").addEventListener("click", () => {
    cancelDownload().catch((error) => {
      setFeedback(`Cancel failed: ${error.message}`, "error");
    });
  });

  byId("recheck-btn").addEventListener("click", recheckDependencies);

  if (window.appApi) {
    window.appApi.onDependencyStatus((status) => {
      renderStatus(status);
    });
    window.appApi.onDownloadEvent(handleDownloadEvent);
  }

  loadInitialStatus().catch((error) => {
    renderStatus({
      message: `Dependency check failed: ${error.message}`,
      checks: [],
      checkedAt: new Date().toISOString()
    });
  });
});
