import {
  Activity,
  Cpu,
  Database,
  FileText,
  FileUp,
  MessageSquare,
  Play,
  RefreshCw,
  Send,
  Sparkles,
  TableProperties,
  Wand2
} from "lucide-react";
import { ChangeEvent, useEffect, useMemo, useState } from "react";

import {
  chat,
  generateReport,
  getHealth,
  inferVariables,
  loadSampleFile,
  loadSampleProfile,
  profileData,
  recommendModel,
  runModel
} from "./api";
import type {
  ChatMessage,
  CoefficientResult,
  DataProfile,
  InferVariablesResponse,
  ModelRecommendation,
  ModelRequest,
  RunModelResponse
} from "./types";

const DEFAULT_QUESTION = "教育水平是否会在控制工作经验和性别后影响收入？";
const DEFAULT_COLUMNS = "income, education, experience, gender";

type BusyKey = "profile" | "infer" | "recommend" | "run" | "chat" | "report" | "sample";

const MODEL_OPTIONS = [
  { value: "OLS", label: "OLS 线性回归" },
  { value: "Logit", label: "Logit 二元选择" },
  { value: "Panel Fixed Effects", label: "面板固定效应" },
  { value: "DID", label: "DID 双重差分" },
  { value: "RDD", label: "RDD 断点回归" },
  { value: "IV-2SLS", label: "IV-2SLS 工具变量" }
];

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "";
  }
  return Math.abs(value) >= 1000 ? value.toFixed(1) : value.toFixed(4);
}

function providerLabel(provider: string | undefined): string {
  if (provider === "custom_model") return "自定义模型";
  if (provider === "huawei_maas") return "华为云 MaaS";
  return "本地规则";
}

function modelLabel(model: string | undefined): string {
  return MODEL_OPTIONS.find((item) => item.value === model)?.label ?? model ?? "";
}

