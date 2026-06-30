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

interface DataFilePayload {
  name: string;
  data: ArrayBuffer;
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

function userGuidePath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "docs", "user-guide.md");
  }
  return path.join(__dirname, "..", "..", "..", "..", "docs", "user-guide.md");
}

function guideMarkdownToHtml(markdown: string) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let inList = false;
  let inCode = false;
  const codeLines: string[] = [];

  const closeList = () => {
    if (inList) {
      html.push("</ul>");
      inList = false;
    }
  };

  for (const line of lines) {
    const text = line.trim();

    if (text.startsWith("```")) {
      if (inCode) {
        html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        codeLines.length = 0;
        inCode = false;
      } else {
        closeList();
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    if (!text) {
      closeList();
      continue;
    }

    const heading = text.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      closeList();
      html.push(`<h${heading[1].length}>${escapeHtml(heading[2])}</h${heading[1].length}>`);
      continue;
    }

    const item = text.match(/^[-*]\s+(.+)$/);
    if (item) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${escapeHtml(item[1])}</li>`);
      continue;
    }

    closeList();
    html.push(`<p>${escapeHtml(text)}</p>`);
  }

  closeList();
  return html.join("\n");
}

function guideHtml(markdown: string) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>小计使用文档</title>
  <style>
    :root {
      color-scheme: light;
      --pink: #f7c4d8;
      --butter: #fffecb;
      --mint: #ddf7b8;
      --aqua: #a7dde3;
      --page: #f8f1e8;
      --panel: #fffefa;
      --ink: #283235;
      --muted: #697275;
      --line: #d9d6c5;
      --accent: #2f7078;
      --gold: #d0a548;
    }
    body {
      margin: 0;
      background:
        linear-gradient(180deg, rgba(247, 196, 216, 0.46), rgba(255, 254, 203, 0.62) 42%, rgba(221, 247, 184, 0.46) 72%, rgba(167, 221, 227, 0.56)),
        var(--page);
      color: var(--ink);
      font-family: "Microsoft YaHei", "Segoe UI", sans-serif;
      line-height: 1.7;
    }
    main {
      max-width: 920px;
      margin: 0 auto;
      padding: 34px 42px 46px;
      background: rgba(255, 254, 250, 0.76);
      min-height: 100vh;
    }
    h1 {
      margin: 0 0 18px;
      color: var(--accent);
      font-size: 28px;
    }
    h2 {
      margin: 28px 0 12px;
      border-bottom: 1px solid var(--line);
      padding-bottom: 8px;
      color: var(--gold);
      font-size: 20px;
    }
    h3 {
      margin: 20px 0 8px;
      color: var(--ink);
      font-size: 16px;
    }
    p, li {
      color: var(--muted);
      font-size: 14px;
    }
    pre {
      overflow: auto;
      border: 1px solid var(--line);
      border-radius: 7px;
      background: #11171a;
      padding: 12px;
    }
    code {
      color: #ecf0e8;
      font-family: "Cascadia Mono", Consolas, monospace;
      font-size: 13px;
    }
  </style>
</head>
<body>
  <main>${guideMarkdownToHtml(markdown)}</main>
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
  const chooseDataFile = async () => {
    if (!mainWindow) return;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "选择数据文件",
      properties: ["openFile"],
      filters: [
        { name: "数据文件", extensions: ["csv", "xlsx", "xls"] },
        { name: "所有文件", extensions: ["*"] }
      ]
    });

    if (result.canceled || result.filePaths.length === 0) return;

    const filePath = result.filePaths[0];
    const data = await fs.readFile(filePath);
    const payload: DataFilePayload = {
      name: path.basename(filePath),
      data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
    };
    mainWindow.webContents.send("data-file-selected", payload);
    mainWindow.focus();
  };

  const openSettings = () => {
    mainWindow?.webContents.send("open-model-settings");
    mainWindow?.focus();
  };

  const openUserGuide = async () => {
    try {
      const markdown = await fs.readFile(userGuidePath(), "utf8");
      const guideWindow = new BrowserWindow({
        width: 980,
        height: 760,
        minWidth: 760,
        minHeight: 560,
        backgroundColor: "#f8f1e8",
        title: "小计使用文档",
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true
        }
      });
      await guideWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(guideHtml(markdown))}`);
    } catch (error) {
      await dialog.showMessageBox({
        type: "warning",
        title: "使用文档",
        message: "暂时无法打开使用文档。",
        detail: error instanceof Error ? error.message : String(error)
      });
    }
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
        { label: "选择数据文件", accelerator: "CmdOrCtrl+O", click: chooseDataFile },
        { type: "separator" },
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
        { label: "使用文档", click: openUserGuide },
        { type: "separator" },
        { label: "检查本地服务", click: checkLocalService },
        { type: "separator" },
        {
          label: "关于",
          click: async () => {
            await dialog.showMessageBox({
              type: "info",
              title: `关于 ${APP_TITLE}`,
              message: "计量建模小计研究工作台",
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
    backgroundColor: "#f8f1e8",
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
