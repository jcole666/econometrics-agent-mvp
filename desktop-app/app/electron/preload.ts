import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("workbench", {
  platform: process.platform,
  onOpenModelSettings: (callback: () => void) => {
    ipcRenderer.on("open-model-settings", () => callback());
  },
  onDataFileSelected: (callback: (payload: { name: string; data: ArrayBuffer }) => void) => {
    ipcRenderer.on("data-file-selected", (_event, payload) => callback(payload));
  },
  saveTextFile: (payload: { fileName: string; content: string }) => {
    return ipcRenderer.invoke("save-text-file", payload);
  },
  saveReportPdf: (payload: { fileName: string; title: string; markdown: string }) => {
    return ipcRenderer.invoke("save-report-pdf", payload);
  }
});
