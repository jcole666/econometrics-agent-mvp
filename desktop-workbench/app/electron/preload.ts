import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("workbench", {
  platform: process.platform
});
