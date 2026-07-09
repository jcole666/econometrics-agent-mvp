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
    assert body["rows"] == 126
    assert diagnostics["duplicate_rows"] == 0
    assert "年份" in diagnostics["possible_time_columns"]
    assert "城市" in diagnostics["possible_entity_columns"]
    assert diagnostics["panel_hint"]["entity_column"] == "城市"
    assert diagnostics["panel_hint"]["time_column"] == "年份"
    assert diagnostics["panel_hint"]["is_balanced"] is True
    assert diagnostics["relationship_hints"]
    assert any(
        {hint["left"], hint["right"]} == {"创新指数", "数字经济发展指数"}
        for hint in diagnostics["relationship_hints"]
    )


def test_variable_inference_for_city_panel_question() -> None:
    payload = {
        "research_question": "数字经济发展是否会提升城市创新水平？",
        "columns": [
            {"name": "城市", "dtype": "object", "sample_values": ["上海", "苏州"]},
            {"name": "年份", "dtype": "int64", "sample_values": ["2018", "2019"]},
            {"name": "创新指数", "dtype": "float64", "sample_values": ["82.3", "84.1"]},
            {"name": "数字经济发展指数", "dtype": "float64", "sample_values": ["78.6", "80.4"]},
            {"name": "财政科技支出", "dtype": "float64", "sample_values": ["5.8", "6.0"]},
        ],
    }

    response = client.post("/infer-variables", json=payload)

    assert response.status_code == 200
    body = response.json()
    assert body["dependent_variable"] == "创新指数"
    assert body["entity_column"] == "城市"
    assert body["time_column"] == "年份"
    assert "数字经济发展指数" in body["independent_variables"]


def test_disabled_llm_config_uses_rules() -> None:
    payload = {
        "research_question": "数字经济发展是否会提升城市创新水平？",
        "columns": ["城市", "年份", "创新指数", "数字经济发展指数", "人力资本"],
        "dependent_variable": "创新指数",
        "independent_variables": ["数字经济发展指数", "人力资本"],
        "llm_config": {"enabled": False},
    }

    response = client.post("/recommend-model", json=payload)

    assert response.status_code == 200
    body = response.json()
    assert body["provider"] == "rules"
    assert body["maas_used"] is False
    assert body["model"] == "Panel Fixed Effects"
    assert "城市" in body["reason"]
    assert "年份" in body["reason"]
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
            "data_columns": ["创新指数", "数字经济发展指数"],
            "data_summary": "126 行；13 列；平衡面板",
            "relationship_hints": [
                {"left": "创新指数", "right": "数字经济发展指数", "score": 0.994, "direction": "正相关"}
            ],
            "research_path": {"model": "Panel Fixed Effects", "risks": ["相关关系不等于因果关系"]},
        },
        llm_config={"enabled": False},
    )

    context = _dump_context(request)

    assert context["data_summary"] == "126 行；13 列；平衡面板"
    assert context["relationship_hints"][0]["left"] == "创新指数"
    assert context["research_path"]["model"] == "Panel Fixed Effects"


def test_ols_runner_returns_coefficients() -> None:
    with SAMPLE_PATH.open("rb") as handle:
        response = client.post(
            "/run-model",
            files={"file": ("sample_city_panel.csv", handle, "text/csv")},
            data={
                "model_type": "OLS",
                "dependent_variable": "创新指数",
                "independent_variables": "数字经济发展指数,宽带接入率,财政科技支出,人力资本,产业结构升级,人口密度",
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
                "dependent_variable": "创新指数",
                "independent_variables": "数字经济发展指数,宽带接入率,财政科技支出,人力资本,产业结构升级,人口密度",
                "entity_column": "城市",
                "time_column": "年份",
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["model_type"] == "Panel Fixed Effects"
    assert body["results"]["sample_size"] == 126
    assert any(item["variable"] == "数字经济发展指数" for item in body["results"]["coefficients"])
    assert any("固定效应" in item for item in body["warnings"])


def test_unsupported_complex_model_returns_business_error() -> None:
    with SAMPLE_PATH.open("rb") as handle:
        response = client.post(
            "/run-model",
            files={"file": ("sample_city_panel.csv", handle, "text/csv")},
            data={
                "model_type": "RDD",
                "dependent_variable": "创新指数",
                "independent_variables": "数字经济发展指数,人力资本",
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
            "inference_notes": "- 关系线索：创新指数 与 数字经济发展指数 正相关。",
            "llm_config": {"enabled": False},
        },
    )

    assert response.status_code == 200
    markdown = response.json()["markdown"]
    assert "## 分析补充" in markdown
    assert "关系线索" in markdown


def test_report_interprets_model_results() -> None:
    response = client.post(
        "/generate-report",
        json={
            "research_question": "数字经济发展是否会提升城市创新水平？",
            "model_type": "Panel Fixed Effects",
            "model_results": {
                "sample_size": 48,
                "r_squared": 0.82,
                "r_squared_adjusted": 0.76,
                "coefficients": [
                    {
                        "variable": "数字经济发展指数",
                        "coefficient": 0.42,
                        "std_error": 0.12,
                        "t_statistic": 3.5,
                        "p_value": 0.004,
                    },
                    {
                        "variable": "人力资本",
                        "coefficient": 0.08,
                        "std_error": 0.06,
                        "t_statistic": 1.3,
                        "p_value": 0.21,
                    },
                ],
            },
            "llm_config": {"enabled": False},
        },
    )

    assert response.status_code == 200
    markdown = response.json()["markdown"]
    assert "核心变量：数字经济发展指数 为正向" in markdown
    assert "5% 水平显著项：数字经济发展指数" in markdown
    assert "解释边界：固定效应" in markdown
