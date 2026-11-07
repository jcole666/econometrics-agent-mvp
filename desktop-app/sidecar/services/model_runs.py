"""模型运行版本管理：创建、列表、读取、挂解读、双版本对比。

存储交给 ``project_store``（分文件 + index + 原子写）。这里只负责业务规则：
- 每次运行新建版本，绝不覆盖；
- 解读重新生成时 revision +1；
- 对比只在「同模型、同数据」时给数值差异，不可比就明确说原因，不硬算百分比。
"""

from __future__ import annotations

from typing import Any

from sidecar.schemas import (
    ModelExplanation,
    ModelRunCompareResponse,
    ModelRunCreateRequest,
    ModelRunRecord,
)
from sidecar.services import project_store

CONFIG_FIELDS = (
    "dependent_variable",
    "entity_column",
    "time_column",
    "treatment_column",
    "running_variable",
    "instrument_variable",
)

CONFIG_LABELS = {
    "dependent_variable": "被解释变量",
    "entity_column": "个体列",
    "time_column": "时间列",
    "treatment_column": "处理列",
    "running_variable": "断点变量",
    "instrument_variable": "工具变量",
}


def create_run(request: ModelRunCreateRequest) -> ModelRunRecord:
    record = ModelRunRecord(
        version_id="v001",
        parent_id=request.parent_id,
        research_question=request.research_question,
        dataset_id=request.dataset_id,
        dataset_hash=request.dataset_hash,
        variable_dictionary_snapshot=request.variable_dictionary_snapshot,
        model=request.model,
        config=request.config,
        result=request.result,
        diagnostics=request.diagnostics or {},
        ai_explanation=request.ai_explanation,
    )
    return project_store.create_model_run(record)


def list_runs(dataset_id: str) -> list[ModelRunRecord]:
    return project_store.list_model_runs(dataset_id)


def get_run(dataset_id: str, version_id: str) -> ModelRunRecord | None:
    return project_store.read_model_run(dataset_id, version_id)


def attach_explanation(dataset_id: str, version_id: str, explanation: ModelExplanation) -> ModelRunRecord | None:
    record = get_run(dataset_id, version_id)
    if record is None:
        return None
    previous = record.ai_explanation
    revision = (previous.revision if previous else 0) + 1
    updated = explanation.model_copy(update={"revision": revision})
    return project_store.update_model_explanation(dataset_id, version_id, updated)


def compare_runs(dataset_id: str, left_id: str, right_id: str) -> ModelRunCompareResponse:
    left = get_run(dataset_id, left_id)
    right = get_run(dataset_id, right_id)
    if left is None or right is None:
        missing = left_id if left is None else right_id
        raise ValueError(f"版本 {missing} 不存在。")

    reasons: list[str] = []
    if left.model != right.model:
        reasons.append(f"模型类型不同（{left.model} 与 {right.model}）")
    if left.dataset_hash and right.dataset_hash and left.dataset_hash != right.dataset_hash:
        reasons.append("样本数据不同（dataset_hash 不一致）")

    comparable = not reasons
    config_diff = _config_diff(left, right)
    metrics_diff = _metrics_diff(left, right) if comparable else {}
    return ModelRunCompareResponse(
        comparable=comparable,
        incomparable_reason="；".join(reasons) if reasons else None,
        config_diff=config_diff,
        metrics_diff=metrics_diff,
        explanations={
            "left": left.ai_explanation.model_dump() if left.ai_explanation else None,
            "right": right.ai_explanation.model_dump() if right.ai_explanation else None,
        },
        ai_diff_summary=_diff_summary(left, right, config_diff, metrics_diff, comparable, reasons),
    )


def _diff_summary(
    left: ModelRunRecord,
    right: ModelRunRecord,
    config_diff: dict[str, Any],
    metrics_diff: dict[str, Any],
    comparable: bool,
    reasons: list[str],
) -> str:
    """本地模板生成的差异摘要（不调模型）。

    可比：说清「改了什么 → 哪些数跟着动」，数字全部来自 metrics_diff。
    不可比：只复述原因，绝不给「提升 x%」这类跨设定比较。
    """
    head = f"{left.version_id} → {right.version_id}："
    if not comparable:
        return f"{head}两次运行不可比：{'；'.join(reasons)}。这里只列配置差异，不比较系数与拟合优度。"

    parts: list[str] = [f"两次运行都用 {left.model}，样本与数据一致。"]

    added = config_diff.get("added_independent_variables") or []
    removed = config_diff.get("removed_independent_variables") or []
    if added:
        parts.append(f"新增解释变量：{'、'.join(added)}。")
    if removed:
        parts.append(f"移除解释变量：{'、'.join(removed)}。")
    for field in ("dependent_variable", "entity_column", "time_column", "treatment_column", "running_variable", "instrument_variable"):
        pair = config_diff.get(field)
        if isinstance(pair, dict):
            parts.append(f"{CONFIG_LABELS.get(field, field)}由「{_text(pair.get('left'))}」改为「{_text(pair.get('right'))}」。")
    if not added and not removed and not any(isinstance(config_diff.get(f), dict) for f in config_diff):
        parts.append("模型设定完全相同，差异只来自重复估计或数据本身。")

    core = _core_coefficient(metrics_diff.get("coefficients") or [])
    if core:
        parts.append(
            f"核心变量 {core['variable']} 的系数 {_num(core.get('left_coefficient'), 4)} → "
            f"{_num(core.get('right_coefficient'), 4)}（Δ {_signed(core.get('delta'))}），"
            f"p 值 {_p(core.get('left_p_value'))} → {_p(core.get('right_p_value'))}。"
        )

    r2 = metrics_diff.get("r_squared")
    if isinstance(r2, dict) and (r2.get("left") is not None or r2.get("right") is not None):
        parts.append(
            f"R² {_num(r2.get('left'), 4)} → {_num(r2.get('right'), 4)}（Δ {_signed(r2.get('delta'))}）。"
        )
    sample = metrics_diff.get("sample_size")
    if isinstance(sample, dict) and sample.get("left") != sample.get("right"):
        parts.append(f"样本量 {sample.get('left')} → {sample.get('right')}。")

    parts.append("这只是两次设定的机械差异，不能据此判定哪个模型更好；是否保留变量要回到理论与检验。")
    return head + "".join(parts)


