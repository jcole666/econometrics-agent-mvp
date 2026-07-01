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
import katex from "katex";
import "katex/dist/katex.min.css";
import { ChangeEvent, CSSProperties, PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";

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
  ChatContext,
  ChatMessage,
  CoefficientResult,
  DataProfile,
  InferVariablesResponse,
  LLMConfig,
  ModelRecommendation,
  ModelRequest,
  RelationshipHint,
  RunModelResponse
} from "./types";

const DEFAULT_QUESTION = "数字经济发展是否会提升城市创新水平？";
const DEFAULT_COLUMNS = "city, province, region, year, innovation_index, digital_economy_index, broadband_access, fiscal_science_spending, human_capital, industrial_upgrade, population_density, smart_city_pilot, green_patent_share";
const DEFAULT_DEPENDENT_VARIABLE = "innovation_index";
const DEFAULT_INDEPENDENT_VARIABLES = "digital_economy_index, broadband_access, fiscal_science_spending, human_capital, industrial_upgrade, population_density";
const QUESTION_PLACEHOLDER = `例如：${DEFAULT_QUESTION}`;
const COLUMNS_PLACEHOLDER = `例如：${DEFAULT_COLUMNS}`;
const DEPENDENT_VARIABLE_PLACEHOLDER = `例如：${DEFAULT_DEPENDENT_VARIABLE}`;
const INDEPENDENT_VARIABLES_PLACEHOLDER = `例如：${DEFAULT_INDEPENDENT_VARIABLES}`;
const CHAT_PLACEHOLDER = "为什么推荐这个模型？";
const SETTINGS_KEY = "econometrics-agent.model-settings";
const CHAT_SESSIONS_KEY = "econometrics-agent.chat-sessions";
const ACTIVE_CHAT_KEY = "econometrics-agent.active-chat";
const LAYOUT_WIDTHS_KEY = "econometrics-agent.layout-widths";

const DEFAULT_RAIL_WIDTHS = { left: 330, right: 360 };
const MIN_LEFT_RAIL = 280;
const MIN_MAIN_RAIL = 420;
const MIN_RIGHT_RAIL = 320;
const COLUMN_RESIZER_WIDTH = 12;

type BusyKey = "profile" | "infer" | "recommend" | "run" | "chat" | "report" | "sample";
type ResizeEdge = "left" | "right";
type CheckpointTarget = "question" | "data" | "variables" | "recommendation" | "risk";

interface RailWidths {
  left: number;
  right: number;
}

interface ResizeSession {
  edge: ResizeEdge;
  startX: number;
  left: number;
  right: number;
}

interface ResearchPath {
  question: string;
  questionCandidates: string[];
  structure: string;
  outcome: string;
  coreVariables: string[];
  controls: string[];
  model: string;
  assumptions: string[];
  risks: string[];
  nextSteps: string[];
}

interface CollaborationCheckpoint {
  id: string;
  target: CheckpointTarget;
  title: string;
  detail: string;
  badge: string;
}

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
  | { kind: "table"; headers: string[]; rows: string[][] }
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

function clamp(value: number, min: number, max: number): number {
  const upper = Math.max(min, max);
  return Math.min(Math.max(value, min), upper);
}

