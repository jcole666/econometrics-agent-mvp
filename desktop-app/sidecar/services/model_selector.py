from __future__ import annotations

from sidecar.schemas import ModelRequest


def select_model(request: ModelRequest) -> tuple[str, str, list[str]]:
    text = request.research_question.lower()

    if request.running_variable or _has_any(text, ["rdd", "regression discontinuity", "discontinuity", "cutoff", "threshold", "断点", "阈值"]):
        return (
            "RDD",
            "研究问题涉及断点、阈值或 cutoff，优先考虑断点回归，并重点检查断点附近样本。",
            ["确认 running variable", "确认 cutoff 阈值", "检查断点两侧样本量", "选择带宽和多项式阶数"],
        )

    if (request.treatment_column and request.time_column) or _has_any(
        text,
        ["did", "difference in differences", "policy", "before and after", "treated", "control group", "双重差分", "政策", "处理组", "对照组"],
    ):
        return (
            "DID",
            "研究问题像政策前后或处理组/对照组比较，适合先按 DID 思路整理变量。",
            ["确认处理组变量", "确认政策后时间变量", "检查平行趋势", "考虑固定效应和聚类稳健标准误"],
        )

    if request.instrument_variable or _has_any(text, ["iv", "2sls", "instrument", "endogeneity", "工具变量", "内生性"]):
        return (
            "IV-2SLS",
            "研究问题涉及内生性或工具变量，建议考虑两阶段最小二乘。",
            ["确认内生解释变量", "确认工具变量", "检查工具变量相关性", "说明排除限制假设"],
        )

    if request.entity_column and request.time_column:
        return (
            "Panel Fixed Effects",
            "已经提供个体列和时间列，数据结构适合面板固定效应工作流。",
            ["确认个体 ID", "确认时间列", "决定是否加入个体和时间固定效应", "根据数据结构选择聚类标准误"],
        )

    if _has_any(text, ["probability", "binary", "default", "choice", "yes/no", "logit", "0/1", "是否", "概率", "二分类"]):
        return (
            "Logit",
            "被解释变量看起来是二分类结果，Logit 比线性模型更适合作为第一版。",
            ["确认 Y 是否编码为 0/1", "检查类别是否严重不平衡", "报告边际效应或预测概率"],
        )

    return (
        "OLS",
        "研究问题更像连续结果变量上的基准影响关系分析，先用 OLS 建立可解释的第一版模型。",
        ["确认 Y 是连续变量", "检查缺失值", "检查多重共线性", "使用稳健标准误"],
    )


def _has_any(text: str, keywords: list[str]) -> bool:
    return any(keyword.lower() in text for keyword in keywords)
