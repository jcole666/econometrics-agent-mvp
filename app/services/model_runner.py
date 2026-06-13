from __future__ import annotations

import math
from typing import Any

import pandas as pd
import statsmodels.api as sm

from app.schemas import CoefficientResult, ModelRunResults, RunModelResponse

SUPPORTED_RUN_MODELS = {"OLS", "Logit"}


def run_model(
    df: pd.DataFrame,
    model_type: str,
    dependent_variable: str,
    independent_variables: list[str],
) -> RunModelResponse:
    normalized_model = _normalize_model_type(model_type)
    if normalized_model not in SUPPORTED_RUN_MODELS:
        return RunModelResponse(
            model_type=normalized_model,
            success=False,
            error=f"{normalized_model} 真实运行将在后续版本支持，当前版本可先使用代码模板和检查清单。",
        )

    try:
        prepared, warnings = _prepare_model_frame(df, dependent_variable, independent_variables)
        if normalized_model == "Logit":
            result = _run_logit(prepared, dependent_variable, independent_variables)
        else:
            result = _run_ols(prepared, dependent_variable, independent_variables)

        return RunModelResponse(
            model_type=normalized_model,
            success=True,
            results=result,
            warnings=warnings,
        )
    except Exception as exc:
        return RunModelResponse(
            model_type=normalized_model,
            success=False,
            error=str(exc),
        )


def _run_ols(df: pd.DataFrame, y_name: str, x_names: list[str]) -> ModelRunResults:
    y = df[y_name]
    x = sm.add_constant(df[x_names], has_constant="add")
    fitted = sm.OLS(y, x).fit(cov_type="HC1")
    return _extract_results(fitted, model_type="OLS")


def _run_logit(df: pd.DataFrame, y_name: str, x_names: list[str]) -> ModelRunResults:
    y = df[y_name]
    y_values = set(y.dropna().unique().tolist())
    if not y_values.issubset({0, 1}):
        raise ValueError("Logit 模型要求被解释变量 Y 只能取 0/1。")

    x = sm.add_constant(df[x_names], has_constant="add")
    fitted = sm.Logit(y, x).fit(disp=False)
    return _extract_results(fitted, model_type="Logit")


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
        raise ValueError("解释变量 X 不能为空。")

    required_columns = [y_name, *x_names]
    missing = [name for name in required_columns if name not in df.columns]
    if missing:
        raise ValueError("数据中不存在这些字段：" + ", ".join(missing))

    prepared = df[required_columns].copy()
    for name in required_columns:
        prepared[name] = pd.to_numeric(prepared[name], errors="coerce")

    rows_before = len(prepared)
    prepared = prepared.replace([math.inf, -math.inf], pd.NA).dropna()
    rows_after = len(prepared)

    if rows_after < 3:
        raise ValueError("有效样本量少于 3 行，无法稳定运行模型。")
    if rows_after <= len(x_names) + 1:
        raise ValueError("有效样本量过少，无法估计当前数量的解释变量。")

    warnings = []
    dropped = rows_before - rows_after
    if dropped:
        warnings.append(f"已自动去除 {dropped} 行缺失值或非数值记录。")

    return prepared, warnings


def _extract_results(fitted: Any, model_type: str) -> ModelRunResults:
    params = fitted.params
    conf_int = fitted.conf_int()
    coefficients = []
    for variable in params.index:
        coefficients.append(
            CoefficientResult(
                variable=str(variable),
                coefficient=_safe_float(params.get(variable)),
                std_error=_safe_float(getattr(fitted, "bse", {}).get(variable)),
                t_statistic=_safe_float(getattr(fitted, "tvalues", {}).get(variable)),
                p_value=_safe_float(getattr(fitted, "pvalues", {}).get(variable)),
                ci_lower=_safe_float(conf_int.loc[variable, 0]) if variable in conf_int.index else None,
                ci_upper=_safe_float(conf_int.loc[variable, 1]) if variable in conf_int.index else None,
            )
        )

    return ModelRunResults(
        sample_size=int(getattr(fitted, "nobs", 0)),
        r_squared=_safe_float(getattr(fitted, "rsquared", None)) if model_type == "OLS" else None,
        r_squared_adjusted=_safe_float(getattr(fitted, "rsquared_adj", None)) if model_type == "OLS" else None,
        f_statistic=_safe_float(getattr(fitted, "fvalue", None)),
        f_pvalue=_safe_float(getattr(fitted, "f_pvalue", None)),
        log_likelihood=_safe_float(getattr(fitted, "llf", None)),
        coefficients=coefficients,
    )


def _normalize_model_type(model_type: str) -> str:
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


def _safe_float(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(number) or math.isinf(number):
        return None
    return number
