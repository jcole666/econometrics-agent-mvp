# Econometrics Agent MVP

计量建模桌面工具。现在主线是 Windows 桌面应用，入口在 `desktop-app/`，最终产物是可以直接双击运行的 portable exe。

## 目录

```text
desktop-app/
  app/          Electron + React 界面
  sidecar/      本地 Python 分析服务
  examples/     示例数据
  packaging/    打包配置
  scripts/      构建脚本
docs/           架构和开发记录
```

旧的浏览器 Demo 后端不再作为主入口维护。

## 打包

```powershell
cd desktop-app
.\scripts\package-windows.ps1
```

打包完成后，exe 会生成到：

```text
desktop-app\app\release\Econometrics-Agent-Workbench-0.1.0-portable.exe
```

## 开发

```powershell
cd desktop-app
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r sidecar\requirements.txt

cd app
npm install
npm run dev
```

另开一个终端启动桌面壳：

```powershell
cd desktop-app\app
npm run dev:electron
```

## 配置

不要把 API Key 写进代码。需要接入 MaaS 时，复制 `.env.example` 或 `desktop-app/config.example.toml` 后在本地填写。

常用环境变量：

```text
MAAS_ENABLED=auto
MAAS_BASE_URL=https://api.modelarts-maas.com/openai/v1
MAAS_MODEL=deepseek-v4-pro-IckBJP
MAAS_API_KEY=...
```
