const fs = require("fs");
const path = require("path");

function getRuntimeTemplateKey() {
  return `${process.platform}-${process.arch}`;
}

function getTemplateRoot(appRoot) {
  return path.join(appRoot, "runtime-template", getRuntimeTemplateKey());
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function uniqueEntries(values) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }

  return result;
}

function copyDirectoryRecursive(sourceDir, destinationDir) {
  fs.mkdirSync(destinationDir, { recursive: true });

  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const destinationPath = path.join(destinationDir, entry.name);

    if (entry.isDirectory()) {
      copyDirectoryRecursive(sourcePath, destinationPath);
      continue;
    }

    if (entry.isSymbolicLink()) {
      const target = fs.readlinkSync(sourcePath);
      fs.symlinkSync(target, destinationPath);
      continue;
    }

    fs.copyFileSync(sourcePath, destinationPath);
  }
}

function createRuntimeService({
  appRoot,
  userDataPath,
  isPackaged,
  packageVersion,
  templateRootOverride = null
}) {
  const templateRoot = templateRootOverride || getTemplateRoot(appRoot);
  const templateManifestPath = path.join(templateRoot, "manifest.json");
  const runtimeRoot = path.join(userDataPath, "managed-runtime");
  const runtimeManifestPath = path.join(runtimeRoot, "manifest.json");
  const stateFilePath = path.join(userDataPath, "managed-runtime-state.json");

  let ensurePromise = null;
  let lastReadyState = null;

  function hasManagedTemplate() {
    return isPackaged && fs.existsSync(templateManifestPath);
  }

  function getTemplateManifest() {
    return readJson(templateManifestPath);
  }

  function getRuntimeManifest() {
    return readJson(runtimeManifestPath);
  }

  function getPythonPath(rootDir) {
    if (process.platform === "win32") {
      return path.join(rootDir, "python", "python.exe");
    }

    return path.join(rootDir, "python", "bin", "python");
  }

  function getFfmpegPath(rootDir) {
    if (process.platform === "win32") {
      return path.join(rootDir, "ffmpeg", "bin", "ffmpeg.exe");
    }

    return path.join(rootDir, "ffmpeg", "bin", "ffmpeg");
  }

  function getRuntimePythonHome(rootDir) {
    return path.join(rootDir, "python");
  }

  function getRuntimeFfmpegBin(rootDir) {
    return path.join(rootDir, "ffmpeg", "bin");
  }

  function manifestsMatch(templateManifest, runtimeManifest) {
    if (!templateManifest || !runtimeManifest) {
      return false;
    }

    return templateManifest.templateId === runtimeManifest.templateId;
  }

  function runtimeLooksUsable(rootDir) {
    return (
      fs.existsSync(getPythonPath(rootDir)) &&
      fs.existsSync(getFfmpegPath(rootDir)) &&
      fs.existsSync(path.join(rootDir, "manifest.json"))
    );
  }

  function buildManagedEnv(extraEnv = {}) {
    const pythonHome = getRuntimePythonHome(runtimeRoot);
    const ffmpegBin = getRuntimeFfmpegBin(runtimeRoot);
    const currentPath = typeof process.env.PATH === "string" ? process.env.PATH.split(path.delimiter) : [];
    const mergedPath = uniqueEntries([ffmpegBin, pythonHome, ...currentPath]).join(path.delimiter);

    return {
      ...process.env,
      ...extraEnv,
      PATH: mergedPath,
      PYTHONHOME: pythonHome,
      YTDL_APP_MANAGED: "1",
      YTDL_MANAGED_RUNTIME_ROOT: runtimeRoot
    };
  }

  function copyTemplateToRuntime() {
    const stagingRoot = `${runtimeRoot}.staging`;
    fs.rmSync(stagingRoot, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(runtimeRoot), { recursive: true });
    copyDirectoryRecursive(templateRoot, stagingRoot);
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
    fs.renameSync(stagingRoot, runtimeRoot);
  }

  async function ensureReady() {
    if (!hasManagedTemplate()) {
      lastReadyState = {
        ok: false,
        managed: false,
        runtimeRoot: null,
        templateRoot: null,
        stateFilePath
      };
      return lastReadyState;
    }

    const templateManifest = getTemplateManifest();
    if (!templateManifest) {
      throw new Error("Managed runtime template manifest is missing.");
    }

    const runtimeManifest = getRuntimeManifest();
    if (lastReadyState && lastReadyState.ok && manifestsMatch(templateManifest, runtimeManifest) && runtimeLooksUsable(runtimeRoot)) {
      return lastReadyState;
    }

    if (ensurePromise) {
      return ensurePromise;
    }

    ensurePromise = Promise.resolve().then(() => {
      const latestRuntimeManifest = getRuntimeManifest();

      if (!manifestsMatch(templateManifest, latestRuntimeManifest) || !runtimeLooksUsable(runtimeRoot)) {
        copyTemplateToRuntime();
      }

      lastReadyState = {
        ok: true,
        managed: true,
        runtimeRoot,
        templateRoot,
        templateManifest,
        stateFilePath
      };
      return lastReadyState;
    }).finally(() => {
      ensurePromise = null;
    });

    return ensurePromise;
  }

  async function getManagedPythonInvoker() {
    const ready = await ensureReady();
    if (!ready.managed || !ready.ok) {
      return null;
    }

    return {
      command: getPythonPath(runtimeRoot),
      args: [],
      env: buildManagedEnv()
    };
  }

  function buildChildEnv(extraEnv = {}) {
    if (!hasManagedTemplate()) {
      return {
        ...process.env,
        ...extraEnv
      };
    }

    return buildManagedEnv(extraEnv);
  }

  function shouldUseManagedRuntime() {
    return hasManagedTemplate();
  }

  function getRuntimeContext() {
    const templateManifest = getTemplateManifest();
    return {
      managed: hasManagedTemplate(),
      runtimeRoot,
      templateRoot,
      templateManifest,
      packageVersion,
      stateFilePath
    };
  }

  return {
    ensureReady,
    getManagedPythonInvoker,
    buildChildEnv,
    shouldUseManagedRuntime,
    getRuntimeContext,
    stateFilePath
  };
}

module.exports = {
  createRuntimeService,
  getRuntimeTemplateKey
};
