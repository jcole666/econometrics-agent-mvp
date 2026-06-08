# Econometrics Agent MVP

面向计量建模初学者和社科研究场景的轻量级 Agent Demo。

本项目参考 Econometrics-Agent 的总体思路，但中期阶段采用更轻量、可解释、便于展示的工程架构：先通过规则引擎完成数据结构识别、模型推荐、代码模板生成和结果解释，再逐步接入更复杂的计量模型。

## 中期 Demo 目标

用户上传表格数据并输入研究问题后，系统能够：

1. 读取 CSV / Excel 数据，识别变量类型；
2. 根据自然语言需求和数据结构推荐计量模型；
3. 支持 OLS、Logit、面板模型、DID、RDD、IV-2SLS 的初步规则判断；
4. 生成可运行的 Python 计量建模代码；
5. 输出面向非技术用户的模型说明、变量检查项和后续建议。

## 技术路线

```text
用户输入研究问题 + 上传数据
        ↓
数据解析模块
        ↓
需求解析模块
        ↓
模型选择规则引擎
        ↓
华为云 MaaS 增强推荐（可选，失败自动回退）
        ↓
代码模板生成器
        ↓
模型执行与结果解释
```

## 当前阶段范围

中期版本优先保证基础闭环：

- OLS：连续型被解释变量，研究影响关系；
- Logit：被解释变量为 0/1；
- 面板模型：存在个体 ID 和年份/时间列；
- DID/RDD/IV-2SLS：先完成识别规则和代码模板，复杂诊断作为后续优化。

## 运行方式

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

如需启用华为云 MaaS，请复制 `.env.example` 为 `.env`，并填入 MaaS API Key：

```text
MAAS_ENABLED=auto
MAAS_API_KEY=你的华为云 MaaS API Key
MAAS_MODEL=deepseek-v4-pro-IckBJP
MAAS_BASE_URL=https://api.modelarts-maas.com/openai/v1
```

未配置 API Key 或 MaaS 请求失败时，系统会自动回退到本地规则引擎，保证 Demo 可继续运行。

启动后访问：

```text
http://127.0.0.1:8000/docs
```

MaaS 配置状态可访问：

```text
http://127.0.0.1:8000/maas-status
```

## 项目结构

```text
econometrics-agent-mvp/
├── app/
│   ├── main.py
│   ├── services/
│   │   ├── data_profile.py
│   │   ├── maas_client.py
│   │   ├── model_selector.py
│   │   └── code_generator.py
│   └── schemas.py
├── examples/
│   └── sample_wage.csv
├── docs/
│   ├── architecture.md
│   └── midterm_plan.md
├── requirements.txt
├── .env.example
└── README.md
```
