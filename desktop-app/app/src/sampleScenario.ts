import type { DataProfile, ModelRequest } from "./types";

export const SAMPLE_SCENARIO = {
  question: "数字经济发展是否会提升城市创新水平？",
  columns: "city, province, region, year, innovation_index, digital_economy_index, broadband_access, fiscal_science_spending, human_capital, industrial_upgrade, population_density, smart_city_pilot, green_patent_share",
  dependentVariable: "innovation_index",
  independentVariables: "digital_economy_index, broadband_access, fiscal_science_spending, human_capital, industrial_upgrade, population_density",
  entityColumn: "city",
  timeColumn: "year",
  modelType: "Panel Fixed Effects",
  brief: {
    title: "城市面板",
    subject: "数字经济与城市创新",
    method: "面板固定效应",
    focus: "数据结构与模型检查"
  },
  learningSteps: [
    "先看字段画像，理解每一列是什么、有没有缺失和异常。",
    "再确认研究问题、Y、X、个体列和时间列。",
    "最后查看模型推荐、运行结果和报告草稿。"
  ],
  fields: [
    ["innovation_index", "城市创新水平"],
    ["digital_economy_index", "数字经济发展水平"],
    ["broadband_access", "数字基础设施"],
    ["fiscal_science_spending", "财政科技支出"],
    ["human_capital", "人力资本"],
    ["industrial_upgrade", "产业结构升级"],
    ["smart_city_pilot", "智慧城市试点"]
  ] as Array<[string, string]>
};

export const SAMPLE_STATUS = {
  needsData: "先选择数据文件，或点击示例准备内置数据。",
  recommending: "正在准备示例：生成模型推荐。",
  running: "正在准备示例：运行模型。",
  reporting: "正在准备示例：生成报告。",
  ready: "示例已准备好：数据、推荐、结果和报告都已生成。",
  failed: "示例数据加载失败。"
};

export const SAMPLE_RAIL_WIDTHS = { left: 370, right: 420 };

export const SAMPLE_PANEL_HEIGHTS = {
  left: { data: 640, variables: 330, report: 360 },
  main: { question: 210, profile: 300, path: 430, recommendation: 280, result: 330 },
  right: { chat: 760 }
};

export type SampleStage = "idle" | "data" | "recommend" | "run" | "report" | "ready" | "error";

function toList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function isSampleProfile(profile: DataProfile | null): boolean {
  if (!profile) return false;
  const names = new Set(profile.columns.map((column) => column.name));
  return (
    names.has(SAMPLE_SCENARIO.dependentVariable) &&
    names.has("digital_economy_index") &&
    names.has(SAMPLE_SCENARIO.entityColumn) &&
    names.has(SAMPLE_SCENARIO.timeColumn)
  );
}

export function buildSampleRequest(sampleProfile: DataProfile): ModelRequest {
  return {
    research_question: SAMPLE_SCENARIO.question,
    columns: sampleProfile.columns.map((column) => column.name),
    dependent_variable: SAMPLE_SCENARIO.dependentVariable,
    independent_variables: toList(SAMPLE_SCENARIO.independentVariables),
    entity_column: SAMPLE_SCENARIO.entityColumn,
    time_column: SAMPLE_SCENARIO.timeColumn,
    treatment_column: null,
    running_variable: null,
    instrument_variable: null,
    llm_config: { enabled: false }
  };
}
