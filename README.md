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

## 快速演示

打开 `小计.exe` 后，点击左侧“演示”。软件会自动加载城市面板样例，填好研究问题和变量，生成模型推荐，运行面板固定效应，并生成一版 Markdown 报告草稿。左侧会同步生成“数据体检”“演示讲解卡”和“路演稿”，下面的“评审追问”可以接到右侧问答，适合 3 分钟路演。

演示样例围绕“数字经济发展是否会提升城市创新水平？”展开，适合结项路演时先展示完整流程，再继续追问数据质量、变量关系和识别边界。

标题右侧的“工作台 / 字段画像 / 研究路径 / 分析报告”用于切换视图，平时只保留核心工作台，细节页面点开再看。“研究路径”里有折叠的现场答辩卡，可以把常见评审问题放进右侧问答继续展开。界面里的列宽和板块高度都可以拖动调整，右上角“演示布局”可以一键恢复路演视图。

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

使用说明见 `docs/user-guide.md`，也可以在软件顶部菜单点击“帮助” -> “使用文档”。

常用检查：

```powershell
cd desktop-app
..\.venv\Scripts\python.exe -m pytest sidecar\tests
npm --prefix app run typecheck
```

## 配置

不要把 API Key 写进代码。需要接入 MaaS 时，用 `.env`、环境变量，或本地未跟踪的 `desktop-app/config.toml`。
