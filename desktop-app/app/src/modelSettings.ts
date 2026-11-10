import type { LLMConfig } from "./types";

const SETTINGS_KEY = "econometrics-agent.model-settings";

export interface ModelSettings {
  enabled: boolean;
  baseUrl: string;
  model: string;
  apiKey: string;
  timeout: string;
}

export interface ModelPreset {
  id: string;
  label: string;
  hint: string;
  baseUrl: string;
  model: string;
}

/** 预设只是快捷填充；任意 OpenAI 兼容地址都可以手填。 */
export const MODEL_PRESETS: ModelPreset[] = [
  {
    id: "modelarts",
    label: "华为 ModelArts",
    hint: "deepseek-v4-pro / deepseek-flash",
    baseUrl: "https://api.modelarts-maas.com/openai/v1",
    model: "deepseek-v4-pro"
  },
  {
    id: "deepseek",
    label: "DeepSeek 官方",
    hint: "deepseek-chat / deepseek-reasoner",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat"
  },
  {
    id: "openai",
    label: "OpenAI",
    hint: "gpt-4o-mini 等",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini"
  },
  {
    id: "qwen",
    label: "通义千问",
    hint: "DashScope 兼容模式",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus"
  },
  {
    id: "zhipu",
    label: "智谱 GLM",
    hint: "glm-4-flash 等",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4-flash"
  },
  {
    id: "moonshot",
    label: "月之暗面",
    hint: "kimi / moonshot-v1",
    baseUrl: "https://api.moonshot.cn/v1",
    model: "moonshot-v1-8k"
  },
  {
    id: "siliconflow",
    label: "硅基流动",
    hint: "OpenAI 兼容聚合",
    baseUrl: "https://api.siliconflow.cn/v1",
    model: "deepseek-ai/DeepSeek-V3"
  },
  {
    id: "custom",
    label: "自定义",
    hint: "任意 OpenAI 兼容接口",
    baseUrl: "",
    model: ""
  }
];

export const DEFAULT_MODEL_SETTINGS: ModelSettings = {
  enabled: false,
  baseUrl: "https://api.modelarts-maas.com/openai/v1",
  model: "deepseek-v4-pro",
  apiKey: "",
  timeout: "60"
};

const MODELARTS_BAD_ALIASES = new Set([
  "deepseek",
  "DeepSeek",
  "deepseek-chat",
  "deepseek-reasoner",
  "deepseek-v4-pro-IckBJP",
  "deepseek-v4-pro-ickbjp"
]);

export function loadModelSettings(): ModelSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_MODEL_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<ModelSettings>;
    const migrated = normalizeModelSettings({
      ...DEFAULT_MODEL_SETTINGS,
      ...parsed,
      enabled: parsed.enabled === true
    });
    if (migrated.baseUrl !== parsed.baseUrl || migrated.model !== parsed.model) {
      saveModelSettings(migrated);
    }
    return migrated;
  } catch {
    return DEFAULT_MODEL_SETTINGS;
  }
}

/**
 * 只纠正已知会 400 的填错；自定义厂商模型名一律保留。
 * 空地址不强制回落到某个厂商，方便「自定义」预设。
 */
export function normalizeModelSettings(settings: ModelSettings): ModelSettings {
  const baseUrl = normalizeBaseUrl(settings.baseUrl);
  let model = settings.model.trim();
  const host = safeHost(baseUrl);

  if (host.includes("modelarts-maas.com") && MODELARTS_BAD_ALIASES.has(model)) {
    model = "deepseek-v4-pro";
  } else if (host === "api.deepseek.com" && (!model || model === "deepseek" || model === "deepseek-v4-pro" || model === "deepseek-flash")) {
    model = "deepseek-chat";
  }

  return {
    ...settings,
    baseUrl,
    model
  };
}

export function applyPreset(settings: ModelSettings, preset: ModelPreset): ModelSettings {
  if (preset.id === "custom") {
    return {
      ...settings,
      enabled: true,
      baseUrl: settings.baseUrl || "",
      model: settings.model || ""
    };
  }
  return normalizeModelSettings({
    ...settings,
    enabled: true,
    baseUrl: preset.baseUrl,
    model: preset.model
  });
}

export function detectPreset(settings: ModelSettings): string {
  const host = safeHost(settings.baseUrl);
  const path = safePath(settings.baseUrl);
  if (!host) return "custom";
  if (host.includes("modelarts-maas.com")) return "modelarts";
  if (host === "api.deepseek.com") return "deepseek";
  if (host === "api.openai.com") return "openai";
  if (host.includes("dashscope.aliyuncs.com")) return "qwen";
  if (host.includes("bigmodel.cn")) return "zhipu";
  if (host.includes("moonshot.cn")) return "moonshot";
  if (host.includes("siliconflow.cn")) return "siliconflow";
  if (host.includes("volces.com") || path.includes("compatible-mode")) return "custom";
  return "custom";
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    const host = url.hostname.toLowerCase();
    if (host === "api.deepseek.com" && (url.pathname === "" || url.pathname === "/")) {
      return "https://api.deepseek.com/v1";
    }
    if (host === "api.openai.com" && (url.pathname === "" || url.pathname === "/")) {
      return "https://api.openai.com/v1";
    }
  } catch {
    return trimmed;
  }
  return trimmed;
}

function safeHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function safePath(baseUrl: string): string {
  try {
    return new URL(baseUrl).pathname.toLowerCase();
  } catch {
    return "";
  }
}

export function saveModelSettings(settings: ModelSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalizeModelSettings(settings)));
}

export function resetModelSettings() {
  localStorage.removeItem(SETTINGS_KEY);
}

export function toLLMConfig(settings: ModelSettings): LLMConfig {
  const normalized = normalizeModelSettings(settings);
  if (!normalized.enabled) {
    return { enabled: false };
  }

  const timeout = Number(normalized.timeout);
  return {
    enabled: true,
    api_key: normalized.apiKey.trim() || null,
    base_url: normalized.baseUrl.trim() || null,
    model: normalized.model.trim() || null,
    timeout: Number.isFinite(timeout) && timeout > 0 ? timeout : null
  };
}

export function missingModelSettings(settings: ModelSettings): string[] {
  const normalized = normalizeModelSettings(settings);
  const missing: string[] = [];
  if (!normalized.enabled) missing.push("启用自定义模型");
  if (!normalized.baseUrl.trim()) missing.push("请求地址");
  if (!normalized.model.trim()) missing.push("模型名称");
  if (!normalized.apiKey.trim()) missing.push("API Key");
  return missing;
}
