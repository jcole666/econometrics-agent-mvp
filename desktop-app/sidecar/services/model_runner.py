from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd
import statsmodels.api as sm
from linearmodels.panel import PanelOLS

from sidecar.schemas import CoefficientResult, ModelRunResults, RunModelResponse

SUPPORTED_RUN_MODELS = {"OLS", "Logit", "Panel Fixed Effects"}


def run_model(
    df: pd.DataFrame,
    model_type: str,
    dependent_variable: str,
    independent_variables: list[str],
    entity_column: str | None = None,
    time_column: str | None = None,
) -> RunModelResponse:
    normalized_model = normalize_model_type(model_type)
    if normalized_model not in SUPPORTED_RUN_MODELS:
        return RunModelResponse(
            model_type=normalized_model,
            success=False,
            error=(
                f"当前版本暂不支持真实运行 {normalized_model}。"
                "可以先使用生成的代码模板和检查清单整理建模方案。"
            ),
        )

    try:
        if normalized_model == "Panel Fixed Effects":
            prepared, warnings = _prepare_panel_frame(df, dependent_variable, independent_variables, entity_column, time_column)
            result = _run_panel_fixed_effects(prepared, dependent_variable, independent_variables)
        else:
            prepared, warnings = _prepare_model_frame(df, dependent_variable, independent_variables)
            result = _run_logit(prepared, dependent_variable, independent_variables) if normalized_model == "Logit" else _run_ols(prepared, dependent_variable, independent_variables)
        return RunModelResponse(model_type=normalized_model, success=True, results=result, warnings=warnings)
    except Exception as exc:
        return RunModelResponse(model_type=normalized_model, success=False, error=str(exc))


def normalize_model_type(model_type: str) -> str:
    lowered = model_type.strip().lower()
    mapping = {
        "ols": "OLS",
        "logit": "Logit",
        "did": "DID",
        "rdd": "RDD",
        "iv": "IV-2SLS",
        "iv-2sls": "IV-2SLS",
        "2sls": "IV-2SLS",
        "panel fixed effects": "Panel Fixed Effects",
    }
    return mapping.get(lowered, model_type.strip() or "UNKNOWN")


def _run_ols(df: pd.DataFrame, y_name: str, x_names: list[str]) -> ModelRunResults:
    y = df[y_name]
    x = sm.add_constant(df[x_names], has_constant="add")
    fitted = sm.OLS(y, x).fit(cov_type="HC1")
    return _extract_results(fitted, model_type="OLS")


def _run_logit(df: pd.DataFrame, y_name: str, x_names: list[str]) -> ModelRunResults:
    y = df[y_name]
    y_values = set(y.dropna().unique().tolist())
    if not y_values.issubset({0, 1}):
        raise ValueError("Logit 要求被解释变量 Y 只能编码为 0/1。")

    x = sm.add_constant(df[x_names], has_constant="add")
    fitted = sm.Logit(y, x).fit(disp=False)
    return _extract_results(fitted, model_type="Logit")


def _run_panel_fixed_effects(df: pd.DataFrame, y_name: str, x_names: list[str]) -> ModelRunResults:
    y = df[y_name]
    x = df[x_names]
    fitted = PanelOLS(y, x, entity_effects=True, time_effects=True, drop_absorbed=True).fit(
        cov_type="clustered",
        cluster_entity=True,
    )
    return _extract_results(fitted, model_type="Panel Fixed Effects")


def _prepare_model_frame(
    df: pd.DataFrame,
    dependent_variable: str,
    independent_variables: list[str],
) -> tuple[pd.DataFrame, list[str]]:
    y_name = dependent_variable.strip()
    x_names = list(dict.fromkeys(name.strip() for name in independent_variables if name.strip()))

    if not y_name:
        raise ValueError("被解释变量 Y 不能为空。")
    if not x_names:
        raise ValueError("至少需要一个解释变量 X。")

    required_columns = [y_name, *x_names]
    missing = [name for name in required_columns if name not in df.columns]
    if missing:
        raise ValueError("数据中不存在这些字段：" + ", ".join(missing))

    prepared = df[required_columns].copy()
    for name in required_columns:
        prepared[name] = pd.to_numeric(prepared[name], errors="coerce")

    rows_before = len(prepared)
    prepared = prepared.replace([math.inf, -math.inf], np.nan).dropna()
    rows_after = len(prepared)

    if rows_after < 3:
        raise ValueError("至少需要 3 行完整数据才能估计模型。")
    if rows_after <= len(x_names) + 1:
        raise ValueError("完整样本量相对解释变量数量过少，无法稳定估计。")

    warnings = []
    dropped = rows_before - rows_after
    if dropped:
        warnings.append(f"已自动剔除 {dropped} 行缺失或非数值记录。")
    return prepared, warnings


