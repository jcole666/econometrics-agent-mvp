from __future__ import annotations

from app.schemas import ModelRequest


def select_model(request: ModelRequest) -> tuple[str, str, list[str]]:
    text = request.research_question.lower()

    if has_any(text, ["rdd", "断点", "断点回归", "阈值", "分数线"]):
        return (
            "RDD",
            "需求中出现断点回归或阈值相关线索，适合先检查断点变量和 cutoff 设置。",
            ["确认 running variable", "确认 cutoff 阈值", "检查断点两侧样本量", "选择带宽和多项式阶数"],
        )

    if has_any(text, ["did", "双重差分", "政策", "实施前后", "处理组", "对照组"]):
        return (
            "DID",
            "需求中出现政策评估、处理组/对照组或政策前后比较线索，适合优先考虑 DID。",
            ["确认处理组变量", "确认政策前后时间变量", "检查平行趋势", "考虑固定效应和聚类稳健标准误"],
        )

    if has_any(text, ["iv", "2sls", "工具变量", "内生性"]) or request.instrument_variable:
        return (
            "IV-2SLS",
            "需求中出现工具变量或内生性相关信息，适合使用两阶段最小二乘。",
            ["确认内生解释变量", "确认工具变量", "检查工具变量相关性", "说明工具变量外生性假设"],
        )

    if request.entity_column and request.time_column:
        return (
            "Panel Fixed Effects",
            "用户提供了个体列和时间列，数据结构符合面板模型的基本要求。",
            ["确认个体 ID", "确认时间变量", "检查是否需要个体固定效应", "检查是否需要时间固定效应"],
        )

    if has_any(text, ["概率", "二分类", "违约", "是否违约", "是否选择", "是否发生"]):
        return (
            "Logit",
            "需求呈现二分类或概率解释场景，优先推荐 Logit 模型。",
            ["确认 Y 是否为 0/1", "检查类别是否极度不平衡", "解释边际效应而不只看系数"],
        )

    return (
        "OLS",
        "默认基础影响关系分析，适合连续型被解释变量和线性解释场景。",
        ["确认 Y 为连续变量", "检查缺失值", "检查多重共线性", "考虑稳健标准误"],
    )


def has_any(text: str, keywords: list[str]) -> bool:
    return any(keyword.lower() in text for keyword in keywords)
