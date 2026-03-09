const fs = require("fs");
const path = require("path");

const { findPythonExecutable, runProcess } = require("../electron/main/dependencyService");

const repoRoot = path.resolve(__dirname, "..");
const templateRoot = path.join(repoRoot, "vendor", "runtime-template", `${process.platform}-${process.arch}`);
const requirementsSitePackages = path.join(repoRoot, ".venv", "Lib", "site-packages");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function copyRecursive(sourcePath, destinationPath) {
  const stats = fs.lstatSync(sourcePath);

  if (stats.isDirectory()) {
    fs.mkdirSync(destinationPath, { recursive: true });
    for (const entry of fs.readdirSync(sourcePath, { withFileTypes: true })) {
      copyRecursive(
        path.join(sourcePath, entry.name),
        path.join(destinationPath, entry.name)
      );
    }
    return;
  }

  if (stats.isSymbolicLink()) {
    const target = fs.readlinkSync(sourcePath);
    fs.symlinkSync(target, destinationPath);
    return;
  }

  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.copyFileSync(sourcePath, destinationPath);
}

function findOnPath(commandNames) {
  const pathEntries = typeof process.env.PATH === "string" ? process.env.PATH.split(path.delimiter) : [];
  const extensions = process.platform === "win32"
    ? (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";")
    : [""];

  for (const commandName of commandNames) {
    for (const entry of pathEntries) {
      if (!entry) {
        continue;
      }

      const directPath = path.join(entry, commandName);
      if (fs.existsSync(directPath)) {
        return directPath;
      }

      for (const extension of extensions) {
        const candidate = path.join(entry, `${commandName}${extension.toLowerCase()}`);
        if (fs.existsSync(candidate)) {
          return candidate;
        }
        const upperCandidate = path.join(entry, `${commandName}${extension.toUpperCase()}`);
        if (fs.existsSync(upperCandidate)) {
          return upperCandidate;
        }
      }
    }
  }

  return null;
}

function cleanTemplateRoot() {
  fs.rmSync(templateRoot, { recursive: true, force: true });
  fs.mkdirSync(templateRoot, { recursive: true });
}

async function resolvePythonHome() {
  const python = await findPythonExecutable(repoRoot);
  assert(python, "Python executable was not found. Run the setup script before staging the managed runtime.");

  const probe = await runProcess(
    python.command,
    [
      ...python.args,
      "-c",
      [
        "import json, sys",
        "import yt_dlp",
        "print(json.dumps({",
        "  'base_prefix': sys.base_prefix,",
        "  'version': sys.version.split()[0],",
        "  'yt_dlp_version': yt_dlp.version.__version__",
        "}))"
      ].join("\n")
    ],
    {
      cwd: repoRoot
    }
  );

  assert(probe.exitCode === 0, probe.stderr || "Failed to inspect the current Python environment.");
  const parsed = JSON.parse(probe.stdout);
  assert(parsed.base_prefix && fs.existsSync(parsed.base_prefix), "Python base installation path was not found.");

  return parsed;
}

function copyPythonHome(basePrefix) {
  const destination = path.join(templateRoot, "python");
  copyRecursive(basePrefix, destination);
}

function copySitePackages() {
  assert(fs.existsSync(requirementsSitePackages), "The project virtualenv site-packages directory is missing.");

  const destination = path.join(templateRoot, "python", "Lib", "site-packages");
  fs.mkdirSync(destination, { recursive: true });

  for (const entry of fs.readdirSync(requirementsSitePackages, { withFileTypes: true })) {
    const sourcePath = path.join(requirementsSitePackages, entry.name);
    const destinationPath = path.join(destination, entry.name);
    copyRecursive(sourcePath, destinationPath);
  }
}

function copyFfmpegTools() {
  const ffmpegPath = findOnPath(["ffmpeg", "ffmpeg.exe"]);
  const ffprobePath = findOnPath(["ffprobe", "ffprobe.exe"]);

  assert(ffmpegPath, "ffmpeg was not found on PATH. Install ffmpeg before building the standalone package.");
  assert(ffprobePath, "ffprobe was not found on PATH. Install ffmpeg before building the standalone package.");

  const sourceBinDir = path.dirname(ffmpegPath);
  const destinationBinDir = path.join(templateRoot, "ffmpeg", "bin");
  fs.mkdirSync(destinationBinDir, { recursive: true });

  for (const entry of fs.readdirSync(sourceBinDir, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }

    copyRecursive(
      path.join(sourceBinDir, entry.name),
      path.join(destinationBinDir, entry.name)
    );
  }

  return {
    ffmpegPath,
    ffprobePath
  };
}

function writeManifest({ pythonVersion, ytDlpVersion, ffmpegPath, ffprobePath }) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  const manifest = {
    templateId: [
      packageJson.version,
      process.platform,
      process.arch,
      pythonVersion,
      ytDlpVersion
    ].join("-"),
    packageVersion: packageJson.version,
    platform: process.platform,
    arch: process.arch,
    generatedAt: new Date().toISOString(),
    pythonVersion,
    ytDlpVersion,
    ffmpegPath,
    ffprobePath
  };

  fs.writeFileSync(
    path.join(templateRoot, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8"
  );
}

async function main() {
  if (process.platform !== "win32") {
    console.log("Managed runtime staging is only configured on Windows in this repository.");
    return;
  }

  cleanTemplateRoot();

  const pythonInfo = await resolvePythonHome();
  copyPythonHome(pythonInfo.base_prefix);
  copySitePackages();
  const ffmpegTools = copyFfmpegTools();
  writeManifest({
    pythonVersion: pythonInfo.version,
    ytDlpVersion: pythonInfo.yt_dlp_version,
    ffmpegPath: ffmpegTools.ffmpegPath,
    ffprobePath: ffmpegTools.ffprobePath
  });

  console.log(`Managed runtime staged at ${templateRoot}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
