const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { runDependencyCheck } = require("../electron/main/dependencyService");

const appRoot = path.resolve(__dirname, "..");

function createFakeExecutable(tempDir, name) {
  const isWindows = process.platform === "win32";
  const filename = isWindows ? `${name}.cmd` : name;
  const fullPath = path.join(tempDir, filename);

  if (isWindows) {
    fs.writeFileSync(fullPath, "@echo off\r\necho mock-tool\r\n", "utf8");
  } else {
    fs.writeFileSync(fullPath, "#!/usr/bin/env bash\necho mock-tool\n", "utf8");
    fs.chmodSync(fullPath, 0o755);
  }

  return fullPath;
}

function runSmokeStartup() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, "smoke-startup.js")], {
      cwd: appRoot,
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);

    child.on("exit", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(
          new Error(
            `Startup smoke check failed with exit code ${code}.\nstdout: ${stdout}\nstderr: ${stderr}`
          )
        );
      }
    });
  });
}

function getCheck(status, name) {
  if (!status || !Array.isArray(status.checks)) {
    return null;
  }
  return status.checks.find((check) => check.name === name) || null;
}

async function verifyDependencyCheckScenarios() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "yt-dl-step0-"));
  const pathWithMocks = `${tempDir}${path.delimiter}${process.env.PATH || ""}`;

  createFakeExecutable(tempDir, "ffmpeg");
  createFakeExecutable(tempDir, "yt-dlp");

  try {
    const simulatedInstalled = await runDependencyCheck({
      appRoot,
      extraEnv: {
        PATH: pathWithMocks,
        FORCE_MISSING_DEPENDENCIES: ""
      }
    });

    const installedFfmpeg = getCheck(simulatedInstalled, "ffmpeg");
    const installedYtdlp = getCheck(simulatedInstalled, "yt-dlp");

    if (!installedFfmpeg || !installedFfmpeg.available) {
      throw new Error("Installed-path scenario failed: ffmpeg was not detected.");
    }
    if (!installedYtdlp || !installedYtdlp.available) {
      throw new Error("Installed-path scenario failed: yt-dlp was not detected.");
    }

    const simulatedMissing = await runDependencyCheck({
      appRoot,
      extraEnv: {
        PATH: pathWithMocks,
        FORCE_MISSING_DEPENDENCIES: "ffmpeg,yt-dlp"
      }
    });

    const missingFfmpeg = getCheck(simulatedMissing, "ffmpeg");
    const missingYtdlp = getCheck(simulatedMissing, "yt-dlp");

    if (!missingFfmpeg || missingFfmpeg.available) {
      throw new Error("Missing-path scenario failed: ffmpeg should be missing.");
    }
    if (!missingYtdlp || missingYtdlp.available) {
      throw new Error("Missing-path scenario failed: yt-dlp should be missing.");
    }

    return {
      simulatedInstalled,
      simulatedMissing
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  console.log("Running Step 0 verification...");
  await runSmokeStartup();
  console.log("1/2 startup smoke test: PASS");

  const dependencyChecks = await verifyDependencyCheckScenarios();
  console.log("2/2 dependency detection scenarios: PASS");

  const installedSummary = dependencyChecks.simulatedInstalled.checks
    .map((check) => `${check.name}=${check.available ? "available" : "missing"}`)
    .join(", ");
  const missingSummary = dependencyChecks.simulatedMissing.checks
    .map((check) => `${check.name}=${check.available ? "available" : "missing"}`)
    .join(", ");

  console.log(`Installed-path scenario: ${installedSummary}`);
  console.log(`Missing-path scenario: ${missingSummary}`);
  console.log("Step 0 verification passed.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

