from __future__ import annotations

import json
from typing import Any

from sidecar.schemas import ChatRequest, ChatResponse
from sidecar.services.maas_client import MaasUnavailable, llm_provider_name, maas_chat

CHAT_SYSTEM_PROMPT = """你是一个计量建模工作台助手。
回答要围绕用户上传的数据、变量选择、模型推荐、生成代码和模型结果展开。
用中文给出清楚、可执行的建模建议。"""

CHAT_CONFIG_MESSAGE = "请先在右上角设置里补全模型配置，保存后再发送问题。"


def chat_with_agent(request: ChatRequest) -> ChatResponse:
    missing = _missing_model_config(request)
    if missing:
        message = f"{CHAT_CONFIG_MESSAGE}缺少：{'、'.join(missing)}。"
        return ChatResponse(reply=message, provider="model_error", maas_error=message)

    try:
        reply = maas_chat(_build_messages(request), request.llm_config).strip()
        if reply:
            return ChatResponse(reply=reply, provider=llm_provider_name(request.llm_config))
    except MaasUnavailable as exc:
        message = f"模型连接失败，请检查 API Key、请求地址、模型名称或网络。{exc}"
        return ChatResponse(reply=message, provider="model_error", maas_error=str(exc))

    return ChatResponse(reply="模型没有返回内容，请稍后重试。", provider=llm_provider_name(request.llm_config), maas_error="模型没有返回内容。")


def _missing_model_config(request: ChatRequest) -> list[str]:
    config = request.llm_config
    missing: list[str] = []
    if config is None or config.enabled is not True:
        missing.append("启用自定义模型")
    if config is None or not (config.base_url or "").strip():
        missing.append("请求地址")
    if config is None or not (config.model or "").strip():
        missing.append("模型名称")
    if config is None or not (config.api_key or "").strip():
        missing.append("API Key")
    return missing


def _build_messages(request: ChatRequest) -> list[dict[str, str]]:
    messages = [{"role": "system", "content": CHAT_SYSTEM_PROMPT}]
    context = _dump_context(request)
    if context:
        messages.append({"role": "system", "content": "当前分析上下文：\n" + json.dumps(context, ensure_ascii=False)})

    for item in request.history[-8:]:
        role = item.role if item.role in {"user", "assistant"} else "user"
        messages.append({"role": role, "content": item.content})

    messages.append({"role": "user", "content": request.message})
    return messages


def _dump_context(request: ChatRequest) -> dict[str, Any]:
    if request.context is None:
        return {}
    if hasattr(request.context, "model_dump"):
        return request.context.model_dump(exclude_none=True)
    return request.context.dict(exclude_none=True)
