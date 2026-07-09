from __future__ import annotations

from itertools import combinations

import pandas as pd
from pandas.api import types as pd_types


def profile_dataframe(df: pd.DataFrame) -> dict:
    columns = []
    for name in df.columns:
        series = df[name]
        missing = int(series.isna().sum())
        columns.append(
            {
                "name": str(name),
                "dtype": str(series.dtype),
                "missing": missing,
                "missing_rate": _ratio(missing, len(df)),
                "unique": int(series.nunique(dropna=True)),
                "kind": _column_kind(series),
                "sample_values": series.dropna().astype(str).head(3).tolist(),
            }
        )

    return {
        "rows": int(len(df)),
        "columns_count": int(len(df.columns)),
        "columns": columns,
        "diagnostics": build_diagnostics(df),
    }


def build_diagnostics(df: pd.DataFrame) -> dict:
    rows = len(df)
    cells = rows * len(df.columns)
    total_missing = int(df.isna().sum().sum())
    time_candidates = _time_candidates(df)
    entity_candidates = _entity_candidates(df, time_candidates)

    return {
        "total_missing": total_missing,
        "missing_rate": _ratio(total_missing, cells),
        "duplicate_rows": int(df.duplicated().sum()),
        "numeric_columns": sum(1 for name in df.columns if pd_types.is_numeric_dtype(df[name])),
        "categorical_columns": sum(1 for name in df.columns if _column_kind(df[name]) == "分类/文本"),
        "datetime_columns": sum(1 for name in df.columns if pd_types.is_datetime64_any_dtype(df[name])),
        "possible_time_columns": time_candidates,
        "possible_entity_columns": entity_candidates,
        "high_missing_columns": _high_missing_columns(df),
        "constant_columns": _constant_columns(df),
        "categorical_summaries": _categorical_summaries(df),
        "outlier_columns": _outlier_columns(df),
        "modeling_warnings": _modeling_warnings(df),
        "relationship_hints": _relationship_hints(df, time_candidates),
        "panel_hint": _panel_hint(df, entity_candidates, time_candidates),
    }


def _column_kind(series: pd.Series) -> str:
    if pd_types.is_bool_dtype(series):
        return "二元/布尔"
    if pd_types.is_datetime64_any_dtype(series):
        return "时间"
    if pd_types.is_numeric_dtype(series):
        values = set(pd.to_numeric(series, errors="coerce").dropna().unique().tolist())
        if values and values.issubset({0, 1}):
            return "二元/布尔"
    if pd_types.is_numeric_dtype(series):
        return "数值"
    return "分类/文本"


def _ratio(numerator: int | float, denominator: int | float) -> float:
    if not denominator:
        return 0.0
    return round(float(numerator) / float(denominator), 4)


def _time_candidates(df: pd.DataFrame) -> list[str]:
    keywords = ("year", "time", "date", "month", "quarter", "年份", "时间", "日期", "月份", "季度", "年")
    found: list[str] = []
    for name in df.columns:
        lowered = str(name).lower()
        series = df[name]
        if any(keyword in lowered for keyword in keywords):
            found.append(str(name))
            continue
        if pd_types.is_numeric_dtype(series):
            numeric = pd.to_numeric(series, errors="coerce").dropna()
            if not numeric.empty and numeric.between(1900, 2100).all() and numeric.nunique() <= 80:
                found.append(str(name))
    return found


