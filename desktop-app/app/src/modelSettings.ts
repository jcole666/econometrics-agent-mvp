import type { LLMConfig } from "./types";

const SETTINGS_KEY = "econometrics-agent.model-settings";

export interface ModelSettings {
  enabled: boolean;
  baseUrl: string;
  model: string;
  apiKey: string;
  timeout: string;
}

export const DEFAULT_MODEL_SETTINGS: ModelSettings = {
  enabled: false,
  baseUrl: "https://api.modelarts-maas.com/openai/v1",
  model: "deepseek-v4-pro-IckBJP",
  apiKey: "",
  timeout: "60"
};

export function loadModelSettings(): ModelSettings {
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

export function saveModelSettings(settings: ModelSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function resetModelSettings() {
  localStorage.removeItem(SETTINGS_KEY);
}

export function toLLMConfig(settings: ModelSettings): LLMConfig {
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

export function missingModelSettings(settings: ModelSettings): string[] {
  const missing: string[] = [];
  if (!settings.enabled) missing.push("启用自定义模型");
  if (!settings.baseUrl.trim()) missing.push("请求地址");
  if (!settings.model.trim()) missing.push("模型名称");
  if (!settings.apiKey.trim()) missing.push("API Key");
  return missing;
}
