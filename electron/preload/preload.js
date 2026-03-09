const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("appApi", {
  getDependencyStatus: () => ipcRenderer.invoke("dependencies:get"),
  checkDependencies: () => ipcRenderer.invoke("dependencies:check"),
  getQueueState: () => ipcRenderer.invoke("queue:get"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  pickDirectory: (payload) => ipcRenderer.invoke("settings:pick-directory", payload),
  saveSettings: (payload) => ipcRenderer.invoke("settings:save", payload),
  resetSettings: () => ipcRenderer.invoke("settings:reset"),
  updateYtdlp: () => ipcRenderer.invoke("updates:ytdlp"),
  validateDownloadInput: (payload) => ipcRenderer.invoke("download:validate", payload),
  startDownload: (payload) => ipcRenderer.invoke("download:start", payload),
  pauseDownload: (itemId) => ipcRenderer.invoke("download:pause", itemId),
  resumeDownload: (itemId) => ipcRenderer.invoke("download:resume", itemId),
  cancelDownload: (itemId) => ipcRenderer.invoke("download:cancel", itemId),
  onDependencyStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("dependencies:status", listener);
    return () => ipcRenderer.removeListener("dependencies:status", listener);
  },
  onQueueUpdated: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("queue:updated", listener);
    return () => ipcRenderer.removeListener("queue:updated", listener);
  },
  onSettingsUpdated: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("settings:updated", listener);
    return () => ipcRenderer.removeListener("settings:updated", listener);
  }
});
