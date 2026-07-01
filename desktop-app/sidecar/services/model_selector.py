from __future__ import annotations

from sidecar.schemas import ModelRequest


def select_model(request: ModelRequest) -> tuple[str, str, list[str]]:
    text = request.research_question.lower()
    entity_column = request.entity_column or _find_column(
        request.columns,
        ["city", "province", "region", "county", "district", "firm", "company", "entity", "城市", "省份", "地区", "企业"],
        exclude=["pilot", "policy", "treat", "post", "试点", "政策", "处理"],
    )
    time_column = request.time_column or _find_column(request.columns, ["year", "time", "date", "month", "年份", "时间", "日期", "月份"])
    treatment_column = request.treatment_column or _find_column(request.columns, ["treat", "treated", "policy", "pilot", "post", "did", "试点", "政策", "处理"])

    if request.running_variable or _has_any(text, ["rdd", "regression discontinuity", "discontinuity", "cutoff", "threshold", "断点", "阈值"]):
        return (
            "RDD",
            "研究问题涉及断点、阈值或 cutoff。优先按 RDD 整理识别策略，但需要把断点附近的样本连续性、操纵检验和带宽选择讲清楚。",
            ["确认 running variable 与 cutoff", "检查断点两侧样本量和协变量连续性", "比较不同带宽和多项式阶数", "替代模型：局部线性回归或安慰剂断点"],
        )

    if (treatment_column and time_column and _has_any(text, ["did", "difference in differences", "policy", "pilot", "before and after", "treated", "control group", "双重差分", "政策", "试点", "处理组", "对照组"])) or _has_any(
        text,
        ["did", "difference in differences", "双重差分"],
    ):
        return (
            "DID",
            f"数据中可以找到处理/政策变量 {_quote(treatment_column)} 和时间变量 {_quote(time_column)}，研究问题也具有政策评估特征。建议优先按 DID 组织识别路径，而不是只做普通相关性回归。",
            ["确认处理组、政策后和交互项定义", "检查政策前平行趋势", "加入个体和时间固定效应", "替代模型：事件研究、安慰剂检验或面板固定效应"],
        )

    if request.instrument_variable or _has_any(text, ["iv", "2sls", "instrument", "endogeneity", "工具变量", "内生性"]):
        return (
            "IV-2SLS",
            "研究问题已经提到内生性或工具变量。建议按 IV-2SLS 组织模型，但重点不在公式本身，而在工具变量相关性和排除限制是否可信。",
            ["确认内生解释变量和工具变量", "报告第一阶段相关性和弱工具变量检验", "说明排除限制的理论依据", "替代模型：滞后变量、固定效应或稳健性边界分析"],
        )

    if entity_column and time_column:
        return (
            "Panel Fixed Effects",
            f"数据包含个体/地区列 {_quote(entity_column)} 和时间列 {_quote(time_column)}，更像面板数据。建议先用双向固定效应作为主线，控制城市不随时间变化的特征和共同年份冲击，再讨论核心解释变量的识别风险。",
            ["确认个体固定效应和时间固定效应设定", "使用聚类稳健标准误", "比较加入控制变量前后的核心系数", "替代模型：OLS 基准、DID 或带滞后项的面板模型"],
        )

    if _has_any(text, ["probability", "binary", "default", "choice", "yes/no", "logit", "0/1", "是否", "概率", "二分类"]):
        return (
            "Logit",
            "被解释变量看起来是二分类结果。Logit 更适合作为第一版模型，但结果解释应转成边际效应或预测概率，避免直接把系数当作线性影响。",
            ["确认 Y 是否编码为 0/1", "检查类别是否严重不平衡", "报告边际效应或预测概率", "替代模型：线性概率模型或 Probit"],
        )

    return (
        "OLS",
        "当前字段结构没有明确显示面板、政策冲击、断点或工具变量。建议先用 OLS 建立可解释的基准模型，并把结论限定为相关性证据。",
        ["确认 Y 是连续变量", "检查缺失值、异常值和多重共线性", "使用稳健标准误", "替代模型：加入固定效应、Logit 或 IV-2SLS，取决于研究设计"],
    )


def _has_any(text: str, keywords: list[str]) -> bool:
    return any(keyword.lower() in text for keyword in keywords)


def _find_column(columns: list[str], keywords: list[str], exclude: list[str] | None = None) -> str | None:
    excluded = [item.lower() for item in (exclude or [])]
    lowered_keywords = [item.lower() for item in keywords]
    for column in columns:
        lowered = column.lower()
        if excluded and any(item in lowered for item in excluded):
            continue
        if any(keyword in lowered for keyword in lowered_keywords):
            return column
    return None


def _quote(value: str | None) -> str:
    return f"`{value}`" if value else "相关字段"
