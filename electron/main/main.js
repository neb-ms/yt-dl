const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { runDependencyCheck } = require("./dependencyService");
const { validateDownloadInput } = require("./validators");
const { cancelActiveDownload, startDownload } = require("./downloadService");

let mainWindow = null;
const appRoot = path.resolve(__dirname, "../..");
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

function registerIpcHandlers() {
  ipcMain.handle("dependencies:get", async () => latestDependencyStatus);
  ipcMain.handle("dependencies:check", async () => checkDependencies());
  ipcMain.handle("download:validate", async (_event, payload) => validateDownloadInput(payload));
  ipcMain.handle("download:start", async (event, payload) => {
    const validated = validateDownloadInput(payload);
    if (!validated.ok) {
      return validated;
    }

    const result = await startDownload({
      appRoot,
      downloadsRoot: app.getPath("downloads"),
      input: validated.data,
      webContents: event.sender
    });

    if (!result.ok) {
      return result;
    }

    return {
      ok: true,
      downloadId: result.downloadId,
      outputDir: result.outputDir,
      note:
        validated.data.sourceKind === "playlist"
          ? "Playlist URL accepted. Step 1 downloads the first item only."
          : null
    };
  });
  ipcMain.handle("download:cancel", async () => cancelActiveDownload());
}

app.whenReady().then(async () => {
  registerIpcHandlers();
  createMainWindow();
  await checkDependencies();

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
