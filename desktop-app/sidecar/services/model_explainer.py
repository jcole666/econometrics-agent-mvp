"""结构化模型解读：组装上下文 → 调模型 → 解析 JSON → 校验 → 失败降级。

边界：系数、标准误、p、R²、样本量全部由 ``model_runner`` 算出，这里只做叙述组织；
模型输出必须通过 ``explanation_validate``，否则整段换成模板（HTTP 仍 200）。
"""

from __future__ import annotations

import json
from typing import Any

from sidecar.schemas import (
    CitedValue,
    ExplainModelRequest,
    ExplanationSections,
    ModelExplanation,
)
from sidecar.services import report_generator as rg
from sidecar.services.explanation_validate import (
    SECTION_KEYS,
    cited_values_from_text,
    numeric_whitelist,
    validate_explanation,
)
from sidecar.services.maas_client import MaasUnavailable, llm_provider_name, maas_chat, parse_json_content


def explain_model(request: ExplainModelRequest) -> ModelExplanation:
    results_dict = request.model_results.model_dump()
    fallback = _fallback(request, results_dict)

    try:
        raw = parse_json_content(maas_chat(_messages(request), request.llm_config))
    except MaasUnavailable as exc:
        return fallback.model_copy(update={"error": str(exc)})

    sections = _sections_from_payload(raw)
    problems = validate_explanation(sections, request.model_results)
    if problems:
        return fallback.model_copy(update={"error": "解读未通过校验：" + "；".join(problems[:3])})

    cited = [CitedValue(**item) for item in cited_values_from_text(sections, request.model_results)]
    return ModelExplanation(
        status="completed",
        revision=1,
        research_question=request.research_question,
        sections=sections,
        cited_values=cited,
        provider=llm_provider_name(request.llm_config),
        error=None,
    )


def _sections_from_payload(raw: dict[str, Any]) -> ExplanationSections:
    nested = raw.get("sections")
    source: dict[str, Any] = nested if isinstance(nested, dict) else raw
    values = {key: str(source.get(key) or "").strip() for key in SECTION_KEYS}
    return ExplanationSections(**values)


def _messages(request: ExplainModelRequest) -> list[dict[str, str]]:
    dependent = request.variables.dependent
    independent = request.variables.independent
    whitelist = [item["value"] for item in numeric_whitelist(request.model_results)]

    payload = {
        "research_question": request.research_question,
        "model": request.model,
        "variables": {
            "dependent": dependent.model_dump() if dependent else None,
            "independent": [item.model_dump() for item in independent],
            "controls": request.variables.controls,
        },
        "results_table": [
            {
                "variable": item.variable,
                "coefficient": item.coefficient,
                "std_error": item.std_error,
                "t_statistic": item.t_statistic,
                "p_value": item.p_value,
            }
            for item in request.model_results.coefficients
        ],
        "model_stats": {
            "sample_size": request.model_results.sample_size,
            "r_squared": request.model_results.r_squared,
            "r_squared_adjusted": request.model_results.r_squared_adjusted,
            "f_statistic": request.model_results.f_statistic,
            "f_pvalue": request.model_results.f_pvalue,
        },
        "diagnostics": request.diagnostics,
        "allowed_numbers": whitelist,
    }

    system = (
        "你是计量经济学助教，负责向学生解释已经跑出来的回归结果。只返回 JSON："
        '{"sections":{"model_and_question":"…","key_findings":"…","stats_explained":"…",'
        '"reliability_limits":"…","next_steps":"…"}}。要求：'
        "1) 五段齐全，每段 2–4 句中文；"
        "2) 只能引用 allowed_numbers 里的数字，允许四舍五入，不得新造数字；"
        "3) 不能说「证明了因果」「必然导致」，OLS 与面板固定效应只能描述相关关系；"
        "4) 没有做过的检验（平行趋势、安慰剂、Hausman、稳健性等）不得写「已通过」；"
        "5) 解释统计量要用学生能懂的话，说清系数方向、显著性与样本量的含义；"
        "6) variables.independent 是核心解释变量，variables.controls 是控制变量："
        "主要发现只围绕核心变量展开，控制变量最多用一句话交代是否显著、符号是否符合预期。"
    )
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
    ]


def _fallback(request: ExplainModelRequest, results_dict: dict[str, Any]) -> ModelExplanation:
    coefficients = results_dict.get("coefficients") or []
    main = rg._main_coefficient(coefficients)
    dependent = request.variables.dependent
    dependent_name = (dependent.label or dependent.column) if dependent else "被解释变量"
    independent_names = [item.label or item.column for item in request.variables.independent]
    independent_text = "、".join(independent_names) if independent_names else "解释变量"
    controls = [item for item in request.variables.controls if item]
    controls_text = f"，同时控制了 {'、'.join(controls)}" if controls else ""

    model_and_question = (
        f"研究问题是「{request.research_question}」。"
        f"这里用 {request.model} 估计 {dependent_name} 与 {independent_text} 的关系{controls_text}，"
        f"进入估计的观测为 {results_dict.get('sample_size')} 个。"
    )

    if main and main.get("coefficient") is not None:
        key_findings = rg._coefficient_sentence(main)
    else:
        key_findings = "结果里没有可直接解读的核心系数，请先核对变量设定与样本。"

    stats_bits: list[str] = []
    if results_dict.get("r_squared") is not None:
        stats_bits.append(f"R² = {rg._fmt(results_dict['r_squared'])}")
    if results_dict.get("r_squared_adjusted") is not None:
        stats_bits.append(f"调整后 R² = {rg._fmt(results_dict['r_squared_adjusted'])}")
    if results_dict.get("f_statistic") is not None:
        stats_bits.append(f"F 统计量 = {rg._fmt(results_dict['f_statistic'])}")
    stats_explained = (
        "；".join(stats_bits) + "。这些数字由本地统计库直接算出，可用同一份数据复现。"
        if stats_bits
        else "本次没有可报告的拟合优度统计量。"
    )

    reliability_limits = (
        rg._boundary_note(request.model)
        + " 本轮没有做平行趋势、安慰剂、Hausman 或稳健性检验，因此不能声称这些检验已通过。"
    )
    next_steps = (
        "1) 先确认变量单位与统计口径是否一致；"
        "2) 换一组控制变量重跑，观察核心系数是否稳定；"
        "3) 需要因果表述时，补做识别设计与对应稳健性检验。"
    )

    sections = ExplanationSections(
        model_and_question=model_and_question,
        key_findings=key_findings,
        stats_explained=stats_explained,
        reliability_limits=reliability_limits,
        next_steps=next_steps,
    )
    return ModelExplanation(
        status="fallback",
        revision=1,
        research_question=request.research_question,
        sections=sections,
        cited_values=[],
        provider="rules",
        error=None,
    )
