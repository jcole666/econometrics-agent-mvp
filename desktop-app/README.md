# Econometrics Agent Workbench

桌面版计量建模工作台。Electron 负责窗口和应用生命周期，Python sidecar 负责本地数据分析、模型推荐、模型运行和报告生成。

## 目录

```text
app/          桌面界面和 Electron 主进程
sidecar/      FastAPI 本地分析服务
examples/     示例数据
packaging/    PyInstaller 配置
scripts/      构建脚本
```

## 打包

在仓库根目录运行：

```powershell
.\package-windows.ps1
```

或在当前目录运行：

```powershell
.\scripts\package-windows.ps1
```

打包流程会先确认 sidecar exe，再构建 Electron portable 应用。输出位置：

```text
app\release\Econometrics-Agent-Workbench-0.1.0-portable.exe
```

需要强制重建 sidecar 时：

```powershell
.\scripts\package-windows.ps1 -RebuildSidecar
```

如果 `sidecar-dist\econometrics-sidecar` 已存在，脚本会停止并提示手动处理，避免误删本地构建产物。

## 开发

准备 Python 依赖：

```powershell
cd desktop-app
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r sidecar\requirements.txt
```

准备界面依赖：

```powershell
cd app
npm install
```

开发模式需要两个终端：

```powershell
# 终端 1
cd desktop-app\app
npm run dev
```

```powershell
# 终端 2
cd desktop-app\app
npm run dev:electron
```

这个模式只用于开发。正式给别人用时，直接发 `app\release\` 里的 portable exe。

## 检查

```powershell
cd desktop-app
..\.venv\Scripts\python.exe -m pytest sidecar\tests
npm --prefix app run typecheck
```

## 配置

不要把密钥写进代码。需要 MaaS 时，用 `.env`、环境变量，或本地未跟踪的 `config.toml`。

常用环境变量：

```text
MAAS_ENABLED=auto
MAAS_BASE_URL=https://api.modelarts-maas.com/openai/v1
MAAS_MODEL=deepseek-v4-pro-IckBJP
MAAS_API_KEY=...
```
