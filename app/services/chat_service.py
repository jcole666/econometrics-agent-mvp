from __future__ import annotations

import json
from typing import Any

from app.prompts.chat_prompts import CHAT_SYSTEM_PROMPT
from app.schemas import ChatRequest, ChatResponse
from app.services.maas_client import MaasUnavailable, maas_chat
from app.utils.llm_config import llm_provider_name


def chat_with_agent(request: ChatRequest) -> ChatResponse:
    messages = _build_messages(request)

    try:
        reply = maas_chat(messages, request.llm_config).strip()
        if reply:
            return ChatResponse(reply=reply, provider=llm_provider_name(request.llm_config))
    except MaasUnavailable as exc:
        return ChatResponse(
            reply=_fallback_reply(request),
            provider="rules",
            maas_error=str(exc),
        )

    return ChatResponse(reply=_fallback_reply(request), provider="rules")


def _build_messages(request: ChatRequest) -> list[dict[str, str]]:
    messages = [{"role": "system", "content": CHAT_SYSTEM_PROMPT}]
    context = _dump_context(request)
    if context:
        messages.append(
            {
                "role": "system",
                "content": "当前分析上下文：\n" + json.dumps(context, ensure_ascii=False),
            }
        )

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
    model = context.recommended_model if context and context.recommended_model else "当前推荐模型"

    if "代码" in text or "code" in text:
        return (
            "当前代码生成模块输出的是 Python 计量建模模板，主要基于 pandas、statsmodels "
            "和 linearmodels。你可以先检查 Y、X 是否填对，再运行模型；复杂模型还需要确认"
            "处理组、时间列、断点变量或工具变量等关键信息。"
        )

    if "结果" in text or "系数" in text or "p值" in text or "p-value" in text:
        return (
            "解释回归结果时，建议先看核心解释变量的系数方向，再看 p 值或置信区间判断显著性，"
            "最后结合研究问题解释经济含义。如果还没有运行模型，请先调用 /run-model 得到结果。"
        )

    if "为什么" in text or "推荐" in text or "模型" in text:
        return (
            f"{model} 的推荐通常取决于被解释变量类型、研究问题关键词和数据结构。"
            "例如连续型 Y 常用 OLS，0/1 型 Y 常用 Logit，政策前后和处理组/对照组场景常考虑 DID，"
            "存在阈值或分数线时考虑 RDD，存在内生性和工具变量时考虑 IV-2SLS。"
        )

    return (
        "我可以围绕当前数据字段、变量选择、模型推荐、生成代码和回归结果继续解释。"
        "如果你想推进分析，可以问我“为什么推荐这个模型”“这段代码什么意思”或“结果应该怎么解读”。"
    )
