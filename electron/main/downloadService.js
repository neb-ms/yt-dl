const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { findPythonExecutable } = require("./dependencyService");
const { FORMAT_OPTIONS } = require("./validators");

let activeDownload = null;

function hasActiveDownload() {
  return Boolean(activeDownload && !activeDownload.finished);
}

function getDefaultOutputDir(downloadsRoot, formatId) {
  const format = FORMAT_OPTIONS[formatId];
  const subdir = format && format.type === "video" ? "yt-dl-videos" : "yt-dl-audio";
  return path.join(downloadsRoot, subdir);
}

function makeDownloadId() {
  return `dl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function emitToWindow(webContents, eventPayload) {
  if (!webContents || webContents.isDestroyed()) {
    return;
  }
  webContents.send("download:event", eventPayload);
}

async function startDownload({
  appRoot,
  downloadsRoot,
  input,
  webContents
}) {
  if (hasActiveDownload()) {
    return {
      ok: false,
      message: "A download is already in progress. Wait for it to finish before starting another."
    };
  }

  const python = await findPythonExecutable(appRoot);
  if (!python) {
    return {
      ok: false,
      message:
        "Python 3 was not found. Install Python and rerun scripts/setup-python.ps1 before downloading."
    };
  }

  const outputDir = getDefaultOutputDir(downloadsRoot, input.formatId);
  fs.mkdirSync(outputDir, { recursive: true });

  const downloadId = makeDownloadId();
  const runnerPath = path.join(appRoot, "python", "runner.py");
  const runnerArgs = [
    runnerPath,
    "--url",
    input.url,
    "--source-kind",
    input.sourceKind,
    "--format-id",
    input.formatId,
    "--quality",
    input.quality,
    "--output-dir",
    outputDir,
    "--download-id",
    downloadId
  ];

  const child = spawn(python.command, [...python.args, ...runnerArgs], {
    cwd: appRoot,
    env: {
      ...process.env,
      PYTHONUNBUFFERED: "1"
    },
    windowsHide: true
  });

  activeDownload = {
    id: downloadId,
    child,
    finished: false
  };

  emitToWindow(webContents, {
    event: "status",
    downloadId,
    message:
      input.sourceKind === "playlist"
        ? "Playlist URL detected. Step 1 will download the first playlist item only."
        : "Download started."
  });

  let stdoutBuffer = "";
  let completionEmitted = false;
  let errorEmitted = false;

  function processStdoutChunk(chunk) {
    stdoutBuffer += chunk.toString();
    let newlineIndex = stdoutBuffer.indexOf("\n");

    while (newlineIndex !== -1) {
      const line = stdoutBuffer.slice(0, newlineIndex).trim();
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);

      if (line) {
        try {
          const parsed = JSON.parse(line);
          const payload = { downloadId, ...parsed };
          emitToWindow(webContents, payload);

          if (parsed.event === "complete") {
            completionEmitted = true;
          }
          if (parsed.event === "error") {
            errorEmitted = true;
          }
        } catch {
          emitToWindow(webContents, {
            event: "status",
            downloadId,
            message: line
          });
        }
      }

      newlineIndex = stdoutBuffer.indexOf("\n");
    }
  }

  child.stdout.on("data", processStdoutChunk);

  child.stderr.on("data", (chunk) => {
    const text = chunk.toString().trim();
    if (!text) {
      return;
    }
    emitToWindow(webContents, {
      event: "status",
      downloadId,
      level: "warning",
      message: text
    });
  });

  child.on("error", (error) => {
    activeDownload = null;
    errorEmitted = true;
    emitToWindow(webContents, {
      event: "error",
      downloadId,
      message: `Failed to start download process: ${error.message}`
    });
  });

  child.on("close", (code) => {
    if (activeDownload && activeDownload.id === downloadId) {
      activeDownload.finished = true;
      activeDownload = null;
    }

    if (code === 0 && !completionEmitted) {
      emitToWindow(webContents, {
        event: "complete",
        downloadId,
        message: "Download completed."
      });
      return;
    }

    if (code !== 0 && !errorEmitted) {
      emitToWindow(webContents, {
        event: "error",
        downloadId,
        message: "Download process exited with an error."
      });
    }
  });

  return {
    ok: true,
    downloadId,
    outputDir
  };
}

function cancelActiveDownload() {
  if (!activeDownload || !activeDownload.child) {
    return {
      ok: false,
      message: "No active download to cancel."
    };
  }

  activeDownload.child.kill("SIGTERM");
  const cancelledId = activeDownload.id;
  activeDownload.finished = true;
  activeDownload = null;
  return {
    ok: true,
    downloadId: cancelledId
  };
}

module.exports = {
  cancelActiveDownload,
  hasActiveDownload,
  startDownload
};

