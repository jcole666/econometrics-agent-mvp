# 系统设计草案

## 参考项目启发

参考项目 Econometrics-Agent 的核心思路包括：

- 使用大模型理解用户的计量分析需求；
- 使用数据解释器拆解任务；
- 通过计量工具库调用 OLS、IV-2SLS、DID、RDD、PSM 等方法；
- 生成并执行 Python 代码；
- 通过报错反思机制修正代码。

本项目中期阶段不直接复刻其重型架构，而是抽取其中最关键的能力，构建轻量 Demo。

## 本项目架构

```text
Frontend / API Docs
        ↓
FastAPI Backend
        ↓
Data Profiler
        ↓
Model Selector
        ↓
Code Generator
        ↓
Econometrics Runtime
```

## 模块说明

### 数据解析模块

读取用户上传的 CSV / Excel，返回行数、列名、字段类型、缺失值、唯一值数量和样例值。

### 模型选择模块

结合用户自然语言需求和字段配置，使用规则引擎判断推荐模型。

### 代码生成模块

根据模型类型生成 statsmodels / linearmodels 代码模板，保证用户可以复制运行和复现。

### 后续扩展模块

后续可接入 LLM，用于：

- 自动识别 Y、X、处理变量、工具变量；
- 解释回归表；
- 根据报错修复代码；
- 自动生成 Demo 报告。

