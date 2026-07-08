# 小计（计量建模工作台）模型选择与前提条件检验动态指导框架

**文档版本**：v2.1（项目实际代码对齐版）
**编制日期**：2026年7月4日
**编制者**：计量摆渡人
**项目仓库**：https://github.com/jcole666/econometrics-agent-mvp
**适用范围**：小计桌面端完成数据画像（/profile-data）和变量识别（/infer-variables）后的模型推荐（/recommend-model）、代码生成（generate_code）与模型运行（/run-model）阶段
**设计原则**：理论驱动 + 规则优先（model_selector.py规则引擎）+ LLM增强（华为MaaS）+ 人机协作决策

---

## ▶ 快速执行协议（Agent专用 · Quick Execution Protocol）

当Agent进入"模型选择与前提验证"阶段时，按以下协议顺序执行。本协议是全文的压缩入口，详细规则见后续各章节。

### 协议步骤

```
[PROTOCOL-STEP-1] 数据结构判定
  ├── 输入：预处理后的DataFrame + 研究问题类型 + 变量清单
  ├── 判定数据维度：横截面 / 面板 / 时间序列
  └── 输出：data_type ∈ {cross_section, panel, time_series}

[PROTOCOL-STEP-2] 路由到候选模型
  ├── 依据 §1.2 路由规则表，将 data_type + research_question 映射到候选模型集
  ├── 候选模型集可能包含 1~3 个模型
  └── 输出：candidate_models = [model_1, model_2, ...]

[PROTOCOL-STEP-3] 逐模型进行前提条件检验
  ├── 对 candidate_models 中的每个模型，按 §2.x.2 执行检验清单
  ├── 每个检验返回：PASS / FAIL / WARN
  ├── 若存在 FAIL 且不可修正 → 从候选集中移除该模型
  ├── 若存在 FAIL 但可修正 → 标记为 CONDITIONAL，触发对应交互确认节点
  └── 输出：model_check_results = {model: {test_id: status, ...}, ...}

[PROTOCOL-STEP-4] 模型竞争裁决
  ├── 若仅剩 1 个候选模型 → 直接选择
  ├── 若剩余多个候选模型 → 触发交互确认，由用户选择
  ├── 若无候选模型剩余 → 输出失败报告，建议替代方案
  └── 输出：selected_model

[PROTOCOL-STEP-5] 代码生成与执行
  ├── 根据 selected_model，读取 §2.x.5 的代码模板（来自 code_generator.py）
  ├── 将模板中的占位符 `<<PLACEHOLDER>>` 替换为实际值
  ├── 若模型支持 /run-model → 通过 model_runner.py 执行并返回系数表
  ├── 若模型仅支持代码模板 → 输出代码供用户本地运行
  └── 输出：模型估计结果 + 诊断检验结果
```

### 路由规则速查表

Agent（model_selector.py）在进行 [PROTOCOL-STEP-2] 时，使用以下规则表确定候选模型集。从上到下依次检查条件，首个匹配的行即为路由目标。**此表与小计 `desktop-app/sidecar/services/model_selector.py` 中 `select_model()` 函数的实际逻辑一致。**

```
[ROUTE-TABLE]
ROUTE_ID | CONDITION（与 model_selector.py 逻辑一致）                   | TARGET_MODEL       | 实际触发关键词
---------|--------------------------------------------------------------|--------------------|--------------------------
R01      | running_variable 已填写 或 研究问题含 "RDD/断点/阈值/cutoff"     | RDD                | rdd, regression discontinuity, discontinuity, cutoff, threshold, 断点, 阈值
R02      | 有 treatment_column + time_column 且 研究问题含 "DID/政策/试点"  | DID                | did, difference in differences, policy, pilot, before and after, treated, control group, 双重差分, 政策, 试点, 处理组, 对照组
R03      | instrument_variable 已填写 或 研究问题含 "IV/2SLS/工具变量/内生性" | IV-2SLS            | iv, 2sls, instrument, endogeneity, 工具变量, 内生性
R04      | 数据有个体列(entity_column) + 时间列(time_column)                | Panel Fixed Effects | 自动检测字段名含 city/province/region/firm 或年份列
R05      | 研究问题含 "probability/binary/logit/0/1/是否/概率/二分类"       | Logit               | probability, binary, default, choice, yes/no, logit, 0/1, 是否, 概率, 二分类
R06      | TRUE（默认兜底）                                                | OLS                 | 所有未匹配的情况
```

### 路由变量与模型选择器字段映射

| 文档中变量名 | model_selector.py 实际参数/来源 | 取值含义 |
|-------------|-------------------------------|----------|
| `data_type` | `data_profile.py` → panel_hint（个体列+时间列→面板；否则横截面） | `cross_section` / `panel` |
| `y_type` | `data_profile.py` → column_kind（数值/二元/分类） | `continuous` / `binary` / `categorical` |
| `research_q` | `ModelRequest.research_question`（用户输入文本） | 含关键词判定 |
| `has_treatment_group` | `ModelRequest.treatment_column` 是否非空 或 字段名含 treat/policy/pilot | `true` / `false` |
| `has_pre_post` | `ModelRequest.time_column` 是否非空 且 研究问题含政策评估关键词 | `true` / `false` |
| `has_rd_cutoff` | `ModelRequest.running_variable` 是否非空 或 研究问题含 RDD/cutoff 关键词 | `true` / `false` |
| `has_running_var` | `ModelRequest.running_variable` 是否非空 | `true` / `false` |
| `has_instrument_var` | `ModelRequest.instrument_variable` 是否非空 或 研究问题含 IV/工具变量 关键词 | `true` / `false` |

**多候选模型并行检查规则**：当路由规则表匹配到多个候选模型时（如面板数据同时满足DID和面板FE条件），Agent应并行检查所有候选模型的前提条件，在交互确认节点中列出所有通过前提检验的模型，由用户选择最终使用的模型。

### 严重级别定义

Agent在检验失败时，根据严重级别决定处理方式：

| 级别 | 标签 | 含义 | Agent行为 |
|------|------|------|----------|
| CRITICAL | ❌ 严重 | 模型核心假设被拒绝，估计量不一致 | 从候选集中移除该模型 |
| WARNING | ⚠️ 警告 | 假设可能违反，但存在修正方法 | 触发交互确认节点，等待用户决策 |
| INFO | ℹ️ 提示 | 边缘情形，建议关注但不阻止 | 输出提示信息，继续执行 |

---

## 目录

