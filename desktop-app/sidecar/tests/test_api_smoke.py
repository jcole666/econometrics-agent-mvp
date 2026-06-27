from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from sidecar.api import app

ROOT = Path(__file__).resolve().parents[2]
SAMPLE_PATH = ROOT / "examples" / "sample_wage.csv"


client = TestClient(app)


def test_health_endpoint() -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_variable_inference_for_wage_question() -> None:
    payload = {
        "research_question": "Does education affect income after controlling for experience and gender?",
        "columns": [
            {"name": "income", "dtype": "int64", "sample_values": ["3720", "3970"]},
            {"name": "education", "dtype": "int64", "sample_values": ["12", "16"]},
            {"name": "experience", "dtype": "int64", "sample_values": ["2", "8"]},
            {"name": "gender", "dtype": "int64", "sample_values": ["0", "1"]},
        ],
    }

    response = client.post("/infer-variables", json=payload)

    assert response.status_code == 200
    body = response.json()
    assert body["dependent_variable"] == "income"
    assert "education" in body["independent_variables"]


def test_disabled_llm_config_uses_rules() -> None:
    payload = {
        "research_question": "Does education affect income?",
        "columns": ["income", "education", "experience"],
        "dependent_variable": "income",
        "independent_variables": ["education", "experience"],
        "llm_config": {"enabled": False},
    }

    response = client.post("/recommend-model", json=payload)

    assert response.status_code == 200
    body = response.json()
    assert body["provider"] == "rules"
    assert body["maas_used"] is False


def test_chat_identity_explains_local_mode() -> None:
    response = client.post(
        "/chat",
        json={
            "message": "你是谁",
            "history": [],
            "context": {"data_columns": []},
            "llm_config": {"enabled": False},
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["provider"] == "rules"
    assert "本地计量建模助手" in body["reply"]


def test_ols_runner_returns_coefficients() -> None:
    with SAMPLE_PATH.open("rb") as handle:
        response = client.post(
            "/run-model",
            files={"file": ("sample_wage.csv", handle, "text/csv")},
            data={
                "model_type": "OLS",
                "dependent_variable": "income",
                "independent_variables": "education,experience,gender",
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
            files={"file": ("sample_wage.csv", handle, "text/csv")},
            data={
                "model_type": "RDD",
                "dependent_variable": "income",
                "independent_variables": "education,experience",
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert body["success"] is False
    assert "暂不支持真实运行" in body["error"]
