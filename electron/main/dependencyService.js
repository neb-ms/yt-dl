const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

function buildPythonCandidates(appRoot) {
  const envPython = process.env.PYTHON_BIN;
  const candidates = [];

  if (appRoot) {
    const venvPython =
      process.platform === "win32"
        ? path.join(appRoot, ".venv", "Scripts", "python.exe")
        : path.join(appRoot, ".venv", "bin", "python");
    if (fs.existsSync(venvPython)) {
      candidates.push({ command: venvPython, args: [] });
    }
  }

  if (envPython) {
    candidates.push({ command: envPython, args: [] });
  }

  if (process.platform === "win32") {
    candidates.push({ command: "python", args: [] });
    candidates.push({ command: "py", args: ["-3"] });
    candidates.push({ command: "py", args: [] });
    candidates.push({ command: "python3", args: [] });
  } else {
    candidates.push({ command: "python3", args: [] });
    candidates.push({ command: "python", args: [] });
  }

  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = `${candidate.command}|${candidate.args.join(" ")}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (result) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      finish({ exitCode: 1, stdout, stderr, error });
    });

    child.on("close", (exitCode) => {
      finish({ exitCode, stdout, stderr });
    });
  });
}

async function findPythonExecutable(appRoot) {
  const candidates = buildPythonCandidates(appRoot);
  for (const candidate of candidates) {
    const probe = await runProcess(candidate.command, [...candidate.args, "--version"]);
    if (probe.exitCode === 0) {
      return candidate;
    }
  }
  return null;
}

function buildMissingPythonResult({ managedRuntime = false } = {}) {
  if (managedRuntime) {
    return {
      ok: false,
      managedRuntime: true,
      checkedAt: new Date().toISOString(),
      message: "The app runtime is unavailable. Reinstall or repair the app package.",
      checks: [
        {
          name: "python",
          available: false,
          path: null,
          installHint: "Reinstall or repair the app package so its managed runtime can be restored."
        },
        {
          name: "yt-dlp",
          available: false,
          path: null,
          installHint: "Restart the app to retry runtime repair, or reinstall the packaged app."
        },
        {
          name: "ffmpeg",
          available: false,
          path: null,
          installHint: "Reinstall or repair the packaged app so bundled media tools are restored."
        }
      ]
    };
  }

  return {
    ok: false,
    checkedAt: new Date().toISOString(),
    message:
      "Python 3 is not available on PATH. Install Python 3 and rerun scripts/setup-python.ps1 (Windows) or ./scripts/setup-python.sh (macOS/Linux).",
    checks: [
      {
        name: "python",
        available: false,
        path: null,
        installHint:
          "Install Python 3 from https://www.python.org/downloads/ and ensure it is available on PATH."
      },
      {
        name: "yt-dlp",
        available: false,
        path: null,
        installHint:
          "After Python is installed, run scripts/setup-python.ps1 (Windows) or ./scripts/setup-python.sh (macOS/Linux)."
      },
      {
        name: "ffmpeg",
        available: false,
        path: null,
        installHint:
          "Install ffmpeg and make sure the ffmpeg binary is on PATH, then reopen the app and run dependency check."
      }
    ]
  };
}

async function runDependencyCheck({
  appRoot,
  extraEnv = {},
  pythonInvoker = null,
  managedRuntime = false
}) {
  const python = pythonInvoker || await findPythonExecutable(appRoot);
  if (!python) {
    return buildMissingPythonResult({ managedRuntime });
  }

  const scriptPath = path.join(appRoot, "python", "dependency_check.py");
  const env = {
    ...process.env,
    ...(python.env || {}),
    ...extraEnv
  };
  const checkRun = await runProcess(
    python.command,
    [...python.args, scriptPath],
    { cwd: appRoot, env }
  );

  if (checkRun.exitCode !== 0) {
    return {
      ok: false,
      checkedAt: new Date().toISOString(),
      message: "Dependency check script failed to run.",
      checks: [],
      error: {
        exitCode: checkRun.exitCode,
        stderr: checkRun.stderr.trim(),
        stdout: checkRun.stdout.trim()
      }
    };
  }

  try {
    const parsed = JSON.parse(checkRun.stdout);
    return {
      ...parsed,
      managedRuntime,
      pythonInvoker: [python.command, ...python.args].join(" ")
    };
  } catch (error) {
    return {
      ok: false,
      checkedAt: new Date().toISOString(),
      message: "Dependency check returned malformed output.",
      checks: [],
      error: {
        details: error.message,
        rawOutput: checkRun.stdout.trim()
      }
    };
  }
}

module.exports = {
  buildMissingPythonResult,
  findPythonExecutable,
  runProcess,
  runDependencyCheck
};
