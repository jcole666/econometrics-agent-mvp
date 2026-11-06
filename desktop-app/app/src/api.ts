import type {
  ChatContext,
  ChatMessage,
  ChatResponse,
  DataProfile,
  InferVariablesRequest,
  InferVariablesResponse,
  LLMConfig,
  ModelRecommendation,
  ModelRequest,
  ReportResponse,
  CorrHeatmapResponse,
  ExplainModelRequest,
  ModelExplanation,
  ModelRunCompareResponse,
  ModelRunCreateRequest,
  ModelRunListResponse,
  ModelRunRecord,
  RunModelResponse,
  ScatterResponse,
  VariableDictConfirmRequest,
  VariableDictConfirmResponse,
  VariableDictInferRequest,
  VariableDictInferResponse,
  VariableDictPatchItem,
  VariableDictPatchPreviewResponse,
  VariableDictionary
} from "./types";

const BASE_URL = (import.meta.env.VITE_SIDECAR_URL as string | undefined) ?? "http://127.0.0.1:8768";

/** 桌面应用启动 sidecar 时会注入本机令牌；浏览器里调试时该值为空，后端也就不校验。 */
const LOCAL_TOKEN = typeof window === "undefined" ? "" : window.workbench?.localToken ?? "";

function withToken(init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers);
  if (LOCAL_TOKEN) {
    headers.set("X-Xiaoji-Token", LOCAL_TOKEN);
  }
  return { ...init, headers };
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, withToken(init));
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();

  if (!response.ok) {
    const message = typeof body === "string" ? body : body.detail ?? JSON.stringify(body);
    throw new Error(message);
  }
  return body as T;
}

export async function getHealth(): Promise<{ status: string; maas: Record<string, unknown> }> {
  return requestJson("/health");
}

export async function profileData(file: File): Promise<DataProfile> {
  const form = new FormData();
  form.append("file", file);
  return requestJson("/profile-data", { method: "POST", body: form });
}

export async function loadSampleProfile(): Promise<DataProfile> {
  return requestJson("/sample-profile");
}

export async function loadSampleFile(): Promise<File> {
  const response = await fetch(`${BASE_URL}/sample-data`, withToken());
  if (!response.ok) {
    throw new Error("无法加载样例数据。");
  }
  const blob = await response.blob();
  return new File([blob], "sample_city_panel.csv", { type: "text/csv" });
}

export async function inferVariables(payload: InferVariablesRequest): Promise<InferVariablesResponse> {
  return requestJson("/infer-variables", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export async function recommendModel(payload: ModelRequest): Promise<ModelRecommendation> {
  return requestJson("/recommend-model", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export async function runModel(file: File, payload: ModelRequest, modelType: string): Promise<RunModelResponse> {
  const form = new FormData();
  form.append("file", file);
  form.append("model_type", modelType);
  form.append("dependent_variable", payload.dependent_variable ?? "");
  form.append("independent_variables", payload.independent_variables.join(","));

  for (const key of ["entity_column", "time_column", "treatment_column", "running_variable", "instrument_variable"] as const) {
    const value = payload[key];
    if (value) {
      form.append(key, value);
    }
  }

  for (const key of ["policy_period", "cutoff", "bandwidth"] as const) {
    const value = payload[key];
    if (value !== null && value !== undefined && Number.isFinite(value)) {
      form.append(key, String(value));
    }
  }

  return requestJson("/run-model", { method: "POST", body: form });
}

export async function chat(message: string, history: ChatMessage[], context: ChatContext, llmConfig?: LLMConfig | null): Promise<ChatResponse> {
  return requestJson("/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history, context, llm_config: llmConfig ?? null })
  });
}

export async function generateReport(
  researchQuestion: string,
  modelType: string,
  modelResults: RunModelResponse["results"] | null,
  inferenceNotes?: string,
  llmConfig?: LLMConfig | null
): Promise<ReportResponse> {
  return requestJson("/generate-report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      research_question: researchQuestion,
      model_type: modelType,
      model_results: modelResults,
      inference_notes: inferenceNotes || null,
      llm_config: llmConfig ?? null
    })
  });
}

// ---------------------------------------------------------------------------
// 变量字典
// ---------------------------------------------------------------------------

export async function inferVariableDict(payload: VariableDictInferRequest): Promise<VariableDictInferResponse> {
  return requestJson("/variable-dict/infer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export async function previewVariableDictPatch(
  message: string,
  dictionary: VariableDictionary,
  llmConfig?: LLMConfig | null
): Promise<VariableDictPatchPreviewResponse> {
  return requestJson("/variable-dict/patch-preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, dictionary, llm_config: llmConfig ?? null })
  });
}

export async function confirmVariableDict(
  payload: VariableDictConfirmRequest
): Promise<VariableDictConfirmResponse> {
  return requestJson("/variable-dict/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export async function getVariableDict(datasetId: string, datasetHash?: string): Promise<VariableDictionary | null> {
  const query = new URLSearchParams({ dataset_id: datasetId });
  if (datasetHash) query.set("dataset_hash", datasetHash);
  const response = await fetch(`${BASE_URL}/variable-dict?${query.toString()}`, withToken());
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error("读取变量字典失败。");
  }
  return (await response.json()) as VariableDictionary;
}

export type { VariableDictPatchItem };

// ---------------------------------------------------------------------------
// 关系图统计（数字由 Python 计算）
// ---------------------------------------------------------------------------

export async function fetchScatter(file: File, xColumn: string, yColumn: string): Promise<ScatterResponse> {
  const form = new FormData();
  form.append("file", file);
  form.append("x_column", xColumn);
  form.append("y_column", yColumn);
  return requestJson("/relationship/scatter", { method: "POST", body: form });
}

export async function fetchCorrHeatmap(file: File, columns: string[]): Promise<CorrHeatmapResponse> {
  const form = new FormData();
  form.append("file", file);
  form.append("columns", columns.join(","));
  return requestJson("/relationship/corr-heatmap", { method: "POST", body: form });
}

export async function explainModel(payload: ExplainModelRequest): Promise<ModelExplanation> {
  return requestJson("/explain/model", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

// ---------------------------------------------------------------------------
// 模型运行版本
// ---------------------------------------------------------------------------

export async function createModelRun(payload: ModelRunCreateRequest): Promise<ModelRunRecord> {
  return requestJson("/model-runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export async function listModelRuns(datasetId: string): Promise<ModelRunRecord[]> {
  const query = new URLSearchParams({ dataset_id: datasetId });
  const body = await requestJson<ModelRunListResponse>(`/model-runs?${query.toString()}`);
  return body.runs;
}

export async function updateModelRunExplanation(
  datasetId: string,
  versionId: string,
  explanation: ModelExplanation
): Promise<ModelRunRecord> {
  const query = new URLSearchParams({ dataset_id: datasetId });
  return requestJson(`/model-runs/${versionId}/explanation?${query.toString()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(explanation)
  });
}

export async function compareModelRuns(
  datasetId: string,
  leftId: string,
  rightId: string
): Promise<ModelRunCompareResponse> {
  return requestJson("/model-runs/compare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataset_id: datasetId, left_id: leftId, right_id: rightId })
  });
}
