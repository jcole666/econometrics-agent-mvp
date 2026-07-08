import {
  Activity,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ChevronDown,
  Cpu,
  Database,
  Download,
  FileText,
  FileUp,
  HelpCircle,
  MessageSquare,
  Minimize2,
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
import {
  chatPreview,
  createChatSession,
  formatChatTime,
  loadChatState,
  saveChatState,
  updateChatMessages,
  type ChatState
} from "./chatSessions";
import {
  DEFAULT_MODEL_SETTINGS,
  loadModelSettings,
  missingModelSettings,
  resetModelSettings as clearStoredModelSettings,
  saveModelSettings as saveStoredModelSettings,
  toLLMConfig,
  type ModelSettings
} from "./modelSettings";
import { ChatMessageBody, MarkdownBody, ThinkingMessage } from "./markdown";
import { saveReportMarkdown, saveReportPdf } from "./reportExport";
import {
  buildSampleRequest,
  isSampleProfile,
  SAMPLE_PANEL_HEIGHTS,
  SAMPLE_RAIL_WIDTHS,
  SAMPLE_SCENARIO,
  SAMPLE_STATUS,
  type SampleStage
} from "./sampleScenario";
import {
  COLUMN_RESIZER_WIDTH,
  DEFAULT_PANEL_HEIGHTS,
  MIN_LEFT_RAIL,
  MIN_MAIN_RAIL,
  MIN_RIGHT_RAIL,
  clamp,
  defaultPanelHeight,
  fitRailWidths,
  loadPanelHeights,
  loadRailWidths,
  panelMinHeight,
  savePanelHeights,
  saveRailWidths,
  type PanelHeights,
  type PanelId,
  type RailId,
  type RailWidths
} from "./workbenchLayout";
import type {
  ChatContext,
  ChatMessage,
  CoefficientResult,
  DataProfile,
  InferVariablesResponse,
  ModelRecommendation,
  ModelRequest,
  RelationshipHint,
  RunModelResponse
} from "./types";

const QUESTION_PLACEHOLDER = `例如：${SAMPLE_SCENARIO.question}`;
const COLUMNS_PLACEHOLDER = `例如：${SAMPLE_SCENARIO.columns}`;
const DEPENDENT_VARIABLE_PLACEHOLDER = `例如：${SAMPLE_SCENARIO.dependentVariable}`;
const INDEPENDENT_VARIABLES_PLACEHOLDER = `例如：${SAMPLE_SCENARIO.independentVariables}`;
const CHAT_PLACEHOLDER = "例如：为什么推荐这个模型？";
type BusyKey = "profile" | "infer" | "recommend" | "run" | "chat" | "report" | "sample";
type ResizeEdge = "left" | "right";
type CheckpointTarget = "question" | "data" | "variables" | "recommendation" | "risk";

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

function firstExistingColumn(profile: DataProfile, names: string[]): string | null {
  const available = new Set(profile.columns.map((column) => column.name));
  return names.find((name) => available.has(name)) ?? null;
}

function fallbackOutcome(profile: DataProfile): string {
  return (
    firstExistingColumn(profile, ["innovation_index", "income", "employment", "gdp", "score"]) ??
    profile.columns.find((column) => column.kind === "数值")?.name ??
    SAMPLE_SCENARIO.dependentVariable
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
    question: question.trim() || "尚未填写研究问题",
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
    detail: hasQuestion ? question.trim() : "先把问题写成「X 是否影响 Y」的形式。",
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
    lines.push(`- 研究路径：当前主线为"${path.question}"，建议下一步关注：${path.nextSteps.slice(0, 3).join("；")}。`);
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
  const [sampleStage, setSampleStage] = useState<SampleStage>("idle");
  const [activeStep, setActiveStep] = useState<number>(1);
  const [showReportPage, setShowReportPage] = useState(false);
  const [showGuideDrawer, setShowGuideDrawer] = useState(false);
  const [showChat, setShowChat] = useState(false);
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

  const columns = useMemo(() => splitList(columnsInput), [columnsInput]);
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
  const workspaceClassName = showReportPage ? "workspace workspace-focused" : "workspace";
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

  const contextSummary = useMemo(() => {
    const parts: string[] = [];
    if (profile) parts.push(`已加载字段画像(${profile.columns?.length ?? 0}列)`);
    if (question.trim()) parts.push("已填写研究问题");
    if (dependentVariable) parts.push(`Y=${dependentVariable}`);
    if (independentVariables) parts.push(`X=${independentVariables}`);
    if (recommendation) parts.push("已生成模型推荐");
    if (runResult) parts.push("已有模型结果");
    if (report.trim()) parts.push("已有报告草稿");
    return parts.length > 0 ? `当前上下文：${parts.join("，")}` : "";
  }, [profile, question, dependentVariable, independentVariables, recommendation, runResult, report]);

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

  function showStep(step: number) {
    setActiveStep(step);
    if (step === 1) setStatus(profile ? "正在查看数据与字段画像。" : "先选择数据并生成字段画像。");
    if (step === 2) setStatus("请确认变量设定和模型推荐。");
    if (step === 3) setStatus(recommendation ? "请确认模型路径并运行。" : "先生成模型推荐。");
    if (step === 4) setStatus(report.trim() ? "报告已生成，可查看或导出。" : "点击生成报告查看分析结果。");
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
    setActiveStep(1);
    setShowReportPage(false);
    setShowGuideDrawer(false);
    setRailWidths(fitRailWidths(SAMPLE_RAIL_WIDTHS, workspaceRailSpace()));
    setPanelHeights({
      left: { ...SAMPLE_PANEL_HEIGHTS.left },
      main: { ...SAMPLE_PANEL_HEIGHTS.main },
      right: { ...SAMPLE_PANEL_HEIGHTS.right }
    });
    setStatus("已恢复推荐布局。");
  }

  useEffect(() => {
    getHealth()
      .then(() => setHealth("online"))
      .catch(() => setHealth("offline"));
  }, []);

  useEffect(() => {
    saveRailWidths(railWidths);
  }, [railWidths]);

  useEffect(() => {
    savePanelHeights(panelHeights);
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
    saveChatState(chatState);
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
    return window.workbench?.onOpenModelSettings?.(() => {
      setSettingsDraft(loadModelSettings());
      setSettingsOpen(true);
    });
  }, []);

  useEffect(() => {
    return window.workbench?.onDataFileSelected?.((payload) => {
      const next = new File([payload.data], payload.name, { type: dataFileType(payload.name) });
      setSelectedFile(next);
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
      dependent_variable: dependentVariable.trim() || null,
      independent_variables: splitList(independentVariables),
      entity_column: entityColumn.trim() || null,
      time_column: timeColumn.trim() || null,
      treatment_column: treatmentColumn.trim() || null,
      running_variable: runningVariable.trim() || null,
      instrument_variable: instrumentVariable.trim() || null,
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
    saveStoredModelSettings(settingsDraft);
    setSettingsOpen(false);
    setStatus(settingsDraft.enabled ? "模型配置已保存。" : "已切换为本地规则。");
  }

  function resetModelSettings() {
    clearStoredModelSettings();
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

  function resetAnalysisForNewFile() {
    setProfile(null);
    setColumnsInput("");
    setDependentVariable("");
    setIndependentVariables("");
    setEntityColumn("");
    setTimeColumn("");
    setTreatmentColumn("");
    setRunningVariable("");
    setInstrumentVariable("");
    setInference(null);
    setRecommendation(null);
    setRecommendationNotice(null);
    setModelType("OLS");
    setRunResult(null);
    setRunNotice(null);
    setReport("");
    setSampleStage("idle");
    setActiveStep(1);
    setShowReportPage(false);
    setConfirmedCheckpoints([]);
  }

  function setSelectedFile(next: File | null) {
    setFile(next);
    resetAnalysisForNewFile();
  }

  function requireColumns() {
    if (columns.length > 0) return true;
    const message = "请先选择数据文件并生成字段画像，或手动填写字段列表。";
    setStatus(message);
    return false;
  }

  function requireRunVariables() {
    const y = dependentVariable.trim();
    const xs = splitList(independentVariables);

    if (y && xs.length > 0) return true;

    const message = !y && xs.length === 0
      ? "请先填写被解释变量 Y 和解释变量 X。"
      : !y
        ? "请先填写被解释变量 Y。"
        : "请先填写至少一个解释变量 X。";

    setActiveStep(2);
    setRunNotice(message);
    setStatus(message);
    return false;
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.files?.[0] ?? null;
    setSelectedFile(next);
    setStatus(next ? `已选择 ${next.name}` : "就绪");
  }

  function updateQuestion(value: string) {
    setQuestion(value);
    setRecommendationNotice(null);
    setRunNotice(null);
  }

  function useCandidateQuestion(questionText: string) {
    setActiveStep(2);
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
      setActiveStep(1);
      window.setTimeout(() => questionInputRef.current?.focus(), 0);
      setStatus("请确认研究问题。");
      return;
    }

    if (target === "data") {
      setActiveStep(1);
      if (!file) {
        setStatus(SAMPLE_STATUS.needsData);
        return;
      }
      window.setTimeout(() => columnsInputRef.current?.focus(), 0);
      setStatus(profile ? "字段画像已生成，可以继续确认数据结构。" : "点击「生成字段画像」查看数据结构。");
      return;
    }

    if (target === "variables") {
      setActiveStep(2);
      window.setTimeout(() => {
        const targetInput = dependentVariable.trim() ? independentInputRef.current : dependentInputRef.current;
        targetInput?.focus();
      }, 0);
      setStatus("请确认变量设定。");
      return;
    }

    if (target === "recommendation") {
      setActiveStep(3);
      setStatus(recommendation ? "请检查模型推荐和识别策略。" : "点击「推荐模型」生成识别策略建议。");
      return;
    }

    setActiveStep(3);
    setStatus("请确认风险边界，必要时回到变量配置或继续向小计提问。");
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
      setActiveStep(1);
      setStatus("字段画像已生成。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "字段画像生成失败。");
    } finally {
      setBusy(null);
    }
  }

  function applySampleState(sampleFile: File, sampleProfile: DataProfile) {
    setFile(sampleFile);
    setProfile(sampleProfile);
    setQuestion(SAMPLE_SCENARIO.question);
    setColumnsInput(sampleProfile.columns.map((column) => column.name).join(", "));
    setDependentVariable(SAMPLE_SCENARIO.dependentVariable);
    setIndependentVariables(SAMPLE_SCENARIO.independentVariables);
    setEntityColumn(SAMPLE_SCENARIO.entityColumn);
    setTimeColumn(SAMPLE_SCENARIO.timeColumn);
    setTreatmentColumn("");
    setRunningVariable("");
    setInstrumentVariable("");
    setModelType(SAMPLE_SCENARIO.modelType);
    setInference(null);
    setRecommendation(null);
    setRecommendationNotice(null);
    setRunResult(null);
    setRunNotice(null);
    setReport("");
    setSampleStage("data");
  }

  async function loadSampleScenario() {
    setBusy("sample");
    setActiveStep(1);
    setSampleStage("data");
    try {
      const [sampleFile, sampleProfile] = await Promise.all([loadSampleFile(), loadSampleProfile()]);
      applySampleState(sampleFile, sampleProfile);

      const request = buildSampleRequest(sampleProfile);

      setSampleStage("recommend");
      setStatus(SAMPLE_STATUS.recommending);
      const nextRecommendation = await recommendModel(request);
      const nextModel = nextRecommendation.model || SAMPLE_SCENARIO.modelType;
      setRecommendation(nextRecommendation);
      setModelType(nextModel);

      setSampleStage("run");
      setStatus(SAMPLE_STATUS.running);
      const nextRunResult = await runModel(sampleFile, request, nextModel);
      setRunResult(nextRunResult);
      setRunNotice(nextRunResult.success ? null : nextRunResult.error ?? "模型运行失败。");
      if (!nextRunResult.success) {
        throw new Error(nextRunResult.error ?? "模型运行失败。");
      }

      const nextPath = buildResearchPath({
        profile: sampleProfile,
        question: SAMPLE_SCENARIO.question,
        dependentVariable: SAMPLE_SCENARIO.dependentVariable,
        independentVariables: SAMPLE_SCENARIO.independentVariables,
        entityColumn: SAMPLE_SCENARIO.entityColumn,
        timeColumn: SAMPLE_SCENARIO.timeColumn,
        modelType: nextModel,
        recommendation: nextRecommendation,
      });
      const notes = buildReportNotes({
        profile: sampleProfile,
        path: nextPath,
        recommendation: nextRecommendation,
        inferenceReasoning: null
      });

      setSampleStage("report");
      setStatus(SAMPLE_STATUS.reporting);
      const nextReport = await generateReport(SAMPLE_SCENARIO.question, nextModel, nextRunResult.results, notes, { enabled: false });
      setReport(nextReport.markdown);
      setConfirmedCheckpoints(["question", "data", "variables", "recommendation"]);
      setSampleStage("ready");
      setStatus(SAMPLE_STATUS.ready);
    } catch (error) {
      setSampleStage("error");
      setStatus(error instanceof Error ? error.message : SAMPLE_STATUS.failed);
    } finally {
      setBusy(null);
    }
  }

  async function infer() {
    const researchQuestion = requireResearchQuestion();
    if (!researchQuestion) return;
    if (!requireColumns()) return;

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
    if (!requireColumns()) {
      setRecommendationNotice("请先补全字段列表，再生成模型推荐。");
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
      const message = SAMPLE_STATUS.needsData;
      setRunNotice(message);
      setStatus(message);
      return;
    }
    const researchQuestion = requireResearchQuestion();
    if (!researchQuestion) {
      setRunNotice("请先填写研究问题，再运行模型。");
      return;
    }
    if (!requireRunVariables()) return;

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
    setChatState((current) => updateChatMessages(current, sessionId, messages));
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
      setShowReportPage(true);
      setActiveStep(4);
      setStatus("报告已生成。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "报告生成失败。");
    } finally {
      setBusy(null);
    }
  }

  async function exportReportMd() {
    const message = await saveReportMarkdown(report, question);
    if (message) setStatus(message);
  }

  async function exportReportPdf() {
    const message = await saveReportPdf(report, question);
    if (message) setStatus(message);
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
            className="topbar-tool-button"
            type="button"
            onClick={resetWorkspaceLayout}
            title="恢复推荐工作台布局"
          >
            <RotateCcw size={16} />
            <span>重置布局</span>
          </button>
          <button
            className="icon-button"
            type="button"
            onClick={() => setShowGuideDrawer(true)}
            title="使用文档"
            aria-label="使用文档"
          >
            <BookOpen size={18} />
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
        {showReportPage ? (
          <div className="report-page">
            <div className="report-page-topbar">
              <button className="secondary" type="button" onClick={() => setShowReportPage(false)} title="返回工作台">
                <ArrowLeft size={16} />
                <span>返回工作台</span>
              </button>
              <h2>分析报告</h2>
              <div className="report-actions">
                <button type="button" onClick={makeReport} disabled={isWorking}>
                  <RefreshCw size={16} />
                  <span>生成/刷新报告</span>
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
            </div>
            <div className="report-page-body">
              <aside className="report-outline">
                <h3>报告目录</h3>
                {report.trim() ? (
                  <nav>
                    {report.split("\n").filter((line) => /^#{1,4}\s/.test(line)).map((line, i) => {
                      const level = line.match(/^(#{1,4})\s/)?.[1]?.length ?? 1;
                      return (
                        <a key={i} style={{ paddingLeft: (level - 1) * 12 }}>
                          <span>{i + 1}</span>
                          {line.replace(/^#{1,4}\s/, "")}
                        </a>
                      );
                    })}
                  </nav>
                ) : (
                  <div className="report-outline-empty">尚未生成报告。</div>
                )}
              </aside>
              <section className="report-preview-pane">
                {report.trim() ? (
                  <MarkdownBody value={report} className="report report-rendered chat-markdown" />
                ) : (
                  <div className="report report-empty">尚未生成报告。点击上方"生成/刷新报告"开始。</div>
                )}
              </section>
              <aside className="report-ai-tools">
                <h3>AI 辅助润色</h3>
                {report.trim() ? (
                  <>
                    <p className="report-ai-head">选择报告段落后，可以在这里让 AI 帮你润色表达、调整结构或补充说明。</p>
                    <button className="secondary wide" type="button" onClick={() => { setShowReportPage(false); setShowChat(true); }} disabled={isWorking}>
                      <MessageSquare size={16} />
                      <span>打开小计对话润色</span>
                    </button>
                  </>
                ) : (
                  <p className="report-ai-head">生成报告后可以使用 AI 辅助润色。</p>
                )}
              </aside>
            </div>
          </div>
        ) : (
          <>
            <aside className="rail rail-left">
              <Panel title="数据" icon={<Database size={17} />} style={panelStyle("left", "data")}>
                <div className="file-row">
                  <label className="file-button" title="选择数据文件">
                    <FileUp size={16} />
                    <span>选择</span>
                    <input type="file" accept=".csv,.xlsx,.xls" onChange={onFileChange} />
                  </label>
                  <button type="button" onClick={loadSampleScenario} disabled={isWorking} title="一键加载示例数据">
                    <Sparkles size={16} />
                    <span>{busy === "sample" ? "准备中" : "示例"}</span>
                  </button>
                </div>
                <div className="filename">{file?.name ?? "尚未选择文件"}</div>
                <SampleScenarioBrief profile={profile} stage={sampleStage} />
                <DataQualityBrief profile={profile} />
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
            </aside>

            <ColumnResizeHandle
              active={resizeEdge === "left"}
              label="拖动调整左侧宽度"
              onPointerDown={(event) => startColumnResize("left", event)}
            />

            <section className="rail rail-main">
              <div className="flow-overview">
                <div className="flow-overview-head">
                  <h2>分析流程</h2>
                  <span className="note">
                    {activeStep === 1 ? "下一步：确认变量" : activeStep === 2 ? "下一步：形成模型路径" : activeStep === 3 ? "下一步：解释结果" : "分析完成"}
                  </span>
                </div>
                <div className="flow-step-grid">
                  <button
                    className={`flow-step ${activeStep === 1 ? "flow-step-active" : ""} ${profile ? "flow-step-done" : ""}`}
                    type="button"
                    onClick={() => showStep(1)}
                  >
                    <span className="flow-step-index">1</span>
                    <div className="flow-step-copy">
                      <span className="flow-step-title"><strong>读取数据</strong></span>
                      <span>选择 CSV 或 Excel 后生成画像</span>
                    </div>
                  </button>
                  <button
                    className={`flow-step ${activeStep === 2 ? "flow-step-active" : ""} ${dependentVariable || independentVariables ? "flow-step-done" : ""}`}
                    type="button"
                    onClick={() => showStep(2)}
                  >
                    <span className="flow-step-index">2</span>
                    <div className="flow-step-copy">
                      <span className="flow-step-title"><strong>确认变量</strong></span>
                      <span>识别或手动填写 Y / X</span>
                    </div>
                  </button>
                  <button
                    className={`flow-step ${activeStep === 3 ? "flow-step-active" : ""} ${recommendation ? "flow-step-done" : ""}`}
                    type="button"
                    onClick={() => showStep(3)}
                  >
                    <span className="flow-step-index">3</span>
                    <div className="flow-step-copy">
                      <span className="flow-step-title"><strong>形成模型路径</strong></span>
                      <span>结合研究问题推荐模型</span>
                    </div>
                  </button>
                  <button
                    className={`flow-step ${activeStep === 4 ? "flow-step-active" : ""} ${runResult ? "flow-step-done" : ""}`}
                    type="button"
                    onClick={() => showStep(4)}
                  >
                    <span className="flow-step-index">4</span>
                    <div className="flow-step-copy">
                      <span className="flow-step-title"><strong>解释结果</strong></span>
                      <span>查看系数、显著性和边界</span>
                    </div>
                  </button>
                </div>
              </div>

              <div className="dynamic-panel">
                {activeStep === 1 ? (
                  <div className="dynamic-stack">
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
                    {profile ? (
                      <>
                        <Panel title="字段画像" icon={<TableProperties size={17} />}>
                          <RelationshipMap hints={profile.diagnostics?.relationship_hints?.slice(0, 8) ?? []} />
                          <ProfileTable profile={profile} />
                        </Panel>
                      </>
                    ) : (
                      <div className="profile-empty-state">
                        <TableProperties size={32} />
                        <p>尚未生成字段画像</p>
                        <span>选择数据文件后点击左侧"生成字段画像"按钮</span>
                      </div>
                    )}
                  </div>
                ) : activeStep === 2 ? (
                  <div className="dynamic-stack">
                    <Panel title="变量配置" icon={<Wand2 size={17} />}>
                      <div className="inline-variable-form">
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
                      </div>
                    </Panel>
                    {profile ? (
                      <Panel title="字段画像" icon={<TableProperties size={17} />}>
                        <ProfileTable profile={profile} />
                      </Panel>
                    ) : null}
                  </div>
                ) : activeStep === 3 ? (
                  <div className="dynamic-stack">
                    <Panel title="模型推荐" icon={<Cpu size={17} />} style={panelStyle("main", "recommendation")}>
                      <div className="model-command-bar">
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
                    {researchPath ? (
                      <Panel title="研究路径" icon={<Sparkles size={17} />}>
                        <ResearchPathView
                          path={researchPath}
                          onUseQuestion={useCandidateQuestion}
                        />
                        <CollaborationCheckpoints
                          checkpoints={collaborationCheckpoints}
                          confirmedIds={confirmedCheckpoints}
                          onToggle={toggleCheckpoint}
                          onFocus={focusCheckpointTarget}
                        />
                      </Panel>
                    ) : null}
                    {runResult ? (
                      <Panel title="模型结果" icon={<Activity size={17} />}>
                        <RunResultView result={runResult} notice={runNotice} />
                      </Panel>
                    ) : null}
                  </div>
                ) : (
                  <div className="dynamic-stack">
                    <Panel title="报告入口" icon={<FileText size={17} />}>
                      <div className="inline-report-panel">
                        <div className="report-actions">
                          <button type="button" onClick={makeReport} disabled={isWorking}>
                            <FileText size={16} />
                            <span>生成报告</span>
                          </button>
                          <button type="button" onClick={() => setShowReportPage(true)} disabled={!report.trim()} className="secondary">
                            <ArrowRight size={16} />
                            <span>查看报告</span>
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
                        {report.trim() ? (
                          <div className="report-entry">
                            <MarkdownBody value={report} className="report report-rendered chat-markdown" />
                            <div className="report-entry-actions" />
                          </div>
                        ) : (
                          <div className="report report-empty">尚未生成报告。点击"生成报告"开始。</div>
                        )}
                      </div>
                    </Panel>
                    {runResult ? (
                      <Panel title="模型结果" icon={<Activity size={17} />}>
                        <RunResultView result={runResult} notice={runNotice} />
                      </Panel>
                    ) : null}
                  </div>
                )}
              </div>
            </section>

            {showChat ? (
              <aside className="floating-chat">
                <div className="panel">
                  <h3>小计回答</h3>
                  <button
                    className="floating-chat-minimize"
                    type="button"
                    onClick={() => setShowChat(false)}
                    title="收起小计"
                  >
                    <Minimize2 size={16} />
                  </button>
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
                  <div className="assistant-context">
                    {contextSummary ? (
                      <span className="assistant-context-line">{contextSummary}</span>
                    ) : null}
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
                </div>
              </aside>
            ) : (
              <button
                className="floating-chat-launcher"
                type="button"
                onClick={() => setShowChat(true)}
                title="打开小计回答"
              >
                <MessageSquare size={20} />
                <span>小计</span>
              </button>
            )}
          </>
        )}

        {showGuideDrawer ? (
          <>
            <div className="guide-drawer-backdrop" onClick={() => setShowGuideDrawer(false)} />
            <aside className="guide-drawer">
              <div className="guide-drawer-head">
                <h2>新手引导</h2>
                <button className="icon-button" type="button" onClick={() => setShowGuideDrawer(false)} title="关闭">
                  <X size={18} />
                </button>
              </div>
              <div className="guide-panel">
                <UserGuideView />
              </div>
            </aside>
          </>
        ) : null}

        {!showReportPage ? (
          <button
            className="guide-floating-button"
            type="button"
            onClick={() => setShowGuideDrawer(true)}
            title="使用文档"
          >
            <HelpCircle size={22} />
          </button>
        ) : null}
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
      text: "双击项目根目录的 小计.exe。启动后看顶部状态条：显示「后端服务在线」时，本地分析服务已经准备好。工作台以中栏 4 步分析流程为主轴，左侧放数据端信息，右侧是浮动问答小窗。"
    },
    {
      title: "2. 选择数据或使用示例",
      text: "自己的数据点击左侧「选择」，支持 CSV、xlsx、xls。想快速体验完整流程时点击「示例」，它会加载城市面板示例数据，并自动准备研究问题、变量、模型推荐、运行结果和报告草稿。"
    },
    {
      title: "3. 生成字段画像",
      text: "选择文件后点击左侧「生成字段画像」。小计会读取字段类型、缺失值、唯一值、样例值、重复行、可能的个体列和时间列，还会把明显的数据质量风险提前列出来。生成后中栏第 1 步会展示关系地图和字段详情表。"
    },
    {
      title: "4. 填写研究问题和变量（第 1-2 步）",
      text: "中栏第 1 步填写研究问题，例如「数字经济发展是否会提升城市创新水平？」。第 2 步填写被解释变量 Y、解释变量 X，以及个体列、时间列、处理列、断点变量或工具变量。多个 X 用英文逗号分隔。点击左侧步骤按钮即可切换。"
    },
    {
      title: "5. 推荐并运行模型（第 3 步）",
      text: "进入中栏第 3 步，点击「推荐模型」后小计会根据研究问题、字段和变量配置给出模型建议。确认模型类型后点击「运行模型」。当前 OLS、Logit、面板固定效应支持直接运行；DID、RDD、IV-2SLS 会先给识别路径、检查清单和代码模板。完整模型检验框架见项目文档 docs/model-check-framework.md。"
    },
    {
      title: "6. 查看研究路径",
      text: "第 3 步动态面板中会展示研究路径，包含候选研究问题、变量设定、识别思路、假设边界和协作检查点。候选问题可以直接采用，也可以放入右侧问答继续展开。"
    },
    {
      title: "7. 使用小计问答（右侧浮动窗）",
      text: "点击右下角「小计」浮动按钮打开问答窗。问答会读取当前字段画像、研究问题、变量配置、模型推荐、模型结果和报告草稿。建议先生成字段画像和模型推荐，再输入自己的问题，例如「为什么推荐这个模型」「系数怎么解释」「下一步要检查什么」。"
    },
    {
      title: "8. 生成和导出报告（第 4 步）",
      text: "进入第 4 步点击「生成报告」，再点击「查看报告」进入全屏报告页。报告页左侧有目录，中间是 Markdown 预览，右侧可以打开小计对话辅助润色。支持导出 MD 和 PDF。"
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
        <span>按下面顺序走一遍，就能完成一次建模练习或论文建模草稿。</span>
      </div>
      <div className="guide-grid">
        {sections.map((section) => (
          <details className="guide-section" key={section.title}>
            <summary>
              <span className="guide-section-number">{section.title}</span>
              <div className="guide-section-copy">
                <strong>{section.title}</strong>
                <span>{section.text?.substring(0, 40)}</span>
              </div>
              <span className="guide-section-icon">
                <ChevronDown size={16} />
              </span>
            </summary>
            <p>{section.text}</p>
          </details>
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

function SampleScenarioBrief({
  profile,
  stage
}: {
  profile: DataProfile | null;
  stage: SampleStage;
}) {
  if (stage === "idle" && !isSampleProfile(profile)) return null;

  return (
    <details className="scenario-brief">
      <summary>
        <span>示例说明</span>
        <strong>{SAMPLE_SCENARIO.brief.title}</strong>
      </summary>
      <p>
        这份示例数据把多个城市跨年份数据放在一起，用来学习从字段画像、变量设定到模型运行的完整流程。你可以直接换成自己的 CSV 或 Excel。
      </p>
      <div className="scenario-learning-list">
        {SAMPLE_SCENARIO.learningSteps.map((step, index) => (
          <div key={step}>
            <strong>{index + 1}</strong>
            <span>{step}</span>
          </div>
        ))}
      </div>
      <div className="scenario-grid">
        <div>
          <span>研究对象</span>
          <strong>{SAMPLE_SCENARIO.brief.subject}</strong>
        </div>
        <div>
          <span>识别路径</span>
          <strong>{SAMPLE_SCENARIO.brief.method}</strong>
        </div>
        <div>
          <span>学习重点</span>
          <strong>{SAMPLE_SCENARIO.brief.focus}</strong>
        </div>
      </div>
      <div className="scenario-field-list">
        {SAMPLE_SCENARIO.fields.map(([name, label]) => (
          <span key={name}>
            <strong>{name}</strong>
            {label}
          </span>
        ))}
      </div>
    </details>
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
  profile
}: {
  profile: DataProfile | null;
}) {
  if (!profile) return null;

  const diagnostics = profile.diagnostics;
  const riskItems = dataQualityRisks(profile);

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
        <strong>概览</strong>
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
    { x: 130, y: 78, labelY: 103 },
    { x: 62, y: 35, labelY: 18 },
    { x: 198, y: 35, labelY: 18 },
    { x: 62, y: 122, labelY: 147 },
    { x: 198, y: 122, labelY: 147 },
    { x: 130, y: 132, labelY: 154 },
  ];
  const positions = new Map(names.map((name, index) => [name, slots[index]]));
  const edges = hints.filter((item) => positions.has(item.left) && positions.has(item.right));

  return (
    <div className="relationship-map" aria-label="变量关系地图">
      <svg viewBox="0 0 260 165" role="img">
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
          const label = variableLabelParts(name);
          return (
            <g className={index === 0 ? "relationship-node relationship-node-main" : "relationship-node"} key={name}>
              <title>{name}</title>
              <circle cx={point.x} cy={point.y} r={index === 0 ? 14 : 12} />
              <text x={point.x} y={point.labelY} textAnchor="middle">
                {label.map((part, lineIndex) => (
                  <tspan x={point.x} dy={lineIndex === 0 ? 0 : 9} key={`${name}-${lineIndex}`}>
                    {part}
                  </tspan>
                ))}
              </text>
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

function variableLabelParts(name: string): string[] {
  const clean = name.replace(/\s+/g, "_");
  if (clean.length <= 16) return [clean];

  const parts = clean.split("_").filter(Boolean);
  if (parts.length <= 1) return [shortVariableName(clean, 18)];

  const lines: string[] = [];
  parts.forEach((part) => {
    const last = lines[lines.length - 1];
    if (!last || `${last}_${part}`.length > 16) {
      lines.push(part);
    } else {
      lines[lines.length - 1] = `${last}_${part}`;
    }
  });

  return lines.slice(0, 2).map((line, index) => (
    index === 1 && lines.length > 2 ? shortVariableName(line, 14) : shortVariableName(line, 16)
  ));
}

function shortVariableName(name: string, maxLength = 18): string {
  return name.length > maxLength ? `${name.slice(0, Math.max(1, maxLength - 3))}...` : name;
}

function ResearchPathView({
  path,
  onUseQuestion
}: {
  path: ResearchPath | null;
  onUseQuestion: (question: string) => void;
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
        <div className="path-title">候选研究问题</div>
        <div className="question-candidate-list">
          {path.questionCandidates.map((item) => (
            <div className="question-candidate" key={item}>
              <p>{item}</p>
              <div>
                <button type="button" onClick={() => onUseQuestion(item)}>采用</button>
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
