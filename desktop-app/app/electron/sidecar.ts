import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

import { app } from "electron";

export const SIDECAR_PORT = 8768;

export const LOCAL_TOKEN_ENV = "XIAOJI_LOCAL_TOKEN";

/**
 * 每次启动生成一个随机令牌，注入 sidecar 环境变量，并交给渲染进程带在请求头里。
 * 这样本机其他进程即使能访问 127.0.0.1:8768，也调不动这些接口（例如借接口把 Key 转发出去）。
 */
const LOCAL_TOKEN = crypto.randomUUID();

export function localAccessToken() {
  return LOCAL_TOKEN;
}

let sidecar: ChildProcess | null = null;
let exitCode: number | null = null;
let logStream: fs.WriteStream | null = null;

function projectRoot() {
  return path.resolve(__dirname, "..", "..", "..");
}

function pythonPath(root: string) {
  const candidates = [
    path.join(root, ".venv", "Scripts", "python.exe"),
    path.join(root, "..", ".venv", "Scripts", "python.exe")
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? "python";
}

/**
 * 源码模式下 sidecar 包位于 desktop-app/，必须在该目录启动，
 * 否则 `python -m sidecar.serve` 会报 No module named 'sidecar'。
 */
function sidecarWorkdir(root: string) {
  const desktopApp = path.join(root, "desktop-app");
  return fs.existsSync(path.join(desktopApp, "sidecar")) ? desktopApp : root;
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

function sidecarLogPath() {
  try {
    return path.join(app.getPath("userData"), "sidecar.log");
  } catch {
    return path.join(process.cwd(), "sidecar.log");
  }
}

/** 清掉占用 8768 的残留进程（上次崩溃留下的 sidecar），再由当前实例带着令牌重新拉起。 */
export function reclaimSidecarPort() {
  if (process.platform !== "win32") return;
  try {
    const out = execFileSync("cmd.exe", ["/c", `netstat -ano | findstr :${SIDECAR_PORT}`], {
      encoding: "utf8",
      windowsHide: true
    });
    const pids = new Set<string>();
    for (const line of out.split(/\r?\n/)) {
      if (!/LISTENING/i.test(line)) continue;
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && /^\d+$/.test(pid) && pid !== String(process.pid)) pids.add(pid);
    }
    for (const pid of pids) {
      try {
        execFileSync("taskkill.exe", ["/PID", pid, "/F", "/T"], { stdio: "ignore", windowsHide: true });
      } catch {
        // ignore
      }
    }
  } catch {
    // 没有监听进程时 findstr 非 0，忽略
  }
}

export function startSidecar() {
  const root = projectRoot();
  const usePackagedSidecar = hasPackagedSidecar();
  const command = usePackagedSidecar ? packagedSidecarPath() : pythonPath(root);
  const args = usePackagedSidecar ? ["--port", String(SIDECAR_PORT)] : ["-m", "sidecar.serve", "--port", String(SIDECAR_PORT)];
  const cwd = usePackagedSidecar ? path.dirname(command) : sidecarWorkdir(root);

  if ((app.isPackaged || process.env.NODE_ENV === "production") && !fs.existsSync(command)) {
    throw new Error(`找不到本地分析服务程序：${command}`);
  }

  if (logStream) {
    try {
      logStream.end();
    } catch {
      // ignore
    }
    logStream = null;
  }

  const captureLogs = app.isPackaged;
  if (captureLogs) {
    try {
      logStream = fs.createWriteStream(sidecarLogPath(), { flags: "a" });
      logStream.write(`\n---- sidecar start ${new Date().toISOString()} ----\n${command} ${args.join(" ")}\n`);
    } catch {
      logStream = null;
    }
  }

  sidecar = spawn(command, args, {
    cwd,
    env: { ...process.env, PYTHONUNBUFFERED: "1", [LOCAL_TOKEN_ENV]: LOCAL_TOKEN },
    stdio: captureLogs && logStream ? ["ignore", "pipe", "pipe"] : app.isPackaged ? "ignore" : "inherit",
    windowsHide: true
  });

  if (logStream) {
    sidecar.stdout?.on("data", (chunk) => logStream?.write(chunk));
    sidecar.stderr?.on("data", (chunk) => logStream?.write(chunk));
  }

  exitCode = null;
  sidecar.on("exit", (code) => {
    exitCode = code;
    sidecar = null;
    if (logStream) {
      try {
        logStream.write(`---- sidecar exit code=${code} ${new Date().toISOString()} ----\n`);
        logStream.end();
      } catch {
        // ignore
      }
      logStream = null;
    }
  });
  sidecar.on("error", (error) => {
    if (logStream) {
      try {
        logStream.write(`---- sidecar spawn error: ${error.message} ----\n`);
      } catch {
        // ignore
      }
    }
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

export function waitForSidecar(timeoutMs = 120000) {
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
