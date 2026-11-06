from __future__ import annotations

import json
from pathlib import Path

import pytest

from sidecar.schemas import (
    CoefficientResult,
    ModelExplanation,
    ModelRunConfig,
    ModelRunRecord,
    ModelRunResults,
    RunModelResponse,
    VariableDictEntry,
    VariableDictionary,
)
from sidecar.services import project_store


@pytest.fixture()
def store_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv(project_store.DATA_DIR_ENV, str(tmp_path))
    return tmp_path


def make_dictionary(dataset_id: str = "sample_city_panel", dataset_hash: str = "hash-1") -> VariableDictionary:
    return VariableDictionary(
        dataset_id=dataset_id,
        dataset_hash=dataset_hash,
        entries={
            "创新指数": VariableDictEntry(column="创新指数", label="城市创新指数", type="numeric", unit="分"),
            "城市": VariableDictEntry(column="城市", label="城市", type="category", confirmed=True, source="user"),
        },
        version=3,
    )


def make_run(dataset_id: str = "sample_city_panel", dataset_hash: str = "hash-1", r2: float = 0.42) -> ModelRunRecord:
    return ModelRunRecord(
        version_id="v001",
        dataset_id=dataset_id,
        dataset_hash=dataset_hash,
        variable_dictionary_snapshot=make_dictionary(dataset_id, dataset_hash),
        model="Panel Fixed Effects",
        config=ModelRunConfig(
            dependent_variable="创新指数",
            independent_variables=["数字经济发展指数"],
            entity_column="城市",
            time_column="年份",
        ),
        result=RunModelResponse(
            model_type="Panel Fixed Effects",
            success=True,
            results=ModelRunResults(
                sample_size=126,
                r_squared=r2,
                coefficients=[
                    CoefficientResult(variable="数字经济发展指数", coefficient=0.47, std_error=0.12, p_value=0.0003)
                ],
            ),
        ),
    )


def test_dictionary_roundtrip_keeps_all_fields(store_root: Path) -> None:
    dictionary = make_dictionary()
    project_store.write_variable_dictionary(dictionary)

    loaded = project_store.read_variable_dictionary("sample_city_panel", "hash-1")
    assert loaded is not None
    assert loaded.version == 3
    assert loaded.entries["创新指数"].label == "城市创新指数"
    assert loaded.entries["创新指数"].unit == "分"
    assert loaded.entries["城市"].confirmed is True
    assert loaded.entries["城市"].source == "user"


def test_dictionary_hash_mismatch_is_ignored(store_root: Path) -> None:
    project_store.write_variable_dictionary(make_dictionary(dataset_hash="hash-1"))

    assert project_store.read_variable_dictionary("sample_city_panel", "hash-1") is not None
    # 换了文件（hash 变）不能把旧字典串过来
    assert project_store.read_variable_dictionary("sample_city_panel", "hash-2") is None
    # 不校验 hash 时仍可读到
    assert project_store.read_variable_dictionary("sample_city_panel") is not None


def test_dataset_id_rejects_path_traversal(store_root: Path) -> None:
    for bad in ["../etc", "a/b", "", "..", "名字", "a b"]:
        with pytest.raises(project_store.ProjectStoreError):
            project_store.project_dir(bad)


def test_ten_runs_are_all_readable(store_root: Path) -> None:
    created = [project_store.create_model_run(make_run()) for _ in range(10)]

    assert [record.version_id for record in created] == [f"v{index:03d}" for index in range(1, 11)]
    runs = project_store.list_model_runs("sample_city_panel")
    assert len(runs) == 10
    for index, record in enumerate(runs, start=1):
        assert record.version_id == f"v{index:03d}"
        assert record.result.results is not None
        assert record.result.results.sample_size == 126
        assert project_store.read_model_run("sample_city_panel", record.version_id) is not None


def test_index_is_rebuilt_when_lost(store_root: Path) -> None:
    for _ in range(3):
        project_store.create_model_run(make_run())
    project_store.index_path("sample_city_panel").unlink()

    runs = project_store.list_model_runs("sample_city_panel")
    assert len(runs) == 3
    assert project_store.index_path("sample_city_panel").exists()


def test_corrupt_file_is_quarantined(store_root: Path) -> None:
    project_store.write_variable_dictionary(make_dictionary())
    path = project_store.dictionary_path("sample_city_panel")
    path.write_text("{ 这不是 JSON", encoding="utf-8")

    assert project_store.read_variable_dictionary("sample_city_panel") is None
    backups = list(path.parent.glob("variable_dictionary.json.corrupt.*"))
    assert backups, "损坏文件应被改名备份，而不是直接删掉"


def test_explanation_update_keeps_run_and_bumps_revision(store_root: Path) -> None:
    record = project_store.create_model_run(make_run())
    explanation = ModelExplanation(
        status="completed",
        revision=1,
        research_question="数字经济发展是否会提升城市创新水平？",
        sections=None,
        provider="huawei_maas",
    )

    updated = project_store.update_model_explanation("sample_city_panel", record.version_id, explanation)
    assert updated is not None
    assert updated.ai_explanation is not None
    assert updated.result.results is not None
    assert updated.version_id == record.version_id

    reloaded = project_store.read_model_run("sample_city_panel", record.version_id)
    assert reloaded is not None
    assert reloaded.ai_explanation is not None
    assert reloaded.ai_explanation.revision == 1


def test_unknown_version_returns_none(store_root: Path) -> None:
    assert project_store.read_model_run("sample_city_panel", "v999") is None
    with pytest.raises(project_store.ProjectStoreError):
        project_store.read_model_run("sample_city_panel", "../evil")


def test_old_payload_without_new_fields_loads(store_root: Path) -> None:
    """旧版 JSON 缺字段时按默认值补齐，不能直接读失败。"""
    folder = project_store.runs_dir("sample_city_panel")
    folder.mkdir(parents=True, exist_ok=True)
    payload = {
        "version_id": "v001",
        "dataset_id": "sample_city_panel",
        "model": "OLS",
        "config": {"dependent_variable": "y"},
        "result": {"model_type": "OLS", "success": True},
    }
    (folder / "v001.json").write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

    record = project_store.read_model_run("sample_city_panel", "v001")
    assert record is not None
    assert record.config.independent_variables == []
    assert record.diagnostics == {}
    assert record.ai_explanation is None
