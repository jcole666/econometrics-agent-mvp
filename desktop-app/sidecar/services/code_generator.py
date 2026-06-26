from __future__ import annotations

from sidecar.schemas import ModelRequest


def generate_code(model: str, request: ModelRequest) -> str:
    y = request.dependent_variable or "Y"
    xs = request.independent_variables or ["X1", "X2"]
    x_list = ", ".join(repr(x) for x in xs)

    if model == "Logit":
        return f'''import pandas as pd
import statsmodels.api as sm

df = pd.read_csv("data.csv")
y = df[{y!r}]
X = df[[{x_list}]]
X = sm.add_constant(X)

result = sm.Logit(y, X).fit()
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

model = PanelOLS(y, X, entity_effects=True, time_effects=True)
result = model.fit(cov_type="clustered", cluster_entity=True)
print(result.summary)
'''

    if model == "DID":
        treatment = request.treatment_column or "treated"
        time = request.time_column or "post"
        return f'''import pandas as pd
import statsmodels.formula.api as smf

df = pd.read_csv("data.csv")
df["did"] = df[{treatment!r}] * df[{time!r}]

formula = "{y} ~ {treatment} + {time} + did"
result = smf.ols(formula, data=df).fit(cov_type="HC1")
print(result.summary())
'''

    if model == "IV-2SLS":
        endogenous = request.treatment_column or "endogenous_x"
        instrument = request.instrument_variable or "instrument_z"
        controls = " + ".join(xs) if xs else "1"
        return f'''import pandas as pd
from linearmodels.iv import IV2SLS

df = pd.read_csv("data.csv")
formula = "{y} ~ 1 + {controls} + [{endogenous} ~ {instrument}]"
result = IV2SLS.from_formula(formula, data=df).fit(cov_type="robust")
print(result.summary)
'''

    if model == "RDD":
        running = request.running_variable or "running_variable"
        cutoff = 0
        return f'''import pandas as pd
import statsmodels.formula.api as smf

df = pd.read_csv("data.csv")
df["above_cutoff"] = (df[{running!r}] >= {cutoff}).astype(int)
df["running_centered"] = df[{running!r}] - {cutoff}

formula = "{y} ~ above_cutoff + running_centered + above_cutoff:running_centered"
result = smf.ols(formula, data=df).fit(cov_type="HC1")
print(result.summary())
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
