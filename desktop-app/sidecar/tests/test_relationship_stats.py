from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from sidecar.api import app
from sidecar.services.relationship_stats import corr_heatmap, scatter_stats

ROOT = Path(__file__).resolve().parents[2]
SAMPLE_PATH = ROOT / "examples" / "sample_city_panel.csv"

client = TestClient(app)


@pytest.fixture(scope="module")
def frame() -> pd.DataFrame:
    return pd.read_csv(SAMPLE_PATH, encoding="utf-8-sig")


def test_scatter_r_matches_pandas(frame: pd.DataFrame) -> None:
    result = scatter_stats(frame, "数字经济发展指数", "创新指数")

    expected = frame["数字经济发展指数"].corr(frame["创新指数"])
    assert result.n > 0
    assert result.r is not None
    assert abs(result.r - expected) < 1e-6
    assert result.fit is not None
    assert result.p_value is not None and 0 <= result.p_value <= 1


def test_scatter_caption_carries_real_numbers(frame: pd.DataFrame) -> None:
    result = scatter_stats(frame, "数字经济发展指数", "创新指数")

    assert f"n = {result.n}" in result.caption.finding
    assert f"{result.r:.3f}" in result.caption.finding
    assert "因果" in result.caption.caveat
    assert result.caption.how_to_read


def test_scatter_pairs_delete_missing() -> None:
    frame = pd.DataFrame({"x": [1.0, 2.0, None, 4.0, 5.0], "y": [2.0, None, 6.0, 8.0, 10.0]})
    result = scatter_stats(frame, "x", "y")

    assert result.n == 3
    assert len(result.points) == 3


def test_scatter_constant_column_warns() -> None:
    frame = pd.DataFrame({"x": [1.0, 1.0, 1.0, 1.0], "y": [1.0, 2.0, 3.0, 4.0]})
    result = scatter_stats(frame, "x", "y")

    assert result.r is None or result.fit is None
    assert any("恒定" in item for item in result.warnings)


def test_scatter_unknown_column_raises(frame: pd.DataFrame) -> None:
    with pytest.raises(ValueError):
        scatter_stats(frame, "不存在的列", "创新指数")


def test_heatmap_symmetric_with_diagonal(frame: pd.DataFrame) -> None:
    columns = ["创新指数", "数字经济发展指数", "人力资本"]
    result = corr_heatmap(frame, columns)

    assert result.columns == columns
    size = len(columns)
    for i in range(size):
        assert result.matrix[i][i] == 1.0
        for j in range(size):
            assert result.matrix[i][j] == pytest.approx(result.matrix[j][i])
            assert result.n_matrix[i][j] > 0


def test_heatmap_matches_pandas(frame: pd.DataFrame) -> None:
    result = corr_heatmap(frame, ["创新指数", "数字经济发展指数"])
    expected = frame["创新指数"].corr(frame["数字经济发展指数"])

    assert abs(result.matrix[0][1] - expected) < 1e-6


def test_heatmap_single_column_returns_warning() -> None:
    result = corr_heatmap(pd.DataFrame({"a": [1, 2, 3], "b": [3, 2, 1]}), ["a"])

    assert result.matrix == []
    assert result.warnings


def test_heatmap_constant_column_leaves_none() -> None:
    frame = pd.DataFrame({"a": [1.0, 2.0, 3.0], "b": [5.0, 5.0, 5.0]})
    result = corr_heatmap(frame, ["a", "b"])

    assert result.matrix[0][1] is None
    assert any("恒定" in item for item in result.warnings)


def test_scatter_endpoint_rejects_unknown_column() -> None:
    with SAMPLE_PATH.open("rb") as handle:
        response = client.post(
            "/relationship/scatter",
            files={"file": ("sample_city_panel.csv", handle, "text/csv")},
            data={"x_column": "不存在", "y_column": "创新指数"},
        )

    assert response.status_code == 400
    assert "不在数据中" in response.json()["detail"]


def test_heatmap_endpoint_returns_matrix() -> None:
    with SAMPLE_PATH.open("rb") as handle:
        response = client.post(
            "/relationship/corr-heatmap",
            files={"file": ("sample_city_panel.csv", handle, "text/csv")},
            data={"columns": "创新指数,数字经济发展指数,人力资本"},
        )

    assert response.status_code == 200, response.text
    body = response.json()
    assert len(body["matrix"]) == 3
    assert body["caption"]["finding"]