def _prepare_panel_frame(
    df: pd.DataFrame,
    dependent_variable: str,
    independent_variables: list[str],
    entity_column: str | None,
    time_column: str | None,
) -> tuple[pd.DataFrame, list[str]]:
    y_name = dependent_variable.strip()
    x_names = list(dict.fromkeys(name.strip() for name in independent_variables if name.strip()))
    entity = (entity_column or "").strip()
    time = (time_column or "").strip()

    if not y_name:
        raise ValueError("被解释变量 Y 不能为空。")
    if not x_names:
        raise ValueError("至少需要一个解释变量 X。")
    if not entity or not time:
        raise ValueError("面板固定效应需要填写个体列和时间列。")

    required_columns = [entity, time, y_name, *x_names]
    missing = [name for name in required_columns if name not in df.columns]
    if missing:
        raise ValueError("数据中不存在这些字段：" + ", ".join(missing))

    prepared = df[required_columns].copy()
    for name in [y_name, *x_names]:
        prepared[name] = pd.to_numeric(prepared[name], errors="coerce")

    rows_before = len(prepared)
    prepared = prepared.replace([math.inf, -math.inf], np.nan).dropna(subset=required_columns)
    rows_after = len(prepared)

    if rows_after < 4:
        raise ValueError("面板固定效应至少需要 4 行完整数据。")
    if int(prepared[entity].nunique(dropna=True)) < 2:
        raise ValueError("面板固定效应至少需要 2 个个体。")
    if int(prepared[time].nunique(dropna=True)) < 2:
        raise ValueError("面板固定效应至少需要 2 个时间期。")

    warnings = ["已加入个体固定效应和时间固定效应，标准误按个体聚类。"]
    dropped = rows_before - rows_after
    if dropped:
        warnings.append(f"已自动剔除 {dropped} 行缺失或非数值记录。")

    return prepared.set_index([entity, time]).sort_index(), warnings


def _extract_results(fitted: Any, model_type: str) -> ModelRunResults:
    params = fitted.params
    conf_int = fitted.conf_int()
    coefficients = []
    for variable in params.index:
        coefficients.append(
            CoefficientResult(
                variable=str(variable),
                coefficient=_safe_float(_series_get(params, variable)),
                std_error=_safe_float(_series_get(getattr(fitted, "bse", getattr(fitted, "std_errors", None)), variable)),
                t_statistic=_safe_float(_series_get(getattr(fitted, "tvalues", getattr(fitted, "tstats", None)), variable)),
                p_value=_safe_float(_series_get(getattr(fitted, "pvalues", None), variable)),
                ci_lower=_safe_float(_conf_int_value(conf_int, variable, 0)),
                ci_upper=_safe_float(_conf_int_value(conf_int, variable, 1)),
            )
        )

    f_statistic = getattr(fitted, "fvalue", None)
    f_pvalue = getattr(fitted, "f_pvalue", None)
    if model_type == "Panel Fixed Effects":
        stat = getattr(fitted, "f_statistic", None)
        f_statistic = getattr(stat, "stat", None)
        f_pvalue = getattr(stat, "pval", None)

    return ModelRunResults(
        sample_size=int(getattr(fitted, "nobs", 0)),
        r_squared=_safe_float(getattr(fitted, "rsquared", None)) if model_type in {"OLS", "Panel Fixed Effects"} else None,
        r_squared_adjusted=_safe_float(getattr(fitted, "rsquared_adj", None)) if model_type == "OLS" else None,
        f_statistic=_safe_float(f_statistic),
        f_pvalue=_safe_float(f_pvalue),
        log_likelihood=_safe_float(getattr(fitted, "llf", None)),
        coefficients=coefficients,
    )


def _series_get(values: Any, key: Any) -> Any:
    if values is None:
        return None
    if hasattr(values, "get"):
        return values.get(key)
    try:
        return values[key]
    except (KeyError, TypeError, IndexError):
        return None


def _conf_int_value(conf_int: Any, variable: Any, position: int) -> Any:
    if variable not in getattr(conf_int, "index", []):
        return None
    try:
        return conf_int.iloc[conf_int.index.get_loc(variable), position]
    except (AttributeError, IndexError, KeyError, TypeError):
        return None


def _safe_float(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(number) or math.isinf(number):
        return None
    return number
