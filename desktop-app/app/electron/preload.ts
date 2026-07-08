import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("workbench", {
  platform: process.platform,
  onOpenModelSettings: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on("open-model-settings", listener);
    return () => ipcRenderer.removeListener("open-model-settings", listener);
  },
  onDataFileSelected: (callback: (payload: { name: string; data: ArrayBuffer }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { name: string; data: ArrayBuffer }) => callback(payload);
    ipcRenderer.on("data-file-selected", listener);
    return () => ipcRenderer.removeListener("data-file-selected", listener);
  },
  saveTextFile: (payload: { fileName: string; content: string }) => {
    return ipcRenderer.invoke("save-text-file", payload);
  },
  saveReportPdf: (payload: { fileName: string; title: string; markdown: string }) => {
    return ipcRenderer.invoke("save-report-pdf", payload);
  }
});
