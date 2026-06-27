import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("workbench", {
  platform: process.platform,
  onOpenModelSettings: (callback: () => void) => {
    ipcRenderer.on("open-model-settings", () => callback());
  }
});
