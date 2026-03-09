const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const appRoot = path.resolve(__dirname, "..");
const distRoot = path.join(appRoot, "dist");
const readmePath = path.join(appRoot, "README.md");
const packageJsonPath = path.join(appRoot, "package.json");
const smokeMatrixPath = path.join(appRoot, "tests", "smoke-matrix.json");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function walkFiles(rootDir) {
  if (!fs.existsSync(rootDir)) {
    return [];
  }

  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
    } else {
      files.push(fullPath);
    }
  }

  return files;
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";

    const timeoutMs = options.timeoutMs || 30000;
    const timeoutHandle = setTimeout(() => {
      child.kill();
      reject(
        new Error(
          `${options.label || "Command"} timed out after ${timeoutMs}ms.\nstdout: ${stdout}\nstderr: ${stderr}`
        )
      );
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      clearTimeout(timeoutHandle);
      reject(error);
    });

    child.on("exit", (code) => {
      clearTimeout(timeoutHandle);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(
          new Error(
            `${options.label || "Command"} failed with exit code ${code}.\nstdout: ${stdout}\nstderr: ${stderr}`
          )
        );
      }
    });
  });
}

function verifyPackageConfiguration() {
  const pkg = readJson(packageJsonPath);
  const build = pkg.build || {};
  const scripts = pkg.scripts || {};
  const extraResources = Array.isArray(build.extraResources) ? build.extraResources : [];
  const files = Array.isArray(build.files) ? build.files : [];

  assert(scripts["dist:win"], "Expected package.json to define dist:win.");
  assert(scripts["dist:linux"], "Expected package.json to define dist:linux.");
  assert(scripts["dist:mac"], "Expected package.json to define dist:mac.");
  assert(scripts["verify:step6"], "Expected package.json to define verify:step6.");

  assert(files.includes("electron/**/*"), "Expected Electron sources to be included in package build files.");
  assert(files.includes("README.md"), "Expected README.md to be included in package build files.");

  assert(
    extraResources.some((entry) => entry.from === "python" && entry.to === "python"),
    "Expected package build to copy python resources."
  );
  assert(
    extraResources.some((entry) => entry.from === "config" && entry.to === "config"),
    "Expected package build to copy config resources."
  );

  const winTargets = (build.win && build.win.target) || [];
  const linuxTargets = (build.linux && build.linux.target) || [];
  const macTargets = (build.mac && build.mac.target) || [];

  assert(winTargets.includes("nsis") && winTargets.includes("portable"), "Expected Windows targets to include nsis and portable.");
  assert(linuxTargets.includes("AppImage") && linuxTargets.includes("tar.gz"), "Expected Linux targets to include AppImage and tar.gz.");
  assert(macTargets.includes("dmg") && macTargets.includes("zip"), "Expected macOS targets to include dmg and zip.");
}

function verifyReadmeCoverage() {
  const readme = fs.readFileSync(readmePath, "utf8");
  const requiredMarkers = [
    "## Packaging",
    "## Troubleshooting",
    "## Limitations",
    "npm.cmd run dist:win",
    "tests/smoke-matrix.json",
    "The packaged app still expects a working local Python 3 installation plus `yt-dlp` and `ffmpeg` on PATH."
  ];

  for (const marker of requiredMarkers) {
    assert(readme.includes(marker), `Expected README.md to include: ${marker}`);
  }
}

function verifySmokeMatrix() {
  assert(fs.existsSync(smokeMatrixPath), "Expected tests/smoke-matrix.json to exist.");

  const matrix = readJson(smokeMatrixPath);
  const cases = Array.isArray(matrix.cases) ? matrix.cases : [];
  const requiredCases = [
    "startup_smoke",
    "single_video_download",
    "single_audio_download",
    "playlist_queue_processing",
    "pause_resume_cancel",
    "metadata_embedding",
    "output_routing_validation",
    "security_input_fuzz",
    "manual_ytdlp_update_flow",
    "windows_portable_packaged_startup",
    "windows_nsis_install_and_startup",
    "private_or_removed_video",
    "network_drop_resume",
    "long_playlist_responsiveness"
  ];
  const allowedStatuses = new Set(["pass", "fail", "not_run"]);

  assert(typeof matrix.generatedAt === "string" && matrix.generatedAt.length > 0, "Expected smoke matrix to include generatedAt.");
  assert(Array.isArray(matrix.verifiedTargets), "Expected smoke matrix to include verifiedTargets.");

  for (const caseId of requiredCases) {
    const record = cases.find((entry) => entry.id === caseId);
    assert(record, `Expected smoke matrix case ${caseId}.`);
    assert(allowedStatuses.has(record.status), `Expected smoke matrix case ${caseId} to use an allowed status.`);
  }
}

