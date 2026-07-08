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

function inlineMarkdown(value: string) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function tableCells(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isTableRow(line: string) {
  const text = line.trim();
  return text.startsWith("|") && text.endsWith("|") && text.includes("|");
}

function isTableSeparator(line: string) {
  if (!isTableRow(line)) return false;
  return tableCells(line).every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isFormulaStart(text: string) {
  return text.startsWith("$$") || text.startsWith("\\[") || /^\\begin\{[^}]+\}/.test(text);
}

function isFormulaEnd(text: string, firstLine: string) {
  if (firstLine.startsWith("$$")) return text.endsWith("$$");
  if (firstLine.startsWith("\\[")) return text.endsWith("\\]");
  const env = firstLine.match(/^\\begin\{([^}]+)\}/)?.[1];
  return Boolean(env && text.startsWith(`\\end{${env}}`));
}

function markdownToHtml(markdown: string) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let index = 0;
  let inList = false;

  const closeList = () => {
    if (inList) {
      html.push("</ul>");
      inList = false;
    }
  };

  while (index < lines.length) {
    const line = lines[index];
    const text = line.trim();

    if (!text) {
      closeList();
      index += 1;
      continue;
    }

    const codeStart = text.match(/^```([\w-]*)/);
    if (codeStart) {
      closeList();
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = text.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = Math.min(heading[1].length, 3);
      html.push(`<h${level}>${inlineMarkdown(heading[2].trim())}</h${level}>`);
      index += 1;
      continue;
    }

    if (isTableRow(text) && index + 1 < lines.length && isTableSeparator(lines[index + 1].trim())) {
      closeList();
      const headers = tableCells(text);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && isTableRow(lines[index].trim()) && !isTableSeparator(lines[index].trim())) {
        const cells = tableCells(lines[index]);
        rows.push(headers.map((_, cellIndex) => cells[cellIndex] ?? ""));
        index += 1;
      }
      html.push("<table><thead><tr>");
      html.push(headers.map((header) => `<th>${inlineMarkdown(header)}</th>`).join(""));
      html.push("</tr></thead><tbody>");
      for (const row of rows) {
        html.push("<tr>");
        html.push(row.map((cell) => `<td>${inlineMarkdown(cell)}</td>`).join(""));
        html.push("</tr>");
      }
      html.push("</tbody></table>");
      continue;
    }

    if (isFormulaStart(text)) {
      closeList();
      const firstLine = text;
      const formulaLines = [line.trim()];
      index += 1;
      const closedOnFirstLine =
        (firstLine.startsWith("$$") && firstLine.length > 2 && firstLine.endsWith("$$")) ||
        (firstLine.startsWith("\\[") && firstLine.endsWith("\\]")) ||
        /^\\begin\{([^}]+)\}.*\\end\{\1\}$/.test(firstLine);

      if (!closedOnFirstLine) {
        while (index < lines.length && !isFormulaEnd(lines[index].trim(), firstLine)) {
          formulaLines.push(lines[index].trim());
          index += 1;
        }
        if (index < lines.length) {
          formulaLines.push(lines[index].trim());
          index += 1;
        }
      }
      html.push(`<div class="formula">${escapeHtml(formulaLines.join("\n"))}</div>`);
      continue;
    }

    const item = text.match(/^[-*]\s+(.+)$/);
    if (item) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${inlineMarkdown(item[1])}</li>`);
      index += 1;
      continue;
    }

    closeList();
    const paragraph = [text];
    index += 1;
    while (index < lines.length) {
      const nextText = lines[index].trim();
      if (
        !nextText ||
        nextText.startsWith("```") ||
        /^(#{1,4})\s+/.test(nextText) ||
        /^[-*]\s+/.test(nextText) ||
        isTableRow(nextText) ||
        isFormulaStart(nextText)
      ) {
        break;
      }
      paragraph.push(nextText);
      index += 1;
    }
    html.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
  }

  closeList();
  return html.join("\n");
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
    h2 {
      margin: 26px 0 10px;
      border-bottom: 1px solid #d9ddd8;
      padding-bottom: 7px;
      font-size: 18px;
    }
    h3 {
      margin: 18px 0 8px;
      font-size: 15px;
    }
    p {
      margin: 8px 0;
    }
    ul {
      margin: 8px 0 12px 20px;
      padding: 0;
    }
    li {
      margin: 4px 0;
    }
    table {
      width: 100%;
      margin: 14px 0;
      border: 1px solid #d9ddd8;
      border-collapse: collapse;
      font-size: 12px;
    }
    th, td {
      border: 1px solid #d9ddd8;
      padding: 7px 8px;
      text-align: left;
      vertical-align: top;
    }
    th {
      background: #f3f4f2;
      font-weight: 700;
    }
    pre {
      margin: 12px 0;
      border: 1px solid #d9ddd8;
      border-radius: 6px;
      background: #f6f6f3;
      padding: 10px;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: "Cascadia Mono", Consolas, monospace;
      font-size: 12px;
    }
    code {
      border-radius: 4px;
      background: #f1f1ee;
      padding: 1px 4px;
      font-family: "Cascadia Mono", Consolas, monospace;
      font-size: 12px;
    }
    .formula {
      margin: 12px 0;
      border-left: 3px solid #202123;
      background: #f6f6f3;
      padding: 10px 12px;
      white-space: pre-wrap;
      font-family: "Cambria Math", "Times New Roman", serif;
    }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <main>${markdownToHtml(markdown)}</main>
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
  return markdownToHtml(markdown);
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
      --page: #eef3f6;
      --panel: #ffffff;
      --ink: #202724;
      --muted: #65716c;
      --line: #d4dde2;
      --accent: #3f6f8f;
      --gold: #b98a2f;
    }
    body {
      margin: 0;
      background: var(--page);
      color: var(--ink);
      font-family: "Microsoft YaHei", "Segoe UI", sans-serif;
      line-height: 1.7;
    }
    main {
      max-width: 920px;
      margin: 0 auto;
      padding: 34px 42px 46px;
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
        backgroundColor: "#eef3f6",
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
