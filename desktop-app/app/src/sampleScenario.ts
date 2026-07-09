import type { DataProfile, ModelRequest } from "./types";

export const SAMPLE_SCENARIO = {
  question: "数字经济发展是否会提升城市创新水平？",
  columns: "城市, 省份, 区域, 年份, 创新指数, 数字经济发展指数, 宽带接入率, 财政科技支出, 人力资本, 产业结构升级, 人口密度, 智慧城市试点, 绿色专利占比",
  dependentVariable: "创新指数",
  independentVariables: "数字经济发展指数, 宽带接入率, 财政科技支出, 人力资本, 产业结构升级, 人口密度",
  entityColumn: "城市",
  timeColumn: "年份",
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
    ["创新指数", "被解释变量（Y）：城市创新水平"],
    ["数字经济发展指数", "核心解释变量：数字经济发展水平"],
    ["宽带接入率", "控制变量：数字基础设施"],
    ["财政科技支出", "控制变量：财政科技投入强度"],
    ["人力资本", "控制变量：人力资本水平"],
    ["产业结构升级", "控制变量：产业结构升级程度"],
    ["人口密度", "控制变量：人口集聚程度"],
    ["智慧城市试点", "控制变量：是否试点城市（0/1）"],
    ["绿色专利占比", "辅助变量：绿色专利占比"]
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
    names.has("数字经济发展指数") &&
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
