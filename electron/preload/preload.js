const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("appApi", {
  getDependencyStatus: () => ipcRenderer.invoke("dependencies:get"),
  checkDependencies: () => ipcRenderer.invoke("dependencies:check"),
  validateDownloadInput: (payload) => ipcRenderer.invoke("download:validate", payload),
  startDownload: (payload) => ipcRenderer.invoke("download:start", payload),
  cancelDownload: () => ipcRenderer.invoke("download:cancel"),
  onDependencyStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("dependencies:status", listener);
    return () => ipcRenderer.removeListener("dependencies:status", listener);
  },
  onDownloadEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("download:event", listener);
    return () => ipcRenderer.removeListener("download:event", listener);
  }
});
