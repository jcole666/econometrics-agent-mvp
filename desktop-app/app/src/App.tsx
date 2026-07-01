import {
  Activity,
  BookOpen,
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
const PANEL_HEIGHTS_KEY = "econometrics-agent.panel-heights";

const DEFAULT_RAIL_WIDTHS = { left: 330, right: 360 };
const DEMO_RAIL_WIDTHS = { left: 370, right: 420 };
const MIN_LEFT_RAIL = 280;
const MIN_MAIN_RAIL = 420;
const MIN_RIGHT_RAIL = 320;
const COLUMN_RESIZER_WIDTH = 12;
const DEFAULT_PANEL_HEIGHTS = {
  left: { data: 540, variables: 420, report: 310 },
  main: { question: 220, profile: 300, path: 360, recommendation: 280, result: 280 },
  right: { chat: 660 }
};
const DEMO_PANEL_HEIGHTS = {
  left: { data: 640, variables: 330, report: 360 },
  main: { question: 210, profile: 300, path: 430, recommendation: 280, result: 330 },
  right: { chat: 760 }
};
const PANEL_MIN_HEIGHTS = {
  data: 360,
  question: 170,
  variables: 280,
  report: 220,
  profile: 220,
  path: 240,
  recommendation: 220,
  result: 220,
  chat: 360
};
const DEMO_MODEL_TYPE = "Panel Fixed Effects";
const DEMO_ENTITY_COLUMN = "city";
const DEMO_TIME_COLUMN = "year";

type BusyKey = "profile" | "infer" | "recommend" | "run" | "chat" | "report" | "demo";
type DemoStage = "idle" | "data" | "recommend" | "run" | "report" | "ready" | "error";
type ResizeEdge = "left" | "right";
type CheckpointTarget = "question" | "data" | "variables" | "recommendation" | "risk";
type WorkbenchView = "workflow" | "profile" | "path" | "report" | "guide";
type RailId = keyof typeof DEFAULT_PANEL_HEIGHTS;
type PanelId = keyof typeof PANEL_MIN_HEIGHTS;
type PanelHeights = Record<RailId, Partial<Record<PanelId, number>>>;

const DEMO_FLOW_STEPS: Array<{ stage: DemoStage; title: string; detail: string }> = [
  { stage: "data", title: "加载演示数据", detail: "城市 × 年份面板数据" },
  { stage: "recommend", title: "推荐模型", detail: "面板固定效应路径" },
  { stage: "run", title: "运行结果", detail: "系数、显著性和 R2" },
  { stage: "report", title: "生成报告", detail: "Markdown 草稿" }
];
const DEMO_REVIEW_QUESTIONS = [
  {
    label: "因果边界",
    question: "这条结果能不能解释为因果？还需要补哪些识别假设和稳健性检验？"
  },
  {
    label: "数据质量",
    question: "字段画像里哪些数据质量风险最值得先查？这些风险会怎样影响模型解释？"
  },
  {
    label: "项目差异",
    question: "这个演示相比直接让普通 LLM 写一个 OLS，有什么不一样？"
  },
  {
    label: "现场回应",
    question: "如果老师质疑演示数据规模不大，我应该怎么回应这个 Demo 的价值？"
  }
];

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

interface PanelResizeSession {
  rail: RailId;
  panelId: PanelId;
  startY: number;
  height: number;
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

interface DemoScriptSection {
  time: string;
  title: string;
  text: string;
}

interface DefenseCard {
  title: string;
  question: string;
  answer: string;
  prompt: string;
}

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

function panelMinHeight(panelId: PanelId): number {
  return PANEL_MIN_HEIGHTS[panelId] ?? 180;
}

function defaultPanelHeight(rail: RailId, panelId: PanelId): number {
  const defaults = DEFAULT_PANEL_HEIGHTS[rail] as Partial<Record<PanelId, number>>;
  return defaults[panelId] ?? panelMinHeight(panelId);
}

function loadPanelHeights(): PanelHeights {
  const heights: PanelHeights = { left: {}, main: {}, right: {} };

  try {
    const raw = localStorage.getItem(PANEL_HEIGHTS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};

    (Object.keys(DEFAULT_PANEL_HEIGHTS) as RailId[]).forEach((rail) => {
      const defaults = DEFAULT_PANEL_HEIGHTS[rail] as Partial<Record<PanelId, number>>;
      Object.keys(defaults).forEach((key) => {
        const panelId = key as PanelId;
        const value = parsed?.[rail]?.[panelId];
        heights[rail][panelId] = Math.max(panelMinHeight(panelId), readableWidth(value, defaultPanelHeight(rail, panelId)));
      });
    });
  } catch {
    (Object.keys(DEFAULT_PANEL_HEIGHTS) as RailId[]).forEach((rail) => {
      heights[rail] = { ...(DEFAULT_PANEL_HEIGHTS[rail] as Partial<Record<PanelId, number>>) };
    });
  }

  return heights;
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

function hasNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isIntercept(variable: string): boolean {
  return ["const", "constant", "intercept", "截距"].includes(variable.trim().toLowerCase());
}

function coefficientDirection(value: number | null | undefined): string {
  if (!hasNumber(value) || Math.abs(value) < 1e-10) return "接近 0";
  return value > 0 ? "正向" : "负向";
}

function significanceText(pValue: number | null | undefined): string {
  if (!hasNumber(pValue)) return "p 值暂缺";
  if (pValue <= 0.01) return "1% 水平显著";
  if (pValue <= 0.05) return "5% 水平显著";
  if (pValue <= 0.1) return "10% 水平边际显著";
  return "暂未通过常用显著性检验";
}

function mainCoefficient(coefficients: CoefficientResult[]): CoefficientResult | null {
  return (
    coefficients.find((item) => !isIntercept(item.variable) && hasNumber(item.coefficient)) ??
    coefficients.find((item) => hasNumber(item.coefficient)) ??
    null
  );
}

function significantCoefficients(coefficients: CoefficientResult[]): CoefficientResult[] {
  return coefficients
    .filter((item) => !isIntercept(item.variable) && hasNumber(item.p_value) && item.p_value <= 0.05)
    .sort((left, right) => (left.p_value ?? 1) - (right.p_value ?? 1))
    .slice(0, 3);
}

function resultBoundary(model: string | undefined): string {
  const normalized = (model ?? "").toLowerCase();
  if (normalized.includes("panel") || normalized.includes("fixed")) {
    return "固定效应更适合看组内变化，但仍要说明识别假设、遗漏变量和反向因果。";
  }
  if (normalized.includes("logit")) {
    return "Logit 系数先看方向和显著性，概率变化建议再算边际效应。";
  }
  if (normalized.includes("ols")) {
    return "OLS 描述的是条件相关关系，能否上升到因果结论要看识别设计。";
  }
  return "当前结果适合作为第一版判断，正式写作前还需要补充稳健性和诊断检查。";
}

function isDemoProfile(profile: DataProfile | null): boolean {
  if (!profile) return false;
  const names = new Set(profile.columns.map((column) => column.name));
  return names.has("innovation_index") && names.has("digital_economy_index") && names.has("city") && names.has("year");
}

function primaryRelationship(profile: DataProfile | null): RelationshipHint | null {
  const hints = profile?.diagnostics?.relationship_hints ?? [];
  return (
    hints.find((item) => (
      [item.left, item.right].includes("innovation_index") &&
      [item.left, item.right].includes("digital_economy_index")
    )) ??
    hints[0] ??
    null
  );
}

function demoFindingText(profile: DataProfile | null): string {
  const hint = primaryRelationship(profile);
  if (!hint) return "先从字段画像和关系线索里找值得追问的变量关系。";
  return `${hint.left} 与 ${hint.right} 呈${hint.direction}，${hint.method}=${hint.score.toFixed(3)}，适合作为演示里的第一条发现。`;
}

function demoResultText(result: RunModelResponse | null): string {
  if (!result?.success || !result.results) {
    return "运行模型后，这里会自动提炼核心系数和显著性。";
  }

  const primary = mainCoefficient(result.results.coefficients);
  if (!primary || !hasNumber(primary.coefficient)) {
    return `模型已运行，有效样本量 ${result.results.sample_size}。`;
  }

  return `${primary.variable} 为${coefficientDirection(primary.coefficient)}，系数 ${formatNumber(primary.coefficient)}，${significanceText(primary.p_value)}。`;
}

function buildDemoScript({
  profile,
  path,
  recommendation,
  runResult
}: {
  profile: DataProfile | null;
  path: ResearchPath | null;
  recommendation: ModelRecommendation | null;
  runResult: RunModelResponse | null;
}): DemoScriptSection[] {
  const questionText = path?.question ?? DEFAULT_QUESTION;
  const model = recommendation?.model ?? path?.model ?? DEMO_MODEL_TYPE;
  const dataText = buildDataSummary(profile) ?? "先加载演示数据，再展示字段画像、缺失情况和变量关系线索";
  const findingText = demoFindingText(profile);
  const resultText = demoResultText(runResult);
  const r2Text = hasNumber(runResult?.results?.r_squared) ? `R2=${formatNumber(runResult?.results?.r_squared)}。` : "";
  const riskText = path?.risks[0] ?? resultBoundary(model);
  const nextStepText = path?.nextSteps.slice(0, 2).join("；") || "补充稳健性检验和替代变量设定";

  return [
    {
      time: "0:00",
      title: "开场",
      text: `各位老师好，我们做的是“小计”，一个面向社科研究生的计量建模工作台。今天用“${questionText}”演示完整流程。`
    },
    {
      time: "0:25",
      title: "数据",
      text: `软件先读取数据并生成字段画像。当前演示数据是：${dataText}。这一步不是直接跑回归，而是先让研究者看清数据结构。`
    },
    {
      time: "0:55",
      title: "发现",
      text: `${findingText}小计把这类线索整理成可追问的问题，但不会把相关性直接说成因果。`
    },
    {
      time: "1:25",
      title: "建模",
      text: `在确认 Y、X、个体列和时间列后，系统推荐 ${modelLabel(model)}。研究者可以在变量配置和检查点里继续干预，而不是全自动黑箱输出。`
    },
    {
      time: "2:00",
      title: "结果",
      text: `${resultText}${r2Text ? ` ${r2Text}` : ""}现场重点不是只报一个系数，而是同步解释方向、显著性和可用边界。`
    },
    {
      time: "2:35",
      title: "收尾",
      text: `所以这个 Demo 展示的是“人机协作做计量分析”：小计负责整理路径、暴露风险、生成草稿，研究者负责判断假设。下一步会继续做：${nextStepText}。当前需要特别说明：${riskText}`
    }
  ];
}

function buildDefenseCards({
  profile,
  path,
  recommendation,
  runResult
}: {
  profile: DataProfile | null;
  path: ResearchPath | null;
  recommendation: ModelRecommendation | null;
  runResult: RunModelResponse | null;
}): DefenseCard[] {
  const model = recommendation?.model ?? path?.model ?? DEMO_MODEL_TYPE;
  const mainResult = demoResultText(runResult);
  const risks = profile ? dataQualityRisks(profile) : [];
  const dataRisk = risks[0] ?? "当前没有看到特别突出的数据质量风险，但正式展示前仍要说明缺失、异常值和样本覆盖。";
  const boundary = path?.risks[0] ?? resultBoundary(model);
  const nextStep = path?.nextSteps.slice(0, 2).join("；") || "补充稳健性检验和替代设定";

  return [
    {
      title: "因果边界",
      question: "老师问：这个结果能不能直接解释为因果？",
      answer: `${boundary} 现场可以先承认边界，再说明下一步会做：${nextStep}。`,
      prompt: "请帮我把当前结果的因果边界整理成一段答辩口径，要求诚实但不显得项目很弱。"
    },
    {
      title: "数据质量",
      question: "老师问：这个数据有没有质量问题？",
      answer: dataRisk,
      prompt: "请基于当前字段画像，帮我列出最该优先解释的数据质量风险，以及它们对模型结论的影响。"
    },
    {
      title: "人机协作",
      question: "老师问：为什么不是全自动跑完就行？",
      answer: "小计把字段画像、关系线索、模型路径、检查点和报告草稿串起来；研究者仍要确认变量、识别假设和结论边界。",
      prompt: "请帮我解释小计为什么是人机协作工具，而不是全自动替代研究者的流水线。"
    },
    {
      title: "Demo 价值",
      question: "老师问：这和普通 LLM 写一段 OLS 有什么区别？",
      answer: `当前演示不是单点写代码，而是从数据结构到 ${modelLabel(model)}、再到结果解释串成流程。${mainResult}`,
      prompt: "请帮我对比小计和普通 LLM 直接写 OLS 的区别，重点放在数据画像、路径推理、检查点和结果边界。"
    }
  ];
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

function buildDemoRequest(sampleProfile: DataProfile): ModelRequest {
  return {
    research_question: DEFAULT_QUESTION,
    columns: sampleProfile.columns.map((column) => column.name),
    dependent_variable: DEFAULT_DEPENDENT_VARIABLE,
    independent_variables: splitList(DEFAULT_INDEPENDENT_VARIABLES),
    entity_column: DEMO_ENTITY_COLUMN,
    time_column: DEMO_TIME_COLUMN,
    treatment_column: null,
    running_variable: null,
    instrument_variable: null,
    llm_config: { enabled: false }
  };
}

function demoStageLabel(stage: DemoStage): string {
  if (stage === "ready") return "已准备好";
  if (stage === "error") return "需要重试";
  if (stage === "idle") return "待开始";
  return "准备中";
}

function demoStepState(stage: DemoStage, step: DemoStage): "pending" | "active" | "done" | "error" {
  if (stage === "ready") return "done";
  if (stage === "error") return "error";
  if (stage === "idle") return "pending";

  const currentIndex = DEMO_FLOW_STEPS.findIndex((item) => item.stage === stage);
  const stepIndex = DEMO_FLOW_STEPS.findIndex((item) => item.stage === step);
  if (stepIndex < currentIndex) return "done";
  if (stepIndex === currentIndex) return "active";
  return "pending";
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
  const [demoStage, setDemoStage] = useState<DemoStage>("idle");
  const [activeView, setActiveView] = useState<WorkbenchView>("workflow");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [modelSettings, setModelSettings] = useState<ModelSettings>(() => loadModelSettings());
  const [settingsDraft, setSettingsDraft] = useState<ModelSettings>(() => loadModelSettings());
  const [railWidths, setRailWidths] = useState<RailWidths>(() => loadRailWidths());
  const [panelHeights, setPanelHeights] = useState<PanelHeights>(() => loadPanelHeights());
  const [resizeEdge, setResizeEdge] = useState<ResizeEdge | null>(null);
  const [panelResizeKey, setPanelResizeKey] = useState<string | null>(null);
  const [confirmedCheckpoints, setConfirmedCheckpoints] = useState<string[]>([]);
  const workspaceRef = useRef<HTMLElement | null>(null);
  const resizeSessionRef = useRef<ResizeSession | null>(null);
  const panelResizeSessionRef = useRef<PanelResizeSession | null>(null);
  const chatLogRef = useRef<HTMLDivElement | null>(null);
  const chatHistoryRef = useRef<HTMLDivElement | null>(null);
  const questionInputRef = useRef<HTMLTextAreaElement | null>(null);
  const columnsInputRef = useRef<HTMLInputElement | null>(null);
  const dependentInputRef = useRef<HTMLInputElement | null>(null);
  const independentInputRef = useRef<HTMLInputElement | null>(null);
  const chatInputRef = useRef<HTMLInputElement | null>(null);

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
  const workspaceClassName = activeView === "workflow" ? "workspace" : "workspace workspace-focused";
  const isWorking = busy !== null;
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

  function currentPanelHeight(rail: RailId, panelId: PanelId): number {
    return panelHeights[rail]?.[panelId] ?? defaultPanelHeight(rail, panelId);
  }

  function panelStyle(rail: RailId, panelId: PanelId): CSSProperties {
    return {
      "--panel-height": `${currentPanelHeight(rail, panelId)}px`,
      "--panel-min-height": `${panelMinHeight(panelId)}px`
    } as CSSProperties;
  }

  function showView(view: WorkbenchView) {
    setActiveView(view);
    if (view === "workflow") setStatus("已回到工作台。");
    if (view === "profile") setStatus(profile ? "正在查看字段画像。" : "先选择数据并生成字段画像。");
    if (view === "path") setStatus(researchPath ? "正在查看研究路径。" : "先生成字段画像和变量配置。");
    if (view === "report") setStatus(report.trim() ? "正在查看分析报告。" : "可以在这里生成分析报告。");
    if (view === "guide") setStatus("正在查看使用文档。");
  }

  function startPanelResize(rail: RailId, panelId: PanelId, event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;

    event.preventDefault();
    panelResizeSessionRef.current = {
      rail,
      panelId,
      startY: event.clientY,
      height: currentPanelHeight(rail, panelId)
    };
    setPanelResizeKey(`${rail}:${panelId}`);
    document.body.classList.add("resizing-panels");
  }

  function resetPanelRail(rail: RailId) {
    setPanelHeights((current) => ({
      ...current,
      [rail]: { ...(DEFAULT_PANEL_HEIGHTS[rail] as Partial<Record<PanelId, number>>) }
    }));
    setStatus("已恢复当前列的板块高度。");
  }

  function resetWorkspaceLayout() {
    setActiveView("workflow");
    setRailWidths(fitRailWidths(DEMO_RAIL_WIDTHS, workspaceRailSpace()));
    setPanelHeights({
      left: { ...DEMO_PANEL_HEIGHTS.left },
      main: { ...DEMO_PANEL_HEIGHTS.main },
      right: { ...DEMO_PANEL_HEIGHTS.right }
    });
    setStatus("已恢复推荐布局。");
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
    try {
      localStorage.setItem(PANEL_HEIGHTS_KEY, JSON.stringify(panelHeights));
    } catch {
    }
  }, [panelHeights]);

  useEffect(() => {
    setConfirmedCheckpoints([]);
  }, [dependentVariable, entityColumn, independentVariables, instrumentVariable, profile, question, recommendation?.model, runningVariable, timeColumn, treatmentColumn]);

  useEffect(() => {
    const fitToWindow = () => {
      setRailWidths((current) => fitRailWidths(current, workspaceRailSpace()));
    };

    const moveResize = (event: PointerEvent) => {
      const session = resizeSessionRef.current;
      if (session) {
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
        return;
      }

      const panelSession = panelResizeSessionRef.current;
      if (!panelSession) return;

      const dy = event.clientY - panelSession.startY;
      const minHeight = panelMinHeight(panelSession.panelId);
      const nextHeight = clamp(panelSession.height + dy, minHeight, Math.max(minHeight, window.innerHeight * 1.6));

      setPanelHeights((current) => ({
        ...current,
        [panelSession.rail]: {
          ...current[panelSession.rail],
          [panelSession.panelId]: nextHeight
        }
      }));
    };

    const stopResize = () => {
      if (!resizeSessionRef.current && !panelResizeSessionRef.current) return;
      resizeSessionRef.current = null;
      panelResizeSessionRef.current = null;
      setResizeEdge(null);
      setPanelResizeKey(null);
      document.body.classList.remove("resizing-columns");
      document.body.classList.remove("resizing-panels");
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
      document.body.classList.remove("resizing-panels");
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
    setDemoStage("idle");
    setStatus(next ? `已选择 ${next.name}` : "就绪");
  }

  function updateQuestion(value: string) {
    setQuestion(value);
    setRecommendationNotice(null);
    setRunNotice(null);
  }

  function useCandidateQuestion(questionText: string) {
    setActiveView("workflow");
    updateQuestion(questionText);
    setStatus("已采用候选研究问题。");
    window.setTimeout(() => questionInputRef.current?.focus(), 0);
  }

  function toggleCheckpoint(id: string) {
    setConfirmedCheckpoints((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
  }

  function focusCheckpointTarget(target: CheckpointTarget) {
    if (target === "question") {
      setActiveView("workflow");
      window.setTimeout(() => questionInputRef.current?.focus(), 0);
      setStatus("请确认研究问题。");
      return;
    }

    if (target === "data") {
      setActiveView("workflow");
      if (!file) {
        setStatus("先选择数据文件，或点击演示准备内置数据。");
        return;
      }
      window.setTimeout(() => columnsInputRef.current?.focus(), 0);
      setStatus(profile ? "字段画像已生成，可以继续确认数据结构。" : "点击“生成字段画像”查看数据结构。");
      return;
    }

    if (target === "variables") {
      setActiveView("workflow");
      window.setTimeout(() => {
        const targetInput = dependentVariable.trim() ? independentInputRef.current : dependentInputRef.current;
        targetInput?.focus();
      }, 0);
      setStatus("请确认变量设定。");
      return;
    }

    if (target === "recommendation") {
      setActiveView("workflow");
      setStatus(recommendation ? "请检查模型推荐和识别策略。" : "点击“推荐模型”生成识别策略建议。");
      return;
    }

    setActiveView("path");
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
      setActiveView("profile");
      setStatus("字段画像已生成。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "字段画像生成失败。");
    } finally {
      setBusy(null);
    }
  }

  function applyDemoState(sampleFile: File, sampleProfile: DataProfile) {
    setFile(sampleFile);
    setProfile(sampleProfile);
    setQuestion(DEFAULT_QUESTION);
    setColumnsInput(sampleProfile.columns.map((column) => column.name).join(", "));
    setDependentVariable(DEFAULT_DEPENDENT_VARIABLE);
    setIndependentVariables(DEFAULT_INDEPENDENT_VARIABLES);
    setEntityColumn("city");
    setTimeColumn("year");
    setTreatmentColumn("");
    setRunningVariable("");
    setInstrumentVariable("");
    setModelType("Panel Fixed Effects");
    setInference(null);
    setRecommendation(null);
    setRecommendationNotice(null);
    setRunResult(null);
    setRunNotice(null);
    setReport("");
    setDemoStage("data");
  }

  async function loadDemoScenario() {
    setBusy("demo");
    setActiveView("workflow");
    setDemoStage("data");
    try {
      const [sampleFile, sampleProfile] = await Promise.all([loadSampleFile(), loadSampleProfile()]);
      applyDemoState(sampleFile, sampleProfile);

      const request = buildDemoRequest(sampleProfile);

      setDemoStage("recommend");
      setStatus("正在准备演示：生成模型推荐。");
      const nextRecommendation = await recommendModel(request);
      const nextModel = nextRecommendation.model || DEMO_MODEL_TYPE;
      setRecommendation(nextRecommendation);
      setModelType(nextModel);

      setDemoStage("run");
      setStatus("正在准备演示：运行模型。");
      const nextRunResult = await runModel(sampleFile, request, nextModel);
      setRunResult(nextRunResult);
      setRunNotice(nextRunResult.success ? null : nextRunResult.error ?? "模型运行失败。");
      if (!nextRunResult.success) {
        throw new Error(nextRunResult.error ?? "模型运行失败。");
      }

      const nextPath = buildResearchPath({
        profile: sampleProfile,
        question: DEFAULT_QUESTION,
        dependentVariable: DEFAULT_DEPENDENT_VARIABLE,
        independentVariables: DEFAULT_INDEPENDENT_VARIABLES,
        entityColumn: DEMO_ENTITY_COLUMN,
        timeColumn: DEMO_TIME_COLUMN,
        modelType: nextModel,
        recommendation: nextRecommendation,
      });
      const notes = buildReportNotes({
        profile: sampleProfile,
        path: nextPath,
        recommendation: nextRecommendation,
        inferenceReasoning: null
      });

      setDemoStage("report");
      setStatus("正在准备演示：生成报告。");
      const nextReport = await generateReport(DEFAULT_QUESTION, nextModel, nextRunResult.results, notes, { enabled: false });
      setReport(nextReport.markdown);
      setConfirmedCheckpoints(["question", "data", "variables", "recommendation"]);
      setDemoStage("ready");
      setStatus("演示已准备好：数据、推荐、结果和报告都已生成。");
    } catch (error) {
      setDemoStage("error");
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
      const message = "请先选择数据文件，或点击演示准备内置数据。";
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

  function prepareReviewQuestion(questionText: string) {
    setActiveView("workflow");
    setChatInput(questionText);
    setChatHistoryOpen(false);
    setStatus("已放入评审追问，确认后可以发送给小计。");
    window.setTimeout(() => chatInputRef.current?.focus(), 0);
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
      setActiveView("report");
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
          <nav className="view-switch" aria-label="工作区视图">
            <button
              className={`view-switch-button ${activeView === "workflow" ? "active" : ""}`}
              type="button"
              onClick={() => showView("workflow")}
            >
              <Database size={15} />
              <span>工作台</span>
            </button>
            <button
              className={`view-switch-button ${activeView === "profile" ? "active" : ""}`}
              type="button"
              onClick={() => showView("profile")}
            >
              <TableProperties size={15} />
              <span>字段画像</span>
            </button>
            <button
              className={`view-switch-button ${activeView === "path" ? "active" : ""}`}
              type="button"
              onClick={() => showView("path")}
            >
              <Sparkles size={15} />
              <span>研究路径</span>
            </button>
            <button
              className={`view-switch-button ${activeView === "report" ? "active" : ""}`}
              type="button"
              onClick={() => showView("report")}
            >
              <FileText size={15} />
              <span>分析报告</span>
            </button>
            <button
              className={`view-switch-button ${activeView === "guide" ? "active" : ""}`}
              type="button"
              onClick={() => showView("guide")}
            >
              <BookOpen size={15} />
              <span>使用文档</span>
            </button>
          </nav>
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
            className="topbar-tool-button"
            type="button"
            onClick={resetWorkspaceLayout}
            title="恢复推荐工作台布局"
          >
            <RotateCcw size={16} />
            <span>重置布局</span>
          </button>
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

      <section className={workspaceClassName} ref={workspaceRef} style={workspaceStyle}>
        {activeView === "workflow" ? (
          <>
        <aside className="rail rail-left">
          <Panel title="数据" icon={<Database size={17} />} style={panelStyle("left", "data")}>
            <div className="file-row">
              <label className="file-button" title="选择数据文件">
                <FileUp size={16} />
                <span>选择</span>
                <input type="file" accept=".csv,.xlsx,.xls" onChange={onFileChange} />
              </label>
              <button type="button" onClick={loadDemoScenario} disabled={isWorking} title="一键准备路演场景">
                <Sparkles size={16} />
                <span>{busy === "demo" ? "准备中" : "演示"}</span>
              </button>
            </div>
            <div className="filename">{file?.name ?? "尚未选择文件"}</div>
            <DemoScenarioBrief profile={profile} stage={demoStage} onAsk={prepareReviewQuestion} />
            <DataQualityBrief profile={profile} onAsk={prepareReviewQuestion} />
            <DemoFlow stage={demoStage} />
            <DemoBrief
              profile={profile}
              path={researchPath}
              recommendation={recommendation}
              runResult={runResult}
              stage={demoStage}
              onAsk={prepareReviewQuestion}
            />
            <DemoScript
              profile={profile}
              path={researchPath}
              recommendation={recommendation}
              runResult={runResult}
              stage={demoStage}
            />
            <button className="wide" type="button" onClick={loadProfile} disabled={!file || isWorking}>
              <RefreshCw size={16} />
              <span>生成字段画像</span>
            </button>
          </Panel>
          <PanelResizeHandle
            active={panelResizeKey === "left:data"}
            label="调整数据板块高度"
            onPointerDown={(event) => startPanelResize("left", "data", event)}
            onDoubleClick={() => resetPanelRail("left")}
          />

          <Panel title="变量配置" icon={<Wand2 size={17} />} className="variables-panel" style={panelStyle("left", "variables")}>
            <div className="two-buttons">
              <button type="button" onClick={infer} disabled={isWorking}>
                <Sparkles size={16} />
                <span>识别变量</span>
              </button>
              <button type="button" onClick={recommend} disabled={isWorking}>
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
          <PanelResizeHandle
            active={panelResizeKey === "left:variables"}
            label="调整变量配置板块高度"
            onPointerDown={(event) => startPanelResize("left", "variables", event)}
            onDoubleClick={() => resetPanelRail("left")}
          />

        </aside>

        <ColumnResizeHandle
          active={resizeEdge === "left"}
          label="拖动调整左侧宽度"
          onPointerDown={(event) => startColumnResize("left", event)}
        />

        <section className="rail rail-main">
          <Panel title="研究问题" icon={<MessageSquare size={17} />} style={panelStyle("main", "question")}>
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
          <PanelResizeHandle
            active={panelResizeKey === "main:question"}
            label="调整研究问题板块高度"
            onPointerDown={(event) => startPanelResize("main", "question", event)}
            onDoubleClick={() => resetPanelRail("main")}
          />

          <Panel title="模型推荐" icon={<Cpu size={17} />} style={panelStyle("main", "recommendation")}>
            <div className="runbar">
              <select value={modelType} onChange={(event) => setModelType(event.target.value)}>
                {MODEL_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
              <button type="button" onClick={run} disabled={isWorking}>
                <Play size={16} />
                <span>运行模型</span>
              </button>
            </div>
            <RecommendationView recommendation={recommendation} notice={recommendationNotice} />
          </Panel>
          <PanelResizeHandle
            active={panelResizeKey === "main:recommendation"}
            label="调整模型推荐板块高度"
            onPointerDown={(event) => startPanelResize("main", "recommendation", event)}
            onDoubleClick={() => resetPanelRail("main")}
          />

          <Panel title="模型结果" icon={<Activity size={17} />} style={panelStyle("main", "result")}>
            <RunResultView result={runResult} notice={runNotice} />
          </Panel>
          <PanelResizeHandle
            active={panelResizeKey === "main:result"}
            label="调整模型结果板块高度"
            onPointerDown={(event) => startPanelResize("main", "result", event)}
            onDoubleClick={() => resetPanelRail("main")}
          />
        </section>

        <ColumnResizeHandle
          active={resizeEdge === "right"}
          label="拖动调整右侧宽度"
          onPointerDown={(event) => startColumnResize("right", event)}
        />

        <aside className="rail rail-right">
          <Panel title="建模问答" icon={<MessageSquare size={17} />} className="chat-panel" style={panelStyle("right", "chat")}>
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
                ref={chatInputRef}
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
          <PanelResizeHandle
            active={panelResizeKey === "right:chat"}
            label="调整建模问答高度"
            onPointerDown={(event) => startPanelResize("right", "chat", event)}
            onDoubleClick={() => resetPanelRail("right")}
          />
        </aside>
          </>
        ) : (
          <div className="focus-view">
            {activeView === "profile" ? (
              <Panel title="字段画像" icon={<TableProperties size={17} />} className="focus-panel">
                <ProfileTable profile={profile} />
              </Panel>
            ) : null}

            {activeView === "path" ? (
              <Panel title="研究路径" icon={<Sparkles size={17} />} className="focus-panel">
                <ResearchPathView
                  path={researchPath}
                  onUseQuestion={useCandidateQuestion}
                  onAskQuestion={prepareReviewQuestion}
                />
                <CollaborationCheckpoints
                  checkpoints={collaborationCheckpoints}
                  confirmedIds={confirmedCheckpoints}
                  onToggle={toggleCheckpoint}
                  onFocus={focusCheckpointTarget}
                />
                <DefenseCardsView
                  profile={profile}
                  path={researchPath}
                  recommendation={recommendation}
                  runResult={runResult}
                  onAsk={prepareReviewQuestion}
                />
              </Panel>
            ) : null}

            {activeView === "report" ? (
              <Panel title="分析报告" icon={<FileText size={17} />} className="report-panel focus-panel">
                <div className="report-actions">
                  <button type="button" onClick={makeReport} disabled={isWorking}>
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
            ) : null}

            {activeView === "guide" ? (
              <Panel title="使用文档" icon={<BookOpen size={17} />} className="guide-panel focus-panel">
                <UserGuideView />
              </Panel>
            ) : null}
          </div>
        )}
      </section>
    </main>
  );
}

function Panel({
  title,
  icon,
  children,
  className,
  style
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const classes = ["panel", style ? "resizable-panel" : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <section className={classes} style={style}>
      <div className="panel-title">
        {icon}
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}

function UserGuideView() {
  const sections = [
    {
      title: "1. 打开和确认状态",
      text: "双击项目根目录的 小计.exe。启动后看顶部状态条：显示“后端服务在线”时，本地分析服务已经准备好。顶部的“工作台、字段画像、研究路径、分析报告、使用文档”用于切换主要页面。"
    },
    {
      title: "2. 选择数据或使用演示",
      text: "自己的数据点击左侧“选择”，支持 CSV、xlsx、xls。路演或课堂展示点击“演示”，它会加载城市面板演示数据，并自动准备研究问题、变量、模型推荐、运行结果和报告草稿。"
    },
    {
      title: "3. 生成字段画像",
      text: "选择文件后点击“生成字段画像”。小计会读取字段类型、缺失值、唯一值、样例值、重复行、可能的个体列和时间列，还会把明显的数据质量风险提前列出来。字段画像只提供线索，不直接替代研究判断。"
    },
    {
      title: "4. 填写研究问题和变量",
      text: "中间栏顶部填写研究问题，例如“数字经济发展是否会提升城市创新水平？”。左侧变量配置里填写被解释变量 Y、解释变量 X，以及个体列、时间列、处理列、断点变量或工具变量。多个 X 用英文逗号分隔。"
    },
    {
      title: "5. 推荐并运行模型",
      text: "点击“推荐模型”后，小计会根据研究问题、字段和变量配置给出模型建议。确认后点击“运行模型”。当前 OLS、Logit、面板固定效应支持直接运行；DID、RDD、IV-2SLS 会先给识别路径、检查清单和代码模板。"
    },
    {
      title: "6. 查看研究路径",
      text: "点顶部“研究路径”，可以看到候选研究问题、变量设定、识别思路、假设边界和协作检查点。候选问题可以直接采用，也可以放入右侧问答继续追问。答辩卡适合准备老师可能会问的因果边界、数据质量和 Demo 价值问题。"
    },
    {
      title: "7. 使用小计问答",
      text: "右侧问答会读取当前字段画像、研究问题、变量配置、模型推荐、模型结果和报告草稿。建议先生成字段画像和模型推荐，再问“为什么推荐这个模型”“系数怎么解释”“下一步要检查什么”。右侧可以新建会话，也可以搜索历史会话。"
    },
    {
      title: "8. 生成和导出报告",
      text: "点顶部“分析报告”，再点“生成报告”。报告会汇总研究问题、模型选择、核心结果、数据风险和下一步建议。可以导出 MD 继续编辑，也可以导出 PDF 用于提交或发送。"
    },
    {
      title: "9. 配置模型",
      text: "右上角齿轮用于配置大模型。需要填请求地址、模型名称和 API Key。配置保存在本机，不写进代码。未配置时，小计会提示先补全模型设置。"
    },
    {
      title: "10. 常见问题",
      text: "后端离线时先关闭软件再重新打开；端口被占用时关闭其他小计窗口；Excel 读取失败时确认文件没有被 Excel 占用且表头在第一行；模型运行失败时优先检查变量名、数值类型、缺失值和样本量。"
    }
  ];

  return (
    <div className="guide-body">
      <div className="guide-lead">
        <strong>从数据到报告的完整流程</strong>
        <span>按下面顺序走一遍，就能完成一次课堂演示或论文建模草稿。</span>
      </div>
      <div className="guide-grid">
        {sections.map((section) => (
          <section className="guide-section" key={section.title}>
            <h3>{section.title}</h3>
            <p>{section.text}</p>
          </section>
        ))}
      </div>
    </div>
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

function PanelResizeHandle({
  active,
  label,
  onPointerDown,
  onDoubleClick
}: {
  active: boolean;
  label: string;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onDoubleClick: () => void;
}) {
  return (
    <div
      className={active ? "panel-resizer active" : "panel-resizer"}
      role="separator"
      aria-label={label}
      aria-orientation="horizontal"
      title="拖动调整当前板块高度，双击恢复本列高度"
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
    />
  );
}

function DemoFlow({ stage }: { stage: DemoStage }) {
  return (
    <div className={`demo-flow demo-flow-${stage}`}>
      <div className="demo-flow-head">
        <strong>路演流程</strong>
        <span>{demoStageLabel(stage)}</span>
      </div>
      <div className="demo-step-list">
        {DEMO_FLOW_STEPS.map((item) => {
          const state = demoStepState(stage, item.stage);
          return (
            <div className={`demo-step demo-step-${state}`} key={item.stage}>
              <i />
              <div>
                <strong>{item.title}</strong>
                <span>{item.detail}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DemoScenarioBrief({
  profile,
  stage,
  onAsk
}: {
  profile: DataProfile | null;
  stage: DemoStage;
  onAsk: (question: string) => void;
}) {
  if (stage === "idle" && !isDemoProfile(profile)) return null;

  const fieldNotes = [
    ["innovation_index", "城市创新水平"],
    ["digital_economy_index", "数字经济发展水平"],
    ["broadband_access", "数字基础设施"],
    ["fiscal_science_spending", "财政科技支出"],
    ["human_capital", "人力资本"],
    ["industrial_upgrade", "产业结构升级"],
    ["smart_city_pilot", "智慧城市试点"]
  ];

  return (
    <details className="scenario-brief">
      <summary>
        <span>演示场景</span>
        <strong>城市面板</strong>
      </summary>
      <p>
        这份演示数据把多个城市跨年份数据放在一起，问题不是单纯写一段 OLS，而是先识别城市 × 年份结构，再讨论固定效应、控制变量和因果边界。
      </p>
      <div className="scenario-grid">
        <div>
          <span>研究对象</span>
          <strong>数字经济与城市创新</strong>
        </div>
        <div>
          <span>识别路径</span>
          <strong>面板固定效应</strong>
        </div>
        <div>
          <span>展示重点</span>
          <strong>发现关系，不替代判断</strong>
        </div>
      </div>
      <div className="scenario-field-list">
        {fieldNotes.map(([name, label]) => (
          <span key={name}>
            <strong>{name}</strong>
            {label}
          </span>
        ))}
      </div>
      <button
        className="scenario-ask"
        type="button"
        onClick={() => onAsk("请帮我用答辩口吻解释这个城市面板演示为什么比普通 OLS 演示更有说服力。")}
      >
        追问场景价值
      </button>
    </details>
  );
}

function DemoBrief({
  profile,
  path,
  recommendation,
  runResult,
  stage,
  onAsk
}: {
  profile: DataProfile | null;
  path: ResearchPath | null;
  recommendation: ModelRecommendation | null;
  runResult: RunModelResponse | null;
  stage: DemoStage;
  onAsk: (question: string) => void;
}) {
  if (stage === "idle" && !isDemoProfile(profile)) return null;

  const model = recommendation?.model ?? path?.model ?? DEMO_MODEL_TYPE;
  const structure = path?.structure ?? "城市 × 年份面板演示数据，用来展示从数据画像到模型结果的完整路径。";
  const resultText = demoResultText(runResult);

  return (
    <div className="demo-brief">
      <div className="demo-brief-head">
        <span>演示讲解卡</span>
        <strong>{stage === "ready" ? "可直接讲" : "准备中"}</strong>
      </div>
      <p className="demo-brief-lead">这不是让小计替研究者下结论，而是让它把“发现问题、选择路径、解释边界”串起来。</p>
      <div className="demo-brief-list">
        <div>
          <span>1</span>
          <p>{structure}</p>
        </div>
        <div>
          <span>2</span>
          <p>{demoFindingText(profile)}</p>
        </div>
        <div>
          <span>3</span>
          <p>推荐使用 {modelLabel(model)}，先控制城市和年份层面的固定差异。</p>
        </div>
        <div>
          <span>4</span>
          <p>{resultText}</p>
        </div>
      </div>
      <div className="review-questions">
        <div className="review-questions-title">评审追问</div>
        <div className="review-question-list">
          {DEMO_REVIEW_QUESTIONS.map((item) => (
            <button className="review-question" type="button" key={item.label} onClick={() => onAsk(item.question)}>
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function DemoScript({
  profile,
  path,
  recommendation,
  runResult,
  stage
}: {
  profile: DataProfile | null;
  path: ResearchPath | null;
  recommendation: ModelRecommendation | null;
  runResult: RunModelResponse | null;
  stage: DemoStage;
}) {
  if (stage === "idle" && !isDemoProfile(profile)) return null;

  const sections = buildDemoScript({ profile, path, recommendation, runResult });

  return (
    <div className="demo-script">
      <div className="demo-script-head">
        <span>路演稿</span>
        <strong>3 分钟</strong>
      </div>
      <div className="demo-script-list">
        {sections.map((section) => (
          <div className="demo-script-item" key={section.time}>
            <span>{section.time}</span>
            <div>
              <strong>{section.title}</strong>
              <p>{section.text}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DefenseCardsView({
  profile,
  path,
  recommendation,
  runResult,
  onAsk
}: {
  profile: DataProfile | null;
  path: ResearchPath | null;
  recommendation: ModelRecommendation | null;
  runResult: RunModelResponse | null;
  onAsk: (question: string) => void;
}) {
  if (!profile && !path) return null;

  const cards = buildDefenseCards({ profile, path, recommendation, runResult });

  return (
    <details className="defense-cards">
      <summary>
        <span>现场答辩卡</span>
        <strong>{cards.length} 个常见问题</strong>
      </summary>
      <div className="defense-card-list">
        {cards.map((card) => (
          <article className="defense-card" key={card.title}>
            <div className="defense-card-head">
              <span>{card.title}</span>
              <button type="button" onClick={() => onAsk(card.prompt)}>
                放入问答
              </button>
            </div>
            <strong>{card.question}</strong>
            <p>{card.answer}</p>
          </article>
        ))}
      </div>
    </details>
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

function dataQualityRisks(profile: DataProfile): string[] {
  const diagnostics = profile.diagnostics;
  if (!diagnostics) return [];

  const risks: string[] = [];
  if (diagnostics.duplicate_rows > 0) {
    risks.push(`重复行 ${diagnostics.duplicate_rows} 行，建模前需要确认是否重复采样。`);
  }
  diagnostics.high_missing_columns.slice(0, 2).forEach((item) => {
    risks.push(`${item.name} 缺失率 ${formatPercent(item.missing_rate)}，可能影响样本保留。`);
  });
  diagnostics.constant_columns.slice(0, 2).forEach((name) => {
    risks.push(`${name} 近似常量，进入回归前要确认是否有解释价值。`);
  });
  diagnostics.outlier_columns.slice(0, 2).forEach((item) => {
    risks.push(`${item.name} 有 ${item.outliers} 个 IQR 异常值，建议先看分布或做稳健处理。`);
  });
  diagnostics.modeling_warnings.slice(0, 3).forEach((item) => {
    risks.push(`${item.name}：${item.reason}`);
  });

  return Array.from(new Set(risks)).slice(0, 4);
}

function DataQualityBrief({
  profile,
  onAsk
}: {
  profile: DataProfile | null;
  onAsk: (question: string) => void;
}) {
  if (!profile) return null;

  const diagnostics = profile.diagnostics;
  const riskItems = dataQualityRisks(profile);
  const askText = "这份数据目前最值得优先处理的质量风险是什么？请按缺失、重复、异常值、变量关系和建模影响分点说明。";

  if (!diagnostics) {
    return (
      <div className="quality-brief">
        <div className="quality-head">
          <span>数据体检</span>
          <strong>基础</strong>
        </div>
        <div className="quality-metrics">
          <div>
            <strong>{profile.rows}</strong>
            <span>样本量</span>
          </div>
          <div>
            <strong>{profile.columns_count}</strong>
            <span>字段数</span>
          </div>
        </div>
      </div>
    );
  }

  const panel = diagnostics.panel_hint;
  const riskCount = (
    (diagnostics.duplicate_rows > 0 ? 1 : 0) +
    diagnostics.high_missing_columns.length +
    diagnostics.constant_columns.length +
    diagnostics.outlier_columns.length +
    diagnostics.modeling_warnings.length
  );

  return (
    <div className="quality-brief">
      <div className="quality-head">
        <span>数据体检</span>
        <button className="quality-ask" type="button" onClick={() => onAsk(askText)}>
          追问风险
        </button>
      </div>
      <div className="quality-metrics">
        <div>
          <strong>{formatPercent(diagnostics.missing_rate)}</strong>
          <span>缺失率</span>
        </div>
        <div>
          <strong>{diagnostics.duplicate_rows}</strong>
          <span>重复行</span>
        </div>
        <div>
          <strong>{riskCount}</strong>
          <span>风险项</span>
        </div>
        <div>
          <strong>{diagnostics.relationship_hints.length}</strong>
          <span>关系线索</span>
        </div>
      </div>
      {panel ? (
        <div className="quality-panel-line">
          <strong>{panel.entity_column} × {panel.time_column}</strong>
          <span>{panel.units} 个个体，{panel.periods} 期，{panel.is_balanced ? "平衡面板" : `缺 ${panel.missing_cells} 格`}</span>
        </div>
      ) : null}
      <ul className="quality-risk-list">
        {(riskItems.length ? riskItems : ["暂未发现明显质量风险。"]).map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
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

function ResearchPathView({
  path,
  onUseQuestion,
  onAskQuestion
}: {
  path: ResearchPath | null;
  onUseQuestion: (question: string) => void;
  onAskQuestion: (question: string) => void;
}) {
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
        <div className="question-candidate-list">
          {path.questionCandidates.map((item) => (
            <div className="question-candidate" key={item}>
              <p>{item}</p>
              <div>
                <button type="button" onClick={() => onUseQuestion(item)}>采用</button>
                <button type="button" onClick={() => onAskQuestion(`围绕这个研究问题继续展开：${item}`)}>追问</button>
              </div>
            </div>
          ))}
        </div>
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
      <ResultInterpretation result={result} />
      <CoefficientTable coefficients={result.results.coefficients} />
    </div>
  );
}

function ResultInterpretation({ result }: { result: RunModelResponse }) {
  if (!result.results) return null;

  const primary = mainCoefficient(result.results.coefficients);
  const significant = significantCoefficients(result.results.coefficients);
  const primaryText =
    primary && hasNumber(primary.coefficient)
      ? `${primary.variable} 为${coefficientDirection(primary.coefficient)}，系数 ${formatNumber(primary.coefficient)}，${significanceText(primary.p_value)}。`
      : "还没有可直接解读的核心系数。";
  const significantText = significant.length
    ? significant
        .map((item) => `${item.variable}（${coefficientDirection(item.coefficient)}，p=${formatNumber(item.p_value)}）`)
        .join("；")
    : "暂未看到 5% 水平显著的解释变量。";

  return (
    <div className="result-insights">
      <section className="result-insight-card">
        <span>核心变量</span>
        <p>{primaryText}</p>
      </section>
      <section className="result-insight-card">
        <span>显著项</span>
        <p>{significantText}</p>
      </section>
      <section className="result-insight-card">
        <span>解释边界</span>
        <p>{resultBoundary(result.model_type)}</p>
      </section>
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
