from __future__ import annotations

import json
from typing import Any

from app.prompts.infer_prompts import INFER_VARIABLES_SYSTEM_PROMPT
from app.schemas import InferVariablesRequest, InferVariablesResponse
from app.services.maas_client import MaasUnavailable, maas_chat


def infer_variables(request: InferVariablesRequest) -> InferVariablesResponse:
    fallback = _infer_variables_rules(request)

    try:
        content = maas_chat(_build_messages(request))
        raw = _parse_json_content(content)
        return _normalize_response(raw, request, provider="huawei_maas")
    except MaasUnavailable as exc:
        fallback.maas_error = str(exc)
        return fallback
    except ValueError as exc:
        fallback.maas_error = f"MaaS 变量识别结果不可用，已使用规则降级：{exc}"
        return fallback


def _build_messages(request: InferVariablesRequest) -> list[dict[str, str]]:
    payload = _dump_model(request)
    return [
        {"role": "system", "content": INFER_VARIABLES_SYSTEM_PROMPT},
        {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
    ]


def _infer_variables_rules(request: InferVariablesRequest) -> InferVariablesResponse:
    columns = [column.name for column in request.columns]
    lower_names = {name: name.lower() for name in columns}
    question = request.research_question.lower()

    entity_column = _find_first(columns, lower_names, ["id", "entity", "person", "firm", "company", "city", "省份", "城市", "个体", "编号"])
    time_column = _find_first(columns, lower_names, ["year", "time", "date", "month", "post", "年份", "时间", "月份"])
    treatment_column = _find_first(columns, lower_names, ["treat", "treated", "policy", "group", "did", "处理", "政策", "实验组"])
    running_variable = _find_first(columns, lower_names, ["running", "score", "grade", "cutoff", "threshold", "分数", "成绩", "阈值", "断点"])
    instrument_variable = _find_first(columns, lower_names, ["instrument", "iv", "z_", "工具"])

    dependent_variable = _guess_dependent_variable(columns, lower_names, question)
    excluded = {dependent_variable, entity_column, time_column, instrument_variable}
    independent_variables = [
        name
        for name in columns
        if name not in excluded and not _is_obvious_identifier(name, lower_names[name])
    ]

    if treatment_column and treatment_column not in independent_variables and treatment_column != dependent_variable:
        independent_variables.append(treatment_column)

    reasoning = "已根据研究问题关键词和字段名进行规则识别，建议用户在前端确认后再运行模型。"
    if dependent_variable is None:
        reasoning = "未能稳定识别被解释变量 Y，请用户手动确认；其余变量按字段名规则给出候选。"

    return InferVariablesResponse(
        dependent_variable=dependent_variable,
        independent_variables=independent_variables,
        entity_column=entity_column,
        time_column=time_column,
        treatment_column=treatment_column,
        running_variable=running_variable if _mentions_any(question, ["rdd", "断点", "阈值", "分数线"]) else None,
        instrument_variable=instrument_variable,
        reasoning=reasoning,
        provider="rules",
    )


def _guess_dependent_variable(columns: list[str], lower_names: dict[str, str], question: str) -> str | None:
    groups = [
        (["收入", "工资", "薪资", "income", "wage", "salary"], ["income", "wage", "salary", "pay"]),
        (["违约", "是否违约", "default"], ["default", "违约"]),
        (["成绩", "分数", "score", "grade"], ["score", "grade", "成绩", "分数"]),
        (["录取", "admit", "admission"], ["admit", "admission", "录取"]),
        (["就业", "employment", "job"], ["employment", "employ", "job", "就业"]),
        (["利润", "profit"], ["profit", "利润"]),
        (["gdp", "产出"], ["gdp", "output", "产出"]),
    ]
    for question_terms, column_terms in groups:
        if _mentions_any(question, question_terms):
            found = _find_first(columns, lower_names, column_terms)
            if found:
                return found

    for name in columns:
        lowered = lower_names[name]
        if not _is_obvious_identifier(name, lowered):
            return name
    return None


def _normalize_response(
    raw: dict[str, Any],
    request: InferVariablesRequest,
    provider: str,
) -> InferVariablesResponse:
    valid = {column.name for column in request.columns}

    dependent_variable = _valid_name(raw.get("dependent_variable"), valid)
    independent_variables = [
        name
        for item in raw.get("independent_variables", [])
        if (name := _valid_name(item, valid)) and name != dependent_variable
    ]

    reasoning = str(raw.get("reasoning") or "MaaS 已返回变量识别结果，建议用户确认后使用。").strip()

    return InferVariablesResponse(
        dependent_variable=dependent_variable,
        independent_variables=list(dict.fromkeys(independent_variables)),
        entity_column=_valid_name(raw.get("entity_column"), valid),
        time_column=_valid_name(raw.get("time_column"), valid),
        treatment_column=_valid_name(raw.get("treatment_column"), valid),
        running_variable=_valid_name(raw.get("running_variable"), valid),
        instrument_variable=_valid_name(raw.get("instrument_variable"), valid),
        reasoning=reasoning,
        provider=provider,
    )


def _parse_json_content(content: str) -> dict[str, Any]:
    text = content.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if lines:
            lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines).strip()

    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start == -1 or end <= start:
            raise ValueError("未返回 JSON。")
        value = json.loads(text[start : end + 1])

    if not isinstance(value, dict):
        raise ValueError("JSON 顶层不是对象。")
    return value


def _find_first(columns: list[str], lower_names: dict[str, str], keywords: list[str]) -> str | None:
    lowered_keywords = [keyword.lower() for keyword in keywords]
    for name in columns:
        lowered = lower_names[name]
        if any(keyword in lowered for keyword in lowered_keywords):
            return name
    return None


def _valid_name(value: Any, valid: set[str]) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value if value in valid else None


def _is_obvious_identifier(name: str, lowered: str) -> bool:
    return lowered == "id" or lowered.endswith("_id") or lowered in {"uuid", "index", "编号"}


def _mentions_any(text: str, keywords: list[str]) -> bool:
    return any(keyword.lower() in text for keyword in keywords)


def _dump_model(model: Any) -> dict[str, Any]:
    if hasattr(model, "model_dump"):
        return model.model_dump()
    return model.dict()