def _entity_candidates(df: pd.DataFrame, time_candidates: list[str]) -> list[str]:
    keywords = (
        "city",
        "province",
        "region",
        "county",
        "district",
        "entity",
        "firm",
        "company",
        "school",
        "person",
        "城市",
        "省份",
        "地区",
        "区域",
        "个体",
        "企业",
        "公司",
    )
    time_set = set(time_candidates)
    found: list[str] = []
    for name in df.columns:
        label = str(name)
        if label in time_set:
            continue
        lowered = label.lower()
        if any(key in lowered for key in ("pilot", "policy", "treat", "treated", "post", "did", "试点", "政策", "处理")):
            continue
        unique = int(df[name].nunique(dropna=True))
        if any(keyword in lowered for keyword in keywords):
            found.append(label)
        elif 1 < unique <= max(20, len(df) // 2) and not pd_types.is_numeric_dtype(df[name]):
            found.append(label)
    return found


def _high_missing_columns(df: pd.DataFrame) -> list[dict]:
    result = []
    for name in df.columns:
        missing = int(df[name].isna().sum())
        rate = _ratio(missing, len(df))
        if rate >= 0.2:
            result.append({"name": str(name), "missing": missing, "missing_rate": rate})
    return result


def _constant_columns(df: pd.DataFrame) -> list[str]:
    return [str(name) for name in df.columns if int(df[name].nunique(dropna=True)) <= 1]


def _categorical_summaries(df: pd.DataFrame) -> list[dict]:
    result = []
    for name in df.columns:
        series = df[name]
        if pd_types.is_numeric_dtype(series):
            continue
        unique = int(series.nunique(dropna=True))
        if unique <= max(30, len(df) // 2):
            top_values = series.dropna().astype(str).value_counts().head(3)
            result.append(
                {
                    "name": str(name),
                    "unique": unique,
                    "top_values": [f"{index}({int(value)})" for index, value in top_values.items()],
                }
            )
    return result


def _outlier_columns(df: pd.DataFrame) -> list[dict]:
    result = []
    for name in df.columns:
        series = pd.to_numeric(df[name], errors="coerce").dropna()
        if series.size < 8:
            continue
        q1 = float(series.quantile(0.25))
        q3 = float(series.quantile(0.75))
        iqr = q3 - q1
        if iqr <= 0:
            continue
        lower = q1 - 1.5 * iqr
        upper = q3 + 1.5 * iqr
        count = int(((series < lower) | (series > upper)).sum())
        if count:
            result.append(
                {
                    "name": str(name),
                    "outliers": count,
                    "lower_bound": round(lower, 4),
                    "upper_bound": round(upper, 4),
                }
            )
    return result


def _modeling_warnings(df: pd.DataFrame) -> list[dict]:
    warnings = []
    rows = len(df)
    for name in df.columns:
        series = df[name]
        label = str(name)
        missing = int(series.isna().sum())
        unique = int(series.nunique(dropna=True))
        lowered = label.lower()

        if rows and missing / rows >= 0.2:
            warnings.append({"name": label, "reason": "缺失率较高，建模前需要说明处理方式"})
        if unique <= 1:
            warnings.append({"name": label, "reason": "有效取值过少，无法提供解释变化"})
        if unique >= max(10, rows * 0.9) and (not pd_types.is_numeric_dtype(series) or any(key in lowered for key in ("id", "index", "code", "编号"))):
            warnings.append({"name": label, "reason": "唯一值接近样本量，可能是 ID 或索引列"})
        if not pd_types.is_numeric_dtype(series) and any(key in lowered for key in ("city", "province", "region", "城市", "省份", "地区", "区域")):
            warnings.append({"name": label, "reason": "地区标识更适合做固定效应、分组或虚拟变量"})
    return warnings


def _relationship_hints(df: pd.DataFrame, time_candidates: list[str]) -> list[dict]:
    time_set = set(time_candidates)
    numeric_columns = [
        name
        for name in df.columns
        if str(name) not in time_set
        and pd_types.is_numeric_dtype(df[name])
        and int(df[name].nunique(dropna=True)) > 1
    ]
    hints = []

    for left, right in combinations(numeric_columns, 2):
        pair = df[[left, right]].apply(pd.to_numeric, errors="coerce").dropna()
        if len(pair) < 8:
            continue

        score = pair[left].corr(pair[right])
        if pd.isna(score) or abs(score) < 0.5:
            continue

        hints.append(
            {
                "left": str(left),
                "right": str(right),
                "method": "Pearson",
                "score": round(float(score), 3),
                "direction": "正相关" if score > 0 else "负相关",
                "note": _relationship_note(float(score)),
            }
        )

    return sorted(hints, key=lambda item: abs(item["score"]), reverse=True)[:8]


def _relationship_note(score: float) -> str:
    if abs(score) >= 0.8:
        return "关系很强，适合作为重点线索；建模时也要检查共同趋势和多重共线性。"
    return "关系较明显，可以放进研究路径里继续验证；它本身还不是因果证据。"


def _panel_hint(df: pd.DataFrame, entity_candidates: list[str], time_candidates: list[str]) -> dict | None:
    if not entity_candidates or not time_candidates:
        return None

    entity = entity_candidates[0]
    time = time_candidates[0]
    pairs = df[[entity, time]].dropna()
    if pairs.empty:
        return None

    units = int(pairs[entity].nunique(dropna=True))
    periods = int(pairs[time].nunique(dropna=True))
    observed = int(pairs.drop_duplicates().shape[0])
    expected = units * periods

    return {
        "entity_column": str(entity),
        "time_column": str(time),
        "units": units,
        "periods": periods,
        "observed_cells": observed,
        "expected_cells": expected,
        "is_balanced": expected > 0 and observed == expected,
        "missing_cells": max(expected - observed, 0),
    }
