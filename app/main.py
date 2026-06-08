from __future__ import annotations

import io
from pathlib import Path

import pandas as pd
from fastapi import FastAPI, File, UploadFile
from fastapi.responses import HTMLResponse

from app.schemas import ModelRecommendation, ModelRequest
from app.services.code_generator import generate_code
from app.services.data_profile import profile_dataframe
from app.services.maas_client import MaasUnavailable, enhance_recommendation, get_maas_status
from app.services.model_selector import select_model

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SAMPLE_DATA_PATH = PROJECT_ROOT / "examples" / "sample_wage.csv"

app = FastAPI(
    title="计量建模 Agent MVP",
    description="上传表格数据，输入研究问题，自动推荐计量模型并生成 Python 代码模板。",
    version="0.1.0",
    docs_url="/api-docs",
    redoc_url=None,
)


@app.get("/", response_class=HTMLResponse, summary="中文演示首页")
def demo_home() -> str:
    return CHINESE_DEMO_HTML


@app.get("/docs", response_class=HTMLResponse, summary="中文演示界面")
def chinese_docs() -> str:
    return CHINESE_DEMO_HTML


@app.get("/health", summary="服务健康检查")
def health_check() -> dict:
    return {"status": "ok", "message": "计量建模 Agent MVP 正在运行", "maas": get_maas_status()}


@app.get("/maas-status", summary="华为云 MaaS 配置状态")
def maas_status() -> dict:
    return get_maas_status()


@app.post(
    "/profile-data",
    summary="识别上传数据字段",
    description="上传 CSV 或 Excel 文件，返回字段类型、缺失值、唯一值和样例值。",
)
async def profile_data(file: UploadFile = File(..., description="CSV 或 Excel 数据文件")) -> dict:
    content = await file.read()
    suffix = (file.filename or "").lower()

    if suffix.endswith(".xlsx") or suffix.endswith(".xls"):
        df = pd.read_excel(io.BytesIO(content))
    else:
        df = pd.read_csv(io.BytesIO(content))

    return profile_dataframe(df)


@app.get("/sample-profile", summary="加载示例数据字段")
def sample_profile() -> dict:
    df = pd.read_csv(SAMPLE_DATA_PATH)
    return profile_dataframe(df)


@app.post(
    "/recommend-model",
    response_model=ModelRecommendation,
    summary="推荐计量模型并生成代码",
    description="根据研究问题、字段信息和变量配置，推荐计量模型并生成 Python 代码模板。",
)
def recommend_model(request: ModelRequest) -> ModelRecommendation:
    model, reason, checks = select_model(request)
    code = generate_code(model, request)

    try:
        maas_result = enhance_recommendation(request, model, reason, checks, code)
        return ModelRecommendation(
            model=maas_result.model,
            reason=maas_result.reason,
            required_checks=maas_result.required_checks,
            generated_code=maas_result.generated_code,
            provider="huawei_maas",
            maas_used=True,
            llm_explanation=maas_result.llm_explanation,
        )
    except MaasUnavailable as exc:
        maas_error = str(exc)

    return ModelRecommendation(
        model=model,
        reason=reason,
        required_checks=checks,
        generated_code=code,
        provider="rules",
        maas_used=False,
        maas_error=maas_error,
    )


