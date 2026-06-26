import path from "node:path";

import { app, BrowserWindow, dialog } from "electron";

import {
  checkSidecarHealth,
  hasPackagedSidecar,
  lastSidecarExitCode,
  SIDECAR_PORT,
  startSidecar,
  stopSidecar,
  waitForSidecar
} from "./sidecar";

const APP_TITLE = "Econometrics Agent Workbench";

let mainWindow: BrowserWindow | null = null;

async function showStartupError(detail: string) {
  await dialog.showMessageBox({
    type: "error",
    title: APP_TITLE,
    message: "The local analysis service did not start.",
    detail
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1040,
    minHeight: 720,
    backgroundColor: "#ece9df",
    title: APP_TITLE,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:5173";
  if (app.isPackaged || hasPackagedSidecar() || process.env.NODE_ENV === "production") {
    mainWindow.loadFile(path.join(__dirname, "..", "..", "dist", "index.html"));
  } else {
    mainWindow.loadURL(devUrl);
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

const singleInstanceLock = app.requestSingleInstanceLock();

if (!singleInstanceLock) {
  app.quit();
} else {
  app.setName(APP_TITLE);

  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    try {
      const packagedSidecar = hasPackagedSidecar();
      const alreadyRunning = await checkSidecarHealth(500);

      if (packagedSidecar && alreadyRunning) {
        await showStartupError(`Port ${SIDECAR_PORT} is already in use. Close the other instance and start the app again.`);
        app.quit();
        return;
      }

      if (!alreadyRunning) {
        startSidecar();
      }

      const ready = alreadyRunning || (await waitForSidecar());
      if (!ready) {
        const exitCode = lastSidecarExitCode();
        const exitNote = exitCode === null ? "" : ` Sidecar exited with code ${exitCode}.`;
        await showStartupError(`Port: ${SIDECAR_PORT}.${exitNote}`);
        app.quit();
        return;
      }

      createWindow();

      app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          createWindow();
        }
      });
    } catch (error) {
      await showStartupError(error instanceof Error ? error.message : String(error));
      app.quit();
    }
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", stopSidecar);