function readableWidth(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function fitRailWidths(widths: RailWidths, railSpace: number): RailWidths {
  let left = Math.max(MIN_LEFT_RAIL, readableWidth(widths.left, DEFAULT_RAIL_WIDTHS.left));
  let right = Math.max(MIN_RIGHT_RAIL, readableWidth(widths.right, DEFAULT_RAIL_WIDTHS.right));

  if (!Number.isFinite(railSpace) || railSpace <= 0) {
    return { left, right };
  }

  const sideSpace = railSpace - MIN_MAIN_RAIL;
  if (sideSpace < MIN_LEFT_RAIL + MIN_RIGHT_RAIL) {
    return { left: MIN_LEFT_RAIL, right: MIN_RIGHT_RAIL };
  }

  right = clamp(right, MIN_RIGHT_RAIL, sideSpace - MIN_LEFT_RAIL);
  left = clamp(left, MIN_LEFT_RAIL, sideSpace - right);
  return { left, right };
}

function loadRailWidths(): RailWidths {
  try {
    const raw = localStorage.getItem(LAYOUT_WIDTHS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return fitRailWidths(
      {
        left: readableWidth(parsed.left, DEFAULT_RAIL_WIDTHS.left),
        right: readableWidth(parsed.right, DEFAULT_RAIL_WIDTHS.right)
      },
      0
    );
  } catch {
    return DEFAULT_RAIL_WIDTHS;
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

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "0%";
  }
  return `${(value * 100).toFixed(value > 0 && value < 0.01 ? 1 : 0)}%`;
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

function firstExistingColumn(profile: DataProfile, names: string[]): string | null {
  const available = new Set(profile.columns.map((column) => column.name));
  return names.find((name) => available.has(name)) ?? null;
}

function fallbackOutcome(profile: DataProfile): string {
  return (
    firstExistingColumn(profile, ["innovation_index", "income", "employment", "gdp", "score"]) ??
    profile.columns.find((column) => column.kind === "数值")?.name ??
    DEFAULT_DEPENDENT_VARIABLE
  );
}

function fallbackCoreVariables(profile: DataProfile, outcome: string): string[] {
  const preferred = [
    "digital_economy_index",
    "broadband_access",
    "fiscal_science_spending",
    "human_capital",
    "industrial_upgrade",
    "population_density",
    "smart_city_pilot",
  ];
  const picked = preferred.filter((name) => profile.columns.some((column) => column.name === name && name !== outcome));
  if (picked.length) return picked;

  return profile.columns
    .filter((column) => column.name !== outcome && (column.kind === "数值" || column.kind === "二元/布尔"))
    .map((column) => column.name)
    .slice(0, 5);
}

function questionCandidates(profile: DataProfile, outcome: string, coreVariables: string[]): string[] {
  const hasCityDemo = Boolean(firstExistingColumn(profile, ["digital_economy_index"])) && outcome === "innovation_index";
  if (hasCityDemo) {
    return [
      "数字经济发展是否会提升城市创新水平？",
      "智慧城市试点后，城市创新指数是否出现更快增长？",
      "数字基础设施、财政科技支出和人力资本中，哪类因素更能解释城市创新差异？",
    ];
  }

  const core = coreVariables[0] ?? "核心解释变量";
  return [
    `${core} 与 ${outcome} 是否存在稳定关系？`,
    `在加入控制变量后，${core} 对 ${outcome} 的关系是否仍然明显？`,
    `不同个体或时期之间，${outcome} 的变化是否具有结构性差异？`,
  ];
}

function structureSummary(profile: DataProfile, entityColumn: string | null, timeColumn: string | null): string {
  const panel = profile.diagnostics?.panel_hint;
  if (panel) {
    return `识别到 ${panel.entity_column} × ${panel.time_column} 面板结构：${panel.units} 个个体、${panel.periods} 期，${panel.is_balanced ? "平衡面板" : `缺 ${panel.missing_cells} 个观测格`}。`;
  }
  if (entityColumn && timeColumn) {
    return `已配置 ${entityColumn} × ${timeColumn} 面板结构，可进一步确认是否加入个体和时间固定效应。`;
  }
  return `当前数据包含 ${profile.rows} 行、${profile.columns_count} 个字段，适合先做变量识别和数据质量核查。`;
}

function modelFromPath(modelType: string, recommendation: ModelRecommendation | null, entityColumn: string | null, timeColumn: string | null): string {
  if (recommendation?.model) return recommendation.model;
  if (entityColumn && timeColumn) return "Panel Fixed Effects";
  return modelType || "OLS";
}

function assumptionsForModel(model: string): string[] {
  if (model === "Panel Fixed Effects") {
    return ["个体固定效应能够吸收不随时间变化的城市特征", "年份冲击需要通过时间固定效应或年份变量控制", "核心解释变量仍需满足严格外生性假设"];
  }
  if (model === "DID") {
    return ["处理组和对照组在政策前具有可比趋势", "政策实施时间和处理状态定义清楚", "需要检查是否存在提前反应或其他同期政策冲击"];
  }
  if (model === "Logit") {
    return ["被解释变量应为 0/1 结果", "需要关注类别不平衡和边际效应解释", "线性概率模型可作为可解释性对照"];
  }
  if (model === "IV-2SLS") {
    return ["工具变量要与内生解释变量相关", "工具变量不能直接影响结果变量", "需要报告弱工具变量检验"];
  }
  return ["解释变量与误差项外生", "函数形式设定合理", "建议使用稳健标准误并检查多重共线性"];
}

function risksFromProfile(profile: DataProfile, model: string): string[] {
  const warnings = profile.diagnostics?.modeling_warnings.map((item) => `${item.name}：${item.reason}`) ?? [];
  const risks = warnings.slice(0, 3);

  if (model === "Panel Fixed Effects") {
    risks.push("面板固定效应可以降低遗漏的时间不变因素影响，但不能自动解决反向因果。");
  } else {
    risks.push("当前路径首先支持相关性分析，若要做因果解释，需要补充识别策略。");
  }

  if (profile.diagnostics?.outlier_columns.length) {
    risks.push("部分数值字段存在 IQR 异常值，建模前需要确认是否截尾或保留。");
  }
  return risks;
}

function nextStepsForPath(model: string): string[] {
  if (model === "Panel Fixed Effects") {
    return ["确认城市和年份固定效应设定", "准备聚类稳健标准误", "比较加入/不加入控制变量时核心系数是否稳定"];
  }
  if (model === "DID") {
    return ["画出政策前趋势", "确认处理组和对照组定义", "设计安慰剂检验或事件研究图"];
  }
  return ["确认 Y 和核心 X", "检查缺失值和异常值处理", "准备稳健性检验和替代变量设定"];
}

function buildResearchPath({
  profile,
  question,
  dependentVariable,
  independentVariables,
  entityColumn,
  timeColumn,
  modelType,
  recommendation,
}: {
  profile: DataProfile | null;
  question: string;
  dependentVariable: string;
  independentVariables: string;
  entityColumn: string;
  timeColumn: string;
  modelType: string;
  recommendation: ModelRecommendation | null;
}): ResearchPath | null {
  if (!profile) return null;

  const panel = profile.diagnostics?.panel_hint;
  const entity = entityColumn.trim() || panel?.entity_column || null;
  const time = timeColumn.trim() || panel?.time_column || null;
  const outcome = dependentVariable.trim() || fallbackOutcome(profile);
  const coreVariables = splitList(independentVariables).length ? splitList(independentVariables) : fallbackCoreVariables(profile, outcome);
  const model = modelFromPath(modelType, recommendation, entity, time);

  return {
    question: question.trim() || DEFAULT_QUESTION,
    questionCandidates: questionCandidates(profile, outcome, coreVariables),
    structure: structureSummary(profile, entity, time),
    outcome,
    coreVariables: coreVariables.slice(0, 3),
    controls: coreVariables.slice(3, 8),
    model,
    assumptions: assumptionsForModel(model),
    risks: risksFromProfile(profile, model),
    nextSteps: nextStepsForPath(model),
  };
}

function buildCollaborationCheckpoints({
  profile,
  path,
  question,
  dependentVariable,
  independentVariables,
  recommendation,
}: {
  profile: DataProfile | null;
  path: ResearchPath | null;
  question: string;
  dependentVariable: string;
  independentVariables: string;
  recommendation: ModelRecommendation | null;
}): CollaborationCheckpoint[] {
  const checkpoints: CollaborationCheckpoint[] = [];
  const hasQuestion = Boolean(question.trim());
  const hasVariables = Boolean(dependentVariable.trim() && independentVariables.trim());

  checkpoints.push({
    id: "question",
    target: "question",
    title: "研究问题",
    detail: hasQuestion ? question.trim() : "先把问题写成“X 是否影响 Y”的形式。",
    badge: hasQuestion ? "待确认" : "待填写"
  });

  checkpoints.push({
    id: "data",
    target: "data",
    title: "数据结构",
    detail: path?.structure ?? "先加载数据并生成字段画像。",
    badge: profile ? "已画像" : "待画像"
  });

  checkpoints.push({
    id: "variables",
    target: "variables",
    title: "变量设定",
    detail: hasVariables
      ? `Y：${dependentVariable.trim()}；X：${splitList(independentVariables).slice(0, 4).join(", ")}`
      : "先确认被解释变量和核心解释变量。",
    badge: hasVariables ? "待确认" : "待补全"
  });

  checkpoints.push({
    id: "recommendation",
    target: "recommendation",
    title: "识别策略",
    detail: recommendation?.reason ?? (path ? `当前倾向：${modelLabel(path.model)}` : "生成模型推荐后再确认识别策略。"),
    badge: recommendation ? modelLabel(recommendation.model) : "待推荐"
  });

  checkpoints.push({
    id: "risk",
    target: "risk",
    title: "风险边界",
    detail: path?.risks[0] ?? "确认缺失、异常值、内生性和因果解释边界。",
    badge: "需确认"
  });

  return checkpoints;
}

function buildReportNotes({
  profile,
  path,
  recommendation,
  inferenceReasoning
}: {
  profile: DataProfile | null;
  path: ResearchPath | null;
  recommendation: ModelRecommendation | null;
  inferenceReasoning?: string | null;
}): string {
  const lines: string[] = [];

  if (profile?.diagnostics) {
    const diagnostics = profile.diagnostics;
    const panel = diagnostics.panel_hint;
    lines.push(`- 数据概览：${profile.rows} 行、${profile.columns_count} 列，总缺失率 ${formatPercent(diagnostics.missing_rate)}，重复行 ${diagnostics.duplicate_rows} 行。`);

    if (panel) {
      lines.push(`- 结构判断：数据接近 ${panel.entity_column} × ${panel.time_column} 的${panel.is_balanced ? "平衡" : "非平衡"}面板。`);
    }

    if (diagnostics.relationship_hints?.length) {
      const hints = diagnostics.relationship_hints.slice(0, 3).map((item) => (
        `${item.left} 与 ${item.right} ${item.direction}(${item.method}=${item.score.toFixed(3)})`
      ));
      lines.push(`- 关系线索：${hints.join("；")}。这些线索用于提出问题，不直接代表因果结论。`);
    }
  }

  if (path) {
    lines.push(`- 研究路径：当前主线为“${path.question}”，建议下一步关注：${path.nextSteps.slice(0, 3).join("；")}。`);
    if (path.risks.length) {
      lines.push(`- 风险边界：${path.risks.slice(0, 3).join("；")}。`);
    }
  }

  if (recommendation) {
    lines.push(`- 模型推荐：${modelLabel(recommendation.model)}。${recommendation.reason}`);
  }

  if (inferenceReasoning?.trim()) {
    lines.push(`- 变量识别：${inferenceReasoning.trim()}`);
  }

  return lines.join("\n");
}

function buildDataSummary(profile: DataProfile | null): string | null {
  if (!profile?.diagnostics) return null;

  const diagnostics = profile.diagnostics;
  const parts = [
    `${profile.rows} 行`,
    `${profile.columns_count} 列`,
    `缺失率 ${formatPercent(diagnostics.missing_rate)}`,
    `重复行 ${diagnostics.duplicate_rows}`
  ];

  if (diagnostics.panel_hint) {
    const panel = diagnostics.panel_hint;
    parts.push(`${panel.entity_column} × ${panel.time_column}，${panel.is_balanced ? "平衡面板" : `缺 ${panel.missing_cells} 个观测格`}`);
  }

  return parts.join("；");
}

function buildChatContext({
  columns,
  profile,
  path,
  recommendation,
  modelType,
  runResult,
  dependentVariable,
  independentVariables,
  entityColumn,
  timeColumn,
}: {
  columns: string[];
  profile: DataProfile | null;
  path: ResearchPath | null;
  recommendation: ModelRecommendation | null;
  modelType: string;
  runResult: RunModelResponse | null;
  dependentVariable: string;
  independentVariables: string;
  entityColumn: string;
  timeColumn: string;
}): ChatContext {
  return {
    data_columns: columns,
    data_summary: buildDataSummary(profile),
    variable_settings: {
      dependent_variable: dependentVariable.trim() || null,
      independent_variables: splitList(independentVariables),
      entity_column: entityColumn.trim() || null,
      time_column: timeColumn.trim() || null,
    },
    relationship_hints: profile?.diagnostics?.relationship_hints?.slice(0, 5) ?? [],
    research_path: path
      ? {
          question: path.question,
          structure: path.structure,
          model: path.model,
          next_steps: path.nextSteps,
          risks: path.risks,
        }
      : null,
    recommended_model: recommendation?.model ?? modelType,
    generated_code: recommendation?.generated_code ?? null,
    model_results: runResult?.results ?? null
  };
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
  return /[βεαδγθλ]|\\[a-zA-Z]+|Y|X|income|log|ln|\^|²|₀|₁|₂|₃/.test(text);
}

function latexEnvironmentName(value: string) {
  return value.trim().match(/^\\begin\{([^}]+)\}/)?.[1] ?? null;
}

function isTableRow(value: string) {
  const text = value.trim();
  return text.startsWith("|") && text.endsWith("|") && text.slice(1, -1).includes("|");
}

function parseTableCells(value: string) {
  return value
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isTableSeparator(value: string) {
  if (!isTableRow(value)) return false;
  const cells = parseTableCells(value);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
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

    if (text.startsWith("\\[")) {
      const formulaLines: string[] = [];
      const first = text.replace(/^\\\[/, "").trim();
      if (first && first !== "\\]") formulaLines.push(first);
      index += 1;
      while (index < lines.length && !lines[index].trim().endsWith("\\]")) {
        formulaLines.push(lines[index].trim());
        index += 1;
      }
      if (index < lines.length) {
        const last = lines[index].trim().replace(/\\\]$/, "").trim();
        if (last) formulaLines.push(last);
        index += 1;
      }
      blocks.push({ kind: "formula", text: formulaLines.join("\n") });
      continue;
    }

    const environmentName = latexEnvironmentName(text);
    if (environmentName) {
      const formulaLines = [text];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith(`\\end{${environmentName}}`)) {
        formulaLines.push(lines[index].trim());
        index += 1;
      }
      if (index < lines.length) {
        formulaLines.push(lines[index].trim());
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

    if (isTableRow(text) && index + 1 < lines.length && isTableSeparator(lines[index + 1].trim())) {
      const headers = parseTableCells(text);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && isTableRow(lines[index].trim()) && !isTableSeparator(lines[index].trim())) {
        const cells = parseTableCells(lines[index]);
        rows.push(headers.map((_, cellIndex) => cells[cellIndex] ?? ""));
        index += 1;
      }
      blocks.push({ kind: "table", headers, rows });
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
        nextText.startsWith("\\[") ||
        Boolean(latexEnvironmentName(nextText)) ||
        /^(#{1,4})\s+/.test(nextText) ||
        isDivider(nextText) ||
        isTableRow(nextText) ||
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

function renderMathHtml(value: string, displayMode: boolean) {
  try {
    return katex.renderToString(value, {
      displayMode,
      throwOnError: false,
      strict: false,
      trust: false
    });
  } catch {
    return "";
  }
}

function InlineMath({ value }: { value: string }) {
  const html = renderMathHtml(value, false);
  if (!html) return <code>{value}</code>;
  return <span className="inline-math" dangerouslySetInnerHTML={{ __html: html }} />;
}

function BlockMath({ value }: { value: string }) {
  const html = renderMathHtml(value, true);
  if (!html) return <code>{value}</code>;
  return <div className="math-html" dangerouslySetInnerHTML={{ __html: html }} />;
}

function renderInline(text: string) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\\\(.+?\\\)|\$[^$\n]+\$)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }
    if (part.startsWith("**") && part.endsWith("**")) {
      return <b key={index}>{part.slice(2, -2)}</b>;
    }
    if (part.startsWith("\\(") && part.endsWith("\\)")) {
      return <InlineMath key={index} value={part.slice(2, -2)} />;
    }
    if (part.startsWith("$") && part.endsWith("$")) {
      return <InlineMath key={index} value={part.slice(1, -1)} />;
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
  const [recommendationNotice, setRecommendationNotice] = useState<string | null>(null);
  const [modelType, setModelType] = useState("OLS");
  const [runResult, setRunResult] = useState<RunModelResponse | null>(null);
  const [runNotice, setRunNotice] = useState<string | null>(null);
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
  const [railWidths, setRailWidths] = useState<RailWidths>(() => loadRailWidths());
  const [resizeEdge, setResizeEdge] = useState<ResizeEdge | null>(null);
  const [confirmedCheckpoints, setConfirmedCheckpoints] = useState<string[]>([]);
  const workspaceRef = useRef<HTMLElement | null>(null);
  const resizeSessionRef = useRef<ResizeSession | null>(null);
  const chatLogRef = useRef<HTMLDivElement | null>(null);
  const chatHistoryRef = useRef<HTMLDivElement | null>(null);
  const questionInputRef = useRef<HTMLTextAreaElement | null>(null);
  const columnsInputRef = useRef<HTMLInputElement | null>(null);
  const dependentInputRef = useRef<HTMLInputElement | null>(null);
  const independentInputRef = useRef<HTMLInputElement | null>(null);

  const columns = useMemo(() => splitList(columnsInput.trim() ? columnsInput : DEFAULT_COLUMNS), [columnsInput]);
  const llmConfig = useMemo(() => toLLMConfig(modelSettings), [modelSettings]);
  const currentChat = useMemo(
    () => chatState.sessions.find((session) => session.id === chatState.activeId) ?? chatState.sessions[0],
    [chatState]
  );
  const chatHistory = currentChat?.messages ?? [];
  const workspaceStyle = {
    "--left-rail-width": `${railWidths.left}px`,
    "--right-rail-width": `${railWidths.right}px`,
    "--left-rail-min": `${MIN_LEFT_RAIL}px`,
    "--main-rail-min": `${MIN_MAIN_RAIL}px`,
    "--right-rail-min": `${MIN_RIGHT_RAIL}px`
  } as CSSProperties;
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
  const researchPath = useMemo(
    () =>
      buildResearchPath({
        profile,
        question,
        dependentVariable,
        independentVariables,
        entityColumn,
        timeColumn,
        modelType,
        recommendation,
      }),
    [dependentVariable, entityColumn, independentVariables, modelType, profile, question, recommendation, timeColumn]
  );
  const collaborationCheckpoints = useMemo(
    () =>
      buildCollaborationCheckpoints({
        profile,
        path: researchPath,
        question,
        dependentVariable,
        independentVariables,
        recommendation,
      }),
    [dependentVariable, independentVariables, profile, question, recommendation, researchPath]
  );

  function workspaceRailSpace() {
    const node = workspaceRef.current;
    if (!node) return 0;

    const rect = node.getBoundingClientRect();
    const style = window.getComputedStyle(node);
    const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    return Math.max(0, rect.width - padding - COLUMN_RESIZER_WIDTH * 2);
  }

  function startColumnResize(edge: ResizeEdge, event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;

    event.preventDefault();
    resizeSessionRef.current = {
      edge,
      startX: event.clientX,
      left: railWidths.left,
      right: railWidths.right
    };
    setResizeEdge(edge);
    document.body.classList.add("resizing-columns");
  }

  useEffect(() => {
    getHealth()
      .then(() => setHealth("online"))
      .catch(() => setHealth("offline"));
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(LAYOUT_WIDTHS_KEY, JSON.stringify(railWidths));
    } catch {
    }
  }, [railWidths]);

  useEffect(() => {
    setConfirmedCheckpoints([]);
  }, [dependentVariable, entityColumn, independentVariables, instrumentVariable, profile, question, recommendation?.model, runningVariable, timeColumn, treatmentColumn]);

  useEffect(() => {
    const fitToWindow = () => {
      setRailWidths((current) => fitRailWidths(current, workspaceRailSpace()));
    };

    const moveResize = (event: PointerEvent) => {
      const session = resizeSessionRef.current;
      if (!session) return;

      const railSpace = workspaceRailSpace();
      const dx = event.clientX - session.startX;

      if (session.edge === "left") {
        const maxLeft = railSpace - session.right - MIN_MAIN_RAIL;
        setRailWidths((current) => ({
          ...current,
          left: clamp(session.left + dx, MIN_LEFT_RAIL, maxLeft)
        }));
        return;
      }

      const maxRight = railSpace - session.left - MIN_MAIN_RAIL;
      setRailWidths((current) => ({
        ...current,
        right: clamp(session.right - dx, MIN_RIGHT_RAIL, maxRight)
      }));
    };

    const stopResize = () => {
      if (!resizeSessionRef.current) return;
      resizeSessionRef.current = null;
      setResizeEdge(null);
      document.body.classList.remove("resizing-columns");
    };

    window.addEventListener("pointermove", moveResize);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
    window.addEventListener("resize", fitToWindow);
    window.addEventListener("blur", stopResize);
    fitToWindow();

    return () => {
      window.removeEventListener("pointermove", moveResize);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
      window.removeEventListener("resize", fitToWindow);
      window.removeEventListener("blur", stopResize);
      document.body.classList.remove("resizing-columns");
    };
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
      setRunNotice(null);
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
    setRunNotice(null);
    setStatus(next ? `已选择 ${next.name}` : "就绪");
  }

  function updateQuestion(value: string) {
    setQuestion(value);
    setRecommendationNotice(null);
    setRunNotice(null);
  }

  function toggleCheckpoint(id: string) {
    setConfirmedCheckpoints((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
  }

  function focusCheckpointTarget(target: CheckpointTarget) {
    if (target === "question") {
      questionInputRef.current?.focus();
      setStatus("请确认研究问题。");
      return;
    }

    if (target === "data") {
      if (!file) {
        setStatus("先选择数据文件，或加载样例数据。");
        return;
      }
      columnsInputRef.current?.focus();
      setStatus(profile ? "字段画像已生成，可以继续确认数据结构。" : "点击“生成字段画像”查看数据结构。");
      return;
    }

    if (target === "variables") {
      const targetInput = dependentVariable.trim() ? independentInputRef.current : dependentInputRef.current;
      targetInput?.focus();
      setStatus("请确认变量设定。");
      return;
    }

    if (target === "recommendation") {
      setStatus(recommendation ? "请检查模型推荐和识别策略。" : "点击“推荐模型”生成识别策略建议。");
      return;
    }

    setStatus("请确认风险边界，必要时回到变量配置或继续追问小计。");
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

  function applySampleState(sampleFile: File, sampleProfile: DataProfile, demo: boolean) {
    setFile(sampleFile);
    setProfile(sampleProfile);
    setQuestion(demo ? DEFAULT_QUESTION : "");
    setColumnsInput(sampleProfile.columns.map((column) => column.name).join(", "));
    setDependentVariable(demo ? DEFAULT_DEPENDENT_VARIABLE : "");
    setIndependentVariables(demo ? DEFAULT_INDEPENDENT_VARIABLES : "");
    setEntityColumn(demo ? "city" : "");
    setTimeColumn(demo ? "year" : "");
    setTreatmentColumn("");
    setRunningVariable("");
    setInstrumentVariable("");
    setModelType(demo ? "Panel Fixed Effects" : "OLS");
    setInference(null);
    setRecommendation(null);
    setRecommendationNotice(null);
    setRunResult(null);
    setRunNotice(null);
    setReport("");
  }

  async function loadSample() {
    setBusy("sample");
    try {
      const [sampleFile, sampleProfile] = await Promise.all([loadSampleFile(), loadSampleProfile()]);
      applySampleState(sampleFile, sampleProfile, false);
      setStatus("样例数据已加载。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "样例数据加载失败。");
    } finally {
      setBusy(null);
    }
  }

  async function loadDemoScenario() {
    setBusy("sample");
    try {
      const [sampleFile, sampleProfile] = await Promise.all([loadSampleFile(), loadSampleProfile()]);
      applySampleState(sampleFile, sampleProfile, true);
      try {
        const next = await recommendModel({
          research_question: DEFAULT_QUESTION,
          columns: sampleProfile.columns.map((column) => column.name),
          dependent_variable: DEFAULT_DEPENDENT_VARIABLE,
          independent_variables: splitList(DEFAULT_INDEPENDENT_VARIABLES),
          entity_column: "city",
          time_column: "year",
          treatment_column: null,
          running_variable: null,
          instrument_variable: null,
          llm_config: { enabled: false }
        });
        setRecommendation(next);
        setModelType(next.model);
        setStatus("演示场景已准备好，模型推荐已生成。");
      } catch {
        setStatus("演示场景已准备好，模型推荐可手动生成。");
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "演示场景加载失败。");
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
    if (!researchQuestion) {
      setRecommendationNotice("请先填写研究问题，再生成模型推荐。");
      return;
    }

    setBusy("recommend");
    setRecommendationNotice(null);
    try {
      const next = await recommendModel(buildRequest(researchQuestion));
      setRecommendation(next);
      setModelType(next.model);
      setStatus("模型推荐已生成。");
    } catch (error) {
      const message = error instanceof Error ? error.message : "模型推荐失败。";
      setRecommendationNotice(message);
      setStatus(message);
    } finally {
      setBusy(null);
    }
  }

  async function run() {
    if (!file) {
      const message = "请先加载样例数据或选择一个数据文件，模型结果需要真实数据才能计算。";
      setRunNotice(message);
      setStatus(message);
      return;
    }
    const researchQuestion = requireResearchQuestion();
    if (!researchQuestion) {
      setRunNotice("请先填写研究问题，再运行模型。");
      return;
    }

    setBusy("run");
    setRunNotice(null);
    try {
      const next = await runModel(file, buildRequest(researchQuestion), modelType);
      setRunResult(next);
      setStatus(next.success ? "模型运行完成。" : next.error ?? "模型运行已停止。");
    } catch (error) {
      const message = error instanceof Error ? error.message : "模型运行失败。";
      setRunNotice(message);
      setStatus(message);
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

    const context = buildChatContext({
      columns,
      profile,
      path: researchPath,
      recommendation,
      modelType,
      runResult,
      dependentVariable,
      independentVariables,
      entityColumn,
      timeColumn,
    });
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
      const notes = buildReportNotes({
        profile,
        path: researchPath,
        recommendation,
        inferenceReasoning: inference?.reasoning
      });
      const response = await generateReport(researchQuestion, modelType, runResult?.results ?? null, notes, llmConfig);
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

      <section className="workspace" ref={workspaceRef} style={workspaceStyle}>
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
              <button type="button" onClick={loadDemoScenario} disabled={busy === "sample"} title="准备演示场景">
                <Sparkles size={16} />
                <span>演示</span>
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
              ref={questionInputRef}
              className="question-input"
              value={question}
              placeholder={QUESTION_PLACEHOLDER}
              onChange={(event) => updateQuestion(event.target.value)}
              rows={4}
            />
            <label>字段列表</label>
            <input
              ref={columnsInputRef}
              className="columns-input"
              value={columnsInput}
              placeholder={COLUMNS_PLACEHOLDER}
              onChange={(event) => setColumnsInput(event.target.value)}
            />
          </Panel>

          <Panel title="变量配置" icon={<Wand2 size={17} />} className="variables-panel">
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
              ref={dependentInputRef}
              className="dependent-input"
              value={dependentVariable}
              placeholder={DEPENDENT_VARIABLE_PLACEHOLDER}
              onChange={(event) => setDependentVariable(event.target.value)}
            />
            <label>解释变量 X</label>
            <input
              ref={independentInputRef}
              className="independent-input"
              value={independentVariables}
              placeholder={INDEPENDENT_VARIABLES_PLACEHOLDER}
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

          <Panel title="分析报告" icon={<FileText size={17} />} className="report-panel">
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

        <ColumnResizeHandle
          active={resizeEdge === "left"}
          label="拖动调整左侧宽度"
          onPointerDown={(event) => startColumnResize("left", event)}
        />

        <section className="rail rail-main">
          <Panel title="字段画像" icon={<TableProperties size={17} />}>
            <ProfileTable profile={profile} />
          </Panel>

          <Panel title="研究路径" icon={<Sparkles size={17} />}>
            <ResearchPathView path={researchPath} />
            <CollaborationCheckpoints
              checkpoints={collaborationCheckpoints}
              confirmedIds={confirmedCheckpoints}
              onToggle={toggleCheckpoint}
              onFocus={focusCheckpointTarget}
            />
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
            <RecommendationView recommendation={recommendation} notice={recommendationNotice} />
          </Panel>

          <Panel title="模型结果" icon={<Activity size={17} />}>
            <RunResultView result={runResult} notice={runNotice} />
          </Panel>
        </section>

        <ColumnResizeHandle
          active={resizeEdge === "right"}
          label="拖动调整右侧宽度"
          onPointerDown={(event) => startColumnResize("right", event)}
        />

        <aside className="rail rail-right">
          <Panel title="建模问答" icon={<MessageSquare size={17} />} className="chat-panel">
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
        </aside>
      </section>
    </main>
  );
}

function Panel({
  title,
  icon,
  children,
  className
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={className ? `panel ${className}` : "panel"}>
      <div className="panel-title">
        {icon}
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}

function ColumnResizeHandle({
  active,
  label,
  onPointerDown
}: {
  active: boolean;
  label: string;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      className={active ? "column-resizer active" : "column-resizer"}
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      onPointerDown={onPointerDown}
    />
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
        if (block.kind === "table") {
          return (
            <div className="chat-table-wrap" key={index}>
              <table className="chat-table">
                <thead>
                  <tr>
                    {block.headers.map((header, headerIndex) => (
                      <th key={`${index}-head-${headerIndex}`}>{renderInline(header)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr key={`${index}-row-${rowIndex}`}>
                      {row.map((cell, cellIndex) => (
                        <td key={`${index}-cell-${rowIndex}-${cellIndex}`}>{renderInline(cell)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
              <BlockMath value={block.text} />
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

  const diagnostics = profile.diagnostics;

  return (
    <div className="profile-stack">
      {diagnostics ? (
        <DataDiagnosticsView profile={profile} />
      ) : (
        <div className="metric-row">
          <span>{profile.rows} 行</span>
          <span>{profile.columns_count} 列</span>
        </div>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>字段名</th>
              <th>类型判断</th>
              <th>原始类型</th>
              <th>缺失</th>
              <th>缺失率</th>
              <th>唯一值</th>
              <th>样例值</th>
            </tr>
          </thead>
          <tbody>
            {profile.columns.map((column) => (
              <tr key={column.name}>
                <td title={column.name}>{column.name}</td>
                <td>{column.kind ?? "未知"}</td>
                <td>{column.dtype}</td>
                <td>{column.missing}</td>
                <td>{formatPercent(column.missing_rate)}</td>
                <td>{column.unique}</td>
                <td title={column.sample_values.join(", ")}>{column.sample_values.join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DataDiagnosticsView({ profile }: { profile: DataProfile }) {
  const diagnostics = profile.diagnostics;
  if (!diagnostics) return null;

  const panel = diagnostics.panel_hint;
  const riskItems = [
    ...diagnostics.modeling_warnings.map((item) => `${item.name}：${item.reason}`),
    ...diagnostics.outlier_columns.map((item) => `${item.name}：发现 ${item.outliers} 个 IQR 异常值`),
  ];

  if (diagnostics.duplicate_rows > 0) {
    riskItems.unshift(`重复行：${diagnostics.duplicate_rows} 行`);
  }

  if (riskItems.length === 0) {
    riskItems.push("暂未发现明显质量风险。");
  }

  return (
    <div className="diagnostics">
      <div className="diagnostic-cards">
        <div className="diagnostic-card">
          <span>样本量</span>
          <strong>{profile.rows}</strong>
          <small>{profile.columns_count} 个字段</small>
        </div>
        <div className="diagnostic-card">
          <span>总缺失</span>
          <strong>{formatPercent(diagnostics.missing_rate)}</strong>
          <small>{diagnostics.total_missing} 个单元格</small>
        </div>
        <div className="diagnostic-card">
          <span>重复行</span>
          <strong>{diagnostics.duplicate_rows}</strong>
          <small>{diagnostics.duplicate_rows ? "需要核查" : "未发现"}</small>
        </div>
        <div className="diagnostic-card">
          <span>字段类型</span>
          <strong>{diagnostics.numeric_columns}/{diagnostics.categorical_columns}</strong>
          <small>数值 / 分类文本</small>
        </div>
      </div>

      <div className="diagnostic-section">
        <div className="diagnostic-title">结构识别</div>
        <div className="diagnostic-tags">
          <span>时间列：{diagnostics.possible_time_columns.join(", ") || "未识别"}</span>
          <span>个体/地区列：{diagnostics.possible_entity_columns.join(", ") || "未识别"}</span>
          <span>时间类型字段：{diagnostics.datetime_columns}</span>
        </div>
        {panel ? (
          <div className="panel-hint">
            <strong>{panel.entity_column} × {panel.time_column}</strong>
            <span>{panel.units} 个个体，{panel.periods} 期，{panel.is_balanced ? "平衡面板" : `缺 ${panel.missing_cells} 个观测格`}</span>
          </div>
        ) : null}
      </div>

      <div className="diagnostic-section">
        <div className="diagnostic-title">分类字段</div>
        <div className="diagnostic-tags">
          {diagnostics.categorical_summaries.length ? (
            diagnostics.categorical_summaries.slice(0, 6).map((item) => (
              <span key={item.name}>{item.name}：{item.unique} 类</span>
            ))
          ) : (
            <span>暂无分类字段</span>
          )}
        </div>
      </div>

      <div className="diagnostic-section">
        <div className="diagnostic-title">关系线索</div>
        {diagnostics.relationship_hints?.length ? (
          <>
            <RelationshipMap hints={diagnostics.relationship_hints.slice(0, 8)} />
            <div className="relationship-list">
              {diagnostics.relationship_hints.slice(0, 5).map((item) => (
                <div className="relationship-item" key={`${item.left}-${item.right}`}>
                  <div>
                    <strong>{item.left}</strong>
                    <span>{item.direction}</span>
                    <strong>{item.right}</strong>
                  </div>
                  <p>{item.method} = {item.score.toFixed(3)}；{item.note}</p>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="empty compact-empty">暂未发现明显变量关系。</div>
        )}
      </div>

      <div className="diagnostic-section">
        <div className="diagnostic-title">风险提示</div>
        <ul className="diagnostic-list">
          {riskItems.slice(0, 8).map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function RelationshipMap({ hints }: { hints: RelationshipHint[] }) {
  const names = Array.from(new Set(hints.flatMap((item) => [item.left, item.right]))).slice(0, 6);
  if (names.length < 2) return null;

  const slots = [
    { x: 50, y: 50 },
    { x: 20, y: 24 },
    { x: 80, y: 24 },
    { x: 22, y: 70 },
    { x: 78, y: 70 },
    { x: 50, y: 82 },
  ];
  const positions = new Map(names.map((name, index) => [name, slots[index]]));
  const edges = hints.filter((item) => positions.has(item.left) && positions.has(item.right));

  return (
    <div className="relationship-map" aria-label="变量关系地图">
      <svg viewBox="0 0 100 100" role="img">
        <title>变量关系地图</title>
        {edges.map((item) => {
          const left = positions.get(item.left)!;
          const right = positions.get(item.right)!;
          return (
            <line
              key={`${item.left}-${item.right}`}
              x1={left.x}
              y1={left.y}
              x2={right.x}
              y2={right.y}
              className={item.score >= 0 ? "relationship-edge-positive" : "relationship-edge-negative"}
              strokeWidth={Math.max(0.5, Math.min(2.8, Math.abs(item.score) * 2.4))}
            />
          );
        })}
        {names.map((name, index) => {
          const point = positions.get(name)!;
          return (
            <g className={index === 0 ? "relationship-node relationship-node-main" : "relationship-node"} key={name}>
              <circle cx={point.x} cy={point.y} r={index === 0 ? 8.5 : 7.2} />
              <text x={point.x} y={point.y + 14} textAnchor="middle">{shortVariableName(name)}</text>
            </g>
          );
        })}
      </svg>
      <div className="relationship-map-note">
        <strong>{names[0]}</strong>
        <span>与 {names.length - 1} 个变量形成明显连接</span>
      </div>
    </div>
  );
}

function shortVariableName(name: string): string {
  return name.length > 18 ? `${name.slice(0, 15)}...` : name;
}

function ResearchPathView({ path }: { path: ResearchPath | null }) {
  if (!path) {
    return <div className="empty">等待数据画像。</div>;
  }

  return (
    <div className="research-path">
      <div className="path-question">
        <span>当前主线</span>
        <strong>{path.question}</strong>
      </div>

      <div className="path-section">
        <div className="path-title">可追问的问题</div>
        <ul className="path-list">
          {path.questionCandidates.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>

      <div className="path-grid">
        <div className="path-card">
          <span>数据结构</span>
          <p>{path.structure}</p>
        </div>
        <div className="path-card">
          <span>变量设定</span>
          <p>Y：{path.outcome}</p>
          <p>X：{path.coreVariables.join(", ") || "待确认"}</p>
          {path.controls.length ? <p>控制：{path.controls.join(", ")}</p> : null}
        </div>
        <div className="path-card">
          <span>推荐方向</span>
          <strong>{modelLabel(path.model)}</strong>
          <p>{path.model === "Panel Fixed Effects" ? "适合先整理固定效应模型，再讨论因果解释边界。" : "适合先建立基准模型，再逐步加入识别设计。"}</p>
        </div>
      </div>

      <div className="path-columns">
        <div className="path-section">
          <div className="path-title">关键假设</div>
          <ul className="path-list">
            {path.assumptions.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div className="path-section">
          <div className="path-title">风险边界</div>
          <ul className="path-list">
            {path.risks.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="path-section">
        <div className="path-title">下一步判断</div>
        <div className="path-tags">
          {path.nextSteps.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function CollaborationCheckpoints({
  checkpoints,
  confirmedIds,
  onToggle,
  onFocus
}: {
  checkpoints: CollaborationCheckpoint[];
  confirmedIds: string[];
  onToggle: (id: string) => void;
  onFocus: (target: CheckpointTarget) => void;
}) {
  if (!checkpoints.length) return null;

  const confirmedCount = checkpoints.filter((item) => confirmedIds.includes(item.id)).length;

  return (
    <div className="checkpoints">
      <div className="checkpoints-head">
        <div>
          <span>协作检查点</span>
          <strong>{confirmedCount}/{checkpoints.length} 已确认</strong>
        </div>
      </div>
      <div className="checkpoint-list">
        {checkpoints.map((checkpoint) => {
          const checked = confirmedIds.includes(checkpoint.id);
          return (
            <div className={`checkpoint-item ${checked ? "checkpoint-item-done" : ""}`} key={checkpoint.id}>
              <label className="checkpoint-check">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(checkpoint.id)}
                  aria-label={`确认${checkpoint.title}`}
                />
              </label>
              <div className="checkpoint-copy">
                <div className="checkpoint-title-row">
                  <strong>{checkpoint.title}</strong>
                  <span>{checked ? "已确认" : checkpoint.badge}</span>
                </div>
                <p>{checkpoint.detail}</p>
              </div>
              <button className="checkpoint-action" type="button" onClick={() => onFocus(checkpoint.target)}>
                去处理
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RecommendationView({
  recommendation,
  notice
}: {
  recommendation: ModelRecommendation | null;
  notice: string | null;
}) {
  if (notice) {
    return <div className="empty">{notice}</div>;
  }

  if (!recommendation) {
    return <div className="empty">模型推荐会给出适合的模型、推荐理由、检查清单和可运行代码。</div>;
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

function RunResultView({ result, notice }: { result: RunModelResponse | null; notice: string | null }) {
  if (notice) {
    return <div className="empty">{notice}</div>;
  }

  if (!result) {
    return <div className="empty">模型结果会显示样本量、R2、系数、标准误、统计量和 p 值。</div>;
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
