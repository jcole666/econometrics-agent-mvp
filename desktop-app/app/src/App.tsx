import {
  Activity,
  ChevronDown,
  Cpu,
  Database,
  Download,
  FileText,
  FileUp,
  MessageSquare,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Send,
  Settings,
  Sparkles,
  TableProperties,
  Wand2,
  X
} from "lucide-react";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";

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
  LLMConfig,
  ModelRecommendation,
  ModelRequest,
  RunModelResponse
} from "./types";

const DEFAULT_QUESTION = "教育水平是否会在控制工作经验和性别后影响收入？";
const DEFAULT_COLUMNS = "income, education, experience, gender";
const DEFAULT_DEPENDENT_VARIABLE = "income";
const DEFAULT_INDEPENDENT_VARIABLES = "education, experience, gender";
const CHAT_PLACEHOLDER = "为什么推荐这个模型？";
const SETTINGS_KEY = "econometrics-agent.model-settings";
const CHAT_SESSIONS_KEY = "econometrics-agent.chat-sessions";
const ACTIVE_CHAT_KEY = "econometrics-agent.active-chat";

type BusyKey = "profile" | "infer" | "recommend" | "run" | "chat" | "report" | "sample";

interface ModelSettings {
  enabled: boolean;
  baseUrl: string;
  model: string;
  apiKey: string;
  timeout: string;
}

interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: number;
}

interface ChatState {
  sessions: ChatSession[];
  activeId: string;
}

type ChatMarkdownBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "heading"; level: number; text: string }
  | { kind: "list"; items: { text: string; depth: number }[] }
  | { kind: "code"; language: string; code: string }
  | { kind: "formula"; text: string }
  | { kind: "rule" };

const MODEL_OPTIONS = [
  { value: "OLS", label: "OLS 线性回归" },
  { value: "Logit", label: "Logit 二元选择" },
  { value: "Panel Fixed Effects", label: "面板固定效应" },
  { value: "DID", label: "DID 双重差分" },
  { value: "RDD", label: "RDD 断点回归" },
  { value: "IV-2SLS", label: "IV-2SLS 工具变量" }
];

const DEFAULT_MODEL_SETTINGS: ModelSettings = {
  enabled: false,
  baseUrl: "https://api.modelarts-maas.com/openai/v1",
  model: "deepseek-v4-pro-IckBJP",
  apiKey: "",
  timeout: "60"
};

function loadModelSettings(): ModelSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_MODEL_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<ModelSettings>;
    return {
      ...DEFAULT_MODEL_SETTINGS,
      ...parsed,
      enabled: parsed.enabled === true
    };
  } catch {
    return DEFAULT_MODEL_SETTINGS;
  }
}

function toLLMConfig(settings: ModelSettings): LLMConfig {
  if (!settings.enabled) {
    return { enabled: false };
  }

  const timeout = Number(settings.timeout);
  return {
    enabled: true,
    api_key: settings.apiKey.trim() || null,
    base_url: settings.baseUrl.trim() || null,
    model: settings.model.trim() || null,
    timeout: Number.isFinite(timeout) && timeout > 0 ? timeout : null
  };
}

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
  if (provider === "model_error") return "模型连接";
  return "本地规则";
}

function modelLabel(model: string | undefined): string {
  return MODEL_OPTIONS.find((item) => item.value === model)?.label ?? model ?? "";
}

function missingModelSettings(settings: ModelSettings): string[] {
  const missing: string[] = [];
  if (!settings.enabled) missing.push("启用自定义模型");
  if (!settings.baseUrl.trim()) missing.push("请求地址");
  if (!settings.model.trim()) missing.push("模型名称");
  if (!settings.apiKey.trim()) missing.push("API Key");
  return missing;
}

