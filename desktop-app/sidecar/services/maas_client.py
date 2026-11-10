from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib import error, request as urlrequest
from urllib.parse import urlparse

from sidecar.schemas import LLMConfig, ModelRequest
from sidecar.services.code_generator import generate_code
from sidecar.services.config_paths import read_env_file, resolve_env_file


def _env_file() -> Path | None:
    return resolve_env_file()


# 默认示例仍用华为 ModelArts DeepSeek；用户可在设置里换成任意 OpenAI 兼容接口。
DEFAULT_BASE_URL = "https://api.modelarts-maas.com/openai/v1"
DEFAULT_MODEL = "deepseek-v4-pro"
MODELARTS_MODELS = frozenset({"deepseek-v4-pro", "deepseek-flash"})
DEEPSEEK_OFFICIAL_MODELS = frozenset({"deepseek-chat", "deepseek-reasoner"})
SUPPORTED_MODELS = {"OLS", "Logit", "Panel Fixed Effects", "DID", "IV-2SLS", "RDD"}

# 常见厂商仅作文档/健康检查参考；真正校验不再强制白名单，
# 任何 OpenAI 兼容的 https 地址都可以由用户自行填写。
DEFAULT_ALLOWED_HOSTS = frozenset(
    {
        "api.deepseek.com",
        "api.modelarts-maas.com",
        "api.openai.com",
        "dashscope.aliyuncs.com",
        "api.moonshot.cn",
        "open.bigmodel.cn",
        "ark.cn-beijing.volces.com",
        "api.anthropic.com",
        "generativelanguage.googleapis.com",
        "api.siliconflow.cn",
        "api.lingyiwanwu.com",
        "api.minimax.chat",
        "openrouter.ai",
    }
)
LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})
# 仍拦截云元数据等明显 SSRF 目标；其余 https 公网/校园域名放行。
BLOCKED_HOSTS = frozenset(
    {
        "169.254.169.254",
        "metadata.google.internal",
        "metadata.goog",
        "instance-data",
    }
)


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
    base_url = os.getenv("MAAS_BASE_URL", DEFAULT_BASE_URL).rstrip("/")
    env_file = getattr(_load_local_env, "_source", None)
    return {
        "provider": "huawei_maas",
        "enabled": enabled,
        "configured": enabled and bool(api_key),
        "api_key_present": bool(api_key),
        "base_url": base_url,
        "base_url_allowed": is_base_url_allowed(base_url),
        "model": os.getenv("MAAS_MODEL", DEFAULT_MODEL),
        "config_file": str(env_file) if env_file is not None else None,
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

    if llm_config and llm_config.enabled is False:
        raise MaasUnavailable("模型服务已关闭，当前使用本地规则。")
    if _has_custom_config(llm_config):
        return _get_custom_config(llm_config)
    if _is_disabled(os.getenv("MAAS_ENABLED", "auto")):
        raise MaasUnavailable("MaaS 已关闭，当前使用本地规则。")

    api_key = _get_api_key()
    if not api_key:
        raise MaasUnavailable("未配置 MAAS_API_KEY，当前使用本地规则。")

    return MaasConfig(
        api_key=api_key,
        base_url=_validate_base_url(os.getenv("MAAS_BASE_URL", DEFAULT_BASE_URL)),
        model=os.getenv("MAAS_MODEL", DEFAULT_MODEL),
        timeout=_get_timeout(),
    )


def _has_custom_config(llm_config: LLMConfig | None) -> bool:
    return bool(llm_config and any([llm_config.api_key, llm_config.base_url, llm_config.model]))


def _allowed_hosts() -> set[str]:
    hosts = set(DEFAULT_ALLOWED_HOSTS)
    for item in os.getenv("MAAS_ALLOWED_HOSTS", "").split(","):
        candidate = item.strip().lower()
        if candidate:
            hosts.add(candidate)
    return hosts


def is_base_url_allowed(base_url: str) -> bool:
    try:
        _validate_base_url(base_url)
    except MaasUnavailable:
        return False
    return True


def _validate_base_url(base_url: str | None) -> str:
    """校验模型服务地址，返回去掉尾部斜杠的地址。

    规则：
    - 必须是 http/https，且不得携带账号密码；
    - 本机回环允许 http（Ollama 等本地服务）；
    - 其他地址必须 https；
    - 任意 OpenAI 兼容域名都可用，不再强制厂商白名单；
    - 仅拦截云元数据等明确危险主机。
    """
    raw = (base_url or "").strip()
    if not raw:
        raise MaasUnavailable("模型服务地址为空，当前使用本地规则。")

    parsed = urlparse(raw)
    if parsed.scheme not in {"http", "https"}:
        raise MaasUnavailable("模型服务地址必须以 http:// 或 https:// 开头，当前使用本地规则。")
    if parsed.username or parsed.password:
        raise MaasUnavailable("模型服务地址不允许携带账号密码，当前使用本地规则。")

    host = (parsed.hostname or "").lower()
    if not host:
        raise MaasUnavailable("模型服务地址缺少域名，当前使用本地规则。")
    if parsed.scheme == "http" and host not in LOOPBACK_HOSTS:
        raise MaasUnavailable("模型服务地址必须使用 HTTPS（本机回环除外），当前使用本地规则。")
    if host in BLOCKED_HOSTS or host.endswith(".internal"):
        raise MaasUnavailable(f"模型服务域名 {host} 不允许使用，当前使用本地规则。")

    # 少数官方根地址漏写 /v1 时自动补上；自定义地址保持用户原样。
    if host == "api.deepseek.com" and parsed.path in {"", "/"}:
        return f"{parsed.scheme}://{host}/v1"
    if host == "api.openai.com" and parsed.path in {"", "/"}:
        return f"{parsed.scheme}://{host}/v1"

    return raw.rstrip("/")


def _get_custom_config(llm_config: LLMConfig | None) -> MaasConfig:
    assert llm_config is not None

    base_url = _validate_base_url(llm_config.base_url or os.getenv("MAAS_BASE_URL", DEFAULT_BASE_URL))
    api_key = (llm_config.api_key or _get_api_key()).strip()
    model = _normalize_model_name(
        (llm_config.model or os.getenv("MAAS_MODEL", DEFAULT_MODEL)).strip(),
        base_url,
    )

    if not api_key:
        raise MaasUnavailable("自定义模型缺少 API Key，当前使用本地规则。")
    if not model:
        raise MaasUnavailable("自定义模型缺少模型名称，当前使用本地规则。")

    return MaasConfig(api_key=api_key, base_url=base_url, model=model, timeout=llm_config.timeout or _get_timeout())


def _normalize_model_name(model: str, base_url: str) -> str:
    """只纠正已知网关的常见填错；自定义厂商的模型名原样保留。"""
    host = (urlparse(base_url).hostname or "").lower()
    name = (model or "").strip()
    if not name:
        return DEFAULT_MODEL

    if host.endswith("modelarts-maas.com"):
        if name in MODELARTS_MODELS:
            return name
        # 仅纠正明确会 400 的别名，不改用户自定义部署名。
        lowered = name.lower()
        if lowered in {"deepseek", "deepseek-chat", "deepseek-reasoner", "deepseek-v4-pro-ickbjp"}:
            return "deepseek-v4-pro"
        return name

    if host == "api.deepseek.com":
        if name in DEEPSEEK_OFFICIAL_MODELS:
            return name
        if name.lower() in {"deepseek", "deepseek-v4-pro", "deepseek-flash"}:
            return "deepseek-chat"
        return name

    # OpenAI / 通义 / 智谱 / 月之暗面 / 学校私有网关：完全尊重用户填写。
    return name


def _load_local_env() -> None:
    if getattr(_load_local_env, "_done", False):
        return

    env_path = _env_file()
    if env_path is not None:
        for key, value in read_env_file(env_path).items():
            if key not in os.environ:
                os.environ[key] = value

    _load_local_env._source = env_path
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
        detail = _http_error_detail(exc)
        raise MaasUnavailable(f"模型请求失败（HTTP {exc.code}）{detail}。请核对请求地址、模型名称和 API Key。") from exc
    except error.URLError as exc:
        reason = getattr(exc, "reason", None)
        hint = f"：{reason}" if reason else ""
        raise MaasUnavailable(f"模型网络请求失败{hint}。请检查网络，以及请求地址是否为 https://api.deepseek.com/v1。") from exc
    except TimeoutError as exc:
        raise MaasUnavailable("模型请求超时，可在设置里把超时秒数调大后再试。") from exc

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


def parse_json_content(content: str) -> dict[str, Any]:
    """公开版本：供变量字典、模型解读等模块复用同一套 JSON 提取逻辑。"""
    return _parse_json_content(content)


def _http_error_detail(exc: error.HTTPError) -> str:
    try:
        body = exc.read().decode("utf-8", errors="replace").strip()
    except Exception:
        body = ""
    if not body:
        return ""
    # 截断，避免把超长 HTML/JSON 整段塞进前端状态条。
    snippet = body.replace("\n", " ")[:180]
    return f"：{snippet}"


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
