from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib import error, request as urlrequest

from sidecar.schemas import LLMConfig, ModelRequest
from sidecar.services.code_generator import generate_code

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_BASE_URL = "https://api.modelarts-maas.com/openai/v1"
DEFAULT_MODEL = "deepseek-v4-pro-IckBJP"
SUPPORTED_MODELS = {"OLS", "Logit", "Panel Fixed Effects", "DID", "IV-2SLS", "RDD"}


class MaasUnavailable(RuntimeError):
    pass


@dataclass(frozen=True)
class MaasConfig:
    api_key: str
    base_url: str
    model: str
    timeout: float


@dataclass(frozen=True)
class MaasRecommendation:
    model: str
    reason: str
    required_checks: list[str]
    generated_code: str
    note: str | None = None


def llm_provider_name(config: LLMConfig | None) -> str:
    return "custom_model" if _has_custom_config(config) else "huawei_maas"


def get_maas_status() -> dict[str, Any]:
    _load_local_env()
    api_key = _get_api_key()
    enabled = not _is_disabled(os.getenv("MAAS_ENABLED", "auto"))
    return {
        "provider": "huawei_maas",
        "enabled": enabled,
        "configured": enabled and bool(api_key),
        "api_key_present": bool(api_key),
        "base_url": os.getenv("MAAS_BASE_URL", DEFAULT_BASE_URL).rstrip("/"),
        "model": os.getenv("MAAS_MODEL", DEFAULT_MODEL),
    }


def get_maas_recommendation(
    request: ModelRequest,
    model: str,
    reason: str,
    required_checks: list[str],
    generated_code: str,
) -> MaasRecommendation:
    config = _get_config(request.llm_config)
    fallback = {
        "model": model,
        "reason": reason,
        "required_checks": required_checks,
        "generated_code": generated_code,
    }
    messages = _build_recommendation_messages(request, fallback)
    raw = _parse_json_content(_chat_completion(config, messages))
    return _normalize_recommendation(raw, fallback, request)


def maas_chat(messages: list[dict[str, str]], llm_config: LLMConfig | None = None) -> str:
    return _chat_completion(_get_config(llm_config), messages)


def _get_config(llm_config: LLMConfig | None = None) -> MaasConfig:
    _load_local_env()

    if _has_custom_config(llm_config):
        return _get_custom_config(llm_config)
    if _is_disabled(os.getenv("MAAS_ENABLED", "auto")):
        raise MaasUnavailable("MaaS 已关闭，当前使用本地规则。")

    api_key = _get_api_key()
    if not api_key:
        raise MaasUnavailable("未配置 MAAS_API_KEY，当前使用本地规则。")

    return MaasConfig(
        api_key=api_key,
        base_url=os.getenv("MAAS_BASE_URL", DEFAULT_BASE_URL).rstrip("/"),
        model=os.getenv("MAAS_MODEL", DEFAULT_MODEL),
        timeout=_get_timeout(),
    )


def _has_custom_config(llm_config: LLMConfig | None) -> bool:
    return bool(llm_config and any([llm_config.api_key, llm_config.base_url, llm_config.model]))


def _get_custom_config(llm_config: LLMConfig | None) -> MaasConfig:
    assert llm_config is not None

    base_url = (llm_config.base_url or os.getenv("MAAS_BASE_URL", DEFAULT_BASE_URL)).strip().rstrip("/")
    api_key = (llm_config.api_key or _get_api_key()).strip()
    model = (llm_config.model or os.getenv("MAAS_MODEL", DEFAULT_MODEL)).strip()

    if not api_key:
        raise MaasUnavailable("自定义模型缺少 API Key，当前使用本地规则。")
    if not base_url:
        raise MaasUnavailable("自定义模型缺少 API 地址，当前使用本地规则。")
    if not model:
        raise MaasUnavailable("自定义模型缺少模型名称，当前使用本地规则。")

    return MaasConfig(api_key=api_key, base_url=base_url, model=model, timeout=llm_config.timeout or _get_timeout())


