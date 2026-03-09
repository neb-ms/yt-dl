const fs = require("fs");
const path = require("path");
const { validateApprovedPath, validateDirectoryPath } = require("./pathSafety");

const SETTINGS_FILE_NAME = "settings.json";
const SETTINGS_VERSION = 1;

function readDefaultConfig(appRoot) {
  const configPath = path.join(appRoot, "config", "default-settings.json");

  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function buildDefaultOutputDirectories(downloadsRoot, defaultConfig) {
  const outputConfig =
    defaultConfig && typeof defaultConfig.outputDirectories === "object"
      ? defaultConfig.outputDirectories
      : {};

  const videoSubdirectory =
    typeof outputConfig.videoSubdirectory === "string" && outputConfig.videoSubdirectory.trim()
      ? outputConfig.videoSubdirectory.trim()
      : "yt-dl-videos";
  const audioSubdirectory =
    typeof outputConfig.audioSubdirectory === "string" && outputConfig.audioSubdirectory.trim()
      ? outputConfig.audioSubdirectory.trim()
      : "yt-dl-audio";

  return {
    video: path.normalize(path.resolve(downloadsRoot, videoSubdirectory)),
    audio: path.normalize(path.resolve(downloadsRoot, audioSubdirectory))
  };
}

function dedupeDirectories(directories) {
  const unique = [];
  const seen = new Set();

  for (const directory of directories) {
    const validation = validateDirectoryPath(directory);
    if (!validation.ok) {
      continue;
    }

    const comparable = process.platform === "win32" ? validation.path.toLowerCase() : validation.path;
    if (seen.has(comparable)) {
      continue;
    }

    seen.add(comparable);
    unique.push(validation.path);
  }

  return unique;
}

function normalizeSettings(rawSettings, defaultOutputDirectories) {
  const outputDirectories = {
    video: defaultOutputDirectories.video,
    audio: defaultOutputDirectories.audio
  };

  if (rawSettings && typeof rawSettings.outputDirectories === "object") {
    const videoValidation = validateDirectoryPath(rawSettings.outputDirectories.video);
    const audioValidation = validateDirectoryPath(rawSettings.outputDirectories.audio);

    if (videoValidation.ok) {
      outputDirectories.video = videoValidation.path;
    }
    if (audioValidation.ok) {
      outputDirectories.audio = audioValidation.path;
    }
  }

  return {
    version: SETTINGS_VERSION,
    outputDirectories,
    approvedDirectories: dedupeDirectories([
      ...(Array.isArray(rawSettings?.approvedDirectories) ? rawSettings.approvedDirectories : []),
      outputDirectories.video,
      outputDirectories.audio
    ])
  };
}

function cloneSettings(settings, defaultOutputDirectories, settingsFilePath) {
  return {
    version: settings.version,
    outputDirectories: {
      video: settings.outputDirectories.video,
      audio: settings.outputDirectories.audio
    },
    approvedDirectories: [...settings.approvedDirectories],
    defaultOutputDirectories: {
      video: defaultOutputDirectories.video,
      audio: defaultOutputDirectories.audio
    },
    settingsFilePath
  };
}

function readStoredSettings(settingsFilePath) {
  try {
    if (!fs.existsSync(settingsFilePath)) {
      return null;
    }

    const raw = fs.readFileSync(settingsFilePath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writeSettings(settingsFilePath, settings) {
  fs.mkdirSync(path.dirname(settingsFilePath), { recursive: true });
  fs.writeFileSync(settingsFilePath, JSON.stringify(settings, null, 2));
}

function createSettingsService({ appRoot, userDataPath, downloadsRoot }) {
  const settingsFilePath = path.join(userDataPath, SETTINGS_FILE_NAME);
  const defaultConfig = readDefaultConfig(appRoot);
  const defaultOutputDirectories = buildDefaultOutputDirectories(downloadsRoot, defaultConfig);

  let settings = normalizeSettings(readStoredSettings(settingsFilePath), defaultOutputDirectories);
  writeSettings(settingsFilePath, settings);

  function getSettings() {
    return cloneSettings(settings, defaultOutputDirectories, settingsFilePath);
  }

  function saveSettings(payload) {
    const videoValidation = validateDirectoryPath(payload?.videoOutputDir);
    const audioValidation = validateDirectoryPath(payload?.audioOutputDir);
    const errors = [];
    const fieldErrors = {};

    if (!videoValidation.ok) {
      fieldErrors.videoOutputDir = videoValidation.message;
      errors.push(videoValidation.message);
    }

    if (!audioValidation.ok) {
      fieldErrors.audioOutputDir = audioValidation.message;
      errors.push(audioValidation.message);
    }

    if (errors.length > 0) {
      return {
        ok: false,
        message: errors[0],
        errors,
        fieldErrors
      };
    }

    settings = normalizeSettings(
      {
        version: SETTINGS_VERSION,
        outputDirectories: {
          video: videoValidation.path,
          audio: audioValidation.path
        },
        approvedDirectories: [videoValidation.path, audioValidation.path]
      },
      defaultOutputDirectories
    );
    writeSettings(settingsFilePath, settings);

    return {
      ok: true,
      settings: getSettings()
    };
  }

  function resetSettings() {
    settings = normalizeSettings(null, defaultOutputDirectories);
    writeSettings(settingsFilePath, settings);

    return {
      ok: true,
      settings: getSettings()
    };
  }

  function resolveOutputDirectory(formatType) {
    const kind = formatType === "video" ? "video" : "audio";
    const configuredPath = settings.outputDirectories[kind];
    const validation = validateApprovedPath(configuredPath, settings.approvedDirectories);

    if (!validation.ok) {
      return {
        ok: false,
        message: `Configured ${kind} output folder is invalid: ${validation.message}`
      };
    }

    return {
      ok: true,
      path: validation.path,
      kind
    };
  }

  return {
    getSettings,
    saveSettings,
    resetSettings,
    resolveOutputDirectory
  };
}

module.exports = {
  buildDefaultOutputDirectories,
  createSettingsService
};
