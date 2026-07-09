# 小计：计量建模工作台

一个本地运行的计量建模桌面工具。日常使用不需要打开网页，也不需要进命令行。

## 下载发布版

Windows 用户直接下载最新版：

[Econometrics-Agent-Workbench-0.6.0-portable.exe](https://github.com/jcole666/econometrics-agent-mvp/releases/download/v0.6.0/Econometrics-Agent-Workbench-0.6.0-portable.exe)

下载后双击即可使用。第一次启动会自动拉起本地分析服务，可能需要等待十几秒。

当前版本还没有做代码签名。如果 Windows 弹出安全提示，可以点”更多信息” -> “仍要运行”。

旧版本仍保留在 [GitHub Releases](https://github.com/jcole666/econometrics-agent-mvp/releases) 页面，可以按版本号下载。

校验值：

```text
SHA256 5B9D3C99D2DE9F6C4E7134242E2259038C2A0C818D7E4244AFAF92F5FAF21A73
```

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
desktop-app\app\release\Econometrics-Agent-Workbench-0.5.0-portable.exe
```

## 快速体验

打开 `小计.exe` 后，点击左侧“示例”。软件会自动加载城市面板示例数据（14 个城市，2018-2026 年，共 126 行），填好研究问题和变量，生成模型推荐，运行面板固定效应，并生成一版 Markdown 报告草稿。左侧会同步显示“示例说明”和“数据体检”，方便新用户理解从数据读取到报告生成的完整流程。

示例场景围绕“数字经济发展是否会提升城市创新水平？”展开。你可以先用它熟悉字段画像、变量关系、模型推荐和识别边界，再换成自己的数据继续分析。

标题右侧的“工作台 / 字段画像 / 研究路径 / 分析报告 / 使用文档”用于切换视图，平时只保留核心工作台，细节页面点开再看。“研究路径”里的候选问题可以直接采用，也可以在右侧小计回答里继续展开。界面里的列宽和板块高度都可以拖动调整，右上角“重置布局”可以恢复推荐工作台布局。

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
  model-check-framework.md  模型选择与前提条件检验框架
```

## 打包 exe

在仓库根目录运行：

```powershell
.\package-windows.ps1
```

生成结果会放在两个位置：

```text
小计.exe
desktop-app\app\release\Econometrics-Agent-Workbench-0.6.0-portable.exe
```

## 开发

开发细节见 `desktop-app/README.md`。

使用说明见 `docs/user-guide.md`，也可以在软件顶部点击“使用文档”。模型选择与前提条件检验框架见 `docs/model-check-framework.md`。

常用检查：

```powershell
cd desktop-app
..\.venv\Scripts\python.exe -m pytest sidecar\tests
npm --prefix app run typecheck
```

## 配置

不要把 API Key 写进代码。需要接入 MaaS 时，用 `.env`、环境变量，或本地未跟踪的 `desktop-app/config.toml`。
