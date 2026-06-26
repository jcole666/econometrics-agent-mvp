# Architecture

当前版本只保留桌面应用主线。

```text
Econometrics-Agent-Workbench.exe
        |
        v
Electron main process
        |
        +-- React renderer
        |
        +-- packaged sidecar process
              |
              v
          FastAPI endpoints
              |
              +-- data profiling
              +-- variable inference
              +-- model recommendation
              +-- OLS / Logit execution
              +-- chat and report generation
```

## 入口

- `desktop-app/app/electron/main.ts`：窗口、单实例、启动流程。
- `desktop-app/app/electron/sidecar.ts`：sidecar 进程启动、健康检查和退出处理。
- `desktop-app/app/src/App.tsx`：桌面界面。
- `desktop-app/sidecar/api.py`：本地分析 API。

## 打包

`desktop-app/scripts/package-windows.ps1` 是主构建脚本：

1. 检查或构建 `sidecar-dist/econometrics-sidecar/econometrics-sidecar.exe`。
2. 构建 React 和 Electron 主进程。
3. 通过 electron-builder 生成 Windows portable exe。

根目录 `package-windows.ps1` 只是快捷入口。

## 运行时

用户双击 portable exe 后，Electron 会启动本地 sidecar，并等待 `/health` 返回 `ok`。如果启动失败，应用会弹出中文错误提示，不会静默白屏。
