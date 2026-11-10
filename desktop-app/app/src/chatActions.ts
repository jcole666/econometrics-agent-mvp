/** 小计对话可下发的工作台操作；前端按 type 执行，未知 type 忽略。 */

export type ChatActionType =
  | "set_question"
  | "set_dependent"
  | "set_independent"
  | "set_entity"
  | "set_time"
  | "set_treatment"
  | "set_running"
  | "set_instrument"
  | "set_model"
  | "goto_step"
  | "run_profile"
  | "infer_dictionary"
  | "infer_variables"
  | "recommend_model"
  | "run_model"
  | "open_settings"
  | "confirm_dictionary";

export interface ChatAction {
  type: ChatActionType;
  value?: string | number | string[] | null;
  step?: number;
}

const ACTION_TYPES = new Set<string>([
  "set_question",
  "set_dependent",
  "set_independent",
  "set_entity",
  "set_time",
  "set_treatment",
  "set_running",
  "set_instrument",
  "set_model",
  "goto_step",
  "run_profile",
  "infer_dictionary",
  "infer_variables",
  "recommend_model",
  "run_model",
  "open_settings",
  "confirm_dictionary"
]);

export function normalizeActions(raw: unknown): ChatAction[] {
  if (!Array.isArray(raw)) return [];
  const actions: ChatAction[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const type = String((item as { type?: unknown }).type ?? "").trim();
    if (!ACTION_TYPES.has(type)) continue;
    const action: ChatAction = { type: type as ChatActionType };
    if ("value" in (item as object)) {
      action.value = (item as { value?: ChatAction["value"] }).value ?? null;
    }
    if ("step" in (item as object)) {
      const step = Number((item as { step?: unknown }).step);
      if (Number.isFinite(step)) action.step = step;
    }
    actions.push(action);
  }
  return actions;
}

export function actionSummary(actions: ChatAction[]): string {
  if (!actions.length) return "";
  const labels: Record<ChatActionType, string> = {
    set_question: "填写研究问题",
    set_dependent: "设置被解释变量",
    set_independent: "设置解释变量",
    set_entity: "设置个体列",
    set_time: "设置时间列",
    set_treatment: "设置处理列",
    set_running: "设置断点变量",
    set_instrument: "设置工具变量",
    set_model: "切换模型",
    goto_step: "跳转步骤",
    run_profile: "生成字段画像",
    infer_dictionary: "推断字段含义",
    infer_variables: "识别变量角色",
    recommend_model: "推荐模型",
    run_model: "运行模型",
    open_settings: "打开模型设置",
    confirm_dictionary: "确认变量字典"
  };
  return actions.map((item) => labels[item.type] ?? item.type).join("、");
}