def _core_coefficient(coefficients: list[dict[str, Any]]) -> dict[str, Any] | None:
    """摘要只讲一个核心变量：优先两边都有系数的第一个（配置顺序里的第一项就是核心 X）。"""
    for item in coefficients:
        if item.get("left_coefficient") is not None and item.get("right_coefficient") is not None:
            return item
    return coefficients[0] if coefficients else None


def _num(value: Any, digits: int) -> str:
    if value is None:
        return "—"
    try:
        return f"{float(value):.{digits}f}"
    except (TypeError, ValueError):
        return "—"


def _p(value: Any) -> str:
    """p 值按论文习惯显示：小于 0.001 写 <0.001，不写 0.000。"""
    if value is None:
        return "—"
    try:
        number = float(value)
    except (TypeError, ValueError):
        return "—"
    return "<0.001" if number < 0.001 else f"{number:.3f}"


def _signed(value: Any) -> str:
    if value is None:
        return "—"
    try:
        number = float(value)
    except (TypeError, ValueError):
        return "—"
    return f"{number:+.4f}" if abs(number) < 1000 else f"{number:+.0f}"


def _text(value: Any) -> str:
    if value is None or value == "":
        return "空"
    if isinstance(value, list):
        return "、".join(str(item) for item in value) or "空"
    return str(value)


def _config_diff(left: ModelRunRecord, right: ModelRunRecord) -> dict[str, Any]:
    diff: dict[str, Any] = {}
    for field in CONFIG_FIELDS:
        left_value = getattr(left.config, field)
        right_value = getattr(right.config, field)
        if left_value != right_value:
            diff[field] = {"left": left_value, "right": right_value}

    added = [item for item in right.config.independent_variables if item not in left.config.independent_variables]
    removed = [item for item in left.config.independent_variables if item not in right.config.independent_variables]
    if added:
        diff["added_independent_variables"] = added
    if removed:
        diff["removed_independent_variables"] = removed
    return diff


def _delta(left: float | None, right: float | None) -> float | None:
    if left is None or right is None:
        return None
    return round(float(right) - float(left), 6)


def _metrics_diff(left: ModelRunRecord, right: ModelRunRecord) -> dict[str, Any]:
    left_results = left.result.results
    right_results = right.result.results
    if left_results is None or right_results is None:
        return {}

    coefficients: list[dict[str, Any]] = []
    left_map = {item.variable: item for item in left_results.coefficients}
    right_map = {item.variable: item for item in right_results.coefficients}
    ordered = list(dict.fromkeys([*left_map.keys(), *right_map.keys()]))
    for variable in ordered:
        left_item = left_map.get(variable)
        right_item = right_map.get(variable)
        coefficients.append(
            {
                "variable": variable,
                "left_coefficient": left_item.coefficient if left_item else None,
                "right_coefficient": right_item.coefficient if right_item else None,
                "delta": _delta(
                    left_item.coefficient if left_item else None,
                    right_item.coefficient if right_item else None,
                ),
                "left_p_value": left_item.p_value if left_item else None,
                "right_p_value": right_item.p_value if right_item else None,
            }
        )

    metrics: dict[str, Any] = {
        "sample_size": {"left": left_results.sample_size, "right": right_results.sample_size},
        "coefficients": coefficients,
    }
    # 两种拟合指标按可用性输出：面板固定效应常没有调整后 R²，
    # 若两边都是 None 就不下发，避免前端渲染出一行全「—」。
    for key, left_value, right_value in (
        ("r_squared", left_results.r_squared, right_results.r_squared),
        ("r_squared_adjusted", left_results.r_squared_adjusted, right_results.r_squared_adjusted),
    ):
        if left_value is None and right_value is None:
            continue
        metrics[key] = {"left": left_value, "right": right_value, "delta": _delta(left_value, right_value)}
    return metrics
