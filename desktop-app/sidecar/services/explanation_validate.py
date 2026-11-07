"""解读校验：AI 写出来的每个数字都必须能对上 Python 算出的结果表。

规则写死在代码里，不依赖提示词自觉：
1. 五段必须齐全；
2. 数字必须命中白名单（允许四舍五入、科学计数、百分比写法），小整数与年份例外；
3. 禁止因果断言（OLS / 面板固定效应只能讲相关）；
4. 没跑过的检验不许写「通过」。
"""

from __future__ import annotations

import math
import re
from typing import Any

from sidecar.schemas import ExplanationSections, ModelRunResults

SECTION_KEYS = ("model_and_question", "key_findings", "stats_explained", "reliability_limits", "next_steps")
SECTION_NAMES = {
    "model_and_question": "模型与研究问题",
    "key_findings": "核心发现",
    "stats_explained": "统计量解释",
    "reliability_limits": "可靠性与边界",
    "next_steps": "下一步建议",
}

BANNED_CAUSAL_PHRASES = (
    "证明了因果",
    "证明因果",
    "证实了因果",
    "确认因果",
    "因果效应已被证明",
    "必然导致",
    "可以断定因果",
)
UNRUN_CHECK_KEYWORDS = (
    "平行趋势",
    "安慰剂",
    "豪斯曼",
    "Hausman",
    "稳健性检验",
    "过度识别",
    "弱工具变量",
)

_NUMBER = re.compile(r"-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?")
_SENTENCE_SPLIT = re.compile(r"[。；;！!？?\n]")


def numeric_whitelist(results: ModelRunResults) -> list[dict[str, Any]]:
    values: list[dict[str, Any]] = []

    def add(path: str, value: Any) -> None:
        if isinstance(value, bool) or value is None:
            return
        try:
            number = float(value)
        except (TypeError, ValueError):
            return
        if math.isfinite(number):
            values.append({"path": path, "value": number})

    add("sample_size", results.sample_size)
    add("r_squared", results.r_squared)
    add("r_squared_adjusted", results.r_squared_adjusted)
    add("f_statistic", results.f_statistic)
    add("f_pvalue", results.f_pvalue)
    add("log_likelihood", results.log_likelihood)
    for index, coefficient in enumerate(results.coefficients):
        add(f"coefficients[{index}].coefficient", coefficient.coefficient)
        add(f"coefficients[{index}].std_error", coefficient.std_error)
        add(f"coefficients[{index}].t_statistic", coefficient.t_statistic)
        add(f"coefficients[{index}].p_value", coefficient.p_value)
        add(f"coefficients[{index}].ci_lower", coefficient.ci_lower)
        add(f"coefficients[{index}].ci_upper", coefficient.ci_upper)
    return values


def _decimals(raw: str) -> int:
    if "." not in raw:
        return 0
    fraction = raw.split(".", 1)[1]
    for marker in ("e", "E"):
        if marker in fraction:
            fraction = fraction.split(marker, 1)[0]
    return len(fraction)


def _matches(number: float, allowed: list[float], decimals: int) -> bool:
    tolerance = max(0.5 * 10 ** (-decimals), 1e-9)
    for value in allowed:
        if abs(number - value) <= tolerance + abs(value) * 1e-9:
            return True
        # 允许把 0.47 写成 47%
        percent = value * 100
        if abs(number - percent) <= tolerance + abs(percent) * 1e-9:
            return True
    return False


def validate_explanation(sections: ExplanationSections, results: ModelRunResults) -> list[str]:
    problems: list[str] = []
    texts = {key: (getattr(sections, key) or "").strip() for key in SECTION_KEYS}

    for key, text in texts.items():
        if not text:
            problems.append(f"缺少「{SECTION_NAMES[key]}」段落。")
    if problems:
        return problems

    allowed = [item["value"] for item in numeric_whitelist(results)]
    for key, text in texts.items():
        for match in _NUMBER.finditer(text):
            raw = match.group(0)
            number = float(raw)
            decimals = _decimals(raw)
            if _matches(number, allowed, decimals):
                continue
            # 「3 个控制变量」「5% 水平」这类小整数不是回归结果
            if float(number).is_integer() and abs(number) <= 10:
                continue
            # 年份
            if float(number).is_integer() and 1900 <= number <= 2100:
                continue
            problems.append(f"「{SECTION_NAMES[key]}」出现对不上结果表的数字 {raw}。")

    whole = " ".join(texts.values())
    for phrase in BANNED_CAUSAL_PHRASES:
        if phrase in whole:
            problems.append(f"出现因果断言「{phrase}」，OLS / 面板固定效应只能讲相关。")

    for sentence in _SENTENCE_SPLIT.split(whole):
        if "通过" in sentence and any(keyword in sentence for keyword in UNRUN_CHECK_KEYWORDS):
            problems.append(f"提到未运行检验「通过」：{sentence.strip()[:40]}")

    return problems


def cited_values_from_text(sections: ExplanationSections, results: ModelRunResults) -> list[dict[str, Any]]:
    """把解读里用到的数字映射回结果表路径，便于前端点数字跳表格。"""
    whitelist = numeric_whitelist(results)
    cited: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()

    for key in SECTION_KEYS:
        text = getattr(sections, key) or ""
        for match in _NUMBER.finditer(text):
            raw = match.group(0)
            number = float(raw)
            decimals = _decimals(raw)
            for item in whitelist:
                value = item["value"]
                tolerance = max(0.5 * 10 ** (-decimals), 1e-9)
                if abs(number - value) <= tolerance or abs(number - value * 100) <= tolerance:
                    marker = (item["path"], raw)
                    if marker not in seen:
                        seen.add(marker)
                        cited.append({"path": item["path"], "value": value})
                    break
    return cited