- [▶ 快速执行协议](#-快速执行协议agent专用--quick-execution-protocol)
- [一、框架总体设计](#一框架总体设计)
  - [1.1 框架定位与适用边界](#11-框架定位与适用边界)
  - [1.2 模型执行能力矩阵](#12-模型执行能力矩阵与-model_runnerpy-实际能力对齐)
  - [1.3 人机协作交互机制](#13-人机协作交互机制)
  - [1.4 理论基础与文献总览](#14-理论基础与文献总览)
  - [1.5 LLM增强机制](#15-llm增强机制与-maas_clientpy-实际实现对齐)
- [二、六种核心模型结构化指导](#二六种核心模型结构化指导)
  - [2.1 普通最小二乘法（OLS）](#21-普通最小二乘法ols)
  - [2.2 逻辑回归（Logit）](#22-逻辑回归logit)
  - [2.3 双重差分法（DID）](#23-双重差分法did)
  - [2.4 断点回归设计（RDD）](#24-断点回归设计rdd)
  - [2.5 工具变量两阶段最小二乘法（IV-2SLS）](#25-工具变量两阶段最小二乘法iv-2sls)
  - [2.6 面板数据模型](#26-面板数据模型)
- [三、动态决策树与交互确认节点](#三动态决策树与交互确认节点)
- [四、参考文献](#四参考文献)

---

## 一、框架总体设计

### 1.1 框架定位与适用边界

本框架面向 EconMetrics Agent 在以下情境下调用：用户已提供数据（Excel/CSV）、Agent已完成Step 1-2（需求理解与变量识别）以及Step 4（数据预处理）后，进入Step 3（模型自动判定引擎）以及Step 5-6（代码生成与模型检验）阶段时，需要系统、严谨地进行计量模型的选择决策与前提条件验证。

**[ACTION] 框架的核心职责**：

1. **模型筛选**：根据数据结构特征与研究问题类型，从六种核心模型中判定适用候选集
2. **前提验证**：对每种候选模型进行系统性假设检验，输出通过/不通过/需补充信息的判断
3. **交互触发**：在关键决策点（前提不满足、数据特征异常、备选模型竞争）触发用户确认
4. **代码调度**：根据模型选择结果，通过 code_generator.py 生成代码模板，支持 /run-model 真实执行或提供检查清单

**[ACTION] 框架不适用的情境**：

- 用户尚未明确研究问题（应先通过 /infer-variables 完成变量识别）
- 数据未完成字段画像（应先通过 /profile-data 完成数据体检，获取 columns/dtype/missing/unique 等信息）
- 模型类型超出六种核心模型范围（如门槛回归、合成控制法、分位数回归等扩展模型，当前版本小计不支持）
- 当前版本中 DID、RDD、IV-2SLS 在 model_runner.py 中不支持真实执行（仅提供代码模板），前提检验清单以"检查清单"形式提供给用户自主评估

### 1.2 模型执行能力矩阵（与 model_runner.py 实际能力对齐）

| 模型 | 推荐方式 | 执行方式 | model_runner.py 支持 | 底层库 |
|------|----------|----------|---------------------|--------|
| OLS | /recommend-model | /run-model 软件内真实运行 | ✅ 完整估计+系数表 | statsmodels OLS (cov_type='HC1') |
| Logit | /recommend-model | /run-model 软件内真实运行 | ✅ 含0/1校验，自动异常处理 | statsmodels Logit (MLE, disp=False) |
| Panel Fixed Effects | /recommend-model | /run-model 软件内真实运行 | ✅ 双向FE+个体聚类SE（需 entity_column + time_column） | linearmodels PanelOLS (entity_effects=True, time_effects=True, cov_type='clustered', cluster_entity=True) |
| DID | /recommend-model | 代码模板+检查清单 | ❌ 仅 generate_code() 提供 Python 模板 | 用户本地 statsmodels 运行 |
| RDD | /recommend-model | 代码模板+检查清单 | ❌ 仅 generate_code() 提供 Python 模板 | 用户本地 statsmodels 运行 |
| IV-2SLS | /recommend-model | 代码模板+检查清单 | ❌ 仅 generate_code() 提供 Python 模板 | 用户本地 linearmodels IV2SLS 运行 |

### 1.3 人机协作交互机制

本框架基于"人机协作决策"理念设计，Agent在以下三类关键节点触发交互确认：

**[TRIGGER] 第一类：前提条件不满足节点**

当模型的某一核心前提条件经检验被拒绝时，Agent不得静默忽略或自动降级。Agent应：

1. 明确告知用户哪个假设被拒绝、检验统计量及临界值、违反程度的定量描述
2. 提供2-4个备选处理方案（如更换稳健标准误、剔除异常变量、改用替代模型）
3. 给出各方案的优劣对比与推荐排序
4. 等待用户选择后继续执行

**[TRIGGER] 第二类：数据特征异常节点**

当数据特征处于模型适用边界的"灰色地带"时（如小样本<50、虚拟变量几乎无变异、高维控制变量、极端不平衡面板），Agent应输出预警信息，由用户确认是否继续使用当前模型。

**[TRIGGER] 第三类：多模型竞争节点**

当多种模型均满足前提条件时（如DID与面板FE均适用、OLS与IV均可使用），Agent应列出各方案的适用性论证，由用户确认最终选择。

**[OUTPUT] 交互确认节点的标准输出格式**：

```
═══════════════════════════════════════════
⚠️ 交互确认节点 [Cxx]：[节点名称]
═══════════════════════════════════════════

【问题描述】：[明确描述触发交互的原因]
【检验结果】：[相关检验统计量、p值、判断标准]
【影响评估】：[如果不处理，对结论的潜在影响]

【可选方案】：
  A. [方案A名称] — [优缺点简述] [推荐度：★★★]
  B. [方案B名称] — [优缺点简述] [推荐度：★★☆]
  C. [方案C名称] — [优缺点简述] [推荐度：★☆☆]

【推荐意见】：[给出明确的推荐方案及理由]

请选择处理方案（A/B/C）或输入"自行处理"以跳过。
═══════════════════════════════════════════
```

### 1.4 理论基础与文献总览

本框架的方法论基础主要来自以下核心文献体系：

**总论性著作**：
- Angrist, J. D., & Pischke, J.-S. (2009). *Mostly Harmless Econometrics: An Empiricist's Companion*. Princeton University Press.（以下简称 MHE）

**各模型核心文献**（详见各章节）：

| 模型 | 核心理论依据 | 关键方法论前沿 |
|------|-------------|---------------|
| OLS | Gauss-Markov定理；MHE CEF近似理论 | White (1980); MacKinnon & White (1985) HCSE; Cattaneo et al. (2019) 稳健推断 |
| Logit | 潜变量框架；极大似然估计 | Firth (1993) 惩罚似然；McFadden (1974) 伪R² |
| DID | MHE第5章；平行趋势假设 | Goodman-Bacon (2021); Callaway & Sant'Anna (2021); Sun & Abraham (2021); Roth (2024) |
| RDD | MHE第6章；连续性假设 | McCrary (2008); Imbens & Kalyanaraman (2012); Calonico, Cattaneo & Titiunik (2014) |
| IV-2SLS | MHE第4章；LATE框架 | Angrist & Krueger (2001); Stock & Yogo (2005) 弱IV检验 |
| 面板数据 | Hausman (1978); Mundlak (1978) CRE | Arellano (1987) 序列相关；聚类标准误层次选择 |

### 1.5 LLM增强机制（与 maas_client.py 实际实现对齐）

小计支持通过华为MaaS API增强模型推荐的推荐理由质量。`model_selector.py` 返回的规则推荐结果（model + reason + required_checks + generated_code）会作为 fallback 传入 `maas_client.py` 的 `get_maas_recommendation()` 函数，LLM可优化推荐理由和补充说明。**LLM不可用时自动回退规则引擎结果（MaasUnavailable 异常捕获），所有本地功能保持可用。**

**LLM增强范围**：
- 模型推荐：LLM可优化 recommended_model.reason 和 maas_note，但 model 字段若不在 SUPPORTED_MODELS 中则回退为规则结果
- 变量识别：LLM可辅助推断变量角色，字段名仍需存在于数据列中
- 智能问答：/chat 端点基于当前数据上下文（字段列表、数据摘要、变量配置、推荐模型、运行结果）回答追问

**降级策略**（`_get_config()` 函数逻辑）：
1. 若 LLM请求中 `enabled=false` → MaasUnavailable → 回退规则引擎
2. 若未配置 API Key → MaasUnavailable → 回退规则引擎
3. 若 HTTP/网络/超时/JSON解析错误 → MaasUnavailable → 回退规则引擎
4. 降级时 provider 字段为 "rules"，maas_used 字段为 false，前端可据此显示对应的提示文案

---

## 二、六种核心模型结构化指导

### 2.1 普通最小二乘法（OLS）

#### 2.1.1 理论框架

OLS是计量经济学最基础的估计方法。在 Angrist & Pischke (2009, MHE) 的框架中，OLS的核心正当性并非来自Gauss-Markov定理，而是来自**回归-CEF定理**：无论真实的CEF是否线性，OLS总是给出CEF的最小均方误差线性近似。这一视角使得OLS在弱假设下即具备描述性价值，但在引申因果结论时需满足更强的识别条件。

**Classic Gauss-Markov假设**（Wooldridge表述）：

| 假设 | 内容 | 违反后果 |
|------|------|----------|
| MLR.1 线性性 | $y = X\beta + \varepsilon$，参数线性 | 模型误设，估计有偏 |
| MLR.2 随机抽样 | 观测独立同分布(i.i.d.) | 标准误估计偏误 |
| MLR.3 无完全共线性 | X列满秩，无变量是其他变量的精确线性组合 | 矩阵不可逆，无法估计 |
| MLR.4 严格外生性 | $E(\varepsilon|X)=0$ | 遗漏变量偏误，估计不一致 |
| MLR.5 球形误差 | $Var(\varepsilon|X)=\sigma^2 I$（同方差+无自相关） | OLS不再BLUE |

**Angrist & Pischke的因果识别视角**：
要赋予OLS估计系数以因果解释，核心条件是**条件独立假设（CIA）**：在控制了协变量X后，处理变量与潜在结果独立。CIA比MLR.4更严格但更具操作性。

#### 2.1.2 适用条件与前提假设检验

**[CHECK] 检验清单**：

| 检验ID | 检验项目 | 检验方法 | 判断标准 | 严重级别 | 实现参考 |
|--------|----------|----------|----------|----------|----------|
| OLS-T1 | 多重共线性 | 方差膨胀因子（VIF） | [THRESHOLD] 任一变量VIF > 10 → FAIL（严重共线性）；VIF > 5 → WARN | CRITICAL if VIF>10 | `statsmodels.stats.outliers_influence.variance_inflation_factor` |
| OLS-T2 | 异方差 | Breusch-Pagan检验 / White检验 | [THRESHOLD] BP检验p < 0.05 或 White检验p < 0.05 → WARN（拒绝同方差） | WARNING | `sm.stats.diagnostic.het_breuschpagan` |
| OLS-T3 | 残差正态性（大样本可选） | Jarque-Bera检验 | [THRESHOLD] p < 0.05 且 n < 100 → WARN；n ≥ 100 → INFO | WARNING if n<100 | `scipy.stats.jarque_bera` |
| OLS-T4 | 模型设定（遗漏变量/函数形式） | Ramsey RESET检验 | [THRESHOLD] p < 0.01 → CRITICAL；0.01 ≤ p < 0.05 → WARN | CRITICAL if p<0.01 | `sm.stats.diagnostic.linear_reset` |
| OLS-T5 | 自相关（时间序列/面板） | Durbin-Watson检验 / Breusch-Godfrey检验 | [THRESHOLD] BG检验p < 0.05 → WARN | WARNING | `sm.stats.durbin_watson` |

**[ACTION] 检验执行顺序**：OLS-T1（共线性）→ OLS-T2（异方差）→ OLS-T5（自相关，如适用）→ OLS-T4（设定检验）→ OLS-T3（正态性）

**理论注记**：White (1980) 提出了异方差一致协方差矩阵估计量（HCCME），MacKinnon & White (1985) 进一步比较了HC0至HC3四种变体，推荐使用HC3（jackknife）估计量，因其在小样本下的表现最优。Cattaneo et al. (2019) 将稳健推断推广至高维设定。

#### 2.1.3 不适用场景与预警提示

**[DECISION] 强制拒绝建模的情况**：
- VIF > 10的变量超过2个且样本量n < 100 → ❌ 拒绝OLS，建议使用正则化方法（Ridge/Lasso）
- RESET检验p < 0.01 → ❌ 强烈警告模型设定错误，触发 [TRIGGER:C02]

**[TRIGGER] 触发交互确认节点C02的情况**：
- Breusch-Pagan检验显著拒绝同方差 → Agent应建议使用HC3稳健标准误，由用户确认
- Jarque-Bera拒绝正态性但n < 50 → Agent应提示小样本下正态性假设重要，建议考虑bootstrap推断
- 某些控制变量VIF在5-10之间 → Agent应列出高VIF变量，询问用户是否剔除或保留

#### 2.1.4 变量要求

| 变量类型 | 数据类型要求 | 设定规范 |
|----------|-------------|----------|
| 因变量Y | 连续型（数值型） | 需检查偏度，偏度>2建议取对数或IHS转换 |
| 核心自变量X | 连续型或虚拟变量(0/1) | 连续变量需中心化处理（减去均值）以增强截距项可解释性 |
| 控制变量 | 数值型 | 虚拟变量需确保非完全共线（避免虚拟变量陷阱） |
| 交互项（如有） | 两个变量的乘积 | 成分变量需先分别纳入模型；连续变量交互前需中心化 |

**[THRESHOLD] 变量数量约束**：$n$（样本量）应至少满足 $n \geq 10 \times k$（k为自变量个数），低于此阈值时Agent应输出"小样本预警"。

#### 2.1.5 代码模板（与 code_generator.py 实际输出对齐）

当Agent完成OLS前提条件检验且通过后，`code_generator.py` 按以下模板生成代码。**Agent必须将 `<<PLACEHOLDER>>` 替换为实际值。** 当前版本 OLS 支持在 `/run-model` 端点通过 `model_runner.py` 真实执行。

```
[CODE-TEMPLATE: OLS]（来源：code_generator.py generate_code("OLS", request)）
═══════════════════════════════════════════

import pandas as pd
import statsmodels.api as sm

df = pd.read_csv("data.csv")
y = df['<<Y_VAR>>']
X = df[<<X_LIST>>]
X = sm.add_constant(X)

result = sm.OLS(y, X).fit(cov_type='HC1')
print(result.summary())

═══════════════════════════════════════════
```

**[ACTION] model_runner.py 实际执行逻辑**（`_run_ols()` 函数）：

1. 调用 `_prepare_model_frame()` 完成：列存在性校验 → 强制转为数值型（errors='coerce'）→ 剔除 inf/NaN 行 → 样本量检查（≥3行且 > 变量数）
2. 使用 `sm.OLS(y, X).fit(cov_type='HC1')` 进行估计（HC1异方差稳健标准误）
3. 通过 `_extract_results()` 提取：样本量、R²、调整R²、F统计量、F-p值、各系数+标准误+t值+p值+置信区间
4. 返回 `RunModelResponse`（含 success/error/warnings/results）

### 2.2 逻辑回归（Logit）

#### 2.2.1 理论框架

二元选择模型（Binary Response Models）处理因变量为二值变量的情境。其理论基础建立在**潜变量模型**（Latent Variable Model）之上：

$$y_i^* = X_i\beta + \varepsilon_i$$

$$y_i = \mathbb{1}\{y_i^* > 0\}$$

其中$y_i^*$为不可观测的潜变量（如"就医倾向"、"违约倾向"），观测变量$y_i \in \{0,1\}$。

当$\varepsilon_i$服从标准Logistic分布时，得到Logit模型：
$$P(y_i=1|X_i) = \frac{\exp(X_i\beta)}{1+\exp(X_i\beta)} = \Lambda(X_i\beta)$$

当$\varepsilon_i$服从标准正态分布时，得到Probit模型：
$$P(y_i=1|X_i) = \Phi(X_i\beta)$$

**Logit与Probit的比较**：两类模型在实际应用中结果通常高度一致（系数约差1.6倍，即$\beta_{Logit} \approx 1.6 \times \beta_{Probit}$）。Logit的优势在于系数可解释为对数优势比（log odds ratio），且尾部更厚，在极端概率事件中更稳健。除非有特殊理论要求（如选择模型的IIA假设），一般推荐Logit作为默认二元选择模型。

**核心方法论文献**：Firth (1993) 提出基于Jeffreys先验的惩罚极大似然估计，解决了稀有事件和完全分离问题下的有限样本偏误。McFadden (1974) 提出伪R²作为模型拟合的度量指标，其取值范围在0到1之间，0.2-0.4即表示较好的拟合。

#### 2.2.2 适用条件与前提假设检验

**[CHECK] 检验清单**：

| 检验ID | 检验项目 | 检验方法 | 判断标准 | 严重级别 |
|--------|----------|----------|----------|----------|
| LOGIT-T1 | 因变量类型 | 数据验证 | [THRESHOLD] Y必须为0/1二值 → 否则 CRITICAL | CRITICAL |
| LOGIT-T2 | 完全分离/准完全分离 | 检查自变量是否完美预测Y | [THRESHOLD] 若存在完全分离 → CRITICAL（标准MLE不收敛），应使用Firth惩罚似然 | CRITICAL |
| LOGIT-T3 | 多重共线性 | VIF（在等价线性模型中计算） | [THRESHOLD] VIF > 10 → CRITICAL | CRITICAL |
| LOGIT-T4 | 稀有事件问题 | 事件比例检查 | [THRESHOLD] 事件比例 < 5% 或 事件数 < 样本量/10 → WARN | WARNING |
| LOGIT-T5 | 样本量充足性 | 每个自变量对应事件数 | [THRESHOLD] 每个自变量至少对应10-20个事件 → 不满足则 WARN | WARNING |
| LOGIT-T6 | 模型拟合优度 | Hosmer-Lemeshow检验 | [THRESHOLD] p < 0.05 → WARN（模型可能存在设定偏误） | WARNING |
| LOGIT-T7 | 模型整体显著性 | 似然比检验（LR test） | [THRESHOLD] p < 0.05 → 模型整体显著 | INFO |

**理论注记——平均边际效应（AME）vs 优势比**：
- Logit模型的原始系数$\beta$解释为对数优势比（log odds），不易直观理解
- **推荐优先报告AME（Average Marginal Effect）**：$\frac{\partial P(y_i=1)}{\partial x_{ij}}$，每个观测值取均值。AME与OLS系数具有同尺度可比性
- 优势比（OR = $\exp(\beta)$）在医学和公卫领域常用，但应注意OR并非风险比（RR），当事件发生率>10%时会高估效应

**Firth惩罚似然的适用信号**：
- 事件数 < 20 或 非事件数 < 20
- 某个自变量完全预测结果（如"退休"变量完美预测"就医行为"）
- 标准Logit的MLE估计标准误极大（>5）

#### 2.2.3 不适用场景与预警提示

**[DECISION] 强制拒绝建模的情况**：
- 因变量非二值 → ❌ 若Y为多分类变量，建议改用多项Logit/Probit或有序Logit/Probit
- 事件数为0或事件数=样本量 → ❌ Y没有变异，无法建模
- 完全分离且样本量极小（n<30）→ ❌ 建议使用精确逻辑回归（Exact Logistic Regression）

**[TRIGGER] 触发交互确认节点C03的情况**：
- 事件比例 < 5% → Agent提示稀有事件偏误，推荐Firth惩罚似然，由用户选择
- Hosmer-Lemeshow检验p < 0.05 → Agent提示模型拟合不佳，建议检查遗漏变量或非线性关系
- Logit与Probit的AIC差异 > 4 → Agent提示两个模型结论可能存在差异，由用户选择报告哪个

#### 2.2.4 变量要求

| 变量类型 | 数据类型要求 | 设定规范 |
|----------|-------------|----------|
| 因变量Y | 严格二值0/1 | Agent应检查Y值域，若发现非0/1值自动报错 |
| 核心自变量X | 连续型或虚拟变量 | 连续变量建议标准化（减去均值除以标准差）以利收敛和AME计算 |
| 控制变量 | 数值型 | 虚拟变量编码为0/1；多分类变量需生成k-1个虚拟变量 |
| 特殊要求 | — | **无完美预测变量**：任何自变量不能是Y的确定性函数 |

#### 2.2.5 代码模板（与 code_generator.py 实际输出对齐）

```
[CODE-TEMPLATE: Logit]（来源：code_generator.py generate_code("Logit", request)）
═══════════════════════════════════════════

import pandas as pd
import statsmodels.api as sm

df = pd.read_csv("data.csv")
y = df['<<Y_VAR>>']
X = df[<<X_LIST>>]
X = sm.add_constant(X)

result = sm.Logit(y, X).fit()
print(result.summary())

═══════════════════════════════════════════
```

**[ACTION] model_runner.py 实际执行逻辑**（`_run_logit()` 函数）：

1. 同OLS的数据清洗流程
2. **额外校验**：`y_values.issubset({0, 1})` — 因变量必须严格为0/1，否则抛出 ValueError
3. 使用 `sm.Logit(y, X).fit(disp=False)` 进行极大似然估计
4. 返回与OLS相同结构的 `RunModelResponse`（含 log_likelihood 字段）

### 2.3 双重差分法（DID）

#### 2.3.1 理论框架

DID是政策评估中最广泛使用的因果推断方法之一。其核心识别假设是**平行趋势假设**（Parallel Trends Assumption）：在没有政策干预的情况下，处理组与对照组的结局变量应随时间以相同的趋势变化（Angrist & Pischke, 2009, MHE 第5章）。

**标准2×2 DID模型**：
$$Y_{it} = \alpha + \beta \cdot Treat_i + \gamma \cdot Post_t + \delta \cdot (Treat_i \times Post_t) + \varepsilon_{it}$$

其中$\delta$即为DID估计量——处理效应的无偏估计。

**面板双向固定效应DID**：
$$Y_{it} = \alpha_i + \lambda_t + \delta \cdot DID_{it} + X_{it}\beta + \varepsilon_{it}$$

其中$\alpha_i$为个体固定效应（吸收Treat_i），$\lambda_t$为时间固定效应（吸收Post_t），$DID_{it} = Treat_i \times Post_t$。

**交错DID（Staggered DID）的前沿方法**：

近年来，交错DID（不同单位在不同时间接受处理）的TWFE估计量被发现存在严重的"负权重"问题。Goodman-Bacon (2021) 证明，TWFE估计量可分解为三种2×2比较的加权平均，其中"已处理组作对照组"的比较会赋予负权重，导致当处理效应异质时TWFE估计量可能严重偏误。

为此，学界提出了多种新估计量：

| 方法 | 论文 | 核心思想 |
|------|------|----------|
| Callaway & Sant'Anna (CS) | Callaway & Sant'Anna (2021, JoE) | 估计组别-时间ATT $ATT(g,t)$，以从未处理组或尚未处理组为对照组，避免负权重 |
| Sun & Abraham (SA) | Sun & Abraham (2021, JoE) | 交互加权（IW）估计量，仅使用新处理组vs从未处理组的比较，消除跨队列污染 |
| de Chaisemartin & d'Haultfoeuille | dCdH (2020, AER) | 估计瞬时处理效应的DID_M估计量，适用于处理开关的情境 |
| Borusyak, Jaravel & Spiess | BJS (2024, Econometrica) | 插补法（Imputation Estimator），基于从未处理组的反事实预测 |

**平行趋势前检验的陷阱**：Roth (2024, AER: Insights) 指出，常规的事件研究前检验存在两大问题：(1) 筛选效应——通过前检验的估计量条件偏误反而更大；(2) 前检验的统计功效通常很低，无法有效检测经济上有意义的平行趋势违背。Roth建议报告经过前检验校正的置信区间，并辅以HonestDiD灵敏度分析（Rambachan & Roth, 2023, AER）。

#### 2.3.2 适用条件与前提假设检验

**[CHECK] DID核心前提条件五大检查项**：

| 检验ID | 检验项目 | 检验方法 | 判断标准 | 严重级别 | 实现参考 |
|--------|----------|----------|----------|----------|----------|
| DID-T1 | 处理组变量合法性 | 数据验证 | [THRESHOLD] Treat必须为0/1二值 → 否则 CRITICAL | CRITICAL | — |
| DID-T2 | 政策时点合法性 | 数据验证 | [THRESHOLD] 存在政策前时期（T < T_policy）的观测 → 否则 WARN | WARNING | — |
| DID-T3 | 处理组与对照组重叠 | 数据验证 | [THRESHOLD] 两组在政策前有共同的观测时期 → 否则 CRITICAL | CRITICAL | — |
| DID-T4 | 平行趋势检验（事件研究法） | 估计动态DID | [THRESHOLD] 政策前所有β_k联合不显著（F检验p > 0.10）→ PASS；p < 0.05 → CRITICAL；0.05 ≤ p < 0.10 → WARN | CRITICAL if p<0.05 | `sp.event_study()` → `sp.enhanced_event_study_plot()` |
| DID-T5 | 安慰剂检验 | 伪处理时点/随机分配处理组 | [THRESHOLD] 伪时点的DID系数不显著 → PASS | INFO | `sp.rdplacebo()` |

**[CHECK] DID-T4 平行趋势检验的详细流程**（Agent必须执行的步骤）：

```
[CHECK:DID-T4-STEP-1] 构建事件研究数据集
  ├── 定义相对时间变量：rel_time = t - T_policy（每单位政策发生时间可能不同）
  ├── 生成滞后/领先虚拟变量：D^k_it = 1{Treat_i × rel_time_it = k}
  └── 需包含政策前至少2期、政策后至少1期

[CHECK:DID-T4-STEP-2] 事件研究回归
  ├── 使用sp.event_study(data, y, treat, time, ref_period=-1)
  ├── 基准期一般为政策前1期（k=-1）
  └── 聚类标准误在个体层面

[CHECK:DID-T4-STEP-3] 平行趋势判断
  ├── 联合检验：H0: β_{-K} = β_{-(K-1)} = ... = β_{-2} = 0
  ├── [DECISION] 若F检验p < 0.05 → ❌ 平行趋势假设被拒绝 → [TRIGGER:C04-A]
  ├── [DECISION] 若F检验p < 0.10 → ⚠️ 边缘情形 → [TRIGGER:C04-A]
  └── [DECISION] 若F检验p ≥ 0.10 → ✅ 平行趋势假设通过

[CHECK:DID-T4-STEP-4] 前检验功效评估（推荐，基于Roth, 2024）
  ├── 计算：在前检验能检测到的最小趋势违背效应量
  └── 若检测能力（power）不足 → 提示用户平行趋势前检验功效较低
```

**[CHECK] 交错DID的额外检验（当处理时点不唯一时）**：

| 检验ID | 检验项目 | 检验方法 | 判断标准 | 严重级别 |
|--------|----------|----------|----------|----------|
| DID-T6 | Goodman-Bacon分解 | 运行Bacon分解，检查三类比较的权重 | [THRESHOLD] "已处理vs已处理"比较的权重之和不应过大（建议<20%）→ 超过则 WARN | WARNING |
| DID-T7 | CS vs SA稳健性 | 并行估计CS和SA两种方法 | [THRESHOLD] 两种方法的核心结论应一致（符号相同、显著性一致）→ 否则 WARN | WARNING |
| DID-T8 | HonestDiD灵敏度 | Rambachan & Roth (2023)平滑限制方法 | 报告在不同M值下的置信区间 | INFO |

#### 2.3.3 不适用场景与预警提示

**[DECISION] 强制拒绝建模的情况**：
- 无政策前数据（所有时期均为政策后）→ ❌ 无法检验平行趋势假设，拒绝DID模型。Agent应输出替代方案建议
- 处理组或对照组在政策前某一时期观测数为0 → ❌ 无法估计事件研究系数
- 个体仅有一期观测 → ❌ 面板DID不可行

**[TRIGGER] 触发交互确认节点C04的情况**：

- **[TRIGGER:C04-A] 平行趋势前检验未通过** → Agent输出：
  ```
  ⚠️ 平行趋势假设检验未通过
  ─────────────────────────────
  政策前各期β系数联合F检验p=<<PVAL>>，拒绝平行趋势原假设。
  以下各期出现显著偏离：<<FAILED_PERIODS>>

  可选方案：
  A. 放弃DID，改用合成控制法或PSM（推荐 ★★★）
  B. 在回归中控制组别特定线性时间趋势（需谨慎，可能吸收处理效应）（★★☆）
  C. 使用HonestDiD方法进行灵敏度分析并报告（★☆☆）
  ```

- **[TRIGGER:C04-B] Goodman-Bacon分解发现大量"坏比较"** → Agent输出：
  ```
  ⚠️ TWFE估计量存在大量负权重
  ─────────────────────────────
  Bacon分解显示，"已处理vs已处理"比较占总权重的<<BAD_WEIGHT_PCT>>%，
  超过推荐阈值20%，TWFE估计量可能严重偏误。

  建议方案：改用Callaway & Sant'Anna (2021)估计量，以从未处理组作为对照组。
  ```

- **[TRIGGER:C04-C] 面板vs横截面DID选择** → 当数据仅有横截面时（政策前后各一期不同样本），Agent应确认用户是否接受假设更强的横截面DID

#### 2.3.4 变量要求

| 变量类型 | 数据类型要求 | 设定规范 |
|----------|-------------|----------|
| 因变量Y | 连续型（数值型） | 对数化需谨慎：Roth & Sant'Anna (2023)证明平行趋势在水平vs对数下不一定同时成立 |
| 处理组标识D | 严格0/1虚拟变量 | 1=处理组，0=对照组；多组处理应创建多个虚拟变量 |
| 时间变量T | 整数型或日期型 | 需包含政策前与政策后时期 |
| 政策时点（Policy Year）| 整数或日期 | 交错DID中每个体可能有不同政策时点 |
| 个体ID | 字符串或整数 | 面板数据必需 |
| 控制变量 | 数值型 | **关键约束**：控制变量应为政策前特征或时不变变量，避免"坏控制"问题（Angrist & Pischke, 2009, MHE 第3章） |

**特殊变量类型处理**：
- 多期DID：需创建 `first_treat` 变量，记录每个个体的首次处理时间（从未处理组设为0或极大值）
- 处理强度DID：替代Treat×Post交互项，使用连续型处理强度变量 × Post
- 事件研究交互项：需为每期创建Treat × 时期虚拟变量的交互项

#### 2.3.5 代码模板（与 code_generator.py 实际输出对齐）

**注意**：当前版本小计中 DID 不支持 `/run-model` 真实执行。`code_generator.py` 提供代码模板，`model_runner.py` 的 `SUPPORTED_RUN_MODELS` 中不含 DID。用户需将生成的代码复制到本地 Python 环境运行。

```
[CODE-TEMPLATE: DID]（来源：code_generator.py generate_code("DID", request)）
═══════════════════════════════════════════

import pandas as pd
import statsmodels.formula.api as smf

df = pd.read_csv("data.csv")
df["did"] = df['<<TREATMENT_VAR>>'] * df['<<TIME_VAR>>']

formula = "<<Y_VAR>> ~ <<TREATMENT_VAR>> + <<TIME_VAR>> + did"
result = smf.ols(formula, data=df).fit(cov_type='HC1')
print(result.summary())

═══════════════════════════════════════════
```

---

### 2.4 断点回归设计（RDD）

#### 2.4.1 理论框架

RDD利用政策或制度规则产生的断点，识别处理变量在断点附近对结果变量的局部因果效应。Angrist & Pischke (2009, MHE 第6章) 将RDD誉为"最接近随机实验的准实验设计"。其核心识别假设是**连续性假设**：除处理变量在断点处发生跳跃外，所有其他决定结果的因素在断点处连续变化。

**精确RDD（Sharp RDD）**：处理概率在断点处从0跳至1。
$$Y_i = \alpha + \tau \cdot D_i + f(X_i - c) + \varepsilon_i$$
$$D_i = \mathbb{1}\{X_i \geq c\}$$

其中$\tau$为局部平均处理效应（LATE），$f(\cdot)$为运行变量的平滑函数（通常为局部线性或局部二次多项式）。

**模糊RDD（Fuzzy RDD）**：处理概率在断点处发生跳跃但非从0到1。此时$\tau$通过两阶段估计：
$$\tau_{Fuzzy} = \frac{\lim_{x \downarrow c} E[Y|X=x] - \lim_{x \uparrow c} E[Y|X=x]}{\lim_{x \downarrow c} E[D|X=x] - \lim_{x \uparrow c} E[D|X=x]}$$

**核心方法论演进**：
- McCrary (2008) 提出密度检验，检验运行变量在断点处是否被操纵（若个体能精确操控运行变量以越过分界线，则连续性假设被破坏）
- Imbens & Kalyanaraman (2012) 推导了RDD在MSE准则下的渐近最优带宽，成为带宽选择的基准方法
- Calonico, Cattaneo & Titiunik (2014, Econometrica) 提出了偏误校正的RDD估计量和稳健置信区间，解决了传统方法在MSE最优带宽下置信区间覆盖率不足的问题，其`rdrobust`软件包已成为RDD分析的行业标准
- Cattaneo, Idrobo & Titiunik (2020, 2024) 编写了实用的RDD操作指南（Cambridge Elements系列），系统梳理了RDD的最佳实践

#### 2.4.2 适用条件与前提假设检验

**[CHECK] RDD六大前提条件检验**：

| 检验ID | 检验项目 | 检验方法 | 判断标准 | 严重级别 | 实现参考 |
|--------|----------|----------|----------|----------|----------|
| RDD-T1 | 运行变量连续性（McCrary检验） | McCrary (2008) 密度检验 | [THRESHOLD] p ≥ 0.10 → PASS；0.05 ≤ p < 0.10 → WARN；p < 0.05 → CRITICAL | CRITICAL if p<0.05 | `rdrobust`包的密度检验 |
| RDD-T2 | 前定协变量连续性 | 对每个控制变量在断点处运行RDD | [THRESHOLD] 所有协变量的RDD系数应不显著（p ≥ 0.05）→ 否则 WARN | WARNING | 安慰剂RDD检验 |
| RDD-T3 | 断点附近观测数充足 | 计算c±h范围内的样本量 | [THRESHOLD] n ≥ 30 → PASS；n < 30 → WARN | WARNING | — |
| RDD-T4 | 断点外推无效 | 限制分析样本在断点附近 | [THRESHOLD] 默认带宽不超过 0.5 × SD(X) → 否则 WARN | WARNING | — |
| RDD-T5 | 最优带宽选择 | IK带宽 + CCT带宽 | 双报告两种带宽下的结果，核心结论应一致 | INFO | `rdrobust`自动选择 |
| RDD-T6 | 带宽敏感性 | 在[0.5h, 1.5h]范围内变换带宽 | [THRESHOLD] LATE的符号和显著性应保持稳定 → 否则 WARN | WARNING | 带宽敏感性图 |

**[CHECK] McCrary密度检验的详细处理逻辑**：

```
[CHECK:RDD-T1-STEP-1] 执行McCrary密度检验
  ├── H0: 运行变量X在断点c处的密度函数连续
  ├── 检验统计量基于断点两侧的密度估计差值
  └── 使用sp.rdplot() 可视化密度分布

[CHECK:RDD-T1-STEP-2] 判断结果
  ├── [DECISION] p ≥ 0.10 → ✅ 无法拒绝连续性假设，通过
  ├── [DECISION] 0.05 ≤ p < 0.10 → ⚠️ 边缘显著 → [TRIGGER:C05-A]
  └── [DECISION] p < 0.05 → ❌ 拒绝连续性假设，存在操纵嫌疑

[CHECK:RDD-T1-STEP-3] 若McCrary检验未通过，Agent应：
  ├── 自动探索"甜甜圈RDD"：剔除断点附近[c-ε, c+ε]观测后重新检验
  ├── 若剔除后通过 → 建议使用甜甜圈RDD
  └── 若剔除后仍不通过 → 拒绝RDD模型 → [TRIGGER:C05-A]
```

#### 2.4.3 不适用场景与预警提示

**[DECISION] 强制拒绝建模的情况**：
- 断点不是精确可知的 → ❌ RDD要求断点由外部规则精确确定
- 断点附近观测数为0（没有任何个体落在断点任一侧）→ ❌ 无法识别
- McCrary检验p < 0.01且甜甜圈RDD仍不通过 → ❌ 严重操纵，拒绝RDD

**[TRIGGER] 触发交互确认节点C05的情况**：

- **[TRIGGER:C05-A] McCrary检验未通过** → Agent应如2.4.2节所述，探索甜甜圈RDD并询问用户

- **[TRIGGER:C05-B] 精确RDD vs 模糊RDD选择** → 当第一阶段处理概率跳跃非1时，Agent应说明精确RDD与模糊RDD的区别，由用户选择

- **[TRIGGER:C05-C] 带宽选择不确定** → 当IK带宽与CCT带宽的推荐值差异过大（>2倍），Agent应输出两种带宽下的估计结果对比，由用户选择

#### 2.4.4 变量要求

| 变量类型 | 数据类型要求 | 设定规范 |
|----------|-------------|----------|
| 因变量Y | 连续型（数值型） | RDD也可处理二值Y，但需注意解释为局部处理效应 |
| 运行变量X（Running/Forcing Variable）| 连续型 | **必须是连续的**，不能是离散的（除非值足够多，如年龄）；需包含断点两侧的变异 |
| 处理变量D（仅模糊RDD）| 0/1虚拟变量 | 精确RDD中D = 1{X ≥ c}自动生成 |
| 断点c | 单一数值 | 需由外部制度规则明确定义（如年龄阈值、分数线等） |
| 控制变量 | 数值型 | **不能是事后变量**（政策后的结果变量）；用于检验协变量连续性而非提高精度 |

**非标准RDD情形的处理**：
- 离散运行变量（如仅有整数年份）→ Agent应评估离散值数量，若≥10个不同值则可勉强使用，否则触发交互确认
- 多维RDD（多个运行变量或多个断点）→ 超出本框架范围，Agent应建议使用专门的边界RDD方法

#### 2.4.5 代码模板（与 code_generator.py 实际输出对齐）

```
[CODE-TEMPLATE: RDD]（来源：code_generator.py generate_code("RDD", request)）
═══════════════════════════════════════════

import pandas as pd
import statsmodels.formula.api as smf

df = pd.read_csv("data.csv")
df["above_cutoff"] = (df['<<RUNNING_VAR>>'] >= <<CUTOFF_VALUE>>).astype(int)
df["running_centered"] = df['<<RUNNING_VAR>>'] - <<CUTOFF_VALUE>>

formula = "<<Y_VAR>> ~ above_cutoff + running_centered + above_cutoff:running_centered"
result = smf.ols(formula, data=df).fit(cov_type='HC1')
print(result.summary())

═══════════════════════════════════════════
```

---

### 2.5 工具变量两阶段最小二乘法（IV-2SLS）

#### 2.5.1 理论框架

工具变量法是处理内生性问题（遗漏变量偏误、测量误差、反向因果）的核心方法。Angrist & Pischke (2009, MHE 第4章) 以Angrist & Krueger (1991) 的义务教育法工具变量为范例，系统建立了IV估计的识别框架。IV方法的核心思想是：寻找一个与内生解释变量相关但与误差项不相关的外生变量（工具变量），利用工具变量的外生变异来一致估计因果效应。

**两阶段最小二乘法（2SLS）**：
- 第一阶段：$X_i = \pi_0 + \pi_1 Z_i + \gamma' W_i + \nu_i$
- 第二阶段：$Y_i = \beta_0 + \beta_1 \hat{X}_i + \delta' W_i + \varepsilon_i$

其中$Z$为工具变量，$W$为外生控制变量。

**IV有效性的三个条件**（MHE 第4.1节）：

| 条件 | 定义 | 可检验性 |
|------|------|----------|
| **相关性**（Relevance） | $Cov(Z, X) \neq 0$，即工具变量与内生变量相关 | ✅ 可检验（第一阶段F统计量） |
| **排他性**（Exclusion） | $Cov(Z, \varepsilon) = 0$，工具变量仅通过内生变量影响结果 | ❌ 不可直接检验（需理论论证） |
| **单调性**（Monotonicity） | 工具变量对所有个体的内生变量影响方向一致 | ❌ 不可直接检验（需理论论证） |

**LATE vs ATE**：Angrist, Imbens & Rubin (1996) 证明，当处理效应异质时，IV估计的是**局部平均处理效应（LATE）**——仅反映那些因工具变量而改变处理状态的个体（compliers）的平均效应，而非全部人口的平均处理效应（ATE）。

**弱工具变量问题**：Stock & Yogo (2005) 系统研究了弱工具变量问题，提出基于第一阶段F统计量的检验。经验法则：第一阶段F统计量 > 10可基本排除严重弱IV问题。更精确地，需参考Stock-Yogo临界值表：在5%显著性水平下，当有1个内生变量时，Cragg-Donald Wald F统计量需大于16.38（基于最大10%的相对偏误容忍度）。

**过度识别检验**：当工具变量个数超过内生变量个数时（过度识别情形），可进行过度识别约束检验。Sargan (1958) 和Hansen (1982) J检验的原假设为：所有工具变量均外生。若检验显著拒绝原假设（p < 0.05），则至少有一个工具变量不满足排他性约束。

#### 2.5.2 适用条件与前提假设检验

**[CHECK] IV-2SLS七大前提条件检验**：

| 检验ID | 检验项目 | 检验方法 | 判断标准 | 严重级别 |
|--------|----------|----------|----------|----------|
| IV-T1 | 内生性诊断 | Hausman内生性检验 / Durbin-Wu-Hausman检验 | [THRESHOLD] p < 0.05 → 存在内生性，IV必要；p ≥ 0.05 → OLS可能已足够 → [TRIGGER:C06-A] | INFO |
| IV-T2 | 第一阶段相关性（弱IV检验） | 第一阶段F统计量 + Stock-Yogo临界值 | [THRESHOLD] F > 10（单内生变量经验法则）或 F > Stock-Yogo临界值 → PASS；F < 10 → CRITICAL | CRITICAL if F<10 |
| IV-T3 | 恰好识别 vs 过度识别 | 工具变量个数（k）vs 内生变量个数（m） | k = m → 恰好识别；k > m → 过度识别，需IV-T4检验 | INFO |
| IV-T4 | 过度识别检验（仅k > m时） | Sargan检验 / Hansen J检验 | [THRESHOLD] p ≥ 0.05 → PASS；p < 0.01 → CRITICAL；0.01 ≤ p < 0.05 → WARN → [TRIGGER:C06-B] | CRITICAL if p<0.01 |
| IV-T5 | 排他性论证 | 无法统计检验，需理论论证 | Agent应提示用户提供工具变量的排他性理论依据 | INFO |
| IV-T6 | 第一阶段可视化 | 散点图展示Z与X的关系 | 视觉检查是否存在异常值驱动的相关性 | WARNING |
| IV-T7 | 简化式（Reduced Form） | Y对Z的回归 | [THRESHOLD] 若Y与Z不显著相关 → WARN（即使第一阶段通过，因果效应可能很弱） | WARNING |

**排他性约束的间接论证方法**（Agent应提示用户考虑）：
- 证伪检验（Falsification Test）：检验Z是否影响已知不应受X影响的子群体的Y
- 零效应子群体检验：若存在理论上X不影响Y的子群体，检验Z→Y在该子群体中是否显著
- 安慰剂结果变量：选择一个理论上不应受X影响的结果变量，检验Z→该变量的效应

#### 2.5.3 不适用场景与预警提示

**[DECISION] 强制拒绝建模的情况**：
- 第一阶段F统计量 < 10（单内生变量）→ ❌ 弱工具变量，拒绝IV-2SLS。Agent应输出替代方案建议
- 过度识别检验p < 0.01 → ❌ 至少一个工具变量严重违反复排他性假设
- 工具变量个数 = 0 → ❌ 无可用工具变量，无法运行IV

**[TRIGGER] 触发交互确认节点C06的情况**：

- **[TRIGGER:C06-A] Hausman检验未拒绝外生性** → p ≥ 0.05时，Agent应输出：OLS与IV估计无显著差异，可能意味着OLS已一致或IV工具变量不足。建议：A. 报告OLS结果作为主结果，IV作为稳健性检验；B. 若理论强烈支持内生性，仍使用IV但注明Hausman检验结果
- **[TRIGGER:C06-B] 过度识别检验p在0.01-0.05之间** → Agent应列出每个工具变量的排除后J统计量变化，帮助用户识别哪个IV可能有问题
- **[TRIGGER:C06-C] 恰好识别（k=m）无法进行过度识别检验** → Agent应提示：恰好识别下无法统计检验排他性假设，结论对该假设的敏感度更高
- **[TRIGGER:C06-D] 多个内生变量** → Stock-Yogo临界值随内生变量个数变化，Agent应正确选择对应m的临界值

#### 2.5.4 变量要求

| 变量类型 | 数据类型要求 | 设定规范 |
|----------|-------------|----------|
| 因变量Y | 连续型 | 二值Y也可使用线性概率模型的IV-2SLS（虽然效率较低，但LATE解释更清晰） |
| 内生变量X | 连续型或虚拟变量 | 若X为二值，第一阶段需使用线性概率模型或Probit，但2SLS第一阶段仍推荐线性模型 |
| 工具变量Z | 连续型或虚拟变量 | **必须**与X显著相关、与Y的误差项不相关；虚拟变量IV（如政策冲击、自然实验）在实践中更可信 |
| 控制变量W | 数值型 | 必须为外生变量（不受X或Z影响） |
| 第一阶段F统计量 | 数值 | 从第一阶段回归的F检验获得 |

**工具变量数量与质量的评估框架**：
- 恰好识别（k=m）：模型恰好识别，虽不能检验过度识别，但偏误风险最低
- 过度识别（k>m）：可检验排他性，但增加偏误风险——工具变量越多且越弱，2SLS偏误越大
- 工具变量的"故事"（narrative）比统计检验更重要：Agent应提示用户提供IV合理性的经济理论依据

#### 2.5.5 代码模板（与 code_generator.py 实际输出对齐）

```
[CODE-TEMPLATE: IV-2SLS]（来源：code_generator.py generate_code("IV-2SLS", request)）
═══════════════════════════════════════════

import pandas as pd
from linearmodels.iv import IV2SLS

df = pd.read_csv("data.csv")
formula = "<<Y_VAR>> ~ 1 + <<CONTROLS>> + [<<ENDOGENOUS_X>> ~ <<INSTRUMENT_Z>>]"
result = IV2SLS.from_formula(formula, data=df).fit(cov_type='robust')
print(result.summary)

═══════════════════════════════════════════
```

---

### 2.6 面板数据模型

#### 2.6.1 理论框架

面板数据模型利用同一横截面单位在多个时期上的重复观测，通过控制不随时间变化的不可观测异质性来缓解遗漏变量偏误问题。其核心方程形式为：

$$Y_{it} = X_{it}\beta + \alpha_i + \lambda_t + \varepsilon_{it}$$

其中$\alpha_i$为个体特定效应（Individual-Specific Effect），$\lambda_t$为时间特定效应。

**固定效应模型（FE）**：允许$\alpha_i$与$X_{it}$任意相关，通过组内变换（Within Transformation）或LSDV（最小二乘虚拟变量法）消去$\alpha_i$。

**随机效应模型（RE）**：假设$\alpha_i$与$X_{it}$不相关，通过广义最小二乘法（GLS）估计，效率高于FE但一致性依赖于该假设。

**Hausman检验**（Hausman, 1978）是FE vs RE选择的经典检验：
- H0：$\alpha_i$与$X_{it}$不相关 → RE一致且有效，FE一致但效率较低
- H1：$\alpha_i$与$X_{it}$相关 → RE不一致，FE仍然一致
- 若检验显著（p < 0.05）→ 拒绝H0，选择FE
- 若检验不显著（p ≥ 0.05）→ 不拒绝H0，RE可接受

**Mundlak相关随机效应（CRE）**：Mundlak (1978, Econometrica) 革命性地证明FE和RE的分歧本质上是关于$E(\alpha_i|X_{it})$是否等于0的设定问题。他提出在RE模型中加入所有时变变量的个体均值$\bar{X}_i$，在此增广模型中RE估计量与FE估计量完全等价。CRE框架统一了FE与RE的方法论分歧：
$$Y_{it} = X_{it}\beta + \bar{X}_i\gamma + (\eta_i + \varepsilon_{it})$$

其中$\gamma=0$的检验等价于Hausman检验。

**聚类标准误的选择**：面板数据中，同一体的不同时期观测可能存在任意形式的序列相关，因此必须在个体层面聚类标准误。关键规则：**聚类层数不应低于处理变量的变异层数**。例如，若政策在省级层面变化，则应在省级层面聚类。Arellano (1987) 开发了面板误差项序列相关的诊断检验。

**双向固定效应的适用条件**：在同时控制个体和时间固定效应后，估计量反映的是个体内部随时间偏离其均值的变异。这要求：(1) 处理变量在个体内部有时间维度变异；(2) 变异不应仅来源于少数个体（否则估计量主要由这些个体驱动）。

#### 2.6.2 适用条件与前提假设检验

**[CHECK] 面板模型六大前提条件检验**：

| 检验ID | 检验项目 | 检验方法 | 判断标准 | 严重级别 |
|--------|----------|----------|----------|----------|
| PANEL-T1 | 面板结构完整性 | 数据验证 | [THRESHOLD] 必须存在个体ID列和时间列；个体数N ≥ 2，时间期数T ≥ 2 → 否则 CRITICAL | CRITICAL |
| PANEL-T2 | FE vs RE选择（Hausman检验） | Hausman (1978) 检验或Mundlak CRE检验 | [THRESHOLD] p < 0.05 → 选择FE；0.02 ≤ p < 0.08 → WARN → [TRIGGER:C07-A]；p ≥ 0.05 → RE可接受 | INFO |
| PANEL-T3 | 个体效应显著性 | 联合F检验（FE中所有个体虚拟变量=0） | [THRESHOLD] p < 0.05 → 个体效应显著存在，面板方法优于混合OLS | INFO |
| PANEL-T4 | 时间效应显著性 | 联合F检验（所有时间虚拟变量=0） | [THRESHOLD] p < 0.05 → 应纳入时间固定效应 | INFO |
| PANEL-T5 | 组内自相关 | Wooldridge面板自相关检验 / Arellano (1987)检验 | [THRESHOLD] p < 0.05 → 存在序列相关，聚类标准误必需 | WARNING |
| PANEL-T6 | 截面相关（Cross-Sectional Dependence） | Pesaran CD检验 | [THRESHOLD] p < 0.05 → 存在截面相关，需使用Driscoll-Kraay或空间标准误 | WARNING |

**[CHECK] 面板结构完整性检查流程**：

```
[CHECK:PANEL-T1-STEP-1] 面板变量验证
  ├── 检查id_var是否存在且每个体有至少2个观测
  ├── 检查time_var是否合理（如年份列无异常值）
  └── 检查面板是否为平衡面板：df.groupby(id_var).size().describe()

[CHECK:PANEL-T1-STEP-2] 个体内变异检查
  ├── 检查核心自变量X的组内标准差（Within SD）vs 组间标准差（Between SD）
  ├── [DECISION] 若组内SD / 总SD < 0.1 → ⚠️ 变量几乎无组内变异，FE估计可能不可靠
  └── [DECISION] 若组内SD = 0 → ❌ 该变量为时不变变量，FE模型将自动剔除

[CHECK:PANEL-T1-STEP-3] 面板类型判定
  ├── T ≤ N（短面板）→ 关注序列相关和截面相关的标准误修正
  └── T > N（长面板）→ 关注单位根和协整问题（超出本框架范围）
```

#### 2.6.3 不适用场景与预警提示

**[DECISION] 强制拒绝/修正建模的情况**：
- 不存在面板结构（无个体ID或无时间变量）→ ❌ 非面板数据，降级为横截面OLS
- 核心自变量为时不变变量且选择FE → ❌ FE模型自动剔除时不变变量。Agent应提示用户改用Mundlak CRE模型以保留时不变变量的系数估计
- 面板极度不平衡（T_i的变异系数 > 1）→ ⚠️ 可能影响估计量的加权性质

**[TRIGGER] 触发交互确认节点C07的情况**：

- **[TRIGGER:C07-A] Hausman检验边缘结果** → p 在 0.02-0.08 之间时，Agent应同时报告FE和RE的估计，并注明Hausman检验结论对样本设定敏感，建议以FE作为基准模型，RE作为稳健性对照

- **[TRIGGER:C07-B] 聚类层数选择** → Agent应检测处理变量的变异层数并输出：
  ```
  数据中处理变量的变异层数：
  - 个体层面：<<N_TREATED>>个个体有处理变异
  - 省/州市层面：<<PROVINCE_COUNT>>个省/州市有处理变异
  - 国家层面：<<COUNTRY_COUNT>>个国家有处理变异

  建议聚类层数：<<RECOMMENDED_LEVEL>>（处理变量的最低变异层）
  当前数据聚类变量：<<CURRENT_CLUSTER>>
  <<IF MISMATCH>>⚠️ 当前聚类层数可能不足以捕捉误差项的相关结构
  ```

- **[TRIGGER:C07-C] 面板单位根**（T > 20的长面板）→ Agent应建议进行LLC检验或IPS检验，若存在单位根需先进行差分或协整处理

#### 2.6.4 变量要求

| 变量类型 | 数据类型要求 | 设定规范 |
|----------|-------------|----------|
| 因变量Y | 连续型 | 面板模型也可处理二值或计数因变量（使用面板Logit/FE Poisson），但需特殊估计方法 |
| 核心自变量X | 连续型或虚拟变量 | 需有时序变异（Within SD > 0）；时不变X在FE中会被吸收 |
| 个体ID | 字符串或整数 | 每个体有≥2个时间观测 |
| 时间变量 | 整数或日期 | 需在合理范围内，无异常值 |
| 控制变量 | 数值型 | 同样应有时序变异 |
| 聚类变量（标准误） | 字符串或整数 | 按处理变量的变异层数设定 |

#### 2.6.5 代码模板（与 code_generator.py 实际输出对齐）

```
[CODE-TEMPLATE: Panel Fixed Effects]（来源：code_generator.py generate_code("Panel Fixed Effects", request)）
═══════════════════════════════════════════

import pandas as pd
import statsmodels.api as sm
from linearmodels.panel import PanelOLS

df = pd.read_csv("data.csv")
df = df.set_index(['<<ENTITY_VAR>>', '<<TIME_VAR>>'])
y = df['<<Y_VAR>>']
X = sm.add_constant(df[<<X_LIST>>])

model = PanelOLS(y, X, entity_effects=True, time_effects=True)
result = model.fit(cov_type='clustered', cluster_entity=True)
print(result.summary)

═══════════════════════════════════════════
```

**[ACTION] model_runner.py 实际执行逻辑**（`_run_panel_fixed_effects()` 函数）：

1. 调用 `_prepare_panel_frame()` 完成：列存在性校验 → entity_column 和 time_column 存在性检查 → 数值型强制转换 → MultiIndex 设置 `.set_index([entity, time]).sort_index()`
2. **额外校验**：至少2个个体（`nunique(entity) >= 2`）、至少2个时期（`nunique(time) >= 2`）、至少4行完整数据
3. 使用 `PanelOLS(y, X, entity_effects=True, time_effects=True).fit(cov_type='clustered', cluster_entity=True)` — 双向固定效应（个体+时间），标准误按个体聚类
4. `_extract_results()` 中面板模型的 F统计量提取逻辑不同（从 `fitted.f_statistic.stat` 和 `fitted.f_statistic.pval` 获取，而非 `fitted.fvalue`）

---

## 三、动态决策树与交互确认节点

### 3.1 交互确认节点汇总

本框架定义了以下标准交互确认节点，Agent在流程中遇到对应条件时，**必须**暂停自动执行，输出交互提示并等待用户选择：

| 节点ID | 触发条件 | 关联模型 | 严重级别 |
|--------|----------|----------|----------|
| [TRIGGER:C01] | 数据类型为时间序列（无面板/横截面结构） | ALL | WARNING |
| [TRIGGER:C02] | OLS前提条件未通过（BP异方差显著、RESET设定检验显著等） | OLS | WARNING |
| [TRIGGER:C03] | Logit稀有事件偏误、HL拟合优度检验不通过 | Logit | WARNING |
| [TRIGGER:C04-A] | DID平行趋势前检验未通过 | DID | CRITICAL |
| [TRIGGER:C04-B] | Goodman-Bacon分解显示TWFE存在大量负权重 | DID | WARNING |
| [TRIGGER:C04-C] | 仅有横截面数据但需要DID | DID | WARNING |
| [TRIGGER:C05-A] | McCrary密度检验未通过 | RDD | CRITICAL |
| [TRIGGER:C05-B] | 精确RDD vs 模糊RDD选择 | RDD | INFO |
| [TRIGGER:C05-C] | IK带宽与CCT带宽差异过大 | RDD | WARNING |
| [TRIGGER:C06-A] | Hausman检验未拒绝外生性（IV-2SLS） | IV-2SLS | INFO |
| [TRIGGER:C06-B] | 过度识别检验边缘显著 | IV-2SLS | WARNING |
| [TRIGGER:C06-C] | 恰好识别无法检验过度识别 | IV-2SLS | INFO |
| [TRIGGER:C07-A] | Hausman检验边缘结果（面板） | Panel | WARNING |
| [TRIGGER:C07-B] | 聚类层数与处理变量变异层数不一致 | Panel | WARNING |
| [TRIGGER:C07-C] | 长面板单位根问题 | Panel | WARNING |

### 3.2 通用交互提示词库

Agent应根据节点类型，从以下词库中组合生成交互提示。词库覆盖三类交互模式：

**[OUTPUT] 模式一：假设违背——需要用户决策**

```
【触发条件】：<<CONDITION_DESCRIPTION>>
【检验证据】：<<TEST_NAME>> = <<STAT>>, p = <<PVAL>>, 临界值 = <<CRITICAL_VALUE>>
【严重程度】：<<SEVERITY_LEVEL>>（严重/中等/轻微）
【推荐方案】：<<RECOMMENDATION>>（推荐度：<<RATING>>/5）
【可选方案】：<<ALTERNATIVES>>
【风险提示】：<<RISK_WARNING>>
```

**[OUTPUT] 模式二：信息不足——需要用户补充输入**

```
【缺失信息】：<<MISSING_INFO_DESCRIPTION>>
【因缺乏此信息而无法进行的步骤】：<<BLOCKED_STEPS>>
【信息用途】：<<WHY_NEEDED>>
【示例输入】：<<EXAMPLE_INPUT>>
```

**[OUTPUT] 模式三：多方案竞争——需要用户选择优先级**

```
【可选模型】：<<MODEL_CANDIDATES>>
【各方案对比】：
  | 方案 | 优势 | 劣势 | 前提满足度 | 推荐度 |
  |------|------|------|-----------|--------|
  <<ROWS>>

【选择建议】：<<RECOMMENDATION_WITH_REASONING>>
```

---

## 四、参考文献

### 4.1 方法论总论

Angrist, J. D., & Pischke, J.-S. (2009). *Mostly Harmless Econometrics: An Empiricist's Companion*. Princeton University Press.

### 4.2 OLS与稳健推断

Cattaneo, M. D., Crump, R. K., Farrell, M. H., & Feng, Y. (2019). On Binscatter. *arXiv preprint arXiv:1902.09608*.

MacKinnon, J. G., & White, H. (1985). Some heteroskedasticity-consistent covariance matrix estimators with improved finite sample properties. *Journal of Econometrics*, 29(3), 305-325.

White, H. (1980). A heteroskedasticity-consistent covariance matrix estimator and a direct test for heteroskedasticity. *Econometrica*, 48(4), 817-838.

### 4.3 二元选择模型

Firth, D. (1993). Bias reduction of maximum likelihood estimates. *Biometrika*, 80(1), 27-38.

McFadden, D. (1974). Conditional logit analysis of qualitative choice behavior. In P. Zarembka (Ed.), *Frontiers in Econometrics* (pp. 105-142). Academic Press.

### 4.4 双重差分法（DID）

Callaway, B., & Sant'Anna, P. H. C. (2021). Difference-in-differences with multiple time periods. *Journal of Econometrics*, 225(2), 200-230.

Goodman-Bacon, A. (2021). Difference-in-differences with variation in treatment timing. *Journal of Econometrics*, 225(2), 254-277.

Rambachan, A., & Roth, J. (2023). An honest approach to parallel trends. *American Economic Review*, 113(9), 2489-2529.

Roth, J. (2024). Pre-test with caution: Event-study estimates after testing for parallel trends. *American Economic Review: Insights*, 6(3), 380-398.

Roth, J., & Sant'Anna, P. H. C. (2023). When is parallel trends sensitive to functional form? *Econometrica*, 91(2), 737-775.

Sun, L., & Abraham, S. (2021). Estimating dynamic treatment effects in event studies with heterogeneous treatment effects. *Journal of Econometrics*, 225(2), 175-199.

### 4.5 断点回归设计（RDD）

Calonico, S., Cattaneo, M. D., & Titiunik, R. (2014). Robust nonparametric confidence intervals for regression-discontinuity designs. *Econometrica*, 82(6), 2295-2326.

Cattaneo, M. D., Idrobo, N., & Titiunik, R. (2020). *A Practical Introduction to Regression Discontinuity Designs: Foundations*. Cambridge University Press.

Cattaneo, M. D., Idrobo, N., & Titiunik, R. (2024). *A Practical Introduction to Regression Discontinuity Designs: Extensions*. Cambridge University Press.

Cattaneo, M. D., & Titiunik, R. (2022). Regression discontinuity designs. *Annual Review of Economics*, 14, 821-851.

Imbens, G., & Kalyanaraman, K. (2012). Optimal bandwidth choice for the regression discontinuity estimator. *Review of Economic Studies*, 79(3), 933-959.

McCrary, J. (2008). Manipulation of the running variable in the regression discontinuity design: A density test. *Journal of Econometrics*, 142(2), 698-714.

### 4.6 工具变量法（IV）

Angrist, J. D., & Krueger, A. B. (2001). Instrumental variables and the search for identification: From supply and demand to natural experiments. *Journal of Economic Perspectives*, 15(4), 69-85.

Angrist, J. D., Imbens, G. W., & Rubin, D. B. (1996). Identification of causal effects using instrumental variables. *Journal of the American Statistical Association*, 91(434), 444-455.

Stock, J. H., & Yogo, M. (2005). Testing for weak instruments in linear IV regression. In D. W. K. Andrews & J. H. Stock (Eds.), *Identification and Inference for Econometric Models: Essays in Honor of Thomas Rothenberg* (pp. 80-108). Cambridge University Press.

### 4.7 面板数据模型

Arellano, M. (1987). Computing robust standard errors for within-groups estimators. *Oxford Bulletin of Economics and Statistics*, 49(4), 431-434.

Hausman, J. A. (1978). Specification tests in econometrics. *Econometrica*, 46(6), 1251-1271.

Mundlak, Y. (1978). On the pooling of time series and cross section data. *Econometrica*, 46(1), 69-85.

### 4.8 软件与实现

本项目（小计 v0.1.0）计量核心基于 statsmodels 和 linearmodels，不依赖 statsPAI。代码模板参见 `desktop-app/sidecar/services/code_generator.py`，模型执行器参见 `desktop-app/sidecar/services/model_runner.py`。

---

*文档编制说明：本框架由计量摆渡人编制，供小计桌面端在模型选择与前提条件检验阶段调用。代码模板来自 code_generator.py 的实际输出，模型执行逻辑来自 model_runner.py 的实际实现。框架的交互确认机制确保Agent在遇到不确定性时能够与用户协作决策，而非静默地做出可能错误的建模选择。LLM增强功能通过华为MaaS API实现，LLM不可用时自动回退规则引擎。*

*Agent使用说明（小计桌面端）：Agent应首先阅读文档顶部的"快速执行协议"部分以获取完整执行流程概览，随后按照 [PROTOCOL-STEP] 顺序执行各步骤。路由规则应与 model_selector.py 中 select_model() 函数的实际逻辑保持一致。在执行模型的前提条件检验时，Agent应按 §2.x.2 中的 [CHECK] 清单逐项执行。对于支持软件内运行的模型（OLS/Logit/面板FE），通过 /run-model 端点执行；对于暂不支持真实执行的模型（DID/RDD/IV-2SLS），通过 /recommend-model 端点提供代码模板和检查清单。遇到 [TRIGGER] 标记时通过前端UI触发用户交互确认。所有代码模板的占位符格式为 `<<PLACEHOLDER>>`。*