CHINESE_DEMO_HTML = """
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>计量建模 Agent MVP</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f8fb;
      --panel: #ffffff;
      --ink: #172033;
      --muted: #667085;
      --line: #d9e2ec;
      --blue: #2563eb;
      --blue-dark: #1e40af;
      --green: #087f5b;
      --code: #111827;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      font-family: "Microsoft YaHei", "Segoe UI", Arial, sans-serif;
      line-height: 1.55;
    }
    header {
      background: #ffffff;
      border-bottom: 1px solid var(--line);
      padding: 24px 32px;
    }
    header h1 {
      margin: 0 0 6px;
      font-size: 26px;
      letter-spacing: 0;
    }
    header p {
      margin: 0;
      color: var(--muted);
      font-size: 14px;
    }
    main {
      width: min(1180px, calc(100vw - 32px));
      margin: 22px auto 40px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      align-items: start;
    }
    section {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 20px;
      box-shadow: 0 6px 20px rgba(15, 23, 42, 0.04);
    }
    section.full { grid-column: 1 / -1; }
    h2 {
      margin: 0 0 14px;
      font-size: 18px;
      letter-spacing: 0;
    }
    label {
      display: block;
      margin: 12px 0 6px;
      font-weight: 600;
      font-size: 14px;
    }
    input, textarea {
      width: 100%;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      padding: 10px 12px;
      font: inherit;
      background: #ffffff;
      color: var(--ink);
    }
    input[type="file"] {
      position: absolute;
      width: 1px;
      height: 1px;
      opacity: 0;
      pointer-events: none;
    }
    textarea {
      min-height: 76px;
      resize: vertical;
    }
    button {
      margin-top: 14px;
      border: 0;
      border-radius: 6px;
      background: var(--blue);
      color: white;
      padding: 10px 14px;
      font-weight: 700;
      cursor: pointer;
    }
    button:hover { background: var(--blue-dark); }
    button.secondary {
      background: #e2e8f0;
      color: var(--ink);
      margin-left: 8px;
    }
    button.secondary:hover { background: #cbd5e1; }
    .file-label {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 40px;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      background: #ffffff;
      color: var(--ink);
      padding: 9px 12px;
      font-weight: 700;
      cursor: pointer;
    }
    .file-label:hover { border-color: var(--blue); color: var(--blue); }
    .file-name {
      display: inline-block;
      margin-left: 10px;
      color: var(--muted);
      font-size: 13px;
    }
    .hint {
      color: var(--muted);
      font-size: 13px;
      margin-top: 8px;
    }
    .result {
      margin-top: 14px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #f8fafc;
      padding: 12px;
      min-height: 80px;
      white-space: pre-wrap;
      overflow: auto;
    }
    .model-name {
      display: inline-block;
      color: var(--green);
      font-weight: 800;
      margin-bottom: 8px;
    }
    pre {
      background: var(--code);
      color: #e5e7eb;
      border-radius: 6px;
      padding: 14px;
      overflow: auto;
      white-space: pre-wrap;
      margin: 10px 0 0;
      font-size: 13px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
      font-size: 13px;
    }
    th, td {
      border: 1px solid var(--line);
      padding: 8px;
      text-align: left;
      vertical-align: top;
    }
    th { background: #f1f5f9; }
    .links {
      display: flex;
      gap: 12px;
      margin-top: 12px;
      flex-wrap: wrap;
    }
    .links a {
      color: var(--blue);
      text-decoration: none;
      font-weight: 600;
    }
    @media (max-width: 860px) {
      main { grid-template-columns: 1fr; }
      header { padding: 20px 16px; }
    }
  </style>
</head>
<body>
  <header>
    <h1>计量建模 Agent MVP</h1>
    <p>上传表格数据，输入研究问题，自动推荐计量模型并生成 Python 代码模板。</p>
    <div class="links">
      <a href="/api-docs">接口文档</a>
      <a href="/health">健康检查</a>
      <a href="/maas-status">MaaS 状态</a>
    </div>
  </header>

  <main>
    <section>
      <h2>一、上传数据并识别字段</h2>
      <label class="file-label" for="fileInput">选择数据文件</label>
      <span id="fileName" class="file-name">尚未选择文件</span>
      <input id="fileInput" type="file" accept=".csv,.xlsx,.xls" onchange="showFileName()" />
      <button onclick="profileData()">识别数据字段</button>
      <button class="secondary" onclick="loadSampleData()">加载示例数据</button>
      <p class="hint">支持 CSV / Excel。系统会返回字段类型、缺失值、唯一值和样例值。</p>
      <div id="profileResult" class="result">等待上传数据...</div>
    </section>

    <section>
      <h2>二、输入研究问题并推荐模型</h2>
      <label for="question">研究问题</label>
      <textarea id="question">教育水平和工作经验是否影响收入</textarea>

      <label for="columns">字段列表（英文逗号分隔）</label>
      <input id="columns" value="income, education, experience, gender" />

      <label for="y">被解释变量 Y</label>
      <input id="y" value="income" />

      <label for="xs">解释变量 X（英文逗号分隔）</label>
      <input id="xs" value="education, experience, gender" />

      <button onclick="recommendModel()">推荐模型并生成代码</button>
      <div id="recommendResult" class="result">等待输入研究问题...</div>
    </section>

    <section class="full">
      <h2>三、Demo 可展示的模型类型</h2>
      <table>
        <thead>
          <tr><th>研究场景</th><th>推荐模型</th><th>需要检查的内容</th></tr>
        </thead>
        <tbody>
          <tr><td>连续型结果变量，研究影响关系</td><td>OLS</td><td>缺失值、多重共线性、稳健标准误</td></tr>
          <tr><td>结果变量为 0/1，例如是否违约</td><td>Logit</td><td>二分类变量、类别不平衡、边际效应</td></tr>
          <tr><td>同一个体跨年份数据</td><td>面板固定效应</td><td>个体 ID、时间列、固定效应</td></tr>
          <tr><td>政策前后和处理组/对照组</td><td>DID</td><td>处理组、政策后变量、平行趋势</td></tr>
          <tr><td>存在断点或阈值</td><td>RDD</td><td>断点变量、cutoff、带宽</td></tr>
          <tr><td>存在内生性和工具变量</td><td>IV-2SLS</td><td>内生变量、工具变量相关性和外生性</td></tr>
        </tbody>
      </table>
    </section>
  </main>

  <script>
    function splitValues(value) {
      return value.split(",").map(item => item.trim()).filter(Boolean);
    }

    function showFileName() {
      const file = document.getElementById("fileInput").files[0];
      document.getElementById("fileName").textContent = file ? file.name : "尚未选择文件";
    }

    function renderProfileResult(data) {
      const box = document.getElementById("profileResult");
      const rows = data.columns.map(col => (
        `<tr><td>${col.name}</td><td>${col.dtype}</td><td>${col.missing}</td><td>${col.unique}</td><td>${col.sample_values.join(", ")}</td></tr>`
      )).join("");
      box.innerHTML = `
        <strong>行数：</strong>${data.rows}　<strong>列数：</strong>${data.columns_count}
        <table>
          <thead><tr><th>字段名</th><th>类型</th><th>缺失值</th><th>唯一值</th><th>样例值</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      `;
    }

    async function profileData() {
      const file = document.getElementById("fileInput").files[0];
      const box = document.getElementById("profileResult");
      if (!file) {
        box.textContent = "请先选择一个 CSV 或 Excel 文件。";
        return;
      }
      const form = new FormData();
      form.append("file", file);
      box.textContent = "正在识别数据字段...";
      try {
        const response = await fetch("/profile-data", { method: "POST", body: form });
        const data = await response.json();
        if (!response.ok) throw new Error(JSON.stringify(data));
        renderProfileResult(data);
      } catch (error) {
        box.textContent = "识别失败：" + error.message;
      }
    }

    async function loadSampleData() {
      const box = document.getElementById("profileResult");
      document.getElementById("fileName").textContent = "sample_income.csv";
      document.getElementById("question").value = "教育水平和工作经验是否影响收入";
      document.getElementById("columns").value = "income, education, experience, gender";
      document.getElementById("y").value = "income";
      document.getElementById("xs").value = "education, experience, gender";
      box.textContent = "正在加载示例数据...";
      try {
        const response = await fetch("/sample-profile");
        const data = await response.json();
        if (!response.ok) throw new Error(JSON.stringify(data));
        renderProfileResult(data);
      } catch (error) {
        box.textContent = "加载示例失败：" + error.message;
      }
    }

    async function recommendModel() {
      const box = document.getElementById("recommendResult");
      const payload = {
        research_question: document.getElementById("question").value,
        columns: splitValues(document.getElementById("columns").value),
        dependent_variable: document.getElementById("y").value || null,
        independent_variables: splitValues(document.getElementById("xs").value)
      };
      box.textContent = "正在推荐模型...";
      try {
        const response = await fetch("/recommend-model", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (!response.ok) throw new Error(JSON.stringify(data));
        const source = data.maas_used ? "华为云 MaaS" : "本地规则引擎";
        const note = data.llm_explanation || data.maas_error || "";
        box.innerHTML = `
          <span class="model-name">推荐模型：${data.model}</span>
          <div><strong>推荐来源：</strong>${source}</div>
          <div><strong>推荐理由：</strong>${data.reason}</div>
          ${note ? `<div><strong>补充说明：</strong>${note}</div>` : ""}
          <div><strong>建模前检查：</strong></div>
          <ul>${data.required_checks.map(item => `<li>${item}</li>`).join("")}</ul>
          <div><strong>生成代码：</strong></div>
          <pre>${escapeHtml(data.generated_code)}</pre>
        `;
      } catch (error) {
        box.textContent = "推荐失败：" + error.message;
      }
    }

    function escapeHtml(value) {
      return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
    }
  </script>
</body>
</html>
"""
