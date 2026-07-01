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
  RunModelResponse
} from "./types";

const BASE_URL = (import.meta.env.VITE_SIDECAR_URL as string | undefined) ?? "http://127.0.0.1:8768";

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, init);
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
  const response = await fetch(`${BASE_URL}/sample-data`);
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
