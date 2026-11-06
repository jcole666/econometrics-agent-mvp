from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from sidecar.api import app
from sidecar.services import project_store

client = TestClient(app)
DATASET_ID = "sample_city_panel"


@pytest.fixture(autouse=True)
def isolated_store(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv(project_store.DATA_DIR_ENV, str(tmp_path))
    return tmp_path


def run_payload(
    model: str = "Panel Fixed Effects",
    independent: tuple[str, ...] = ("数字经济发展指数",),
    r2: float = 0.6421,
    coefficient: float = 0.4706,
    dataset_hash: str = "hash-a",
    parent_id: str | None = None,
) -> dict:
    return {
        "parent_id": parent_id,
        "research_question": "数字经济发展是否会提升城市创新水平？",
        "dataset_id": DATASET_ID,
        "dataset_hash": dataset_hash,
        "variable_dictionary_snapshot": {
            "dataset_id": DATASET_ID,
            "dataset_hash": dataset_hash,
            "entries": {
                "创新指数": {
                    "column": "创新指数",
                    "label": "城市创新指数",
                    "description": None,
                    "type": "numeric",
                    "unit": None,
                    "value_labels": {},
                    "confidence": 0.9,
                    "confirmed": True,
                    "source": "user",
                    "updated_at": "2026-11-06T10:00:00+08:00",
                }
            },
            "version": 2,
        },
        "model": model,
        "config": {
            "dependent_variable": "创新指数",
            "independent_variables": list(independent),
            "entity_column": "城市",
            "time_column": "年份",
        },
        "result": {
            "model_type": model,
            "success": True,
            "results": {
                "sample_size": 126,
                "r_squared": r2,
                "r_squared_adjusted": 0.63,
                "f_statistic": 44.12,
                "f_pvalue": 0.0001,
                "log_likelihood": None,
                "coefficients": [
                    {
                        "variable": "数字经济发展指数",
                        "coefficient": coefficient,
                        "std_error": 0.1203,
                        "t_statistic": 3.912,
                        "p_value": 0.0003,
                        "ci_lower": None,
                        "ci_upper": None,
                    }
                ],
            },
            "warnings": [],
            "execution_status": "executed",
        },
        "diagnostics": {"rows": 126},
        "ai_explanation": None,
    }


def explanation_payload(text: str = "系数 0.4706，p = 0.0003。") -> dict:
    return {
        "status": "completed",
        "revision": 1,
        "research_question": "数字经济发展是否会提升城市创新水平？",
        "sections": {
            "model_and_question": "用面板固定效应估计。",
            "key_findings": text,
            "stats_explained": "R2 为 0.6421。",
            "reliability_limits": "只能讲相关。",
            "next_steps": "加入控制变量重跑。",
        },
        "cited_values": [],
        "provider": "huawei_maas",
        "error": None,
        "created_at": "2026-11-06T10:05:00+08:00",
    }


def create(payload: dict | None = None) -> dict:
    response = client.post("/model-runs", json=payload or run_payload())
    assert response.status_code == 200, response.text
    return response.json()


def test_ten_runs_are_kept_with_monotonic_ids() -> None:
    created = [create(run_payload(r2=0.5 + index / 100)) for index in range(10)]

    assert [record["version_id"] for record in created] == [f"v{index:03d}" for index in range(1, 11)]
    listed = client.get("/model-runs", params={"dataset_id": DATASET_ID})
    assert listed.status_code == 200
    assert len(listed.json()["runs"]) == 10
    for record in created:
        fetched = client.get("/model-runs/" + record["version_id"], params={"dataset_id": DATASET_ID})
        assert fetched.status_code == 200
        assert fetched.json()["result"]["results"]["sample_size"] == 126


def test_runs_survive_new_client() -> None:
    create()
    fresh = TestClient(app)
    listed = fresh.get("/model-runs", params={"dataset_id": DATASET_ID})

    assert len(listed.json()["runs"]) == 1


def test_compare_same_model_reports_config_and_metric_diff() -> None:
    left = create(run_payload(independent=("数字经济发展指数",), coefficient=0.4706))
    right = create(run_payload(independent=("数字经济发展指数", "人力资本"), coefficient=0.4123))

    response = client.post(
        "/model-runs/compare",
        json={"dataset_id": DATASET_ID, "left_id": left["version_id"], "right_id": right["version_id"]},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["comparable"] is True
    assert body["incomparable_reason"] is None
    assert body["config_diff"]["added_independent_variables"] == ["人力资本"]
    coefficient = body["metrics_diff"]["coefficients"][0]
    assert coefficient["delta"] == pytest.approx(0.4123 - 0.4706, abs=1e-6)
    assert body["metrics_diff"]["r_squared"]["delta"] == pytest.approx(0.0, abs=1e-9)


def test_compare_different_models_is_incomparable() -> None:
    left = create(run_payload(model="Panel Fixed Effects"))
    right = create(run_payload(model="OLS"))

    body = client.post(
        "/model-runs/compare",
        json={"dataset_id": DATASET_ID, "left_id": left["version_id"], "right_id": right["version_id"]},
    ).json()

    assert body["comparable"] is False
    assert "模型类型不同" in body["incomparable_reason"]
    assert body["metrics_diff"] == {}


def test_compare_different_dataset_hash_is_incomparable() -> None:
    left = create(run_payload(dataset_hash="hash-a"))
    right = create(run_payload(dataset_hash="hash-b"))

    body = client.post(
        "/model-runs/compare",
        json={"dataset_id": DATASET_ID, "left_id": left["version_id"], "right_id": right["version_id"]},
    ).json()

    assert body["comparable"] is False
    assert "样本数据不同" in body["incomparable_reason"]


def test_explanation_revision_increments() -> None:
    record = create()

    first = client.post(
        f"/model-runs/{record['version_id']}/explanation",
        params={"dataset_id": DATASET_ID},
        json=explanation_payload(),
    )
    assert first.status_code == 200, first.text
    assert first.json()["ai_explanation"]["revision"] == 1

    second = client.post(
        f"/model-runs/{record['version_id']}/explanation",
        params={"dataset_id": DATASET_ID},
        json=explanation_payload("重新生成：系数 0.4706。"),
    )
    assert second.json()["ai_explanation"]["revision"] == 2
    # 旧结果与快照不受影响
    assert second.json()["result"]["results"]["r_squared"] == 0.6421
    assert second.json()["variable_dictionary_snapshot"]["version"] == 2


def test_unknown_version_returns_404() -> None:
    assert client.get("/model-runs/v999", params={"dataset_id": DATASET_ID}).status_code == 404
    response = client.post(
        "/model-runs/v999/explanation",
        params={"dataset_id": DATASET_ID},
        json=explanation_payload(),
    )
    assert response.status_code == 404


def test_bad_dataset_id_returns_400() -> None:
    response = client.get("/model-runs", params={"dataset_id": "../evil"})
    assert response.status_code == 400
