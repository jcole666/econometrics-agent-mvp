export type Provider = "rules" | "huawei_maas" | "custom_model" | "model_error" | string;

export interface LLMConfig {
  enabled?: boolean | null;
  api_key?: string | null;
  base_url?: string | null;
  model?: string | null;
  timeout?: number | null;
}

export interface ProfileColumn {
  name: string;
  dtype: string;
  missing: number;
  missing_rate: number;
  unique: number;
  kind: string;
  sample_values: string[];
  min?: number | null;
  max?: number | null;
  non_null?: number | null;
}

export interface DiagnosticColumn {
  name: string;
  missing?: number;
  missing_rate?: number;
}

export interface CategoricalSummary {
  name: string;
  unique: number;
  top_values: string[];
}

export interface OutlierColumn {
  name: string;
  outliers: number;
  lower_bound: number;
  upper_bound: number;
}

export interface ModelingWarning {
  name: string;
  reason: string;
}

export interface RelationshipHint {
  left: string;
  right: string;
  method: string;
  score: number;
  direction: string;
  note: string;
}

export interface PanelHint {
  entity_column: string;
  time_column: string;
  units: number;
  periods: number;
  observed_cells: number;
  expected_cells: number;
  is_balanced: boolean;
  missing_cells: number;
}

export interface DataDiagnostics {
  total_missing: number;
  missing_rate: number;
  duplicate_rows: number;
  numeric_columns: number;
  categorical_columns: number;
  datetime_columns: number;
  possible_time_columns: string[];
  possible_entity_columns: string[];
  high_missing_columns: DiagnosticColumn[];
  constant_columns: string[];
  categorical_summaries: CategoricalSummary[];
  outlier_columns: OutlierColumn[];
  modeling_warnings: ModelingWarning[];
  relationship_hints: RelationshipHint[];
  panel_hint: PanelHint | null;
}

export interface DataProfile {
  rows: number;
  columns_count: number;
  columns: ProfileColumn[];
  diagnostics?: DataDiagnostics;
}

export interface ColumnInfo {
  name: string;
  dtype?: string | null;
  sample_values?: string[];
}

export interface InferVariablesRequest {
  research_question: string;
  columns: ColumnInfo[];
  llm_config?: LLMConfig | null;
}

export interface InferVariablesResponse {
  dependent_variable: string | null;
  independent_variables: string[];
  entity_column: string | null;
  time_column: string | null;
  treatment_column: string | null;
  running_variable: string | null;
  instrument_variable: string | null;
  reasoning: string;
  provider: Provider;
  maas_error?: string | null;
}

export interface ModelRequest {
  research_question: string;
  columns: string[];
  dependent_variable?: string | null;
  independent_variables: string[];
  entity_column?: string | null;
  time_column?: string | null;
  treatment_column?: string | null;
  running_variable?: string | null;
  instrument_variable?: string | null;
  policy_period?: number | null;
  cutoff?: number | null;
  bandwidth?: number | null;
  llm_config?: LLMConfig | null;
}

export interface ModelRecommendation {
  model: string;
  reason: string;
  required_checks: string[];
  generated_code: string;
  provider: Provider;
  maas_used: boolean;
  maas_error?: string | null;
  maas_note?: string | null;
}

export interface CoefficientResult {
  variable: string;
  coefficient: number | null;
  std_error: number | null;
  t_statistic: number | null;
  p_value: number | null;
  ci_lower: number | null;
  ci_upper: number | null;
}

export interface ModelRunResults {
  sample_size: number;
  r_squared: number | null;
  r_squared_adjusted: number | null;
  f_statistic: number | null;
  f_pvalue: number | null;
  log_likelihood: number | null;
  coefficients: CoefficientResult[];
}

