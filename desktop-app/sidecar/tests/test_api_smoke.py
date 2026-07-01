from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from sidecar.api import app

ROOT = Path(__file__).resolve().parents[2]
SAMPLE_PATH = ROOT / "examples" / "sample_city_panel.csv"


client = TestClient(app)


def test_health_endpoint() -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_sample_profile_includes_diagnostics() -> None:
    response = client.get("/sample-profile")

    assert response.status_code == 200
    body = response.json()
    diagnostics = body["diagnostics"]
    assert body["rows"] == 48
    assert diagnostics["duplicate_rows"] == 0
    assert "year" in diagnostics["possible_time_columns"]
    assert "city" in diagnostics["possible_entity_columns"]
    assert diagnostics["panel_hint"]["entity_column"] == "city"
    assert diagnostics["panel_hint"]["time_column"] == "year"
    assert diagnostics["panel_hint"]["is_balanced"] is True


def test_variable_inference_for_city_panel_question() -> None:
    payload = {
        "research_question": "Does the digital economy improve urban innovation?",
        "columns": [
            {"name": "city", "dtype": "object", "sample_values": ["Shanghai", "Suzhou"]},
            {"name": "year", "dtype": "int64", "sample_values": ["2018", "2019"]},
            {"name": "innovation_index", "dtype": "float64", "sample_values": ["82.3", "84.1"]},
            {"name": "digital_economy_index", "dtype": "float64", "sample_values": ["78.6", "80.4"]},
            {"name": "fiscal_science_spending", "dtype": "float64", "sample_values": ["5.8", "6.0"]},
        ],
    }

    response = client.post("/infer-variables", json=payload)

    assert response.status_code == 200
    body = response.json()
    assert body["dependent_variable"] == "innovation_index"
    assert body["entity_column"] == "city"
    assert body["time_column"] == "year"
    assert "digital_economy_index" in body["independent_variables"]


def test_disabled_llm_config_uses_rules() -> None:
    payload = {
        "research_question": "Does the digital economy improve urban innovation?",
        "columns": ["city", "year", "innovation_index", "digital_economy_index", "human_capital"],
        "dependent_variable": "innovation_index",
        "independent_variables": ["digital_economy_index", "human_capital"],
        "llm_config": {"enabled": False},
    }

    response = client.post("/recommend-model", json=payload)

    assert response.status_code == 200
    body = response.json()
    assert body["provider"] == "rules"
    assert body["maas_used"] is False


def test_chat_requires_model_config() -> None:
    response = client.post(
        "/chat",
        json={
            "message": "为什么推荐这个模型？",
            "history": [],
            "context": {"data_columns": []},
            "llm_config": {"enabled": False},
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["provider"] == "model_error"
    assert "API Key" in body["reply"]
    assert "请求地址" in body["reply"]


def test_ols_runner_returns_coefficients() -> None:
    with SAMPLE_PATH.open("rb") as handle:
        response = client.post(
            "/run-model",
            files={"file": ("sample_city_panel.csv", handle, "text/csv")},
            data={
                "model_type": "OLS",
                "dependent_variable": "innovation_index",
                "independent_variables": "digital_economy_index,broadband_access,fiscal_science_spending,human_capital,industrial_upgrade,population_density",
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["results"]["coefficients"]


def test_unsupported_complex_model_returns_business_error() -> None:
    with SAMPLE_PATH.open("rb") as handle:
        response = client.post(
            "/run-model",
            files={"file": ("sample_city_panel.csv", handle, "text/csv")},
            data={
                "model_type": "RDD",
                "dependent_variable": "innovation_index",
                "independent_variables": "digital_economy_index,human_capital",
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert body["success"] is False
    assert "暂不支持真实运行" in body["error"]
