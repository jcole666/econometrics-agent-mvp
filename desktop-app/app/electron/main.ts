import path from "node:path";

import { app, BrowserWindow, dialog, Menu, type MenuItemConstructorOptions } from "electron";

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

function installAppMenu() {
  const template: MenuItemConstructorOptions[] = [
    {
      label: "文件",
      submenu: [
        { label: "关闭窗口", role: "close" },
        { type: "separator" },
        { label: "退出", role: "quit" }
      ]
    },
    {
      label: "编辑",
      submenu: [
        { label: "撤销", role: "undo" },
        { label: "重做", role: "redo" },
        { type: "separator" },
        { label: "剪切", role: "cut" },
        { label: "复制", role: "copy" },
        { label: "粘贴", role: "paste" },
        { label: "全选", role: "selectAll" }
      ]
    },
    {
      label: "视图",
      submenu: [
        { label: "重新加载", role: "reload" },
        { label: "强制重新加载", role: "forceReload" },
        { label: "开发者工具", role: "toggleDevTools" },
        { type: "separator" },
        { label: "实际大小", role: "resetZoom" },
        { label: "放大", role: "zoomIn" },
        { label: "缩小", role: "zoomOut" },
        { type: "separator" },
        { label: "切换全屏", role: "togglefullscreen" }
      ]
    },
    {
      label: "窗口",
      submenu: [
        { label: "最小化", role: "minimize" },
        { label: "缩放", role: "zoom" },
        { type: "separator" },
        { label: "关闭", role: "close" }
      ]
    },
    {
      label: "帮助",
      submenu: [
        {
          label: "关于",
          click: async () => {
            await dialog.showMessageBox({
              type: "info",
              title: `关于 ${APP_TITLE}`,
              message: "计量建模智能体研究工作台",
              detail: "本地运行的计量建模桌面工具。"
            });
          }
        }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function showStartupError(detail: string) {
  await dialog.showMessageBox({
    type: "error",
    title: APP_TITLE,
    message: "本地分析服务启动失败。",
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
      installAppMenu();

      const packagedSidecar = hasPackagedSidecar();
      const alreadyRunning = await checkSidecarHealth(500);

      if (packagedSidecar && alreadyRunning) {
        await showStartupError(`端口 ${SIDECAR_PORT} 已被占用。请关闭正在运行的其他实例后再启动。`);
        app.quit();
        return;
      }

      if (!alreadyRunning) {
        startSidecar();
      }

      const ready = alreadyRunning || (await waitForSidecar());
      if (!ready) {
        const exitCode = lastSidecarExitCode();
        const exitNote = exitCode === null ? "" : `进程退出码：${exitCode}。`;
        await showStartupError(`服务端口：${SIDECAR_PORT}。${exitNote}`);
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
