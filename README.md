# Econometrics Agent MVP

计量建模桌面工具。主项目在 `desktop-app/`，最终产物是 Windows portable exe，双击即可启动。

## 项目结构

```text
desktop-app/
  app/          Electron + React 桌面界面
  sidecar/      本地 Python 分析服务
  examples/     示例数据
  packaging/    打包配置
  scripts/      构建脚本
docs/           架构说明
```

## 打包 exe

在仓库根目录运行：

```powershell
.\package-windows.ps1
```

生成结果：

```text
desktop-app\app\release\Econometrics-Agent-Workbench-0.1.0-portable.exe
```

## 开发

开发细节见 `desktop-app/README.md`。

常用检查：

```powershell
cd desktop-app
..\.venv\Scripts\python.exe -m pytest sidecar\tests
npm --prefix app run typecheck
```

## 配置

不要把 API Key 写进代码。需要接入 MaaS 时，用 `.env`、环境变量，或本地未跟踪的 `desktop-app/config.toml`。
