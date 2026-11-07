from __future__ import annotations

from sidecar.schemas import ModelRequest

HEADER = "# 由「小计」生成的代码模板。运行前请核对列名、年份/断点设置与数据路径。\n"


def _q(name: str) -> str:
    """把列名包进 patsy 的 Q()，避免空格、短横线、括号等特殊字符导致公式解析失败。"""

    return f"Q({name!r})"


def generate_code(model: str, request: ModelRequest) -> str:
    y = request.dependent_variable or "Y"
    xs = request.independent_variables or ["X1", "X2"]
    x_list = ", ".join(repr(x) for x in xs)
    # 公式类模板（DID/IV/RDD）不能用占位符，否则会凭空引用不存在的 X1/X2
    real_xs = [name.strip() for name in request.independent_variables if name.strip()]

    if model == "Logit":
        return f'''import pandas as pd
import statsmodels.api as sm

df = pd.read_csv("data.csv")
y = df[{y!r}]
X = df[[{x_list}]]
X = sm.add_constant(X)

result = sm.Logit(y, X).fit(disp=False)
print(result.summary())
'''

    if model == "Panel Fixed Effects":
        entity = request.entity_column or "entity_id"
        time = request.time_column or "year"
        return f'''import pandas as pd
import statsmodels.api as sm
from linearmodels.panel import PanelOLS

df = pd.read_csv("data.csv")
df = df.set_index([{entity!r}, {time!r}])
y = df[{y!r}]
X = sm.add_constant(df[[{x_list}]])

model = PanelOLS(y, X, entity_effects=True, time_effects=True, drop_absorbed=True)
result = model.fit(cov_type="clustered", cluster_entity=True)
print(result.summary)
'''

    if model == "DID":
        treatment = request.treatment_column or "treated"
        time = request.time_column or "年份"
        entity = request.entity_column
        if request.policy_period is not None:
            policy_line = f"POLICY_YEAR = {request.policy_period:g}"
        else:
            policy_line = "POLICY_YEAR = 2018  # TODO: 改成你研究设计中政策实际实施的年份"

        controls = "".join(f" + {_q(x)}" for x in real_xs if x not in {y, treatment, time})
        formula = f"{_q(y)} ~ did_treated + did_post + did{controls}"

        if entity:
            cov_note = f"# 标准误按 {entity} 聚类；若个体数很少，可改用 HC1。"
            cov_line = (
                'result = smf.ols(formula, data=df).fit(\n'
                f'    cov_type="cluster", cov_kwds={{"groups": df[{entity!r}].astype(str)}}\n'
                ")"
            )
        else:
            cov_note = "# 未指定个体列，标准误用 HC1；面板数据建议按个体聚类。"
            cov_line = 'result = smf.ols(formula, data=df).fit(cov_type="HC1")'

        return f'''{HEADER}import pandas as pd
import statsmodels.formula.api as smf

df = pd.read_csv("data.csv")

# DID 的交互项 = 0/1 处理组 × 0/1 政策后时期。
# 时间列通常是年份，必须先换算成「是否已在政策实施之后」，不能直接相乘。
{policy_line}

df["did_treated"] = pd.to_numeric(df[{treatment!r}], errors="coerce")
df["did_post"] = (pd.to_numeric(df[{time!r}], errors="coerce") >= POLICY_YEAR).astype(int)
df["did"] = df["did_treated"] * df["did_post"]

# treated 列必须是 0/1 分组变量；若手上是单位编号，先映射成「是否属于处理组」。
formula = "{formula}"
print("估计方程:", formula)
{cov_note}
{cov_line}
print(result.summary())

# 本模板只做基准 DID。平行趋势检验、事件研究图、安慰剂检验仍需单独完成，
# 不要在报告里写成「已通过平行趋势检验」。
'''

    if model == "IV-2SLS":
        endogenous = request.treatment_column or "endogenous_x"
        instrument = request.instrument_variable or "instrument_z"
        controls = " + ".join(real_xs) if real_xs else "1"
        return f'''{HEADER}import pandas as pd
from linearmodels.iv import IV2SLS

df = pd.read_csv("data.csv")

# linearmodels 的公式不支持带空格的列名，若报错请先把列名改成合法标识符。
formula = "{y} ~ 1 + {controls} + [{endogenous} ~ {instrument}]"
print("估计方程:", formula)
result = IV2SLS.from_formula(formula, data=df).fit(cov_type="robust")
print(result.summary)

# 需要自行补充：工具变量相关性（第一阶段 F）、外生性论证、过度识别检验。
'''

    if model == "RDD":
        running = request.running_variable or "running_variable"
        cutoff_value = request.cutoff if request.cutoff is not None else 0.0
        if request.bandwidth is not None:
            bandwidth_expr = f"{request.bandwidth:g}"
            bandwidth_note = "# 带宽由调用方指定；正式结论仍建议做多组带宽的敏感性分析。"
        else:
            bandwidth_expr = f'pd.to_numeric(df[{running!r}], errors="coerce").std()'
            bandwidth_note = "# 未指定带宽，这里取 running 变量的标准差；务必做敏感性分析。"
        return f'''{HEADER}import pandas as pd
import statsmodels.formula.api as smf

df = pd.read_csv("data.csv")

RUNNING = {running!r}
CUTOFF = {cutoff_value:g}
H = {bandwidth_expr}
{bandwidth_note}

df["running_centered"] = pd.to_numeric(df[RUNNING], errors="coerce") - CUTOFF
sample = df[df["running_centered"].abs() <= H].copy()
sample["above"] = (sample["running_centered"] >= 0).astype(int)
print("带宽内样本量:", len(sample))

formula = "{_q(y)} ~ above + running_centered + above:running_centered"
result = smf.ols(formula, data=sample).fit(cov_type="HC1")
print(result.summary())

# 这是局部线性断点回归的基准写法：没有偏差校正、没有最优带宽、没有 McCrary 密度检验。
# 论文级结果请使用 rdrobust（bias-corrected 估计 + 稳健置信区间）。
'''

    return f'''import pandas as pd
import statsmodels.api as sm

df = pd.read_csv("data.csv")
y = df[{y!r}]
X = df[[{x_list}]]
X = sm.add_constant(X)

result = sm.OLS(y, X).fit(cov_type="HC1")
print(result.summary())
'''
