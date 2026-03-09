const fs = require("fs");
const path = require("path");

const { findPythonExecutable, runProcess } = require("./dependencyService");

function buildUpdateCommand(python) {
  return {
    command: python.command,
    args: [...python.args, "-m", "pip", "install", "--upgrade", "--disable-pip-version-check", "yt-dlp"]
  };
}

function buildCommandPreview(commandSpec) {
  return [commandSpec.command, ...commandSpec.args].join(" ");
}

function readState(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return {};
  }
}

function writeState(filePath, nextState) {
  if (!filePath) {
    return;
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(nextState, null, 2), "utf8");
}

async function defaultConfirmUpdate({ dialogRef, browserWindow, commandPreview }) {
  if (!dialogRef || typeof dialogRef.showMessageBox !== "function") {
    throw new Error("Update confirmation dialog is unavailable.");
  }

  const result = await dialogRef.showMessageBox(browserWindow || null, {
    type: "question",
    buttons: ["Update", "Cancel"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    title: "Update yt-dlp",
    message: "Update the local yt-dlp package now?",
    detail:
      "This runs locally on your machine and does not send telemetry.\n\n" +
      `Command: ${commandPreview}`
  });

  return result.response === 0;
}

function createUpdateService({
  appRoot,
  browserWindow = null,
  dialogRef = null,
  resolvePythonInvokerFn = null,
  buildCommandEnvFn = null,
  findPythonExecutableFn = findPythonExecutable,
  runProcessFn = runProcess,
  confirmFn = null,
  stateFilePath = null,
  allowAutoUpdate = false,
  autoUpdateIntervalMs = 24 * 60 * 60 * 1000
}) {
  let updateInProgress = false;

  async function resolvePythonInvoker() {
    if (resolvePythonInvokerFn) {
      return resolvePythonInvokerFn();
    }

    return findPythonExecutableFn(appRoot);
  }

  function buildCommandEnv(extraEnv = {}) {
    if (buildCommandEnvFn) {
      return buildCommandEnvFn(extraEnv);
    }

    return {
      ...process.env,
      ...extraEnv
    };
  }

  async function runUpdate({ interactive = true, reason = "manual" } = {}) {
    if (updateInProgress) {
      return {
        ok: false,
        message: "yt-dlp update is already in progress."
      };
    }

    updateInProgress = true;

    try {
      const python = await resolvePythonInvoker();
      if (!python) {
        return {
          ok: false,
          message: "Python 3 was not found. Install Python before updating yt-dlp."
        };
      }

      const commandSpec = buildUpdateCommand(python);
      const commandPreview = buildCommandPreview(commandSpec);
      let isConfirmed = true;

      if (interactive) {
        isConfirmed = confirmFn
          ? await confirmFn({ python, commandSpec, commandPreview })
          : await defaultConfirmUpdate({ dialogRef, browserWindow, commandPreview });
      }

      if (!isConfirmed) {
        return {
          ok: false,
          cancelled: true,
          message: "yt-dlp update cancelled."
        };
      }

      const result = await runProcessFn(commandSpec.command, commandSpec.args, {
        cwd: appRoot,
        env: buildCommandEnv({
          PYTHONUNBUFFERED: "1"
        })
      });

      if (result.exitCode !== 0) {
        return {
          ok: false,
          message: "yt-dlp update failed.",
          reason,
          commandPreview,
          stdout: result.stdout.trim(),
          stderr: result.stderr.trim(),
          exitCode: result.exitCode
        };
      }

      return {
        ok: true,
        message: "yt-dlp update completed successfully.",
        reason,
        commandPreview,
        stdout: result.stdout.trim(),
        stderr: result.stderr.trim()
      };
    } finally {
      updateInProgress = false;
    }
  }

  async function updateYtdlp(options = {}) {
    return runUpdate({
      interactive: options.interactive !== false,
      reason: options.reason || "manual"
    });
  }

  async function maybeAutoUpdateYtdlp() {
    if (!allowAutoUpdate || !stateFilePath) {
      return {
        ok: true,
        skipped: true,
        reason: "disabled"
      };
    }

    const state = readState(stateFilePath);
    const lastAttemptAt = Date.parse(state.lastAttemptAt || "");
    if (Number.isFinite(lastAttemptAt) && Date.now() - lastAttemptAt < autoUpdateIntervalMs) {
      return {
        ok: true,
        skipped: true,
        reason: "recent"
      };
    }

    const result = await runUpdate({
      interactive: false,
      reason: "startup-auto"
    });

    const nextState = {
      ...state,
      lastAttemptAt: new Date().toISOString(),
      lastOutcome: result.ok ? "success" : "failed",
      lastErrorMessage: result.ok ? null : result.message || result.stderr || null
    };

    if (result.ok) {
      nextState.lastSuccessAt = nextState.lastAttemptAt;
    }

    writeState(stateFilePath, nextState);

    return {
      ...result,
      updated: Boolean(result.ok)
    };
  }

  return {
    buildUpdateCommand,
    maybeAutoUpdateYtdlp,
    updateYtdlp
  };
}

module.exports = {
  buildUpdateCommand,
  createUpdateService
};
