import fs from "node:fs/promises";
import path from "node:path";

import { app, BrowserWindow, dialog, ipcMain, Menu, type MenuItemConstructorOptions } from "electron";

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

interface SaveTextPayload {
  fileName?: string;
  content?: string;
}

interface SavePdfPayload {
  fileName?: string;
  title?: string;
  markdown?: string;
}

function fileName(value: string | undefined, fallback: string) {
  const clean = (value || fallback).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim();
  return clean || fallback;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function reportHtml(title: string, markdown: string) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    body {
      margin: 34px;
      color: #24231f;
      font-family: "Microsoft YaHei", "Segoe UI", sans-serif;
      font-size: 13px;
      line-height: 1.65;
    }
    h1 {
      margin: 0 0 18px;
      font-size: 22px;
    }
    pre {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: "Microsoft YaHei", "Segoe UI", sans-serif;
    }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <pre>${escapeHtml(markdown)}</pre>
</body>
</html>`;
}

function installIpcHandlers() {
  ipcMain.handle("save-text-file", async (_event, payload: SaveTextPayload = {}) => {
    const content = payload.content || "";
    if (!content.trim()) {
      return { ok: false, canceled: false, error: "没有可导出的内容。" };
    }

    const result = await dialog.showSaveDialog({
      title: "导出 Markdown 报告",
      defaultPath: path.join(app.getPath("documents"), fileName(payload.fileName, "分析报告.md")),
      filters: [
        { name: "Markdown", extensions: ["md"] },
        { name: "Text", extensions: ["txt"] }
      ]
    });

    if (result.canceled || !result.filePath) {
      return { ok: false, canceled: true };
    }

    await fs.writeFile(result.filePath, content, "utf8");
    return { ok: true, filePath: result.filePath };
  });

  ipcMain.handle("save-report-pdf", async (_event, payload: SavePdfPayload = {}) => {
    const markdown = payload.markdown || "";
    if (!markdown.trim()) {
      return { ok: false, canceled: false, error: "没有可导出的内容。" };
    }

    const result = await dialog.showSaveDialog({
      title: "导出 PDF 报告",
      defaultPath: path.join(app.getPath("documents"), fileName(payload.fileName, "分析报告.pdf")),
      filters: [{ name: "PDF", extensions: ["pdf"] }]
    });

    if (result.canceled || !result.filePath) {
      return { ok: false, canceled: true };
    }

    const printWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    try {
      const html = reportHtml(payload.title || "分析报告", markdown);
      await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      const pdf = await printWindow.webContents.printToPDF({
        pageSize: "A4",
        printBackground: true,
        margins: { marginType: "default" }
      });
      await fs.writeFile(result.filePath, pdf);
      return { ok: true, filePath: result.filePath };
    } finally {
      printWindow.close();
    }
  });
}

function installAppMenu() {
  const openSettings = () => {
    mainWindow?.webContents.send("open-model-settings");
    mainWindow?.focus();
  };

  const checkLocalService = async () => {
    const online = await checkSidecarHealth(1000);
    await dialog.showMessageBox({
      type: online ? "info" : "warning",
      title: "本地服务",
      message: online ? "本地分析服务正在运行。" : "本地分析服务未响应。",
      detail: `服务端口：${SIDECAR_PORT}`
    });
  };

  const viewSubmenu: MenuItemConstructorOptions[] = [
    { label: "恢复默认缩放", role: "resetZoom" },
    { label: "放大", role: "zoomIn" },
    { label: "缩小", role: "zoomOut" },
    { type: "separator" },
    { label: "全屏", role: "togglefullscreen" }
  ];

  if (!app.isPackaged) {
    viewSubmenu.push(
      { type: "separator" },
      { label: "重新加载", role: "reload" },
      { label: "强制重新加载", role: "forceReload" },
      { label: "开发者工具", role: "toggleDevTools" }
    );
  }

  const template: MenuItemConstructorOptions[] = [
    {
      label: "文件",
      submenu: [
        { label: "模型设置", click: openSettings },
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
      submenu: viewSubmenu
    },
    {
      label: "帮助",
      submenu: [
        { label: "检查本地服务", click: checkLocalService },
        { type: "separator" },
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

  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.key === "Escape" && mainWindow?.isFullScreen()) {
      mainWindow.setFullScreen(false);
      event.preventDefault();
    }
  });

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
      installIpcHandlers();
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
