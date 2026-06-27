# 小计：计量建模工作台

一个本地运行的计量建模桌面工具。日常使用不需要打开网页，也不需要进命令行。

## 直接打开

在项目根目录双击：

```text
小计.exe
```

如果根目录还没有这个文件，先运行一次打包脚本：

```powershell
.\package-windows.ps1
```

脚本会生成正式文件，并自动同步一份到根目录：

```text
小计.exe
```

原始打包产物仍保留在：

```text
desktop-app\app\release\Econometrics-Agent-Workbench-0.1.0-portable.exe
```

`小计.exe` 是本地生成文件，体积较大，不提交到 GitHub。

## 项目结构

```text
小计.exe        本地生成的双击入口
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

生成结果会放在两个位置：

```text
小计.exe
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
