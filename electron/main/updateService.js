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
  findPythonExecutableFn = findPythonExecutable,
  runProcessFn = runProcess,
  confirmFn = null
}) {
  let updateInProgress = false;

  async function updateYtdlp() {
    if (updateInProgress) {
      return {
        ok: false,
        message: "yt-dlp update is already in progress."
      };
    }

    updateInProgress = true;

    const python = await findPythonExecutableFn(appRoot);
    if (!python) {
      updateInProgress = false;
      return {
        ok: false,
        message: "Python 3 was not found. Install Python before updating yt-dlp."
      };
    }

    const commandSpec = buildUpdateCommand(python);
    const commandPreview = buildCommandPreview(commandSpec);
    const isConfirmed = confirmFn
      ? await confirmFn({ python, commandSpec, commandPreview })
      : await defaultConfirmUpdate({ dialogRef, browserWindow, commandPreview });

    if (!isConfirmed) {
      updateInProgress = false;
      return {
        ok: false,
        cancelled: true,
        message: "yt-dlp update cancelled."
      };
    }

    try {
      const result = await runProcessFn(commandSpec.command, commandSpec.args, {
        cwd: appRoot,
        env: {
          ...process.env,
          PYTHONUNBUFFERED: "1"
        }
      });

      if (result.exitCode !== 0) {
        return {
          ok: false,
          message: "yt-dlp update failed.",
          commandPreview,
          stdout: result.stdout.trim(),
          stderr: result.stderr.trim(),
          exitCode: result.exitCode
        };
      }

      return {
        ok: true,
        message: "yt-dlp update completed successfully.",
        commandPreview,
        stdout: result.stdout.trim(),
        stderr: result.stderr.trim()
      };
    } finally {
      updateInProgress = false;
    }
  }

  return {
    buildUpdateCommand,
    updateYtdlp
  };
}

module.exports = {
  buildUpdateCommand,
  createUpdateService
};