export default function App() {
  const [health, setHealth] = useState<"checking" | "online" | "offline">("checking");
  const [file, setFile] = useState<File | null>(null);
  const [profile, setProfile] = useState<DataProfile | null>(null);
  const [question, setQuestion] = useState(DEFAULT_QUESTION);
  const [columnsInput, setColumnsInput] = useState(DEFAULT_COLUMNS);
  const [dependentVariable, setDependentVariable] = useState("income");
  const [independentVariables, setIndependentVariables] = useState("education, experience, gender");
  const [entityColumn, setEntityColumn] = useState("");
  const [timeColumn, setTimeColumn] = useState("");
  const [treatmentColumn, setTreatmentColumn] = useState("");
  const [runningVariable, setRunningVariable] = useState("");
  const [instrumentVariable, setInstrumentVariable] = useState("");
  const [inference, setInference] = useState<InferVariablesResponse | null>(null);
  const [recommendation, setRecommendation] = useState<ModelRecommendation | null>(null);
  const [modelType, setModelType] = useState("OLS");
  const [runResult, setRunResult] = useState<RunModelResponse | null>(null);
  const [chatInput, setChatInput] = useState("为什么推荐这个模型？");
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [report, setReport] = useState("");
  const [status, setStatus] = useState("就绪");
  const [busy, setBusy] = useState<BusyKey | null>(null);

  const columns = useMemo(() => splitList(columnsInput), [columnsInput]);

  useEffect(() => {
    getHealth()
      .then(() => setHealth("online"))
      .catch(() => setHealth("offline"));
  }, []);

  function setVariablesFromInference(next: InferVariablesResponse) {
    setInference(next);
    setDependentVariable(next.dependent_variable ?? "");
    setIndependentVariables(next.independent_variables.join(", "));
    setEntityColumn(next.entity_column ?? "");
    setTimeColumn(next.time_column ?? "");
    setTreatmentColumn(next.treatment_column ?? "");
    setRunningVariable(next.running_variable ?? "");
    setInstrumentVariable(next.instrument_variable ?? "");
  }

  function buildRequest(): ModelRequest {
    return {
      research_question: question,
      columns,
      dependent_variable: dependentVariable || null,
      independent_variables: splitList(independentVariables),
      entity_column: entityColumn || null,
      time_column: timeColumn || null,
      treatment_column: treatmentColumn || null,
      running_variable: runningVariable || null,
      instrument_variable: instrumentVariable || null
    };
  }

  function inferenceColumns() {
    if (profile) {
      return profile.columns.map((column) => ({
        name: column.name,
        dtype: column.dtype,
        sample_values: column.sample_values
      }));
    }
    return columns.map((name) => ({ name }));
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.files?.[0] ?? null;
    setFile(next);
    setStatus(next ? `已选择 ${next.name}` : "就绪");
  }

  async function loadProfile() {
    if (!file) {
      setStatus("请先选择一个数据文件。");
      return;
    }
    setBusy("profile");
    try {
      const next = await profileData(file);
      setProfile(next);
      setColumnsInput(next.columns.map((column) => column.name).join(", "));
      setStatus("字段画像已生成。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "字段画像生成失败。");
    } finally {
      setBusy(null);
    }
  }

  async function loadSample() {
    setBusy("sample");
    try {
      const [sampleFile, sampleProfile] = await Promise.all([loadSampleFile(), loadSampleProfile()]);
      setFile(sampleFile);
      setProfile(sampleProfile);
      setQuestion(DEFAULT_QUESTION);
      setColumnsInput(sampleProfile.columns.map((column) => column.name).join(", "));
      setDependentVariable("income");
      setIndependentVariables("education, experience, gender");
      setModelType("OLS");
      setStatus("样例数据已加载。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "样例数据加载失败。");
    } finally {
      setBusy(null);
    }
  }

  async function infer() {
    setBusy("infer");
    try {
      const next = await inferVariables({
        research_question: question,
        columns: inferenceColumns()
      });
      setVariablesFromInference(next);
      setStatus("变量识别完成。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "变量识别失败。");
    } finally {
      setBusy(null);
    }
  }

  async function recommend() {
    setBusy("recommend");
    try {
      const next = await recommendModel(buildRequest());
      setRecommendation(next);
      setModelType(next.model);
      setStatus("模型推荐已生成。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "模型推荐失败。");
    } finally {
      setBusy(null);
    }
  }

  async function run() {
    if (!file) {
      setStatus("请先加载样例数据或选择一个数据文件。");
      return;
    }
    setBusy("run");
    try {
      const next = await runModel(file, buildRequest(), modelType);
      setRunResult(next);
      setStatus(next.success ? "模型运行完成。" : next.error ?? "模型运行已停止。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "模型运行失败。");
    } finally {
      setBusy(null);
    }
  }

  async function sendChat() {
    const message = chatInput.trim();
    if (!message) return;

    const context = {
      data_columns: columns,
      recommended_model: recommendation?.model ?? modelType,
      generated_code: recommendation?.generated_code ?? null,
      model_results: runResult?.results ?? null
    };
    const visibleHistory = [...chatHistory, { role: "user" as const, content: message }];
    setChatHistory(visibleHistory);
    setChatInput("");
    setBusy("chat");
    try {
      const response = await chat(message, chatHistory.slice(-8), context);
      setChatHistory([...visibleHistory, { role: "assistant", content: response.reply }]);
      setStatus(`回答来源：${providerLabel(response.provider)}。`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "问答失败。");
    } finally {
      setBusy(null);
    }
  }

  async function makeReport() {
    setBusy("report");
    try {
      const response = await generateReport(question, modelType, runResult?.results ?? null, inference?.reasoning);
      setReport(response.markdown);
      setStatus("报告已生成。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "报告生成失败。");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">计量建模智能体</p>
          <h1>研究工作台</h1>
        </div>
        <div className="status-strip">
          <span className={`health health-${health}`} />
          <span>{health === "online" ? "后端服务在线" : health === "offline" ? "后端服务离线" : "正在检查后端"}</span>
          <span className="status-text">{status}</span>
        </div>
      </header>

      <section className="workspace">
        <aside className="rail rail-left">
          <Panel title="数据" icon={<Database size={17} />}>
            <div className="file-row">
              <label className="file-button" title="选择数据文件">
                <FileUp size={16} />
                <span>选择</span>
                <input type="file" accept=".csv,.xlsx,.xls" onChange={onFileChange} />
              </label>
              <button type="button" onClick={loadSample} disabled={busy === "sample"} title="加载样例数据">
                <TableProperties size={16} />
                <span>样例</span>
              </button>
            </div>
            <div className="filename">{file?.name ?? "尚未选择文件"}</div>
            <button className="wide" type="button" onClick={loadProfile} disabled={!file || busy === "profile"}>
              <RefreshCw size={16} />
              <span>生成字段画像</span>
            </button>
          </Panel>

          <Panel title="研究问题" icon={<MessageSquare size={17} />}>
            <textarea value={question} onChange={(event) => setQuestion(event.target.value)} rows={4} />
            <label>字段列表</label>
            <input value={columnsInput} onChange={(event) => setColumnsInput(event.target.value)} />
          </Panel>

          <Panel title="变量配置" icon={<Wand2 size={17} />}>
            <div className="two-buttons">
              <button type="button" onClick={infer} disabled={busy === "infer"}>
                <Sparkles size={16} />
                <span>识别变量</span>
              </button>
              <button type="button" onClick={recommend} disabled={busy === "recommend"}>
                <Cpu size={16} />
                <span>推荐模型</span>
              </button>
            </div>
            <label>被解释变量 Y</label>
            <input value={dependentVariable} onChange={(event) => setDependentVariable(event.target.value)} />
            <label>解释变量 X</label>
            <input value={independentVariables} onChange={(event) => setIndependentVariables(event.target.value)} />
            <div className="mini-grid">
              <Input label="个体列" value={entityColumn} onChange={setEntityColumn} />
              <Input label="时间列" value={timeColumn} onChange={setTimeColumn} />
              <Input label="处理列" value={treatmentColumn} onChange={setTreatmentColumn} />
              <Input label="断点变量" value={runningVariable} onChange={setRunningVariable} />
              <Input label="工具变量" value={instrumentVariable} onChange={setInstrumentVariable} />
            </div>
          </Panel>
        </aside>

        <section className="rail rail-main">
          <Panel title="字段画像" icon={<TableProperties size={17} />}>
            <ProfileTable profile={profile} />
          </Panel>

          <Panel title="模型推荐" icon={<Cpu size={17} />}>
            <div className="runbar">
              <select value={modelType} onChange={(event) => setModelType(event.target.value)}>
                {MODEL_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
              <button type="button" onClick={run} disabled={busy === "run"}>
                <Play size={16} />
                <span>运行模型</span>
              </button>
            </div>
            <RecommendationView recommendation={recommendation} />
          </Panel>

          <Panel title="模型结果" icon={<Activity size={17} />}>
            <RunResultView result={runResult} />
          </Panel>
        </section>

        <aside className="rail rail-right">
          <Panel title="建模问答" icon={<MessageSquare size={17} />}>
            <div className="chat-log">
              {chatHistory.length === 0 ? <div className="empty">还没有对话。</div> : null}
              {chatHistory.map((item, index) => (
                <div className={`chat-item chat-${item.role}`} key={`${item.role}-${index}`}>
                  <strong>{item.role === "user" ? "我" : "智能体"}</strong>
                  <span>{item.content}</span>
                </div>
              ))}
            </div>
            <div className="send-row">
              <input value={chatInput} onChange={(event) => setChatInput(event.target.value)} onKeyDown={(event) => event.key === "Enter" && sendChat()} />
              <button type="button" onClick={sendChat} disabled={busy === "chat"} title="发送">
                <Send size={16} />
              </button>
            </div>
          </Panel>

          <Panel title="分析报告" icon={<FileText size={17} />}>
            <button className="wide" type="button" onClick={makeReport} disabled={busy === "report"}>
              <FileText size={16} />
              <span>生成报告</span>
            </button>
            <pre className="report">{report || "尚未生成报告。"}</pre>
          </Panel>
        </aside>
      </section>
    </main>
  );
}

function Panel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="panel">
      <div className="panel-title">
        {icon}
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Input({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function ProfileTable({ profile }: { profile: DataProfile | null }) {
  if (!profile) {
    return <div className="empty">尚未生成字段画像。</div>;
  }

  return (
    <div className="table-wrap">
      <div className="metric-row">
        <span>{profile.rows} 行</span>
        <span>{profile.columns_count} 列</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>字段名</th>
            <th>类型</th>
            <th>缺失</th>
            <th>唯一值</th>
            <th>样例值</th>
          </tr>
        </thead>
        <tbody>
          {profile.columns.map((column) => (
            <tr key={column.name}>
              <td>{column.name}</td>
              <td>{column.dtype}</td>
              <td>{column.missing}</td>
              <td>{column.unique}</td>
              <td>{column.sample_values.join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RecommendationView({ recommendation }: { recommendation: ModelRecommendation | null }) {
  if (!recommendation) {
    return <div className="empty">尚未生成模型推荐。</div>;
  }

  return (
    <div className="stack">
      <div className="model-line">
        <strong>{modelLabel(recommendation.model)}</strong>
        <span>{providerLabel(recommendation.provider)}</span>
      </div>
      <p>{recommendation.reason}</p>
      <ul>
        {recommendation.required_checks.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      {recommendation.maas_error ? <p className="note">{recommendation.maas_error}</p> : null}
      {recommendation.maas_note ? <p className="note">{recommendation.maas_note}</p> : null}
      <pre className="code">{recommendation.generated_code}</pre>
    </div>
  );
}

function RunResultView({ result }: { result: RunModelResponse | null }) {
  if (!result) {
    return <div className="empty">尚未运行模型。</div>;
  }
  if (!result.success || !result.results) {
    return <div className="empty">{result.error ?? "模型没有返回结果。"}</div>;
  }

  return (
    <div className="table-wrap">
      <div className="metric-row">
        <span>{modelLabel(result.model_type)}</span>
        <span>样本量={result.results.sample_size}</span>
        {result.results.r_squared !== null ? <span>R2={formatNumber(result.results.r_squared)}</span> : null}
      </div>
      {result.warnings.map((warning) => (
        <p className="note" key={warning}>
          {warning}
        </p>
      ))}
      <CoefficientTable coefficients={result.results.coefficients} />
    </div>
  );
}

function CoefficientTable({ coefficients }: { coefficients: CoefficientResult[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>变量</th>
          <th>系数</th>
          <th>标准误</th>
          <th>统计量</th>
          <th>p 值</th>
        </tr>
      </thead>
      <tbody>
        {coefficients.map((item) => (
          <tr key={item.variable}>
            <td>{item.variable}</td>
            <td>{formatNumber(item.coefficient)}</td>
            <td>{formatNumber(item.std_error)}</td>
            <td>{formatNumber(item.t_statistic)}</td>
            <td>{formatNumber(item.p_value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
