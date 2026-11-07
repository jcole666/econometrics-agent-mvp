"""端到端联调：按交接稿 §八 的 8 步演示走一遍教学闭环。

覆盖顺序与前端 demo 一致：
1. 读示例城市面板画像
2. 变量字典推断 → 对话预览 → 确认持久化
3. 散点 + 热力图 + 图注
4. 面板固定效应运行 + 结构化解读（离线降级路径）
5. 存 V1 → 加「人力资本」再跑 V2
6. 对比 V1/V2
7. 换新 client 验证版本恢复
8. 旧功能（角色推断 / 推荐 / 规则报告 / 聊天）仍可用
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from sidecar.api import app
from sidecar.services import project_store

ROOT = Path(__file__).resolve().parents[2]
SAMPLE_PATH = ROOT / "examples" / "sample_city_panel.csv"
DATASET_ID = "sample_city_panel"
DATASET_HASH = "e2e-hash"
OFFLINE_LLM = {"enabled": False}
RESEARCH_QUESTION = "数字经济发展是否会提升城市创新水平？"
BASE_INDEPENDENT = ["数字经济发展指数", "宽带接入率", "财政科技支出", "产业结构升级", "人口密度"]

client = TestClient(app)


@pytest.fixture(autouse=True)
def isolated_store(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """每个用例独立的数据目录，互不污染，也不会写进用户 home。"""
    monkeypatch.setenv(project_store.DATA_DIR_ENV, str(tmp_path))
    return tmp_path


def _run_model(independent: list[str]) -> dict:
    with SAMPLE_PATH.open("rb") as handle:
        response = client.post(
            "/run-model",
            files={"file": ("sample_city_panel.csv", handle, "text/csv")},
            data={
                "model_type": "Panel Fixed Effects",
                "dependent_variable": "创新指数",
                "independent_variables": ",".join(independent),
                "entity_column": "城市",
                "time_column": "年份",
            },
        )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["success"] is True, body.get("error")
    return body


def _save_run(result: dict, independent: list[str], dictionary: dict, parent_id: str | None, hash_value: str) -> dict:
    response = client.post(
        "/model-runs",
        json={
            "parent_id": parent_id,
            "research_question": RESEARCH_QUESTION,
            "dataset_id": DATASET_ID,
            "dataset_hash": hash_value,
            "variable_dictionary_snapshot": dictionary,
            "model": "Panel Fixed Effects",
            "config": {
                "dependent_variable": "创新指数",
                "independent_variables": independent,
                "entity_column": "城市",
                "time_column": "年份",
                "treatment_column": None,
                "running_variable": None,
                "instrument_variable": None,
            },
            "result": result,
            "diagnostics": {"rows": 126},
            "ai_explanation": None,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_full_teaching_loop_end_to_end() -> None:
    # ---------- 1. 画像 ----------
    profile = client.get("/sample-profile").json()
    assert profile["rows"] == 126
    columns = profile["columns"]
    column_map = {item["name"]: item for item in columns}
    assert column_map["创新指数"]["min"] < column_map["创新指数"]["max"]

    # ---------- 2. 变量字典：推断 → 预览 → 确认 ----------
    inferred = client.post(
        "/variable-dict/infer",
        json={
            "research_question": RESEARCH_QUESTION,
            "dataset_id": DATASET_ID,
            "dataset_hash": DATASET_HASH,
            "columns": columns,
            "existing": None,
            "llm_config": OFFLINE_LLM,
        },
    )
    assert inferred.status_code == 200, inferred.text
    dictionary = inferred.json()["dictionary"]
    assert dictionary["entries"]["创新指数"]["label"] == "创新指数"

    preview = client.post(
        "/variable-dict/patch-preview",
        json={
            "message": "「创新指数」是城市创新水平，越高越好，单位是分。",
            "dictionary": dictionary,
            "llm_config": OFFLINE_LLM,
        },
    )
    assert preview.status_code == 200, preview.text
    patches = preview.json()["preview"]
    assert patches and patches[0]["column"] == "创新指数"

    confirmed = client.post(
        "/variable-dict/confirm",
        json={
            "dataset_id": DATASET_ID,
            "dataset_hash": DATASET_HASH,
            "patches": patches,
            "dictionary": dictionary,
        },
    )
    assert confirmed.status_code == 200, confirmed.text
    dictionary = confirmed.json()["dictionary"]
    assert dictionary["entries"]["创新指数"]["confirmed"] is True

    # ---------- 3. 散点 + 热力图 + 图注 ----------
    with SAMPLE_PATH.open("rb") as handle:
        scatter = client.post(
            "/relationship/scatter",
            files={"file": ("sample_city_panel.csv", handle, "text/csv")},
            data={"x_column": "数字经济发展指数", "y_column": "创新指数"},
        )
    assert scatter.status_code == 200, scatter.text
    scatter_body = scatter.json()
    assert scatter_body["n"] > 0
    assert scatter_body["fit"]["slope"] is not None
    # 图注里的数字必须来自计算，而不是模板占位
    assert f"n = {scatter_body['n']}" in scatter_body["caption"]["finding"]
    assert "因果" in scatter_body["caption"]["caveat"]

    with SAMPLE_PATH.open("rb") as handle:
        heatmap = client.post(
            "/relationship/corr-heatmap",
            files={"file": ("sample_city_panel.csv", handle, "text/csv")},
            data={"columns": "创新指数,数字经济发展指数,人力资本"},
        )
    assert heatmap.status_code == 200, heatmap.text
    heatmap_body = heatmap.json()
    assert len(heatmap_body["columns"]) == 3
    assert heatmap_body["matrix"][0][0] == pytest.approx(1.0)

    # ---------- 4. 运行 + 结构化解读（离线降级） ----------
    result_v1 = _run_model(BASE_INDEPENDENT)
    explanation = client.post(
        "/explain/model",
        json={
            "research_question": RESEARCH_QUESTION,
            "model": "Panel Fixed Effects",
            "variables": {
                "dependent": {"column": "创新指数", "label": "创新指数"},
                "independent": [{"column": name, "label": name} for name in BASE_INDEPENDENT],
                "controls": [],
            },
            "model_results": result_v1["results"],
            "diagnostics": None,
            "llm_config": OFFLINE_LLM,
        },
    )
    assert explanation.status_code == 200, explanation.text
    explanation_body = explanation.json()
    sections = explanation_body["sections"]
    assert all(
        sections[key]
        for key in ("model_and_question", "key_findings", "stats_explained", "reliability_limits", "next_steps")
    )
    assert explanation_body["status"] in {"completed", "fallback"}

    # ---------- 5. 存 V1，再加「人力资本」跑 V2 ----------
    run_v1 = _save_run(result_v1, BASE_INDEPENDENT, dictionary, None, DATASET_HASH)
    assert run_v1["version_id"] == "v001"

    attached = client.post(
        f"/model-runs/{run_v1['version_id']}/explanation",
        params={"dataset_id": DATASET_ID},
        json=explanation_body,
    )
    assert attached.status_code == 200, attached.text
    assert attached.json()["ai_explanation"]["revision"] == 1

    result_v2 = _run_model([*BASE_INDEPENDENT, "人力资本"])
    run_v2 = _save_run(result_v2, [*BASE_INDEPENDENT, "人力资本"], dictionary, run_v1["version_id"], DATASET_HASH)
    assert run_v2["version_id"] == "v002"
    assert run_v2["parent_id"] == "v001"

    # ---------- 6. 对比 V1/V2 ----------
    compared = client.post(
        "/model-runs/compare",
        json={"dataset_id": DATASET_ID, "left_id": "v001", "right_id": "v002"},
    )
    assert compared.status_code == 200, compared.text
    compare_body = compared.json()
    assert compare_body["comparable"] is True
    assert compare_body["config_diff"]["added_independent_variables"] == ["人力资本"]
    core = next(item for item in compare_body["metrics_diff"]["coefficients"] if item["variable"] == "数字经济发展指数")
    # 差值在服务端按 6 位小数取整（避免浮点尾巴进 UI），这里用同量级容差
    assert core["delta"] == pytest.approx(
        result_v2["results"]["coefficients"][0]["coefficient"]
        - result_v1["results"]["coefficients"][0]["coefficient"],
        abs=1e-6,
    )
    assert compare_body["explanations"]["left"]["sections"]["key_findings"]
    # 差异摘要必须是本地生成、且提到这次新增的那个变量
    summary = compare_body["ai_diff_summary"]
    assert summary and "人力资本" in summary and "R²" in summary

    # ---------- 7. 重启恢复（新 client 走文件读取） ----------
    fresh = TestClient(app)
    listed = fresh.get("/model-runs", params={"dataset_id": DATASET_ID})
    assert listed.status_code == 200
    version_ids = [item["version_id"] for item in listed.json()["runs"]]
    assert version_ids == ["v001", "v002"]
    restored_dictionary = fresh.get(
        "/variable-dict", params={"dataset_id": DATASET_ID, "dataset_hash": DATASET_HASH}
    )
    assert restored_dictionary.status_code == 200
    assert restored_dictionary.json()["entries"]["创新指数"]["confirmed"] is True


def test_legacy_features_still_work_after_new_loop() -> None:
    """新功能上线不能挤掉旧能力：角色推断、推荐、规则报告、聊天。"""
    columns = [{"name": item["name"], "dtype": item["dtype"]} for item in client.get("/sample-profile").json()["columns"]]

    inferred = client.post(
        "/infer-variables",
        json={"research_question": RESEARCH_QUESTION, "columns": columns, "llm_config": OFFLINE_LLM},
    )
    assert inferred.status_code == 200
    assert inferred.json()["dependent_variable"] == "创新指数"

    recommended = client.post(
        "/recommend-model",
        json={
            "research_question": RESEARCH_QUESTION,
            "columns": [item["name"] for item in columns],
            "dependent_variable": "创新指数",
            "independent_variables": ["数字经济发展指数", "人力资本"],
            "llm_config": OFFLINE_LLM,
        },
    )
    assert recommended.status_code == 200
    assert recommended.json()["provider"] == "rules"

    report = client.post(
        "/generate-report",
        json={
            "research_question": RESEARCH_QUESTION,
            "model_type": "Panel Fixed Effects",
            "model_results": None,
            "inference_notes": "- 关系线索：创新指数 与 数字经济发展指数 正相关。",
            "llm_config": OFFLINE_LLM,
        },
    )
    assert report.status_code == 200
    assert "## 分析补充" in report.json()["markdown"]

    chat = client.post(
        "/chat",
        json={
            "message": "为什么推荐这个模型？",
            "history": [],
            "context": {"data_columns": ["创新指数", "数字经济发展指数"]},
            "llm_config": OFFLINE_LLM,
        },
    )
    assert chat.status_code == 200
    assert chat.json()["provider"] == "model_error"
