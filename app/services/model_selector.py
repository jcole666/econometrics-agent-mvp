from __future__ import annotations

from app.schemas import ModelRequest


def select_model(request: ModelRequest) -> tuple[str, str, list[str]]:
    text = request.research_question.lower()
    columns_lower = {col.lower(): col for col in request.columns}

    if "rdd" in text or "断点" in text or "断点回归" in text:
        return (
            "RDD",
            "需求中出现断点回归相关关键词，适合先检查断点变量和阈值设定。",
            ["确认 running variable", "确认 cutoff 阈值", "检查断点两侧样本量", "选择带宽和多项式阶数"],
        )

    if "did" in text or "双重差分" in text or "政策" in text:
        return (
            "DID",
            "需求中出现政策评估或双重差分语义，适合检查处理组、时间变量和政策前后。",
            ["确认处理组变量", "确认政策前后时间变量", "检查平行趋势", "考虑固定效应和聚类稳健标准误"],
        )

    if "iv" in text or "2sls" in text or "工具变量" in text or request.instrument_variable:
        return (
            "IV-2SLS",
            "需求中出现工具变量相关信息，适合使用两阶段最小二乘。",
            ["确认内生解释变量", "确认工具变量", "检查相关性", "检查外生性假设"],
        )

    if request.entity_column and request.time_column:
        return (
            "Panel Fixed Effects",
            "用户提供了个体列和时间列，数据结构符合面板模型的基本要求。",
            ["确认个体 ID", "确认时间变量", "检查是否需要个体固定效应", "检查是否需要时间固定效应"],
        )

    if request.dependent_variable:
        y = request.dependent_variable.lower()
        if y in columns_lower:
            pass

    if "是否" in text or "概率" in text or "二分类" in text or "违约" in text:
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

