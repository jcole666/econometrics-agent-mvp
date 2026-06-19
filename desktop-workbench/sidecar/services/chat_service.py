from __future__ import annotations

import json
from typing import Any

from sidecar.schemas import ChatRequest, ChatResponse
from sidecar.services.maas_client import MaasUnavailable, llm_provider_name, maas_chat

CHAT_SYSTEM_PROMPT = """你是一个计量建模工作台助手。
回答要围绕用户上传的数据、变量选择、模型推荐、生成代码和模型结果展开。
用中文给出清楚、可执行的建模建议。"""


def chat_with_agent(request: ChatRequest) -> ChatResponse:
    try:
        reply = maas_chat(_build_messages(request), request.llm_config).strip()
        if reply:
            return ChatResponse(reply=reply, provider=llm_provider_name(request.llm_config))
    except MaasUnavailable as exc:
        return ChatResponse(reply=_fallback_reply(request), provider="rules", maas_error=str(exc))

    return ChatResponse(reply=_fallback_reply(request), provider="rules")


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


def _fallback_reply(request: ChatRequest) -> str:
    text = request.message.lower()
    context = request.context
    model = context.recommended_model if context and context.recommended_model else "当前模型"

    if "code" in text or "代码" in text:
        return "当前生成的是可复现的 Python 建模模板。建议先核对 Y 和 X 是否选对，再检查缺失值、变量编码和稳健标准误，最后再把结果写进报告。"
    if "result" in text or "coefficient" in text or "p-value" in text or "结果" in text or "系数" in text:
        return "解读结果时先看核心解释变量的系数方向，再看 p 值或置信区间，最后把估计值翻译回你的研究问题。"
    if "why" in text or "recommend" in text or "model" in text or "为什么" in text or "推荐" in text or "模型" in text:
        return f"{model} 的推荐依据主要来自结果变量类型、研究问题表述和当前可用字段。正式使用前，最好再手动确认变量角色。"

    return "我可以继续解释变量选择、模型推荐、生成代码和回归结果。你可以直接问：为什么推荐这个模型、系数怎么解读、下一步该检查什么。"
