import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

import { app, BrowserWindow, dialog } from "electron";

const SIDECAR_PORT = 8768;
const APP_TITLE = "Econometrics Agent Workbench";

let sidecar: ChildProcess | null = null;
let sidecarExitCode: number | null = null;
let mainWindow: BrowserWindow | null = null;

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

function hasPackagedSidecar() {
  return fs.existsSync(packagedSidecarPath());
}

function startSidecar() {
  const root = projectRoot();
  const usePackagedSidecar = hasPackagedSidecar();
  const command = usePackagedSidecar ? packagedSidecarPath() : pythonPath(root);
  const args = usePackagedSidecar ? ["--port", String(SIDECAR_PORT)] : ["-m", "sidecar.serve", "--port", String(SIDECAR_PORT)];
  const cwd = usePackagedSidecar ? path.dirname(command) : root;

  if ((app.isPackaged || process.env.NODE_ENV === "production") && !fs.existsSync(command)) {
    throw new Error(`Sidecar executable not found: ${command}`);
  }

  sidecar = spawn(command, args, {
    cwd,
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
    stdio: "ignore",
    windowsHide: true
  });

  sidecarExitCode = null;
  sidecar.on("exit", (code) => {
    sidecarExitCode = code;
    sidecar = null;
  });
}

function stopSidecar() {
  if (sidecar && !sidecar.killed) {
    sidecar.kill();
  }
  sidecar = null;
}

function checkSidecarHealth(timeoutMs = 1000) {
  return new Promise<boolean>((resolve) => {
    let settled = false;

    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };

    const request = http.get(
      { hostname: "127.0.0.1", port: SIDECAR_PORT, path: "/health", timeout: timeoutMs },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          try {
            finish(response.statusCode === 200 && JSON.parse(body).status === "ok");
          } catch {
            finish(false);
          }
        });
      }
    );

    request.on("timeout", () => {
      request.destroy();
      finish(false);
    });
    request.on("error", () => finish(false));
  });
}

function waitForSidecar(timeoutMs = 15000) {
  const startedAt = Date.now();

  return new Promise<boolean>((resolve) => {
    const ping = async () => {
      if (await checkSidecarHealth()) {
        resolve(true);
        return;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        resolve(false);
        return;
      }

      setTimeout(ping, 500);
    };

    ping();
  });
}

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
        const exitNote = sidecarExitCode === null ? "" : ` Sidecar exited with code ${sidecarExitCode}.`;
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