export interface RunModelResponse {
  model_type: string;
  success: boolean;
  results: ModelRunResults | null;
  warnings: string[];
  error?: string | null;
  /** executed=已真实估计；planned=仅提供代码方案 */
  execution_status?: "executed" | "planned";
  code_template?: string | null;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatContext {
  data_columns: string[];
  data_summary?: string | null;
  variable_settings?: Record<string, unknown> | null;
  relationship_hints?: RelationshipHint[];
  research_path?: Record<string, unknown> | null;
  recommended_model?: string | null;
  generated_code?: string | null;
  model_results?: ModelRunResults | null;
}

export interface ChatResponse {
  reply: string;
  provider: Provider;
  maas_error?: string | null;
}

export interface ReportResponse {
  markdown: string;
}

// ---------------------------------------------------------------------------
// 变量字典（语义元数据，与 /infer-variables 的建模角色并存）
// ---------------------------------------------------------------------------

export type VariableSemanticType = "numeric" | "category" | "binary" | "datetime" | "text" | "unknown";

export interface VariableDictEntry {
  column: string;
  label: string | null;
  description: string | null;
  type: VariableSemanticType;
  unit: string | null;
  value_labels: Record<string, string>;
  confidence: number | null;
  confirmed: boolean;
  source: "ai" | "user" | "mixed";
  updated_at: string;
}

export interface VariableDictionary {
  dataset_id: string;
  dataset_hash: string;
  entries: Record<string, VariableDictEntry>;
  version: number;
}

export interface VariableDictInferRequest {
  research_question?: string;
  dataset_id: string;
  dataset_hash?: string;
  columns: ProfileColumn[] | ColumnInfo[];
  existing?: VariableDictionary | null;
  llm_config?: LLMConfig | null;
}

export interface VariableDictInferResponse {
  dictionary: VariableDictionary;
  provider: Provider;
  maas_error?: string | null;
}

export interface VariableDictPatchItem {
  column: string;
  before: Partial<VariableDictEntry>;
  after: Partial<VariableDictEntry>;
  op: "update" | "confirm";
}

export interface VariableDictPatchPreviewResponse {
  preview: VariableDictPatchItem[];
  assistant_summary: string;
  provider: Provider;
  maas_error?: string | null;
}

export interface VariableDictConfirmRequest {
  dataset_id: string;
  dataset_hash?: string;
  patches: VariableDictPatchItem[];
  dictionary: VariableDictionary;
}

export interface VariableDictConfirmResponse {
  dictionary: VariableDictionary;
}

// ---------------------------------------------------------------------------
// 结构化模型解读
// ---------------------------------------------------------------------------

export interface ExplanationSections {
  model_and_question: string;
  key_findings: string;
  stats_explained: string;
  reliability_limits: string;
  next_steps: string;
}

export interface CitedValue {
  path: string;
  value: number | string;
}

export interface ModelExplanation {
  status: "pending" | "completed" | "failed" | "fallback";
  revision: number;
  research_question: string;
  sections: ExplanationSections | null;
  cited_values: CitedValue[];
  provider: Provider;
  error: string | null;
  created_at: string;
}

export interface ExplainVariable {
  column: string;
  label?: string | null;
  unit?: string | null;
}

export interface ExplainModelRequest {
  research_question: string;
  model: string;
  variables: {
    dependent: ExplainVariable | null;
    independent: ExplainVariable[];
    controls?: string[];
  };
  model_results: ModelRunResults;
  diagnostics?: Record<string, unknown> | null;
  llm_config?: LLMConfig | null;
}

// ---------------------------------------------------------------------------
// 模型运行版本
// ---------------------------------------------------------------------------

export interface ModelRunConfig {
  dependent_variable: string;
  independent_variables: string[];
  entity_column?: string | null;
  time_column?: string | null;
  treatment_column?: string | null;
  running_variable?: string | null;
  instrument_variable?: string | null;
}

export interface ModelRunRecord {
  version_id: string;
  parent_id: string | null;
  created_at: string;
  research_question: string;
  dataset_id: string;
  dataset_hash: string;
  variable_dictionary_snapshot: VariableDictionary | null;
  model: string;
  config: ModelRunConfig;
  result: RunModelResponse;
  diagnostics: Record<string, unknown>;
  ai_explanation: ModelExplanation | null;
}

export interface ModelRunCreateRequest {
  parent_id?: string | null;
  research_question: string;
  dataset_id: string;
  dataset_hash: string;
  variable_dictionary_snapshot?: VariableDictionary | null;
  model: string;
  config: ModelRunConfig;
  result: RunModelResponse;
  diagnostics?: Record<string, unknown> | null;
  ai_explanation?: ModelExplanation | null;
}

export interface ModelRunListResponse {
  runs: ModelRunRecord[];
}

export interface ModelRunCompareResponse {
  comparable: boolean;
  incomparable_reason: string | null;
  config_diff: Record<string, unknown>;
  metrics_diff: Record<string, unknown>;
  explanations: { left?: ModelExplanation | null; right?: ModelExplanation | null };
  ai_diff_summary: string | null;
}

// ---------------------------------------------------------------------------
// 关系图
// ---------------------------------------------------------------------------

export interface ChartCaption {
  how_to_read: string;
  finding: string;
  caveat: string;
}

export interface ScatterPoint {
  x: number;
  y: number;
}

export interface ScatterResponse {
  x: string;
  y: string;
  points: ScatterPoint[];
  fit: { slope: number; intercept: number } | null;
  r: number | null;
  p_value: number | null;
  n: number;
  warnings: string[];
  caption: ChartCaption;
}

export interface CorrHeatmapResponse {
  columns: string[];
  matrix: (number | null)[][];
  n_matrix: number[][];
  warnings: string[];
  caption: ChartCaption;
}
