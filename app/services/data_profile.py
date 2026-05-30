from __future__ import annotations

import pandas as pd


def profile_dataframe(df: pd.DataFrame) -> dict:
    columns = []
    for name in df.columns:
        series = df[name]
        columns.append(
            {
                "name": str(name),
                "dtype": str(series.dtype),
                "missing": int(series.isna().sum()),
                "unique": int(series.nunique(dropna=True)),
                "sample_values": series.dropna().astype(str).head(3).tolist(),
            }
        )

    return {
        "rows": int(len(df)),
        "columns_count": int(len(df.columns)),
        "columns": columns,
    }

