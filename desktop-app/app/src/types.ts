export type Provider = "rules" | "huawei_maas" | "custom_model" | string;

export interface LLMConfig {
  api_key?: string | null;
  base_url?: string | null;
  model?: string | null;
  timeout?: number | null;
}

export interface ProfileColumn {
  name: string;
  dtype: string;
  missing: number;
  unique: number;
  sample_values: string[];
}

export interface DataProfile {
  rows: number;
  columns_count: number;
  columns: ProfileColumn[];
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
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatContext {
  data_columns: string[];
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
