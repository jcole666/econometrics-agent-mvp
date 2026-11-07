from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from sidecar.api import app
from sidecar.schemas import (
    CoefficientResult,
    ExplainModelRequest,
    ExplanationSections,
    ModelRunResults,
)
from sidecar.services import model_explainer
from sidecar.services.explanation_validate import cited_values_from_text, validate_explanation
from sidecar.services.maas_client import MaasUnavailable

client = TestClient(app)

RESULTS = ModelRunResults(
    sample_size=126,
    r_squared=0.6421,
    r_squared_adjusted=0.6302,
    f_statistic=44.12,
    f_pvalue=0.0001,
    coefficients=[
        CoefficientResult(
            variable="数字经济发展指数",
            coefficient=0.4706,
            std_error=0.1203,
            t_statistic=3.912,
            p_value=0.0003,
        ),
        CoefficientResult(variable="const", coefficient=2.1043, std_error=0.55, t_statistic=3.826, p_value=0.0004),
    ],
)

GOOD_SECTIONS = ExplanationSections(
    model_and_question="研究问题是数字经济是否提升城市创新。用面板双向固定效应，样本 126 个观测。",
    key_findings="数字经济发展指数的系数为 0.4706，p = 0.0003，方向为正且显著。",
    stats_explained="R2 = 0.6421，调整后 R2 为 0.63，说明模型解释了约六成变异。",
    reliability_limits="面板固定效应只能说明相关关系，仍可能遗漏随时间变化的因素。",
    next_steps="下一步可加入人力资本等控制变量，观察核心系数是否稳定。",
)

REQUEST_BODY = {
    "research_question": "数字经济发展是否会提升城市创新水平？",
    "model": "Panel Fixed Effects",
    "variables": {
        "dependent": {"column": "创新指数", "label": "创新指数", "unit": None},
        "independent": [{"column": "数字经济发展指数", "label": "数字经济发展指数", "unit": None}],
        "controls": [],
    },
    "model_results": RESULTS.model_dump(),
    "diagnostics": None,
    "llm_config": {"enabled": False},
}


def test_valid_sections_pass() -> None:
    assert validate_explanation(GOOD_SECTIONS, RESULTS) == []


def test_percentage_form_is_allowed() -> None:
    sections = GOOD_SECTIONS.model_copy(update={"stats_explained": "R2 约为 64%，样本 126 个。"})
    assert validate_explanation(sections, RESULTS) == []


def test_fabricated_coefficient_is_rejected() -> None:
    sections = GOOD_SECTIONS.model_copy(
        update={"key_findings": "数字经济发展指数的系数为 0.93，p = 0.0003。"}
    )
    problems = validate_explanation(sections, RESULTS)

    assert any("0.93" in item for item in problems)


def test_causal_claim_is_rejected() -> None:
    sections = GOOD_SECTIONS.model_copy(
        update={"key_findings": "结果证明了因果，数字经济提升了创新。"}
    )
    problems = validate_explanation(sections, RESULTS)

    assert any("因果" in item for item in problems)


def test_unrun_test_cannot_claim_passed() -> None:
    sections = GOOD_SECTIONS.model_copy(
        update={"reliability_limits": "平行趋势检验已通过，结果可靠。"}
    )
    problems = validate_explanation(sections, RESULTS)

    assert any("平行趋势" in item for item in problems)


def test_missing_section_is_rejected() -> None:
    sections = GOOD_SECTIONS.model_copy(update={"next_steps": "  "})
    problems = validate_explanation(sections, RESULTS)

    assert any("下一步建议" in item for item in problems)


def test_cited_values_map_back_to_results() -> None:
    cited = cited_values_from_text(GOOD_SECTIONS, RESULTS)
    paths = {item["path"] for item in cited}

    assert "coefficients[0].coefficient" in paths
    assert "sample_size" in paths


def test_endpoint_falls_back_when_llm_disabled() -> None:
    response = client.post("/explain/model", json=REQUEST_BODY)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "fallback"
    assert body["provider"] == "rules"
    sections = body["sections"]
    for key in ("model_and_question", "key_findings", "stats_explained", "reliability_limits", "next_steps"):
        assert sections[key].strip()
    assert body["error"]


def test_endpoint_completes_with_valid_llm_output(monkeypatch: pytest.MonkeyPatch) -> None:
    payload = (
        '{"sections":{"model_and_question":"研究问题是数字经济与城市创新。用面板固定效应估计，样本 126 个。",'
        '"key_findings":"数字经济发展指数系数 0.4706，p = 0.0003，方向为正。",'
        '"stats_explained":"R2 为 0.6421，说明解释力尚可。",'
        '"reliability_limits":"这是相关关系，不是因果效应。",'
        '"next_steps":"加入人力资本控制变量后重跑。"}}'
    )
    monkeypatch.setattr(model_explainer, "maas_chat", lambda messages, config=None: payload)

    response = client.post("/explain/model", json={**REQUEST_BODY, "llm_config": {"api_key": "test-key", "base_url": "https://api.openai.com/v1", "model": "gpt-test"}})

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "completed"
    assert body["sections"]["key_findings"]
    assert body["cited_values"]


def test_endpoint_falls_back_when_llm_fabricates(monkeypatch: pytest.MonkeyPatch) -> None:
    payload = (
        '{"sections":{"model_and_question":"研究问题是数字经济与城市创新，样本 126 个。",'
        '"key_findings":"系数为 1.88，影响很大。",'
        '"stats_explained":"R2 为 0.6421。",'
        '"reliability_limits":"需要注意遗漏变量。",'
        '"next_steps":"加入控制变量重跑。"}}'
    )
    monkeypatch.setattr(model_explainer, "maas_chat", lambda messages, config=None: payload)

    response = client.post("/explain/model", json={**REQUEST_BODY, "llm_config": {"api_key": "test-key", "base_url": "https://api.openai.com/v1", "model": "gpt-test"}})

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "fallback"
    assert "校验" in body["error"]


def test_endpoint_falls_back_when_llm_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(messages, config=None):
        raise MaasUnavailable("MaaS 网络请求失败，当前使用本地规则。")

    monkeypatch.setattr(model_explainer, "maas_chat", boom)

    response = client.post("/explain/model", json={**REQUEST_BODY, "llm_config": {"api_key": "test-key", "base_url": "https://api.openai.com/v1", "model": "gpt-test"}})

    assert response.status_code == 200
    assert response.json()["status"] == "fallback"


def test_prompt_separates_core_and_controls() -> None:
    body = {**REQUEST_BODY, "variables": {**REQUEST_BODY["variables"], "controls": ["人力资本", "宽带接入率"]}}
    request = ExplainModelRequest(**body)

    messages = model_explainer._messages(request)
    system = messages[0]["content"]
    assert "核心解释变量" in system
    assert "控制变量" in system

    payload = json.loads(messages[1]["content"])
    assert payload["variables"]["controls"] == ["人力资本", "宽带接入率"]
    assert [item["column"] for item in payload["variables"]["independent"]] == ["数字经济发展指数"]


def test_fallback_mentions_controls() -> None:
    body = {**REQUEST_BODY, "variables": {**REQUEST_BODY["variables"], "controls": ["人力资本"]}}
    explanation = model_explainer.explain_model(ExplainModelRequest(**body))

    assert explanation.status == "fallback"
    assert "同时控制了 人力资本" in explanation.sections.model_and_question
    # 控制变量不该被当成核心变量写进结论句
    assert "人力资本" not in explanation.sections.key_findings
