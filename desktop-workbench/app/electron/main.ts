import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { app, BrowserWindow } from "electron";

let sidecar: ChildProcessWithoutNullStreams | null = null;

function projectRoot() {
  return path.resolve(__dirname, "..", "..", "..");
}

function pythonPath(root: string) {
  const localPython = path.join(root, ".venv", "Scripts", "python.exe");
  return fs.existsSync(localPython) ? localPython : "python";
}

function startSidecar() {
  const root = projectRoot();
  const python = pythonPath(root);
  sidecar = spawn(python, ["-m", "sidecar.serve", "--port", "8768"], {
    cwd: root,
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
    stdio: "pipe",
    windowsHide: true
  });

  sidecar.on("exit", () => {
    sidecar = null;
  });
}

function stopSidecar() {
  if (sidecar && !sidecar.killed) {
    sidecar.kill();
  }
  sidecar = null;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1040,
    minHeight: 720,
    backgroundColor: "#ece9df",
    title: "Econometrics Agent Workbench",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:5173";
  if (process.env.NODE_ENV === "production") {
    win.loadFile(path.join(__dirname, "..", "..", "dist", "index.html"));
  } else {
    win.loadURL(devUrl);
  }
}

app.whenReady().then(() => {
  startSidecar();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", stopSidecar);
