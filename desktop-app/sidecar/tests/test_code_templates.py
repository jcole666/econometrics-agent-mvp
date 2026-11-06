from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from sidecar.schemas import ModelRequest
from sidecar.services.code_generator import generate_code


def _run_template(code: str, df: pd.DataFrame) -> dict:
    """把模板里的 read_csv 换成本地 DataFrame 后真实执行，确认模板跑得通。"""

    patched = code.replace('pd.read_csv("data.csv")', "DATA.copy()")
    namespace: dict = {"DATA": df, "pd": pd}
    exec(compile(patched, "<template>", "exec"), namespace)  # noqa: S102 - 测试自有模板
    return namespace


def _did_panel(effect: float = 6.0, seed: int = 7) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    rows = []
    for city in range(1, 11):
        treated = 1 if city >= 6 else 0
        for year in range(2018, 2022):
            post = 1 if year >= 2020 else 0
            rows.append(
                {
                    "城市": f"C{city:02d}",
                    "年份": year,
                    "处理组": treated,
                    "创新指数": 20 + city * 0.5 + year * 0.2 + effect * treated * post + rng.normal(0, 0.3),
                }
            )
    return pd.DataFrame(rows)


def test_did_template_uses_policy_year_not_raw_year() -> None:
    request = ModelRequest(
        research_question="政策是否提升创新",
        columns=["城市", "年份", "处理组", "创新指数"],
        dependent_variable="创新指数",
        independent_variables=["处理组", "年份"],
        entity_column="城市",
        time_column="年份",
        treatment_column="处理组",
        policy_period=2020,
    )

    code = generate_code("DID", request)

    assert "POLICY_YEAR = 2020" in code
    assert 'df["did"] = df["did_treated"] * df["did_post"]' in code
    assert ">= POLICY_YEAR" in code
    # 旧模板的错误写法：直接拿年份列相乘
    assert '* df["年份"]' not in code


def test_did_template_recovers_true_effect() -> None:
    request = ModelRequest(
        research_question="政策是否提升创新",
        columns=["城市", "年份", "处理组", "创新指数"],
        dependent_variable="创新指数",
        independent_variables=[],
        entity_column="城市",
        time_column="年份",
        treatment_column="处理组",
        policy_period=2020,
    )

    namespace = _run_template(generate_code("DID", request), _did_panel(effect=6.0))

    assert abs(namespace["result"].params["did"] - 6.0) < 0.8


def test_rdd_template_limits_sample_to_bandwidth() -> None:
    request = ModelRequest(
        research_question="分数线是否影响录取",
        columns=["考试分数", "录取率"],
        dependent_variable="录取率",
        independent_variables=[],
        running_variable="考试分数",
        cutoff=500,
        bandwidth=120,
    )

    code = generate_code("RDD", request)

    assert "CUTOFF = 500" in code
    assert "H = 120" in code
    assert 'sample = df[df["running_centered"].abs() <= H]' in code


def test_rdd_template_recovers_jump() -> None:
    rng = np.random.default_rng(11)
    scores = rng.uniform(300, 700, 800)
    y = 0.3 + 0.25 * (scores >= 500) + rng.normal(0, 0.1, 800)
    df = pd.DataFrame({"考试分数": scores, "录取率": y})

    request = ModelRequest(
        research_question="分数线是否影响录取",
        columns=["考试分数", "录取率"],
        dependent_variable="录取率",
        independent_variables=[],
        running_variable="考试分数",
        cutoff=500,
        bandwidth=150,
    )

    namespace = _run_template(generate_code("RDD", request), df)

    assert abs(namespace["result"].params["above"] - 0.25) < 0.06


def test_rdd_template_without_bandwidth_still_runs() -> None:
    rng = np.random.default_rng(12)
    scores = rng.normal(0, 1, 400)
    df = pd.DataFrame({"考试分数": scores, "录取率": 0.3 + 0.25 * (scores >= 0) + rng.normal(0, 0.1, 400)})

    request = ModelRequest(
        research_question="断点是否有效应",
        columns=["考试分数", "录取率"],
        dependent_variable="录取率",
        independent_variables=[],
        running_variable="考试分数",
    )

    code = generate_code("RDD", request)

    assert "H = pd.to_numeric(df['考试分数'], errors=\"coerce\").std()" in code
    namespace = _run_template(code, df)
    assert namespace["result"].params["above"] == pytest.approx(0.25, abs=0.08)


def test_formula_wraps_special_column_names() -> None:
    """列名含空格时必须走 Q()，否则 statsmodels 公式解析会失败。"""

    request = ModelRequest(
        research_question="特殊列名",
        columns=["创新 指数", "财政 支出"],
        dependent_variable="创新 指数",
        independent_variables=["财政 支出"],
        time_column="年份",
        treatment_column="处理组",
    )

    code = generate_code("DID", request)

    assert 'Q(\'创新 指数\') ~ did_treated' in code
    assert "+ Q('财政 支出')" in code