function nextChatId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `chat-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function titleFromText(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return "新会话";
  return text.length > 22 ? `${text.slice(0, 22)}...` : text;
}

function titleFromMessages(messages: ChatMessage[]): string {
  return titleFromText(messages.find((item) => item.role === "user")?.content ?? "");
}

function createChatSession(): ChatSession {
  return {
    id: nextChatId(),
    title: "新会话",
    messages: [],
    updatedAt: Date.now()
  };
}

function normalizeChatMessage(value: unknown): ChatMessage | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<ChatMessage>;
  if ((item.role === "user" || item.role === "assistant") && typeof item.content === "string") {
    return { role: item.role, content: item.content };
  }
  return null;
}

function normalizeChatSession(value: unknown): ChatSession | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<ChatSession>;
  const messages = Array.isArray(item.messages)
    ? item.messages.map(normalizeChatMessage).filter((message): message is ChatMessage => Boolean(message))
    : [];
  return {
    id: typeof item.id === "string" && item.id.trim() ? item.id : nextChatId(),
    title: typeof item.title === "string" && item.title.trim() ? item.title.trim() : titleFromMessages(messages),
    messages,
    updatedAt: typeof item.updatedAt === "number" && Number.isFinite(item.updatedAt) ? item.updatedAt : Date.now()
  };
}

function loadChatState(): ChatState {
  try {
    const raw = localStorage.getItem(CHAT_SESSIONS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    const sessions = Array.isArray(parsed)
      ? parsed.map(normalizeChatSession).filter((session): session is ChatSession => Boolean(session))
      : [];

    if (sessions.length === 0) {
      const session = createChatSession();
      return { sessions: [session], activeId: session.id };
    }

    const savedActiveId = localStorage.getItem(ACTIVE_CHAT_KEY);
    return {
      sessions,
      activeId: sessions.some((session) => session.id === savedActiveId) ? savedActiveId! : sessions[0].id
    };
  } catch {
    const session = createChatSession();
    return { sessions: [session], activeId: session.id };
  }
}

function chatPreview(session: ChatSession): string {
  const lastMessage = session.messages[session.messages.length - 1];
  const last = lastMessage?.content.replace(/\s+/g, " ").trim();
  if (!last) return "还没有消息";
  return last.length > 32 ? `${last.slice(0, 32)}...` : last;
}

function formatChatTime(value: number): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${month}/${day} ${hour}:${minute}`;
}

function isDivider(value: string) {
  return /^-{3,}$/.test(value) || /^\*{3,}$/.test(value);
}

function isFormulaLine(value: string) {
  const text = value.trim();
  if (text.length > 160) return false;
  if (!/[=≈∼~]/.test(text)) return false;
  return /[βεαδγθλ]|Y|X|income|log|ln|\^|²|₀|₁|₂|₃/.test(text);
}

function parseChatMarkdown(value: string): ChatMarkdownBlock[] {
  const lines = value.replace(/\r\n/g, "\n").split("\n");
  const blocks: ChatMarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const text = line.trim();

    if (!text) {
      index += 1;
      continue;
    }

    const codeStart = text.match(/^```([\w-]*)/);
    if (codeStart) {
      const language = codeStart[1] || "";
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ kind: "code", language, code: codeLines.join("\n") });
      continue;
    }

    if (text.startsWith("$$")) {
      const formulaLines: string[] = [];
      const first = text.replace(/^\$\$/, "").trim();
      if (first) formulaLines.push(first);
      index += 1;
      while (index < lines.length && !lines[index].trim().endsWith("$$")) {
        formulaLines.push(lines[index].trim());
        index += 1;
      }
      if (index < lines.length) {
        const last = lines[index].trim().replace(/\$\$$/, "").trim();
        if (last) formulaLines.push(last);
        index += 1;
      }
      blocks.push({ kind: "formula", text: formulaLines.join("\n") });
      continue;
    }

    const heading = text.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2].trim() });
      index += 1;
      continue;
    }

    if (isDivider(text)) {
      blocks.push({ kind: "rule" });
      index += 1;
      continue;
    }

    const bullet = line.match(/^(\s*)[-*]\s+(.+)$/);
    if (bullet) {
      const items: { text: string; depth: number }[] = [];
      while (index < lines.length) {
        const item = lines[index].match(/^(\s*)[-*]\s+(.+)$/);
        if (!item) break;
        items.push({
          text: item[2].trim(),
          depth: Math.min(Math.floor(item[1].length / 2), 3)
        });
        index += 1;
      }
      blocks.push({ kind: "list", items });
      continue;
    }

    if (isFormulaLine(text)) {
      blocks.push({ kind: "formula", text });
      index += 1;
      continue;
    }

    const paragraph: string[] = [text];
    index += 1;
    while (index < lines.length) {
      const next = lines[index];
      const nextText = next.trim();
      if (!nextText) break;
      if (
        nextText.startsWith("```") ||
        nextText.startsWith("$$") ||
        /^(#{1,4})\s+/.test(nextText) ||
        isDivider(nextText) ||
        /^(\s*)[-*]\s+/.test(next) ||
        isFormulaLine(nextText)
      ) {
        break;
      }
      paragraph.push(nextText);
      index += 1;
    }
    blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
  }

  return blocks;
}

