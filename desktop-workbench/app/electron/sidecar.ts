import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

import { app } from "electron";

export const SIDECAR_PORT = 8768;

let sidecar: ChildProcess | null = null;
let exitCode: number | null = null;

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

export function hasPackagedSidecar() {
  return fs.existsSync(packagedSidecarPath());
}

export function lastSidecarExitCode() {
  return exitCode;
}

export function startSidecar() {
  const root = projectRoot();
  const usePackagedSidecar = hasPackagedSidecar();
  const command = usePackagedSidecar ? packagedSidecarPath() : pythonPath(root);
  const args = usePackagedSidecar ? ["--port", String(SIDECAR_PORT)] : ["-m", "sidecar.serve", "--port", String(SIDECAR_PORT)];
  const cwd = usePackagedSidecar ? path.dirname(command) : root;

  if ((app.isPackaged || process.env.NODE_ENV === "production") && !fs.existsSync(command)) {
    throw new Error(`找不到本地分析服务程序：${command}`);
  }

  sidecar = spawn(command, args, {
    cwd,
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
    stdio: app.isPackaged ? "ignore" : "inherit",
    windowsHide: true
  });

  exitCode = null;
  sidecar.on("exit", (code) => {
    exitCode = code;
    sidecar = null;
  });
}

export function stopSidecar() {
  if (sidecar && !sidecar.killed) {
    sidecar.kill();
  }
  sidecar = null;
}

export function checkSidecarHealth(timeoutMs = 1000) {
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

export function waitForSidecar(timeoutMs = 15000) {
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
