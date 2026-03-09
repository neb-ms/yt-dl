const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const path = require("path");
const { runDependencyCheck } = require("./dependencyService");
const {
  normalizeSettingsPickerRequest,
  validateDownloadInput,
  validateQueueItemId
} = require("./validators");
const { createQueueService } = require("./queueService");
const { createSettingsService } = require("./settingsService");
const { createUpdateService } = require("./updateService");

let mainWindow = null;
const appRoot = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, "../..");
let queueService = null;
let settingsService = null;
let updateService = null;
let latestDependencyStatus = {
  ok: false,
  checkedAt: null,
  message: "Dependency check has not run yet.",
  checks: []
};

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1000,
    minHeight: 680,
    backgroundColor: "#0f1115",
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });
}

async function checkDependencies() {
  latestDependencyStatus = await runDependencyCheck({ appRoot });

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("dependencies:status", latestDependencyStatus);
  }

  return latestDependencyStatus;
}

function broadcastQueueUpdate(snapshot) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("queue:updated", snapshot);
  }
}

function broadcastSettingsUpdate(settings) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("settings:updated", settings);
  }
}

function registerIpcHandlers() {
  ipcMain.handle("dependencies:get", async () => latestDependencyStatus);
  ipcMain.handle("dependencies:check", async () => checkDependencies());
  ipcMain.handle("download:validate", async (_event, payload) => validateDownloadInput(payload));
  ipcMain.handle("settings:get", async () => settingsService.getSettings());
  ipcMain.handle("settings:pick-directory", async (_event, payload = {}) => {
    const sanitizedPayload = normalizeSettingsPickerRequest(payload);
    const kind = sanitizedPayload.kind;
    const currentSettings = settingsService.getSettings();
    const defaultPath =
      sanitizedPayload.currentPath
        ? sanitizedPayload.currentPath
        : currentSettings.outputDirectories[kind];

    const result = await dialog.showOpenDialog(mainWindow, {
      title: kind === "video" ? "Select video output folder" : "Select audio output folder",
      defaultPath,
      properties: ["openDirectory", "createDirectory"]
    });

    if (result.canceled || !Array.isArray(result.filePaths) || result.filePaths.length === 0) {
      return {
        ok: false,
        cancelled: true
      };
    }

    return {
      ok: true,
      kind,
      path: result.filePaths[0]
    };
  });
  ipcMain.handle("settings:save", async (_event, payload) => {
    const result = settingsService.saveSettings(payload);
    if (result.ok) {
      broadcastSettingsUpdate(result.settings);
    }
    return result;
  });
  ipcMain.handle("settings:reset", async () => {
    const result = settingsService.resetSettings();
    if (result.ok) {
      broadcastSettingsUpdate(result.settings);
    }
    return result;
  });
  ipcMain.handle("updates:ytdlp", async () => {
    const result = await updateService.updateYtdlp();
    if (result.ok) {
      await checkDependencies();
    }
    return result;
  });
  ipcMain.handle("download:start", async (_event, payload) => {
    const validated = validateDownloadInput(payload);
    if (!validated.ok) {
      return validated;
    }

    const result = await queueService.enqueueInput(validated.data);

    if (!result.ok) {
      return result;
    }

    return {
      ok: true,
      addedCount: result.addedCount,
      queueIds: result.queueIds,
      playlistTitle: result.playlistTitle,
      note:
        validated.data.sourceKind === "playlist"
          ? `Playlist expanded into ${result.addedCount} queue item${result.addedCount === 1 ? "" : "s"}.`
          : null
    };
  });
  ipcMain.handle("queue:get", async () => queueService.getSnapshot());
  ipcMain.handle("download:pause", async (_event, itemId) => {
    const validation = validateQueueItemId(itemId);
    return validation.ok
      ? queueService.pauseDownload(validation.itemId)
      : { ok: false, message: validation.message };
  });
  ipcMain.handle("download:resume", async (_event, itemId) => {
    const validation = validateQueueItemId(itemId);
    return validation.ok
      ? queueService.resumeDownload(validation.itemId)
      : { ok: false, message: validation.message };
  });
  ipcMain.handle("download:cancel", async (_event, itemId) => {
    const validation = validateQueueItemId(itemId);
    return validation.ok
      ? queueService.cancelDownload(validation.itemId)
      : { ok: false, message: validation.message };
  });
}

app.whenReady().then(async () => {
  settingsService = createSettingsService({
    appRoot,
    userDataPath: app.getPath("userData"),
    downloadsRoot: app.getPath("downloads")
  });
  queueService = createQueueService({
    appRoot,
    resolveOutputDirectory: (formatType) => settingsService.resolveOutputDirectory(formatType),
    onQueueUpdated: broadcastQueueUpdate
  });
  registerIpcHandlers();
  createMainWindow();
  updateService = createUpdateService({
    appRoot,
    browserWindow: mainWindow,
    dialogRef: dialog
  });
  await checkDependencies();
  broadcastSettingsUpdate(settingsService.getSettings());
  broadcastQueueUpdate(queueService.getSnapshot());

  if (process.env.SMOKE_TEST === "1") {
    setTimeout(() => app.quit(), 1200);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
      updateService = createUpdateService({
        appRoot,
        browserWindow: mainWindow,
        dialogRef: dialog
      });
      checkDependencies().catch(() => {});
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  queueService?.shutdown();
});
