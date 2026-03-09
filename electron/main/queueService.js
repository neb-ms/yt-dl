const fs = require("fs");
const path = require("path");
const { EventEmitter } = require("events");
const { spawn } = require("child_process");
const { findPythonExecutable } = require("./dependencyService");
const { probeDownloadInput } = require("./probeService");

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

function makeQueueItemId() {
  return `queue_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function getDefaultOutputDir(downloadsRoot, formatType) {
  const subdir = formatType === "video" ? "yt-dl-videos" : "yt-dl-audio";
  return path.join(downloadsRoot, subdir);
}

function buildTrimRunnerArgs(trim) {
  if (!trim) {
    return [];
  }

  return [
    "--trim-start-seconds",
    String(trim.startSeconds),
    "--trim-end-seconds",
    String(trim.endSeconds)
  ];
}

function buildRunnerOptionsArgs(runnerOptions = {}) {
  const args = [];
  if (
    typeof runnerOptions.rateLimitBps === "number" &&
    Number.isFinite(runnerOptions.rateLimitBps) &&
    runnerOptions.rateLimitBps > 0
  ) {
    args.push("--rate-limit-bps", String(Math.floor(runnerOptions.rateLimitBps)));
  }
  return args;
}

function createProgressState() {
  return {
    percent: null,
    downloadedBytes: null,
    totalBytes: null,
    speedBps: null,
    etaSeconds: null
  };
}

function cloneProgress(progress) {
  return {
    percent: progress.percent,
    downloadedBytes: progress.downloadedBytes,
    totalBytes: progress.totalBytes,
    speedBps: progress.speedBps,
    etaSeconds: progress.etaSeconds
  };
}

function normalizeSourceKind(sourceKind) {
  return sourceKind === "playlist" ? "video" : sourceKind;
}

function createQueueItem({ input, entry, outputDir, runnerOptions }) {
  return {
    id: makeQueueItemId(),
    title: entry.title || entry.url,
    url: entry.url,
    sourceKind: normalizeSourceKind(entry.sourceKind || input.sourceKind),
    status: "pending",
    formatId: input.formatId,
    formatType: input.formatType,
    quality: input.quality,
    trim: input.trim,
    outputDir,
    outputPath: null,
    playlistTitle: entry.playlistTitle || null,
    playlistIndex: entry.playlistIndex || null,
    errorMessage: null,
    latestMessage: "Queued.",
    createdAt: nowIso(),
    startedAt: null,
    completedAt: null,
    attemptCount: 0,
    progress: createProgressState(),
    runnerOptions: runnerOptions || {}
  };
}

function serializeItem(item) {
  return {
    id: item.id,
    title: item.title,
    url: item.url,
    sourceKind: item.sourceKind,
    status: item.status,
    formatId: item.formatId,
    formatType: item.formatType,
    quality: item.quality,
    trim: item.trim,
    outputDir: item.outputDir,
    outputPath: item.outputPath,
    playlistTitle: item.playlistTitle,
    playlistIndex: item.playlistIndex,
    errorMessage: item.errorMessage,
    latestMessage: item.latestMessage,
    createdAt: item.createdAt,
    startedAt: item.startedAt,
    completedAt: item.completedAt,
    attemptCount: item.attemptCount,
    progress: cloneProgress(item.progress)
  };
}

function buildCounts(items) {
  return items.reduce(
    (counts, item) => {
      counts.total += 1;
      counts[item.status] = (counts[item.status] || 0) + 1;
      return counts;
    },
    {
      total: 0,
      pending: 0,
      active: 0,
      paused: 0,
      completed: 0,
      failed: 0,
      cancelled: 0
    }
  );
}

function createQueueService({ appRoot, downloadsRoot, resolveOutputDirectory, onQueueUpdated }) {
  const emitter = new EventEmitter();
  const queueItems = [];
  let activeTask = null;
  let launchInProgress = false;

  function getResolvedOutputDirectory(formatType) {
    if (typeof resolveOutputDirectory === "function") {
      return resolveOutputDirectory(formatType);
    }

    if (typeof downloadsRoot === "string" && downloadsRoot.trim()) {
      return {
        ok: true,
        kind: formatType === "video" ? "video" : "audio",
        path: getDefaultOutputDir(downloadsRoot, formatType)
      };
    }

    return {
      ok: false,
      message: "Output routing is not configured."
    };
  }

  function getItem(itemId) {
    return queueItems.find((item) => item.id === itemId) || null;
  }

  function getSnapshot() {
    return {
      queue: queueItems.map(serializeItem),
      activeItemId: activeTask ? activeTask.itemId : null,
      counts: buildCounts(queueItems)
    };
  }

  function notifyQueueUpdated() {
    const snapshot = getSnapshot();
    onQueueUpdated?.(snapshot);
    emitter.emit("queue-updated", snapshot);
  }

  function setItemProgress(item, payload) {
    if (typeof payload.percent === "number" && Number.isFinite(payload.percent)) {
      item.progress.percent = payload.percent;
    }
    if (typeof payload.downloadedBytes === "number" && Number.isFinite(payload.downloadedBytes)) {
      item.progress.downloadedBytes = payload.downloadedBytes;
    }
    if (typeof payload.totalBytes === "number" && Number.isFinite(payload.totalBytes)) {
      item.progress.totalBytes = payload.totalBytes;
    }
    if (typeof payload.speedBps === "number" && Number.isFinite(payload.speedBps)) {
      item.progress.speedBps = payload.speedBps;
    }
    if (typeof payload.etaSeconds === "number" && Number.isFinite(payload.etaSeconds)) {
      item.progress.etaSeconds = payload.etaSeconds;
    }
  }

  function scheduleForceKill(task) {
    if (task.killTimer) {
      clearTimeout(task.killTimer);
    }
    task.killTimer = setTimeout(() => {
      if (task.child && !task.child.killed) {
        task.child.kill("SIGKILL");
      }
    }, 5000);
  }

  function clearForceKill(task) {
    if (task && task.killTimer) {
      clearTimeout(task.killTimer);
      task.killTimer = null;
    }
  }

  async function pumpQueue() {
    if (activeTask || launchInProgress) {
      return;
    }

    const nextItem = queueItems.find((item) => item.status === "pending");
    if (!nextItem) {
      notifyQueueUpdated();
      return;
    }

    launchInProgress = true;

    try {
      const python = await findPythonExecutable(appRoot);
      if (!python) {
        nextItem.status = "failed";
        nextItem.errorMessage =
          "Python 3 was not found. Install Python and rerun scripts/setup-python.ps1 before downloading.";
        nextItem.latestMessage = nextItem.errorMessage;
        nextItem.completedAt = nowIso();
        notifyQueueUpdated();
        return;
      }

      fs.mkdirSync(nextItem.outputDir, { recursive: true });

      const runnerPath = path.join(appRoot, "python", "runner.py");
      const runnerArgs = [
        runnerPath,
        "--url",
        nextItem.url,
        "--source-kind",
        nextItem.sourceKind,
        "--format-id",
        nextItem.formatId,
        "--quality",
        nextItem.quality,
        "--output-dir",
        nextItem.outputDir,
        "--download-id",
        nextItem.id,
        ...buildTrimRunnerArgs(nextItem.trim),
        ...buildRunnerOptionsArgs(nextItem.runnerOptions)
      ];

      const child = spawn(python.command, [...python.args, ...runnerArgs], {
        cwd: appRoot,
        env: {
          ...process.env,
          PYTHONUNBUFFERED: "1"
        },
        windowsHide: true
      });

      activeTask = {
        itemId: nextItem.id,
        child,
        intent: "run",
        completionEmitted: false,
        errorEmitted: false,
        killTimer: null
      };

      nextItem.status = "active";
      nextItem.errorMessage = null;
      nextItem.latestMessage = nextItem.attemptCount > 0 ? "Resuming download..." : "Download started.";
      nextItem.startedAt = nowIso();
      nextItem.completedAt = null;
      nextItem.attemptCount += 1;
      notifyQueueUpdated();

      let stdoutBuffer = "";

      function handleJsonPayload(payload) {
        if (payload.event === "progress") {
          setItemProgress(nextItem, payload);
          nextItem.latestMessage = "Downloading...";
          notifyQueueUpdated();
          return;
        }

        if (payload.event === "status") {
          nextItem.latestMessage = payload.message || nextItem.latestMessage;
          notifyQueueUpdated();
          return;
        }

        if (payload.event === "complete") {
          activeTask.completionEmitted = true;
          nextItem.status = "completed";
          nextItem.outputPath = payload.outputPath || nextItem.outputPath;
          nextItem.completedAt = nowIso();
          nextItem.progress.percent = 100;
          nextItem.progress.etaSeconds = 0;
          nextItem.latestMessage = payload.message || "Download completed successfully.";
          notifyQueueUpdated();
          return;
        }

        if (payload.event === "error") {
          activeTask.errorEmitted = true;
          nextItem.status = "failed";
          nextItem.errorMessage = payload.message || "Download failed.";
          nextItem.latestMessage = nextItem.errorMessage;
          nextItem.completedAt = nowIso();
          notifyQueueUpdated();
        }
      }

      function processStdoutChunk(chunk) {
        stdoutBuffer += chunk.toString();
        let newlineIndex = stdoutBuffer.indexOf("\n");

        while (newlineIndex !== -1) {
          const line = stdoutBuffer.slice(0, newlineIndex).trim();
          stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);

          if (line) {
            try {
              handleJsonPayload(JSON.parse(line));
            } catch {
              nextItem.latestMessage = line;
              notifyQueueUpdated();
            }
          }

          newlineIndex = stdoutBuffer.indexOf("\n");
        }
      }

      child.stdout.on("data", processStdoutChunk);

      child.stderr.on("data", (chunk) => {
        const message = chunk.toString().trim();
        if (!message) {
          return;
        }

        nextItem.latestMessage = message;
        notifyQueueUpdated();
      });

      child.on("error", (error) => {
        clearForceKill(activeTask);
        nextItem.status = "failed";
        nextItem.errorMessage = `Failed to start download process: ${error.message}`;
        nextItem.latestMessage = nextItem.errorMessage;
        nextItem.completedAt = nowIso();
        activeTask = null;
        notifyQueueUpdated();
        pumpQueue().catch(() => {});
      });

      child.on("close", (code) => {
        const task = activeTask;
        clearForceKill(task);

        if (task && task.itemId === nextItem.id && task.intent === "pause") {
          nextItem.status = "paused";
          nextItem.latestMessage = "Paused. Resume to continue.";
          activeTask = null;
          notifyQueueUpdated();
          pumpQueue().catch(() => {});
          return;
        }

        if (task && task.itemId === nextItem.id && task.intent === "cancel") {
          nextItem.status = "cancelled";
          nextItem.errorMessage = "Cancelled by user.";
          nextItem.latestMessage = nextItem.errorMessage;
          nextItem.completedAt = nowIso();
          activeTask = null;
          notifyQueueUpdated();
          pumpQueue().catch(() => {});
          return;
        }

        if (activeTask && activeTask.itemId === nextItem.id) {
          activeTask = null;
        }

        if (nextItem.status === "completed" || nextItem.status === "failed") {
          pumpQueue().catch(() => {});
          return;
        }

        if (code === 0) {
          nextItem.status = "completed";
          nextItem.progress.percent = 100;
          nextItem.progress.etaSeconds = 0;
          nextItem.completedAt = nowIso();
          nextItem.latestMessage = "Download completed successfully.";
        } else {
          nextItem.status = "failed";
          nextItem.errorMessage = "Download process exited with an error.";
          nextItem.latestMessage = nextItem.errorMessage;
          nextItem.completedAt = nowIso();
        }

        notifyQueueUpdated();
        pumpQueue().catch(() => {});
      });
    } finally {
      launchInProgress = false;
    }
  }

  async function enqueueInput(input, options = {}) {
    let itemsToAdd;
    let playlistTitle = null;
    const resolvedOutputDir = getResolvedOutputDirectory(input.formatType);

    if (!resolvedOutputDir.ok) {
      return {
        ok: false,
        message: resolvedOutputDir.message
      };
    }

    if (input.sourceKind === "playlist") {
      const probeResult = await probeDownloadInput({ appRoot, input });
      if (!probeResult.ok) {
        return {
          ok: false,
          message: probeResult.message || "Playlist could not be expanded."
        };
      }

      playlistTitle = probeResult.title || null;
      itemsToAdd = (probeResult.entries || []).map((entry) =>
        createQueueItem({
          input,
          entry: {
            ...entry,
            playlistTitle
          },
          outputDir: resolvedOutputDir.path,
          runnerOptions: options.runnerOptions
        })
      );

      if (itemsToAdd.length === 0) {
        return {
          ok: false,
          message: "Playlist expansion returned no downloadable items."
        };
      }
    } else {
      itemsToAdd = [
        createQueueItem({
          input,
          entry: {
            title: input.url,
            url: input.url,
            sourceKind: input.sourceKind
          },
          outputDir: resolvedOutputDir.path,
          runnerOptions: options.runnerOptions
        })
      ];
    }

    queueItems.push(...itemsToAdd);
    notifyQueueUpdated();
    pumpQueue().catch(() => {});

    return {
      ok: true,
      addedCount: itemsToAdd.length,
      queueIds: itemsToAdd.map((item) => item.id),
      playlistTitle
    };
  }

  function pauseDownload(itemId) {
    if (!activeTask || activeTask.itemId !== itemId) {
      return {
        ok: false,
        message: "That queue item is not currently active."
      };
    }

    const item = getItem(itemId);
    if (!item || item.status !== "active") {
      return {
        ok: false,
        message: "That queue item is not currently active."
      };
    }

    activeTask.intent = "pause";
    item.latestMessage = "Pausing...";
    notifyQueueUpdated();
    activeTask.child.kill("SIGTERM");
    scheduleForceKill(activeTask);

    return {
      ok: true,
      itemId
    };
  }

  function resumeDownload(itemId) {
    const item = getItem(itemId);
    if (!item || item.status !== "paused") {
      return {
        ok: false,
        message: "That queue item is not paused."
      };
    }

    item.status = "pending";
    item.latestMessage = "Queued to resume.";
    item.completedAt = null;
    notifyQueueUpdated();
    pumpQueue().catch(() => {});

    return {
      ok: true,
      itemId
    };
  }

  function cancelDownload(itemId) {
    const item = getItem(itemId);
    if (!item) {
      return {
        ok: false,
        message: "Queue item was not found."
      };
    }

    if (TERMINAL_STATUSES.has(item.status)) {
      return {
        ok: false,
        message: "That queue item has already finished."
      };
    }

    if (item.status === "paused" || item.status === "pending") {
      item.status = "cancelled";
      item.errorMessage = "Cancelled by user.";
      item.latestMessage = item.errorMessage;
      item.completedAt = nowIso();
      notifyQueueUpdated();
      pumpQueue().catch(() => {});
      return {
        ok: true,
        itemId
      };
    }

    if (!activeTask || activeTask.itemId !== itemId) {
      return {
        ok: false,
        message: "That queue item cannot be cancelled right now."
      };
    }

    activeTask.intent = "cancel";
    item.latestMessage = "Cancelling...";
    notifyQueueUpdated();
    activeTask.child.kill("SIGTERM");
    scheduleForceKill(activeTask);

    return {
      ok: true,
      itemId
    };
  }

  function shutdown() {
    if (activeTask && activeTask.child) {
      clearForceKill(activeTask);
      activeTask.child.kill("SIGTERM");
      activeTask = null;
    }
  }

  return {
    enqueueInput,
    getSnapshot,
    onQueueUpdated: (callback) => {
      emitter.on("queue-updated", callback);
      return () => emitter.off("queue-updated", callback);
    },
    pauseDownload,
    resumeDownload,
    cancelDownload,
    shutdown
  };
}

module.exports = {
  createQueueService
};