function renderInline(text: string) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }
    if (part.startsWith("**") && part.endsWith("**")) {
      return <b key={index}>{part.slice(2, -2)}</b>;
    }
    return <span key={index}>{part}</span>;
  });
}

function dataFileType(fileName: string) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
  return "application/octet-stream";
}

export default function App() {
  const [health, setHealth] = useState<"checking" | "online" | "offline">("checking");
  const [file, setFile] = useState<File | null>(null);
  const [profile, setProfile] = useState<DataProfile | null>(null);
  const [question, setQuestion] = useState("");
  const [columnsInput, setColumnsInput] = useState("");
  const [dependentVariable, setDependentVariable] = useState("");
  const [independentVariables, setIndependentVariables] = useState("");
  const [entityColumn, setEntityColumn] = useState("");
  const [timeColumn, setTimeColumn] = useState("");
  const [treatmentColumn, setTreatmentColumn] = useState("");
  const [runningVariable, setRunningVariable] = useState("");
  const [instrumentVariable, setInstrumentVariable] = useState("");
  const [inference, setInference] = useState<InferVariablesResponse | null>(null);
  const [recommendation, setRecommendation] = useState<ModelRecommendation | null>(null);
  const [modelType, setModelType] = useState("OLS");
  const [runResult, setRunResult] = useState<RunModelResponse | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [chatSearch, setChatSearch] = useState("");
  const [chatHistoryOpen, setChatHistoryOpen] = useState(false);
  const [chatState, setChatState] = useState<ChatState>(() => loadChatState());
  const [pendingChatId, setPendingChatId] = useState<string | null>(null);
  const [report, setReport] = useState("");
  const [status, setStatus] = useState("就绪");
  const [busy, setBusy] = useState<BusyKey | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [modelSettings, setModelSettings] = useState<ModelSettings>(() => loadModelSettings());
  const [settingsDraft, setSettingsDraft] = useState<ModelSettings>(() => loadModelSettings());
  const chatLogRef = useRef<HTMLDivElement | null>(null);
  const chatHistoryRef = useRef<HTMLDivElement | null>(null);

  const columns = useMemo(() => splitList(columnsInput.trim() ? columnsInput : DEFAULT_COLUMNS), [columnsInput]);
  const llmConfig = useMemo(() => toLLMConfig(modelSettings), [modelSettings]);
  const currentChat = useMemo(
    () => chatState.sessions.find((session) => session.id === chatState.activeId) ?? chatState.sessions[0],
    [chatState]
  );
  const chatHistory = currentChat?.messages ?? [];
  const filteredChatSessions = useMemo(() => {
    const keyword = chatSearch.trim().toLowerCase();
    return [...chatState.sessions]
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .filter((session) => {
        if (!keyword) return true;
        const text = [session.title, ...session.messages.map((message) => message.content)].join("\n").toLowerCase();
        return text.includes(keyword);
      });
  }, [chatSearch, chatState.sessions]);

  useEffect(() => {
    getHealth()
      .then(() => setHealth("online"))
      .catch(() => setHealth("offline"));
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(CHAT_SESSIONS_KEY, JSON.stringify(chatState.sessions));
      localStorage.setItem(ACTIVE_CHAT_KEY, chatState.activeId);
    } catch {
    }
  }, [chatState]);

  useEffect(() => {
    const node = chatLogRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [busy, currentChat?.id, chatHistory.length]);

  useEffect(() => {
    if (!chatHistoryOpen) return;

    const closeHistory = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && !chatHistoryRef.current?.contains(target)) {
        setChatHistoryOpen(false);
      }
    };

    document.addEventListener("mousedown", closeHistory);
    return () => document.removeEventListener("mousedown", closeHistory);
  }, [chatHistoryOpen]);

  useEffect(() => {
    window.workbench?.onOpenModelSettings?.(() => {
      setSettingsDraft(loadModelSettings());
      setSettingsOpen(true);
    });
  }, []);

  useEffect(() => {
    window.workbench?.onDataFileSelected?.((payload) => {
      const next = new File([payload.data], payload.name, { type: dataFileType(payload.name) });
      setFile(next);
      setStatus(`已选择 ${payload.name}`);
    });
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

  function requireResearchQuestion() {
    const text = question.trim();
    if (!text) {
      setStatus("请先填写研究问题。");
      return null;
    }
    return text;
  }

  function buildRequest(researchQuestion: string): ModelRequest {
    return {
      research_question: researchQuestion,
      columns,
      dependent_variable: dependentVariable.trim() || DEFAULT_DEPENDENT_VARIABLE,
      independent_variables: splitList(independentVariables.trim() ? independentVariables : DEFAULT_INDEPENDENT_VARIABLES),
      entity_column: entityColumn || null,
      time_column: timeColumn || null,
      treatment_column: treatmentColumn || null,
      running_variable: runningVariable || null,
      instrument_variable: instrumentVariable || null,
      llm_config: llmConfig
    };
  }

  function updateModelSetting<K extends keyof ModelSettings>(key: K, value: ModelSettings[K]) {
    setSettingsDraft((current) => ({ ...current, [key]: value }));
  }

  function openModelSettings() {
    setSettingsDraft(modelSettings);
    setSettingsOpen(true);
  }

  function saveModelSettings() {
    setModelSettings(settingsDraft);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settingsDraft));
    setSettingsOpen(false);
    setStatus(settingsDraft.enabled ? "模型配置已保存。" : "已切换为本地规则。");
  }

  function resetModelSettings() {
    localStorage.removeItem(SETTINGS_KEY);
    setModelSettings(DEFAULT_MODEL_SETTINGS);
    setSettingsDraft(DEFAULT_MODEL_SETTINGS);
    setStatus("已恢复默认模型配置。");
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
      setQuestion("");
      setColumnsInput(sampleProfile.columns.map((column) => column.name).join(", "));
      setDependentVariable("");
      setIndependentVariables("");
      setModelType("OLS");
      setStatus("样例数据已加载。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "样例数据加载失败。");
    } finally {
      setBusy(null);
    }
  }

  async function infer() {
    const researchQuestion = requireResearchQuestion();
    if (!researchQuestion) return;

    setBusy("infer");
    try {
      const next = await inferVariables({
        research_question: researchQuestion,
        columns: inferenceColumns(),
        llm_config: llmConfig
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
    const researchQuestion = requireResearchQuestion();
    if (!researchQuestion) return;

    setBusy("recommend");
    try {
      const next = await recommendModel(buildRequest(researchQuestion));
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
    const researchQuestion = requireResearchQuestion();
    if (!researchQuestion) return;

    setBusy("run");
    try {
      const next = await runModel(file, buildRequest(researchQuestion), modelType);
      setRunResult(next);
      setStatus(next.success ? "模型运行完成。" : next.error ?? "模型运行已停止。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "模型运行失败。");
    } finally {
      setBusy(null);
    }
  }

  function saveChatMessages(sessionId: string, messages: ChatMessage[]) {
    setChatState((current) => ({
      ...current,
      sessions: current.sessions.map((session) => {
        if (session.id !== sessionId) return session;
        return {
          ...session,
          title: session.title === "新会话" ? titleFromMessages(messages) : session.title,
          messages,
          updatedAt: Date.now()
        };
      })
    }));
  }

  function newChat() {
    if (currentChat && currentChat.messages.length === 0) {
      setChatInput("");
      setChatSearch("");
      setChatHistoryOpen(false);
      setChatState((current) => ({ ...current, activeId: currentChat.id }));
      setStatus("已切换到空白会话。");
      return;
    }

    const session = createChatSession();
    setChatInput("");
    setChatSearch("");
    setChatHistoryOpen(false);
    setChatState((current) => ({
      sessions: [session, ...current.sessions],
      activeId: session.id
    }));
    setStatus("已新建会话。");
  }

  function openChat(sessionId: string) {
    setChatInput("");
    setChatHistoryOpen(false);
    setChatState((current) => ({ ...current, activeId: sessionId }));
    setStatus("已打开历史会话。");
  }

  async function sendChat() {
    const message = chatInput.trim();
    if (!message || !currentChat) return;

    const missing = missingModelSettings(modelSettings);
    if (missing.length > 0) {
      setSettingsDraft({ ...modelSettings, enabled: true });
      setSettingsOpen(true);
      setStatus(`请先在右上角设置里补全：${missing.join("、")}。`);
      return;
    }

    const context = {
      data_columns: columns,
      recommended_model: recommendation?.model ?? modelType,
      generated_code: recommendation?.generated_code ?? null,
      model_results: runResult?.results ?? null
    };
    const visibleHistory = [...chatHistory, { role: "user" as const, content: message }];
    const sessionId = currentChat.id;
    saveChatMessages(sessionId, visibleHistory);
    setChatInput("");
    setPendingChatId(sessionId);
    setBusy("chat");
    try {
      const response = await chat(message, chatHistory.slice(-8), context, llmConfig);
      saveChatMessages(sessionId, [...visibleHistory, { role: "assistant", content: response.reply }]);
      setStatus(response.maas_error ? `回答来源：${providerLabel(response.provider)}。${response.maas_error}` : `回答来源：${providerLabel(response.provider)}。`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "问答失败。");
    } finally {
      setPendingChatId(null);
      setBusy(null);
    }
  }

  async function makeReport() {
    const researchQuestion = requireResearchQuestion();
    if (!researchQuestion) return;

    setBusy("report");
    try {
      const response = await generateReport(researchQuestion, modelType, runResult?.results ?? null, inference?.reasoning, llmConfig);
      setReport(response.markdown);
      setStatus("报告已生成。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "报告生成失败。");
    } finally {
      setBusy(null);
    }
  }

  function reportFileBase() {
    const text = question.replace(/\s+/g, " ").trim();
    if (!text) return "分析报告";
    return text.length > 18 ? text.slice(0, 18) : text;
  }

  function downloadTextFile(fileName: string, content: string) {
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function showExportResult(result: SaveFileResult | undefined, label: string) {
    if (!result) return;
    if (result.ok) {
      setStatus(result.filePath ? `${label}已导出：${result.filePath}` : `${label}已导出。`);
      return;
    }
    if (result.canceled) {
      setStatus("已取消导出。");
      return;
    }
    setStatus(result.error || `${label}导出失败。`);
  }

  async function exportReportMd() {
    if (!report.trim()) {
      setStatus("请先生成报告。");
      return;
    }

    const fileName = `${reportFileBase()}.md`;
    try {
      if (window.workbench?.saveTextFile) {
        const result = await window.workbench.saveTextFile({ fileName, content: report });
        showExportResult(result, "Markdown");
      } else {
        downloadTextFile(fileName, report);
        setStatus("Markdown 已导出。");
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Markdown 导出失败。");
    }
  }

  async function exportReportPdf() {
    if (!report.trim()) {
      setStatus("请先生成报告。");
      return;
    }

    if (!window.workbench?.saveReportPdf) {
      setStatus("PDF 导出需要在桌面应用中使用。");
      return;
    }

    try {
      const result = await window.workbench.saveReportPdf({
        fileName: `${reportFileBase()}.pdf`,
        title: question.trim() || "分析报告",
        markdown: report
      });
      showExportResult(result, "PDF");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "PDF 导出失败。");
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="topbar-left">
          <div>
            <p className="eyebrow">计量建模小计</p>
            <h1>研究工作台</h1>
          </div>
        </div>
        <div className="topbar-actions">
          <div className="status-strip">
            <span className={`health health-${health}`} />
            <span>{health === "online" ? "后端服务在线" : health === "offline" ? "后端服务离线" : "正在检查后端"}</span>
            <span className={`model-badge ${modelSettings.enabled ? "model-badge-on" : ""}`}>
              {modelSettings.enabled ? modelSettings.model || "自定义模型" : "本地规则"}
            </span>
            <span className="status-text">{status}</span>
          </div>
          <button
            className={`icon-button settings-button ${modelSettings.enabled ? "settings-active" : ""}`}
            type="button"
            onClick={openModelSettings}
            title="模型设置"
            aria-label="模型设置"
          >
            <Settings size={18} />
          </button>
        </div>
      </header>

      {settingsOpen ? (
        <SettingsDialog
          settings={settingsDraft}
          onChange={updateModelSetting}
          onSave={saveModelSettings}
          onReset={resetModelSettings}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}

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
            <textarea
              className="question-input"
              value={question}
              placeholder={DEFAULT_QUESTION}
              onChange={(event) => setQuestion(event.target.value)}
              rows={4}
            />
            <label>字段列表</label>
            <input
              className="columns-input"
              value={columnsInput}
              placeholder={DEFAULT_COLUMNS}
              onChange={(event) => setColumnsInput(event.target.value)}
            />
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
            <input
              className="dependent-input"
              value={dependentVariable}
              placeholder={DEFAULT_DEPENDENT_VARIABLE}
              onChange={(event) => setDependentVariable(event.target.value)}
            />
            <label>解释变量 X</label>
            <input
              className="independent-input"
              value={independentVariables}
              placeholder={DEFAULT_INDEPENDENT_VARIABLES}
              onChange={(event) => setIndependentVariables(event.target.value)}
            />
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
            <div className="chat-tools">
              <button className="secondary chat-new-button" type="button" onClick={newChat} title="新建会话">
                <Plus size={15} />
                <span>新会话</span>
              </button>
              <div className="chat-history-wrap" ref={chatHistoryRef}>
                <button
                  className={`secondary chat-history-button ${chatHistoryOpen ? "chat-history-open" : ""}`}
                  type="button"
                  onClick={() => setChatHistoryOpen((open) => !open)}
                  title="查看历史对话"
                >
                  <Search size={15} />
                  <span>历史对话</span>
                  <ChevronDown size={14} />
                </button>
                {chatHistoryOpen ? (
                  <div className="chat-history-popover">
                    <label className="chat-search-field" title="查找历史对话">
                      <Search size={15} />
                      <input
                        value={chatSearch}
                        placeholder="搜索历史对话"
                        onChange={(event) => setChatSearch(event.target.value)}
                      />
                    </label>
                    {filteredChatSessions.length > 0 ? (
                      <div className="chat-session-list">
                        {filteredChatSessions.map((session) => (
                          <button
                            className={`chat-session ${session.id === currentChat?.id ? "chat-session-active" : ""}`}
                            type="button"
                            key={session.id}
                            onClick={() => openChat(session.id)}
                            title={session.title}
                          >
                            <strong>{session.title}</strong>
                            <span>{formatChatTime(session.updatedAt)} · {chatPreview(session)}</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="chat-session-empty">没有找到相关历史。</div>
                    )}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="chat-log" ref={chatLogRef}>
              {chatHistory.length === 0 ? <div className="empty">还没有对话。</div> : null}
              {chatHistory.map((item, index) => (
                <div className={`chat-item chat-${item.role}`} key={`${item.role}-${index}`}>
                  <strong>{item.role === "user" ? "我" : "小计"}</strong>
                  <ChatMessageBody message={item} />
                </div>
              ))}
              {busy === "chat" && pendingChatId === currentChat?.id ? <ThinkingMessage /> : null}
            </div>
            <div className="send-row">
              <input
                className="chat-input"
                value={chatInput}
                placeholder={CHAT_PLACEHOLDER}
                onChange={(event) => setChatInput(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && sendChat()}
              />
              <button type="button" onClick={sendChat} disabled={busy === "chat"} title="发送">
                <Send size={16} />
              </button>
            </div>
          </Panel>

          <Panel title="分析报告" icon={<FileText size={17} />}>
            <div className="report-actions">
              <button type="button" onClick={makeReport} disabled={busy === "report"}>
                <FileText size={16} />
                <span>生成报告</span>
              </button>
              <button className="secondary" type="button" onClick={exportReportMd} disabled={!report.trim()}>
                <Download size={16} />
                <span>导出 MD</span>
              </button>
              <button className="secondary" type="button" onClick={exportReportPdf} disabled={!report.trim()}>
                <Download size={16} />
                <span>导出 PDF</span>
              </button>
            </div>
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

function ChatMessageBody({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return <p className="chat-text">{message.content}</p>;
  }

  const blocks = parseChatMarkdown(message.content);
  return (
    <div className="chat-markdown">
      {blocks.map((block, index) => {
        if (block.kind === "heading") {
          const levelClass = block.level <= 2 ? "chat-heading-main" : "chat-heading";
          return <h3 className={levelClass} key={index}>{renderInline(block.text)}</h3>;
        }
        if (block.kind === "list") {
          return (
            <ul className="chat-list" key={index}>
              {block.items.map((item, itemIndex) => (
                <li className={`chat-list-depth-${item.depth}`} key={`${index}-${itemIndex}`}>
                  {renderInline(item.text)}
                </li>
              ))}
            </ul>
          );
        }
        if (block.kind === "code") {
          return (
            <div className="chat-code-block" key={index}>
              <div className="chat-code-head">{block.language || "代码"}</div>
              <pre><code>{block.code}</code></pre>
            </div>
          );
        }
        if (block.kind === "formula") {
          return (
            <div className="chat-formula" key={index}>
              <code>{block.text}</code>
            </div>
          );
        }
        if (block.kind === "rule") {
          return <hr key={index} />;
        }
        return <p key={index}>{renderInline(block.text)}</p>;
      })}
    </div>
  );
}

function ThinkingMessage() {
  return (
    <div className="chat-item chat-assistant chat-thinking">
      <strong>小计</strong>
      <span className="thinking-line">
        正在思考
        <span className="thinking-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </span>
    </div>
  );
}

function SettingsDialog({
  settings,
  onChange,
  onSave,
  onReset,
  onClose
}: {
  settings: ModelSettings;
  onChange: <K extends keyof ModelSettings>(key: K, value: ModelSettings[K]) => void;
  onSave: () => void;
  onReset: () => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="settings-head">
          <div>
            <p className="eyebrow">模型连接</p>
            <h2 id="settings-title">设置</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} title="关闭" aria-label="关闭">
            <X size={18} />
          </button>
        </div>

        <div className="settings-switch">
          <label className="toggle-field">
            <input type="checkbox" checked={settings.enabled} onChange={(event) => onChange("enabled", event.target.checked)} />
            <span>启用自定义模型</span>
          </label>
          <span className="settings-mode">{settings.enabled ? "自定义模型" : "本地规则"}</span>
        </div>

        <div className="settings-form">
          <label className="field">
            <span>请求地址</span>
            <input
              value={settings.baseUrl}
              placeholder="https://api.example.com/v1"
              onChange={(event) => onChange("baseUrl", event.target.value)}
            />
          </label>
          <label className="field">
            <span>模型名称</span>
            <input
              value={settings.model}
              placeholder="deepseek-chat"
              onChange={(event) => onChange("model", event.target.value)}
            />
          </label>
          <label className="field">
            <span>API Key</span>
            <input
              value={settings.apiKey}
              type="password"
              placeholder="sk-..."
              onChange={(event) => onChange("apiKey", event.target.value)}
            />
          </label>
          <label className="field">
            <span>超时秒数</span>
            <input
              value={settings.timeout}
              min="5"
              step="1"
              type="number"
              onChange={(event) => onChange("timeout", event.target.value)}
            />
          </label>
        </div>

        <div className="settings-note">配置仅保存在当前电脑；打开开关后生效。</div>

        <div className="settings-actions">
          <button className="secondary" type="button" onClick={onReset}>
            <RotateCcw size={16} />
            <span>恢复默认</span>
          </button>
          <button type="button" onClick={onSave}>
            <Save size={16} />
            <span>保存</span>
          </button>
        </div>
      </section>
    </div>
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
