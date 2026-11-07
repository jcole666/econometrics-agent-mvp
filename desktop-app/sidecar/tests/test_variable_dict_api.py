from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from sidecar.api import app
from sidecar.services import project_store

ROOT = Path(__file__).resolve().parents[2]
SAMPLE_PATH = ROOT / "examples" / "sample_city_panel.csv"

client = TestClient(app)

OFFLINE_LLM = {"enabled": False}


@pytest.fixture(autouse=True)
def isolated_store(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv(project_store.DATA_DIR_ENV, str(tmp_path))
    return tmp_path


def sample_columns() -> list[dict]:
    body = client.get("/sample-profile").json()
    return body["columns"]


def infer(columns: list[dict], dataset_hash: str = "hash-a", existing: dict | None = None) -> dict:
    response = client.post(
        "/variable-dict/infer",
        json={
            "research_question": "数字经济发展是否会提升城市创新水平？",
            "dataset_id": "sample_city_panel",
            "dataset_hash": dataset_hash,
            "columns": columns,
            "existing": existing,
            "llm_config": OFFLINE_LLM,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_infer_builds_semantic_labels_not_roles() -> None:
    body = infer(sample_columns())

    entries = body["dictionary"]["entries"]
    assert entries["创新指数"]["label"] == "创新指数"
    assert entries["创新指数"]["type"] == "numeric"
    assert entries["数字经济发展指数"]["label"] == "数字经济发展指数"
    assert entries["城市"]["type"] == "category"
    assert entries["年份"]["type"] == "numeric"
    # 语义字典里不应该出现 Y/X 角色字段
    assert "dependent_variable" not in body["dictionary"]
    assert body["provider"] == "rules"
    assert body["maas_error"]


def test_profile_columns_include_range_for_numeric() -> None:
    columns = {item["name"]: item for item in sample_columns()}

    assert columns["创新指数"]["min"] is not None
    assert columns["创新指数"]["max"] is not None
    assert columns["创新指数"]["min"] < columns["创新指数"]["max"]
    assert columns["创新指数"]["non_null"] == 126
    # 文本列不给数值范围
    assert columns["城市"]["min"] is None


def test_infer_keeps_confirmed_entries() -> None:
    columns = sample_columns()
    first = infer(columns)["dictionary"]
    first["entries"]["创新指数"].update({"label": "城市创新水平", "confirmed": True, "source": "user"})

    second = infer(columns, existing=first)["dictionary"]
    assert second["entries"]["创新指数"]["label"] == "城市创新水平"
    assert second["entries"]["创新指数"]["confirmed"] is True


def test_patch_preview_parses_chinese_sentence() -> None:
    dictionary = infer(sample_columns())["dictionary"]

    response = client.post(
        "/variable-dict/patch-preview",
        json={
            "message": "「创新指数」是城市创新水平，越高越好。",
            "dictionary": dictionary,
            "llm_config": OFFLINE_LLM,
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["preview"], "应能定位到具体列"
    item = body["preview"][0]
    assert item["column"] == "创新指数"
    assert item["op"] == "update"
    assert "城市创新水平" in item["after"]["description"]
    assert body["assistant_summary"]


def test_confirm_persists_and_bumps_version() -> None:
    dictionary = infer(sample_columns())["dictionary"]
    preview = client.post(
        "/variable-dict/patch-preview",
        json={"message": "「创新指数」是城市创新水平。", "dictionary": dictionary, "llm_config": OFFLINE_LLM},
    ).json()["preview"]

    confirm = client.post(
        "/variable-dict/confirm",
        json={
            "dataset_id": "sample_city_panel",
            "dataset_hash": "hash-a",
            "patches": preview,
            "dictionary": dictionary,
        },
    )
    assert confirm.status_code == 200, confirm.text
    confirmed = confirm.json()["dictionary"]
    assert confirmed["version"] == dictionary["version"] + 1
    assert confirmed["entries"]["创新指数"]["confirmed"] is True
    assert confirmed["entries"]["创新指数"]["description"] == "城市创新水平"

    fetched = client.get("/variable-dict", params={"dataset_id": "sample_city_panel", "dataset_hash": "hash-a"})
    assert fetched.status_code == 200
    assert fetched.json()["entries"]["创新指数"]["description"] == "城市创新水平"


def test_get_dictionary_ignores_other_file_hash() -> None:
    dictionary = infer(sample_columns(), dataset_hash="hash-a")["dictionary"]
    client.post(
        "/variable-dict/confirm",
        json={
            "dataset_id": "sample_city_panel",
            "dataset_hash": "hash-a",
            "patches": [],
            "dictionary": dictionary,
        },
    )

    same = client.get("/variable-dict", params={"dataset_id": "sample_city_panel", "dataset_hash": "hash-a"})
    other = client.get("/variable-dict", params={"dataset_id": "sample_city_panel", "dataset_hash": "hash-b"})
    assert same.status_code == 200
    assert other.status_code == 404


def test_confirm_rejects_dataset_mismatch() -> None:
    dictionary = infer(sample_columns())["dictionary"]
    dictionary["dataset_id"] = "other_dataset"

    response = client.post(
        "/variable-dict/confirm",
        json={"dataset_id": "sample_city_panel", "dataset_hash": "hash-a", "patches": [], "dictionary": dictionary},
    )
    assert response.status_code == 400
    assert "不匹配" in response.json()["detail"]


def test_infer_variables_endpoint_still_role_based() -> None:
    """/infer-variables 的语义不能被字典改造污染。"""
    response = client.post(
        "/infer-variables",
        json={
            "research_question": "数字经济发展是否会提升城市创新水平？",
            "columns": [{"name": item["name"], "dtype": item["dtype"]} for item in sample_columns()],
            "llm_config": OFFLINE_LLM,
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["dependent_variable"] == "创新指数"
    assert body["reasoning"]


def test_confirm_persists_value_labels() -> None:
    """编码只写 value_labels 元数据，确认后 GET 要一致，且能整体清空。"""
    dictionary = infer(sample_columns())["dictionary"]
    patch = {
        "column": "城市",
        "before": {"value_labels": {}},
        "after": {"value_labels": {"1": "一线", "2": "二线"}},
        "op": "update",
    }

    confirmed = client.post(
        "/variable-dict/confirm",
        json={
            "dataset_id": "sample_city_panel",
            "dataset_hash": "hash-a",
            "patches": [patch],
            "dictionary": dictionary,
        },
    )
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["dictionary"]["entries"]["城市"]["value_labels"] == {"1": "一线", "2": "二线"}

    fetched = client.get("/variable-dict", params={"dataset_id": "sample_city_panel", "dataset_hash": "hash-a"})
    assert fetched.status_code == 200
    assert fetched.json()["entries"]["城市"]["value_labels"] == {"1": "一线", "2": "二线"}

    cleared = client.post(
        "/variable-dict/confirm",
        json={
            "dataset_id": "sample_city_panel",
            "dataset_hash": "hash-a",
            "patches": [{"column": "城市", "before": {"value_labels": {"1": "一线", "2": "二线"}}, "after": {"value_labels": {}}, "op": "update"}],
            "dictionary": fetched.json(),
        },
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["dictionary"]["entries"]["城市"]["value_labels"] == {}


def test_value_labels_do_not_touch_raw_profile() -> None:
    """编码是元数据：画像里的样例值仍应是原始值，不被替换。"""
    dictionary = infer(sample_columns())["dictionary"]
    client.post(
        "/variable-dict/confirm",
        json={
            "dataset_id": "sample_city_panel",
            "dataset_hash": "hash-a",
            "patches": [{"column": "城市", "before": {}, "after": {"value_labels": {"上海": "上海市"}}, "op": "update"}],
            "dictionary": dictionary,
        },
    )

    columns = {item["name"]: item for item in sample_columns()}
    assert "上海" in columns["城市"]["sample_values"]
