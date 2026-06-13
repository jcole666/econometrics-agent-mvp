from __future__ import annotations

from typing import Any

from app.schemas import ReportRequest, ReportResponse


def generate_markdown_report(request: ReportRequest) -> ReportResponse:
    results = request.model_results or {}
    sections = [
        "# 计量分析报告",
        _section("研究问题", request.research_question),
        _section("模型选择", _model_summary(request.model_type)),
        _section("核心结果", _results_summary(results)),
        _section("建模提醒", _model_notes(request.model_type)),
    ]

    if request.inference_notes:
        sections.append(_section("用户备注", request.inference_notes))

    return ReportResponse(markdown="\n\n".join(sections).strip() + "\n")


def _section(title: str, body: str) -> str:
    return f"## {title}\n\n{body.strip()}"


def _model_summary(model_type: str) -> str:
    normalized = model_type.strip() or "未知模型"
    explanations = {
        "OLS": "本次使用 OLS 多元线性回归，适合连续型被解释变量和基础影响关系分析。",
        "Logit": "本次使用 Logit 模型，适合被解释变量为 0/1 的二分类结果场景。",
        "DID": "DID 适合政策前后、处理组与对照组比较场景，核心前提是平行趋势假设。",
        "RDD": "RDD 适合存在明确断点或阈值的局部政策评估场景，需要重点检查断点附近样本和操纵问题。",
        "IV-2SLS": "IV-2SLS 适合存在内生性且有合理工具变量的场景，需要说明工具变量相关性和外生性。",
    }
    return explanations.get(normalized, f"本次模型类型为 {normalized}，需要结合研究问题和变量结构进一步确认。")


def _results_summary(results: dict[str, Any]) -> str:
    if not results:
        return "当前尚未提供模型运行结果。可以先运行 `/run-model`，再生成包含系数和显著性的报告。"

    lines = []
    sample_size = results.get("sample_size")
    if sample_size is not None:
        lines.append(f"- 有效样本量：{sample_size}")

    r_squared = results.get("r_squared")
    if r_squared is not None:
        lines.append(f"- R2：{_fmt(r_squared)}")

    r_squared_adjusted = results.get("r_squared_adjusted")
    if r_squared_adjusted is not None:
        lines.append(f"- 调整后 R2：{_fmt(r_squared_adjusted)}")

    coefficients = results.get("coefficients") or []
    if coefficients:
        lines.append("\n| 变量 | 系数 | 标准误 | 统计量 | p 值 |")
        lines.append("|---|---:|---:|---:|---:|")
        for item in coefficients:
            lines.append(
                "| {variable} | {coef} | {std} | {stat} | {p} |".format(
                    variable=item.get("variable", ""),
                    coef=_fmt(item.get("coefficient")),
                    std=_fmt(item.get("std_error")),
                    stat=_fmt(item.get("t_statistic")),
                    p=_fmt(item.get("p_value")),
                )
            )

    if not lines:
        return "模型结果字段较少，暂无法生成详细结果摘要。"
    return "\n".join(lines)


def _model_notes(model_type: str) -> str:
    normalized = model_type.strip()
    if normalized == "OLS":
        return "建议继续检查缺失值、多重共线性、异方差，并优先报告稳健标准误。"
    if normalized == "Logit":
        return "建议检查 Y 是否确实为 0/1、类别是否严重不平衡，并在解释时关注边际效应。"
    if normalized == "DID":
        return "建议补充处理组、政策后变量、平行趋势检验和聚类稳健标准误。"
    if normalized == "RDD":
        return "建议补充 running variable、cutoff、带宽选择、断点两侧样本量和操纵检验。"
    if normalized == "IV-2SLS":
        return "建议补充内生变量、工具变量、弱工具变量检验和外生性论证。"
    return "建议结合变量定义、模型假设和数据结构继续检查结果是否可靠。"


def _fmt(value: Any) -> str:
    try:
        return f"{float(value):.4f}"
    except (TypeError, ValueError):
        return ""
