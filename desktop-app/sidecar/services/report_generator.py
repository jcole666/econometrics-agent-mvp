from __future__ import annotations

from typing import Any

from sidecar.schemas import ReportRequest, ReportResponse


def generate_markdown_report(request: ReportRequest) -> ReportResponse:
    sections = [
        "# 计量分析报告",
        _section("研究问题", request.research_question),
        _section("模型选择", _model_summary(request.model_type)),
        _section("核心结果", _results_summary(request.model_results or {})),
        _section("建模提醒", _model_notes(request.model_type)),
    ]
    if request.inference_notes:
        sections.append(_section("变量识别说明", request.inference_notes))
    return ReportResponse(markdown="\n\n".join(sections).strip() + "\n")


def _section(title: str, body: str) -> str:
    return f"## {title}\n\n{body.strip()}"


def _model_summary(model_type: str) -> str:
    explanations = {
        "OLS": "OLS 用于估计连续型被解释变量的基准线性关系，适合作为第一版影响关系模型。",
        "Logit": "Logit 适用于 0/1 型结果变量，解释时应关注预测概率或边际效应。",
        "DID": "DID 适合政策前后、处理组与对照组的比较，核心前提是平行趋势。",
        "RDD": "RDD 适合存在明确断点或阈值的场景，重点关注断点附近的局部比较。",
        "IV-2SLS": "IV-2SLS 适合存在内生性且有可信工具变量的场景。",
        "Panel Fixed Effects": "面板固定效应用于控制个体层面不随时间变化的不可观测差异。",
    }
    normalized = model_type.strip() or "未知模型"
    return explanations.get(normalized, f"当前模型为 {normalized}，解释前需要继续确认变量定义和模型假设。")


def _results_summary(results: dict[str, Any]) -> str:
    if not results:
        return "当前还没有模型运行结果。请先运行模型，再把这一节作为正式报告内容。"

    lines = []
    if results.get("sample_size") is not None:
        lines.append(f"- 有效样本量：{results['sample_size']}")
    if results.get("r_squared") is not None:
        lines.append(f"- R2：{_fmt(results['r_squared'])}")
    if results.get("r_squared_adjusted") is not None:
        lines.append(f"- 调整后 R2：{_fmt(results['r_squared_adjusted'])}")

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

    return "\n".join(lines) if lines else "模型结果字段不足，暂时无法生成详细摘要。"


def _model_notes(model_type: str) -> str:
    normalized = model_type.strip()
    notes = {
        "OLS": "建议继续检查缺失值、多重共线性、异常值，并优先报告稳健标准误。",
        "Logit": "建议检查 Y 是否确实为 0/1、类别是否严重不平衡，并在解释时关注边际效应。",
        "DID": "建议补充处理组、政策后变量、平行趋势检验和聚类稳健标准误。",
        "RDD": "建议补充 running variable、cutoff、带宽选择和断点操纵检验。",
        "IV-2SLS": "建议补充第一阶段强度、工具变量相关性和排除限制论证。",
        "Panel Fixed Effects": "建议确认个体/时间索引，并选择合适的协方差估计方式。",
    }
    return notes.get(normalized, "建议结合变量定义、模型假设和数据结构继续检查估计是否可靠。")


def _fmt(value: Any) -> str:
    try:
        return f"{float(value):.4f}"
    except (TypeError, ValueError):
        return ""
