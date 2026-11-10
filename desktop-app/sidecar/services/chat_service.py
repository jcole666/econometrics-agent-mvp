from __future__ import annotations

import json
import re
from typing import Any

from sidecar.schemas import ChatAction, ChatRequest, ChatResponse
from sidecar.services.maas_client import MaasUnavailable, llm_provider_name, maas_chat, parse_json_content

CHAT_SYSTEM_PROMPT = """你叫小计，是一个计量建模工作台助手。
回答要围绕用户上传的数据、变量选择、模型推荐、生成代码和模型结果展开。
如果上下文里有数据概览、关系线索、研究路径或风险边界，优先结合这些信息回答，不要只给泛泛的计量学模板。
用中文给出清楚、可执行的建模建议。
回答必须使用 Markdown 分块：用标题组织段落，用列表列出步骤和检查项；公式单独成行或放在 $$ 中；代码必须放在三反引号代码块中。

你还可以直接操作工作台。若用户明确要求填写、切换、运行或推断，在回复末尾追加一个 actions 代码块，格式严格如下：
```actions
[{"type":"set_question","value":"..."},{"type":"goto_step","step":2},{"type":"infer_variables"}]
```
可用 type：
- set_question / set_dependent / set_independent / set_entity / set_time / set_treatment / set_running / set_instrument / set_model（value 为字符串；多个解释变量用英文逗号分隔）
- goto_step（step 为 1-4）
- run_profile / infer_dictionary / infer_variables / recommend_model / run_model / open_settings / confirm_dictionary
只在需要真正改动工作台时输出 actions；纯问答不要输出。actions 里的列名必须来自上下文已有字段。"""

CHAT_CONFIG_MESSAGE = "请先在右上角设置里补全模型配置，保存后再发送问题。"

_ACTIONS_BLOCK = re.compile(r"```actions\s*([\s\S]*?)```", re.IGNORECASE)


def chat_with_agent(request: ChatRequest) -> ChatResponse:
    missing = _missing_model_config(request)
    if missing:
        message = f"{CHAT_CONFIG_MESSAGE}缺少：{'、'.join(missing)}。"
        return ChatResponse(reply=message, provider="model_error", maas_error=message, actions=[])

    try:
        raw = maas_chat(_build_messages(request), request.llm_config).strip()
        if raw:
            reply, actions = _split_reply_and_actions(raw)
            return ChatResponse(
                reply=reply or "已收到，正在按你的指令调整工作台。",
                provider=llm_provider_name(request.llm_config),
                actions=actions,
            )
    except MaasUnavailable as exc:
        message = f"模型连接失败，请检查 API Key、请求地址、模型名称或网络。{exc}"
        return ChatResponse(reply=message, provider="model_error", maas_error=str(exc), actions=[])

    return ChatResponse(
        reply="模型没有返回内容，请稍后重试。",
        provider=llm_provider_name(request.llm_config),
        maas_error="模型没有返回内容。",
        actions=[],
    )


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


def _split_reply_and_actions(raw: str) -> tuple[str, list[ChatAction]]:
    match = _ACTIONS_BLOCK.search(raw)
    if match:
        reply = (raw[: match.start()] + raw[match.end() :]).strip()
        actions = _parse_actions(match.group(1))
        return reply, actions

    # 兼容整段 JSON：{"reply":"...","actions":[...]}
    try:
        parsed = parse_json_content(raw)
        if isinstance(parsed, dict) and ("reply" in parsed or "actions" in parsed):
            reply = str(parsed.get("reply") or "").strip() or raw
            return reply, _parse_actions(parsed.get("actions"))
    except Exception:
        pass

    return raw, []


def _parse_actions(raw: Any) -> list[ChatAction]:
    if isinstance(raw, str):
        try:
            raw = parse_json_content(raw)
        except Exception:
            try:
                raw = json.loads(raw)
            except Exception:
                return []

    if isinstance(raw, dict) and "actions" in raw:
        raw = raw.get("actions")
    if not isinstance(raw, list):
        return []

    actions: list[ChatAction] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        action_type = str(item.get("type") or "").strip()
        if not action_type:
            continue
        value = item.get("value")
        if isinstance(value, list):
            value = [str(part) for part in value]
        elif value is not None and not isinstance(value, (str, int, float)):
            value = str(value)
        step = item.get("step")
        step_value = int(step) if isinstance(step, (int, float)) and 1 <= int(step) <= 4 else None
        actions.append(ChatAction(type=action_type, value=value, step=step_value))
    return actions
