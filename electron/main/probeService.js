const path = require("path");
const { spawn } = require("child_process");
const { findPythonExecutable } = require("./dependencyService");

function runProbe(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    function finish(result) {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    }

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      finish({
        exitCode: 1,
        stdout,
        stderr,
        error
      });
    });

    child.on("close", (exitCode) => {
      finish({
        exitCode,
        stdout,
        stderr
      });
    });
  });
}

async function probeDownloadInput({
  appRoot,
  input,
  resolvePythonInvoker = null,
  buildChildEnv = null,
  missingPythonMessage = "Python 3 was not found. Install Python before probing playlist entries."
}) {
  const python = resolvePythonInvoker
    ? await resolvePythonInvoker()
    : await findPythonExecutable(appRoot);
  if (!python) {
    return {
      ok: false,
      message: missingPythonMessage
    };
  }

  const scriptPath = path.join(appRoot, "python", "media_probe.py");
  const probeResult = await runProbe(
    python.command,
    [
      ...python.args,
      scriptPath,
      "--url",
      input.url,
      "--source-kind",
      input.sourceKind
    ],
    {
      cwd: appRoot,
      env: buildChildEnv
        ? buildChildEnv({
            PYTHONUNBUFFERED: "1"
          })
        : {
        ...process.env,
        PYTHONUNBUFFERED: "1"
      }
    }
  );

  if (!probeResult.stdout.trim()) {
    return {
      ok: false,
      message: probeResult.stderr.trim() || "Media probe returned no output."
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(probeResult.stdout);
  } catch {
    return {
      ok: false,
      message: "Media probe returned malformed output.",
      details: {
        stdout: probeResult.stdout.trim(),
        stderr: probeResult.stderr.trim()
      }
    };
  }

  if (probeResult.exitCode !== 0 || parsed.ok === false) {
    return {
      ok: false,
      message: parsed.message || probeResult.stderr.trim() || "Media probe failed."
    };
  }

  return parsed;
}

module.exports = {
  probeDownloadInput
};
