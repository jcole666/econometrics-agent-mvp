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
    return ModelRunCompareResponse(
        comparable=comparable,
        incomparable_reason="；".join(reasons) if reasons else None,
        config_diff=_config_diff(left, right),
        metrics_diff=_metrics_diff(left, right) if comparable else {},
        explanations={
            "left": left.ai_explanation.model_dump() if left.ai_explanation else None,
            "right": right.ai_explanation.model_dump() if right.ai_explanation else None,
        },
        ai_diff_summary=None,
    )


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
