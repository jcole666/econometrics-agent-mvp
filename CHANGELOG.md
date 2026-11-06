# Changelog

本项目从 v0.7.0 开始记录变更。版本号遵循语义化版本：主版本用于不兼容变更，次版本用于功能或行为变更，修订版本用于修复。

## v0.7.0 — 交付修复版（2026-11-06）

定位：不加新功能，把已有能力变成「装得上、跑得通、口径诚实、不泄密」。共 9 个提交，26 个文件、约 1000 行改动。

### 修复（会让发布版不可用的问题）

- **打包版 CORS**：应用以 `file://` 加载页面，浏览器 `Origin` 为 `null`，而原白名单只有 `127.0.0.1:5173`。发布版所有请求会被 CORS 拦掉，开发模式正常因此不易发现。现放行 `null`，并将 `allow_credentials` 置为 `false`、方法收窄为 GET/POST/OPTIONS。
- **服务端模型配置不生效**：`maas_client` 用 `parents[2]` 定位 `.env`，实际指向 `desktop-app/`，导致 `get_maas_status()` 长期返回 `configured=false`；打包版还会去找从未打包的 `_MEIPASS/.env`。新增 `services/config_paths.py`，按 `XIAOJI_CONFIG_DIR` → `%APPDATA%\EconometricsAgent` → 仓库根 顺序查找。
- **源码模式起不来**：Electron 以仓库根为 cwd 执行 `python -m sidecar.serve`，而包在 `desktop-app/` 下，实测 `ModuleNotFoundError: No module named 'sidecar'`。现以 `desktop-app` 作为工作目录。

### 修复（会误导使用者的计量问题）

- **DID 模板估计量错误**：旧模板把年份列直接与处理组相乘，`年份=2018..2026` 时交互项实际是 `treated × 年份`。模拟面板（真实效应 6.0）上旧模板只得 0.80，新模板 4.83（p=0.014）。现先把年份转成 0/1 政策后虚拟变量，支持传入政策年份，个体列存在时按个体聚类。
- **RDD 模板**：`cutoff` 硬编码为 0、用全样本全局 OLS。现断点与带宽参数化，按带宽筛局部样本；缺省带宽退化为 running 列标准差（生成器侧先算好，避免 `H = None` 运行时崩溃）。
- **公式列名**：统一用 `Q("列名")` 包装，带空格、括号的列名不再触发 patsy 语法错误；DID/IV 的控制变量改用真实传入列表，不再凭空引用 `X1`/`X2` 占位符。
- **能力标注**：`/run-model` 增加 `execution_status`（`executed` / `planned`）与 `code_template`。DID、RDD、IV-2SLS 不再只说「暂不支持」，而是返回可运行模板并标明「仅方案」。

### 安全

- **模型地址白名单**：服务端会带着用户的 API Key 请求前端指定的 `base_url`，此前可指向任意主机。现仅允许 HTTPS、必须命中域名白名单、禁止 URL 内嵌账号密码；本机回环可用 HTTP，便于接本地推理服务。
- **本机访问令牌**：接口此前无鉴权，本机任意进程都能调用。现每次启动生成随机 UUID，注入 sidecar 环境变量，前端经 preload 取到后带在 `X-Xiaoji-Token`；`/health` 保持公开。未设置该环境变量时校验整段跳过，源码调试与测试不受影响。

### 文档与仓库治理

- 新增 `docs/capability-matrix.md`：按「真实执行 / 仅代码模板 / 未实现」逐项对齐，作为能力宣称的唯一事实来源。
- README：下载入口改为 `releases/latest`；新增「从源码运行」「自行打包」「本机安全边界」「测试与持续集成」；删除对 clone 用户无效的「根目录双击 小计.exe」。
- 新增 MIT `LICENSE`；新增 GitHub Actions CI（pytest + 前端 typecheck）。
- `.gitignore` 增加 `*.lnk`；`.env.example` 补充 `MAAS_ALLOWED_HOSTS` 说明。

### 测试

- 从 11 个用例增加到 49 个，覆盖 CORS（含 `Origin: null`）、本机令牌（含预检不被拦、401 带 CORS 头）、配置候选链、模型模板真实执行（DID 还原 6.0 效应、RDD 还原 0.25 跳跃）。
- 冻结版 sidecar 实测：2 秒内健康检查通过；无令牌 401、带令牌 200；`Origin: null` 预检返回 `ACAO: null`；示例数据 126 行、平衡面板；面板双向固定效应估计成功；RDD 返回含 `CUTOFF` 的模板。

### 已知限制

- 仍未实现：平行趋势检验、事件研究图、安慰剂检验、PSM-DID、McCrary 密度检验、最优带宽选择、LangGraph 编排、Docker 沙箱、报告 Jinja2 模板、代码签名。
- 打包版没有内置模型配置，用户需在设置面板填写 API Key，或把 `.env` 放到 `%APPDATA%\EconometricsAgent\`。
