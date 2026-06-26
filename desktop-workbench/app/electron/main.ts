import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

import { app, BrowserWindow } from "electron";

const SIDECAR_PORT = 8768;

let sidecar: ChildProcess | null = null;

function projectRoot() {
  return path.resolve(__dirname, "..", "..", "..");
}

function pythonPath(root: string) {
  const localPython = path.join(root, ".venv", "Scripts", "python.exe");
  return fs.existsSync(localPython) ? localPython : "python";
}

function packagedSidecarPath() {
  const name = process.platform === "win32" ? "econometrics-sidecar.exe" : "econometrics-sidecar";
  return path.join(process.resourcesPath, "sidecar", "econometrics-sidecar", name);
}

function startSidecar() {
  const root = projectRoot();
  const command = app.isPackaged ? packagedSidecarPath() : pythonPath(root);
  const args = app.isPackaged ? ["--port", String(SIDECAR_PORT)] : ["-m", "sidecar.serve", "--port", String(SIDECAR_PORT)];
  const cwd = app.isPackaged ? path.dirname(command) : root;

  if (app.isPackaged && !fs.existsSync(command)) {
    throw new Error(`Sidecar executable not found: ${command}`);
  }

  sidecar = spawn(command, args, {
    cwd,
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
    stdio: "ignore",
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

function waitForSidecar(timeoutMs = 15000) {
  const startedAt = Date.now();

  return new Promise<void>((resolve) => {
    const ping = () => {
      let settled = false;

      const retry = () => {
        if (settled) return;
        settled = true;
        if (Date.now() - startedAt >= timeoutMs) {
          resolve();
          return;
        }
        setTimeout(ping, 500);
      };

      const request = http.get(
        { hostname: "127.0.0.1", port: SIDECAR_PORT, path: "/health", timeout: 1000 },
        (response) => {
          response.resume();
          if (settled) return;
          if (response.statusCode && response.statusCode < 500) {
            settled = true;
            resolve();
            return;
          }
          retry();
        }
      );

      request.on("timeout", () => {
        request.destroy();
        retry();
      });
      request.on("error", retry);
    };

    ping();
  });
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
  if (app.isPackaged || process.env.NODE_ENV === "production") {
    win.loadFile(path.join(__dirname, "..", "..", "dist", "index.html"));
  } else {
    win.loadURL(devUrl);
  }
}

app.whenReady().then(async () => {
  startSidecar();
  await waitForSidecar();
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
