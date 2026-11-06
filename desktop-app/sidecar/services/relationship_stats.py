"""关系图统计：散点 + 拟合线、相关系数矩阵。

约定：r / p / n / 斜率 / 相关系数只在这里算，前端与 LLM 都不得自行计算或改写。
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd

from sidecar.schemas import (
    ChartCaption,
    CorrHeatmapResponse,
    ScatterFit,
    ScatterPoint,
    ScatterResponse,
)

MAX_SCATTER_POINTS = 1200


def _require_columns(df: pd.DataFrame, columns: list[str]) -> None:
    missing = [column for column in columns if column not in df.columns]
    if missing:
        raise ValueError(f"列不在数据中：{', '.join(missing)}")


def _pearson(x: pd.Series, y: pd.Series) -> tuple[float | None, float | None]:
    n = len(x)
    if n < 3:
        return None, None
    with np.errstate(invalid="ignore", divide="ignore"):
        r = float(np.corrcoef(x.to_numpy(dtype=float), y.to_numpy(dtype=float))[0, 1])
    if not math.isfinite(r):
        return None, None
    r = max(-1.0, min(1.0, r))
    if abs(r) >= 1.0:
        return r, 0.0
    t_stat = r * math.sqrt((n - 2) / (1 - r * r))
    return r, _two_sided_p(t_stat, n - 2)


def _two_sided_p(t_stat: float, degrees: int) -> float | None:
    if degrees <= 0:
        return None
    try:
        from scipy import stats  # statsmodels 的依赖，通常可用

        return float(2 * stats.t.sf(abs(t_stat), degrees))
    except Exception:
        # 退化为正态近似：大样本下与 t 分布足够接近。
        return float(math.erfc(abs(t_stat) / math.sqrt(2)))


def _format_p(value: float | None) -> str:
    if value is None:
        return "p 无法计算"
    if value < 0.001:
        return "p < 0.001"
    return f"p = {value:.3f}"


def scatter_stats(df: pd.DataFrame, x_column: str, y_column: str) -> ScatterResponse:
    _require_columns(df, [x_column, y_column])
    frame = pd.DataFrame(
        {
            "x": pd.to_numeric(df[x_column], errors="coerce"),
            "y": pd.to_numeric(df[y_column], errors="coerce"),
        }
    ).dropna()

    warnings: list[str] = []
    n = int(len(frame))
    if n == 0:
        return ScatterResponse(
            x=x_column,
            y=y_column,
            n=0,
            warnings=[f"{x_column} 与 {y_column} 没有同时为数值的观测，无法画散点。"],
            caption=ChartCaption(
                how_to_read="散点图需要一个数值型横轴和一个数值型纵轴。",
                finding="当前两列没有可用观测。",
                caveat="请先确认这两列是数值列，或改用分类统计。",
            ),
        )

    if frame["x"].nunique() < 2 or frame["y"].nunique() < 2:
        warnings.append("其中一列取值恒定或几乎恒定，拟合线没有意义。")
    if n < 30:
        warnings.append(f"有效样本仅 {n} 个，相关估计不稳定，解读时以方向为主。")

    r, p_value = _pearson(frame["x"], frame["y"])
    fit: ScatterFit | None = None
    if frame["x"].nunique() >= 2:
        slope, intercept = np.polyfit(frame["x"].to_numpy(dtype=float), frame["y"].to_numpy(dtype=float), 1)
        if math.isfinite(float(slope)) and math.isfinite(float(intercept)):
            fit = ScatterFit(slope=round(float(slope), 6), intercept=round(float(intercept), 6))

    points: list[ScatterPoint] = []
    if n > MAX_SCATTER_POINTS:
        step = math.ceil(n / MAX_SCATTER_POINTS)
        sample = frame.iloc[::step]
        warnings.append(f"图上有 {len(sample)} 个点（每 {step} 个取 1 个展示），r/p/n 仍按全部 {n} 个观测计算。")
    else:
        sample = frame
    points = [ScatterPoint(x=round(float(row.x), 6), y=round(float(row.y), 6)) for row in sample.itertuples()]

    return ScatterResponse(
        x=x_column,
        y=y_column,
        points=points,
        fit=fit,
        r=round(r, 6) if r is not None else None,
        p_value=round(p_value, 6) if p_value is not None else None,
        n=n,
        warnings=warnings,
        caption=_scatter_caption(x_column, y_column, r, p_value, n, fit),
    )


def _scatter_caption(
    x_column: str,
    y_column: str,
    r: float | None,
    p_value: float | None,
    n: int,
    fit: ScatterFit | None,
) -> ChartCaption:
    how_to_read = (
        f"横轴是 {x_column}，纵轴是 {y_column}，每个点是一个观测；直线是用全部观测做的 OLS 拟合。"
        "r 衡量线性相关强度（-1 到 1），p 是「两者无关」时出现这么大相关性的概率。"
    )

    if r is None:
        finding = f"有效样本 {n} 个，但这一对的相关系数无法计算（可能有一列取值恒定）。"
    else:
        strength = "很弱" if abs(r) < 0.2 else "偏弱" if abs(r) < 0.4 else "中等" if abs(r) < 0.6 else "较强"
        direction = "正" if r > 0 else "负"
        significance = (
            "在 5% 水平显著"
            if p_value is not None and p_value < 0.05
            else "未达 5% 显著水平"
        )
        slope_text = f"，拟合斜率约 {fit.slope:.4g}" if fit else ""
        finding = f"r = {r:.3f}（{direction}相关，强度{strength}），{_format_p(p_value)}，n = {n}{slope_text}；{significance}。"

    caveat = "相关不等于因果：这条线只描述同时变化，不能说明谁导致谁；样本量小、异常值和遗漏变量都会改变结论。"
    return ChartCaption(how_to_read=how_to_read, finding=finding, caveat=caveat)


def corr_heatmap(df: pd.DataFrame, columns: list[str]) -> CorrHeatmapResponse:
    ordered = list(dict.fromkeys(column for column in columns if column))
    _require_columns(df, ordered)

    if len(ordered) < 2:
        return CorrHeatmapResponse(
            columns=ordered,
            matrix=[],
            n_matrix=[],
            warnings=["相关系数矩阵至少需要两个数值列。"],
            caption=ChartCaption(
                how_to_read="热力图的每一格是两个变量的皮尔逊相关系数。",
                finding="当前选择的列不足两列。",
                caveat="请至少勾选两个数值列。",
            ),
        )

    numeric = {column: pd.to_numeric(df[column], errors="coerce") for column in ordered}
    warnings: list[str] = []
    for column, series in numeric.items():
        if int(series.dropna().nunique()) < 2:
            warnings.append(f"{column} 取值恒定，相关系数无定义，格子里显示为空。")

    size = len(ordered)
    matrix: list[list[float | None]] = [[None] * size for _ in range(size)]
    n_matrix: list[list[int]] = [[0] * size for _ in range(size)]

    for i, left in enumerate(ordered):
        for j, right in enumerate(ordered):
            pair = pd.DataFrame({"a": numeric[left], "b": numeric[right]}).dropna()
            n_matrix[i][j] = int(len(pair))
            if i == j:
                if len(pair) >= 2 and int(pair["a"].nunique()) >= 2:
                    matrix[i][j] = 1.0
                continue
            r, _ = _pearson(pair["a"], pair["b"])
            matrix[i][j] = round(r, 6) if r is not None else None

    return CorrHeatmapResponse(
        columns=ordered,
        matrix=matrix,
        n_matrix=n_matrix,
        warnings=warnings,
        caption=_heatmap_caption(ordered, matrix, n_matrix),
    )


def _heatmap_caption(columns: list[str], matrix: list[list[float | None]], n_matrix: list[list[int]]) -> ChartCaption:
    how_to_read = (
        "每一格是两个变量的皮尔逊相关系数：偏红为正相关、偏蓝为负相关，颜色越深绝对值越大；"
        "成对删除缺失后计算，格子里的 n 是该对的有效样本量。"
    )

    best: tuple[float, str, str, int, float] | None = None
    for i in range(len(columns)):
        for j in range(i + 1, len(columns)):
            value = matrix[i][j]
            if value is None:
                continue
            candidate = (abs(value), columns[i], columns[j], n_matrix[i][j], value)
            if best is None or candidate[0] > best[0]:
                best = candidate

    if best is None:
        finding = "没有可计算的变量对。"
    else:
        magnitude, left, right, n, raw = best
        direction = "正" if raw > 0 else "负"
        finding = f"相关性最强的一对是 {left} 与 {right}：r = {raw:.3f}（{direction}相关），有效样本 {n} 个。"
        if magnitude >= 0.8:
            finding += "两者高度共线，同时放进回归会抬高标准误，需要取舍。"

    caveat = "系数只反映线性关系；非线性关系、异常值和样本构成变化都可能让系数失真，且同样不能作为因果证据。"
    return ChartCaption(how_to_read=how_to_read, finding=finding, caveat=caveat)
