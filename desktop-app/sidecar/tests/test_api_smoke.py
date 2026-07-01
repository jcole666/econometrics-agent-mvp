from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from sidecar.api import app
from sidecar.schemas import ChatRequest
from sidecar.services.chat_service import _dump_context

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
    assert diagnostics["relationship_hints"]
    assert any(
        {hint["left"], hint["right"]} == {"innovation_index", "digital_economy_index"}
        for hint in diagnostics["relationship_hints"]
    )


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
    assert body["model"] == "Panel Fixed Effects"
    assert "city" in body["reason"]
    assert "year" in body["reason"]
    assert any("固定效应" in item for item in body["required_checks"])


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


def test_chat_context_keeps_analysis_fields() -> None:
    request = ChatRequest(
        message="怎么看关系线索？",
        context={
            "data_columns": ["innovation_index", "digital_economy_index"],
            "data_summary": "48 行；13 列；平衡面板",
            "relationship_hints": [
                {"left": "innovation_index", "right": "digital_economy_index", "score": 0.994, "direction": "正相关"}
            ],
            "research_path": {"model": "Panel Fixed Effects", "risks": ["相关关系不等于因果关系"]},
        },
        llm_config={"enabled": False},
    )

    context = _dump_context(request)

    assert context["data_summary"] == "48 行；13 列；平衡面板"
    assert context["relationship_hints"][0]["left"] == "innovation_index"
    assert context["research_path"]["model"] == "Panel Fixed Effects"


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


def test_panel_fixed_effects_runner_returns_coefficients() -> None:
    with SAMPLE_PATH.open("rb") as handle:
        response = client.post(
            "/run-model",
            files={"file": ("sample_city_panel.csv", handle, "text/csv")},
            data={
                "model_type": "Panel Fixed Effects",
                "dependent_variable": "innovation_index",
                "independent_variables": "digital_economy_index,broadband_access,fiscal_science_spending,human_capital,industrial_upgrade,population_density",
                "entity_column": "city",
                "time_column": "year",
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["model_type"] == "Panel Fixed Effects"
    assert body["results"]["sample_size"] == 48
    assert any(item["variable"] == "digital_economy_index" for item in body["results"]["coefficients"])
    assert any("固定效应" in item for item in body["warnings"])


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


def test_report_includes_analysis_notes() -> None:
    response = client.post(
        "/generate-report",
        json={
            "research_question": "数字经济发展是否会提升城市创新水平？",
            "model_type": "Panel Fixed Effects",
            "model_results": None,
            "inference_notes": "- 关系线索：innovation_index 与 digital_economy_index 正相关。",
            "llm_config": {"enabled": False},
        },
    )

    assert response.status_code == 200
    markdown = response.json()["markdown"]
    assert "## 分析补充" in markdown
    assert "关系线索" in markdown