function findWindowsArtifacts() {
  assert(fs.existsSync(distRoot), "Expected dist/ to exist. Run the packaging build first.");

  const topLevelFiles = fs.readdirSync(distRoot).map((name) => path.join(distRoot, name));
  const topLevelExecutables = topLevelFiles.filter((filePath) => filePath.toLowerCase().endsWith(".exe"));
  const installerExe = topLevelExecutables.find((filePath) => /setup/i.test(path.basename(filePath)));
  const portableExe = topLevelExecutables.find((filePath) => !/setup/i.test(path.basename(filePath)));
  const unpackedDir = path.join(distRoot, "win-unpacked");

  assert(installerExe && fs.existsSync(installerExe), "Expected an NSIS setup executable in dist/.");
  assert(portableExe && fs.existsSync(portableExe), "Expected a portable executable in dist/.");
  assert(fs.existsSync(unpackedDir), "Expected dist/win-unpacked to exist.");

  return {
    installerExe,
    portableExe,
    unpackedDir
  };
}

function verifyWindowsResources(unpackedDir) {
  const runnerPath = path.join(unpackedDir, "resources", "python", "runner.py");
  const configPath = path.join(unpackedDir, "resources", "config", "default-settings.json");

  assert(fs.existsSync(runnerPath), "Expected packaged Windows build to include resources/python/runner.py.");
  assert(fs.existsSync(configPath), "Expected packaged Windows build to include resources/config/default-settings.json.");
}

async function smokeRunExecutable(executablePath, label, tempRoot) {
  const profileRoot = path.join(tempRoot, "profile");
  const tempPath = path.join(tempRoot, "tmp");

  fs.mkdirSync(profileRoot, { recursive: true });
  fs.mkdirSync(tempPath, { recursive: true });

  await runCommand(executablePath, [], {
    cwd: path.dirname(executablePath),
    env: {
      ...process.env,
      SMOKE_TEST: "1",
      APPDATA: profileRoot,
      LOCALAPPDATA: profileRoot,
      TEMP: tempPath,
      TMP: tempPath
    },
    timeoutMs: 45000,
    label
  });
}

async function verifyWindowsPackagedBuild() {
  const { installerExe, portableExe, unpackedDir } = findWindowsArtifacts();
  verifyWindowsResources(unpackedDir);

  const portableTemp = fs.mkdtempSync(path.join(os.tmpdir(), "yt-dl-step6-portable-"));
  try {
    await smokeRunExecutable(portableExe, "Portable packaged startup smoke", portableTemp);
  } finally {
    fs.rmSync(portableTemp, { recursive: true, force: true });
  }

  const installTemp = fs.mkdtempSync(path.join(os.tmpdir(), "yt-dl-step6-install-"));
  const installDir = path.join(installTemp, "app");

  try {
    await runCommand(installerExe, ["/S", `/D=${installDir}`], {
      cwd: path.dirname(installerExe),
      timeoutMs: 180000,
      label: "Windows NSIS installer smoke"
    });

    const installedFiles = walkFiles(installDir);
    const installedExe = installedFiles.find(
      (filePath) =>
        filePath.toLowerCase().endsWith(".exe") &&
        !/uninstall/i.test(path.basename(filePath))
    );

    assert(installedExe, "Expected the NSIS installer to produce an application executable.");
    await smokeRunExecutable(installedExe, "Installed packaged startup smoke", installTemp);
  } finally {
    fs.rmSync(installTemp, { recursive: true, force: true });
  }
}

async function main() {
  console.log("Running Step 6 verification...");

  verifyPackageConfiguration();
  console.log("1/4 packaging configuration check: PASS");

  verifyReadmeCoverage();
  console.log("2/4 README packaging/troubleshooting coverage: PASS");

  verifySmokeMatrix();
  console.log("3/4 smoke matrix coverage check: PASS");

  if (process.platform !== "win32") {
    throw new Error("Step 6 verification currently expects to run on Windows for packaged-build smoke checks.");
  }

  await verifyWindowsPackagedBuild();
  console.log("4/4 Windows packaged build smoke: PASS");

  console.log("Step 6 verification passed.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