def _load_local_env() -> None:
    if getattr(_load_local_env, "_done", False):
        return

    env_path = PROJECT_ROOT / ".env"
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            key, value = stripped.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value

    _load_local_env._done = True


def _get_api_key() -> str:
    return os.getenv("MAAS_API_KEY") or os.getenv("HUAWEI_MAAS_API_KEY") or ""


def _get_timeout() -> float:
    try:
        return float(os.getenv("MAAS_TIMEOUT", "60"))
    except ValueError:
        return 60.0


def _is_disabled(value: str) -> bool:
    return value.strip().lower() in {"0", "false", "off", "no", "disabled"}


def _build_recommendation_messages(request: ModelRequest, fallback: dict[str, Any]) -> list[dict[str, str]]:
    payload = {
        "request": _dump_model(request),
        "rule_recommendation": fallback,
    }
    return [
        {
            "role": "system",
            "content": (
                "你负责帮助用户选择计量模型。只返回 JSON，字段包括："
                "model, reason, required_checks, generated_code, maas_note. "
                "model 只能是 OLS, Logit, Panel Fixed Effects, DID, IV-2SLS, RDD 之一。"
                "reason、required_checks 和 maas_note 使用中文。"
            ),
        },
        {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
    ]


def _chat_completion(config: MaasConfig, messages: list[dict[str, str]]) -> str:
    payload = {
        "model": config.model,
        "messages": messages,
        "temperature": 0.2,
        "max_tokens": 1800,
        "stream": False,
    }
    req = urlrequest.Request(
        f"{config.base_url}/chat/completions",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Authorization": f"Bearer {config.api_key}", "Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urlrequest.urlopen(req, timeout=config.timeout) as resp:
            response_body = resp.read().decode("utf-8")
    except error.HTTPError as exc:
        raise MaasUnavailable(f"MaaS 请求失败（HTTP {exc.code}），当前使用本地规则。") from exc
    except error.URLError as exc:
        raise MaasUnavailable("MaaS 网络请求失败，当前使用本地规则。") from exc
    except TimeoutError as exc:
        raise MaasUnavailable("MaaS 请求超时，当前使用本地规则。") from exc

    try:
        data = json.loads(response_body)
        return data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError, json.JSONDecodeError) as exc:
        raise MaasUnavailable("MaaS 响应格式异常，当前使用本地规则。") from exc


def _parse_json_content(content: str) -> dict[str, Any]:
    text = content.strip()
    if text.startswith("```"):
        lines = text.splitlines()[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines).strip()

    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start == -1 or end <= start:
            raise MaasUnavailable("MaaS 未返回 JSON，当前使用本地规则。")
        try:
            value = json.loads(text[start : end + 1])
        except json.JSONDecodeError as exc:
            raise MaasUnavailable("MaaS 返回的 JSON 无效，当前使用本地规则。") from exc

    if not isinstance(value, dict):
        raise MaasUnavailable("MaaS JSON 顶层不是对象，当前使用本地规则。")
    return value


def _normalize_recommendation(raw: dict[str, Any], fallback: dict[str, Any], request: ModelRequest) -> MaasRecommendation:
    model = str(raw.get("model") or fallback["model"]).strip()
    if model not in SUPPORTED_MODELS:
        model = fallback["model"]

    reason = str(raw.get("reason") or fallback["reason"]).strip()
    checks = raw.get("required_checks")
    required_checks = [str(item).strip() for item in checks if str(item).strip()] if isinstance(checks, list) else []
    if not required_checks:
        required_checks = list(fallback["required_checks"])

    code = raw.get("generated_code")
    if not isinstance(code, str) or not code.strip():
        code = generate_code(model, request)

    note = raw.get("maas_note") or raw.get("notes")
    return MaasRecommendation(
        model=model,
        reason=reason,
        required_checks=required_checks,
        generated_code=code,
        note=str(note).strip() if note else None,
    )


def _dump_model(model: Any) -> dict[str, Any]:
    if hasattr(model, "model_dump"):
        return model.model_dump(exclude={"llm_config"})
    return model.dict(exclude={"llm_config"})
