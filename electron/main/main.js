const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { runDependencyCheck } = require("./dependencyService");
const { validateDownloadInput } = require("./validators");
const { createQueueService } = require("./queueService");

let mainWindow = null;
const appRoot = path.resolve(__dirname, "../..");
let queueService = null;
let latestDependencyStatus = {
  ok: false,
  checkedAt: null,
  message: "Dependency check has not run yet.",
  checks: []
};

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 900,
    minHeight: 620,
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

function registerIpcHandlers() {
  ipcMain.handle("dependencies:get", async () => latestDependencyStatus);
  ipcMain.handle("dependencies:check", async () => checkDependencies());
  ipcMain.handle("download:validate", async (_event, payload) => validateDownloadInput(payload));
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
  ipcMain.handle("download:pause", async (_event, itemId) => queueService.pauseDownload(itemId));
  ipcMain.handle("download:resume", async (_event, itemId) => queueService.resumeDownload(itemId));
  ipcMain.handle("download:cancel", async (_event, itemId) => queueService.cancelDownload(itemId));
}

app.whenReady().then(async () => {
  queueService = createQueueService({
    appRoot,
    downloadsRoot: app.getPath("downloads"),
    onQueueUpdated: broadcastQueueUpdate
  });
  registerIpcHandlers();
  createMainWindow();
  await checkDependencies();
  broadcastQueueUpdate(queueService.getSnapshot());

  if (process.env.SMOKE_TEST === "1") {
    setTimeout(() => app.quit(), 1200);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
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
