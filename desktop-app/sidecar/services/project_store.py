"""项目本地存储：变量字典与模型运行版本。

设计约定（后续阶段不要绕过本模块直接写文件）：

- 权威数据在 sidecar 本地目录，前端只通过 HTTP 读写，localStorage 仅作缓存；
- 目录结构：``<root>/<dataset_id>/variable_dictionary.json``、
  ``<root>/<dataset_id>/model_runs/v001.json``、``.../model_runs/index.json``；
- 写入一律「临时文件 → fsync → os.replace」，避免中途崩溃留下半个 JSON；
- 读到损坏文件时改名为 ``.corrupt.<时间戳>`` 并返回空值，不让进程崩掉。
"""

from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path
from typing import Any

from sidecar.schemas import ModelExplanation, ModelRunRecord, VariableDictionary

DATA_DIR_ENV = "XIAOJI_PROJECT_DATA_DIR"
_SAFE_ID = re.compile(r"^[A-Za-z0-9._-]{1,120}$")
_VERSION_ID = re.compile(r"^v(\d{3,})$")


class ProjectStoreError(ValueError):
    """数据集标识或版本号不合法。"""


def data_root() -> Path:
    override = os.getenv(DATA_DIR_ENV, "").strip()
    if override:
        return Path(override).expanduser()
    return Path.home() / ".econometrics-agent-mvp" / "projects"


def safe_dataset_id(dataset_id: str) -> str:
    candidate = (dataset_id or "").strip()
    if not candidate or candidate in {".", ".."} or not _SAFE_ID.match(candidate):
        raise ProjectStoreError("数据集标识不合法：只允许字母、数字、点、下划线与短横线。")
    return candidate


def project_dir(dataset_id: str) -> Path:
    return data_root() / safe_dataset_id(dataset_id)


def dictionary_path(dataset_id: str) -> Path:
    return project_dir(dataset_id) / "variable_dictionary.json"


def runs_dir(dataset_id: str) -> Path:
    return project_dir(dataset_id) / "model_runs"


def index_path(dataset_id: str) -> Path:
    return runs_dir(dataset_id) / "index.json"


def run_path(dataset_id: str, version_id: str) -> Path:
    if not _VERSION_ID.match(version_id or ""):
        raise ProjectStoreError(f"版本号不合法：{version_id}")
    return runs_dir(dataset_id) / f"{version_id}.json"


# ---------------------------------------------------------------------------
# 原子读写
# ---------------------------------------------------------------------------


def _atomic_write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.{time.time_ns()}.tmp")
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    try:
        with open(tmp, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass


def _read_json(path: Path) -> Any | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        _quarantine(path)
        return None


def _quarantine(path: Path) -> None:
    backup = path.with_name(f"{path.name}.corrupt.{int(time.time() * 1000)}")
    try:
        os.replace(path, backup)
    except OSError:
        pass


# ---------------------------------------------------------------------------
# 变量字典
# ---------------------------------------------------------------------------


def read_variable_dictionary(dataset_id: str, dataset_hash: str | None = None) -> VariableDictionary | None:
    raw = _read_json(dictionary_path(dataset_id))
    if not isinstance(raw, dict):
        return None
    try:
        dictionary = VariableDictionary.model_validate(raw)
    except Exception:  # pydantic.ValidationError 之外还可能是类型错误
        return None
    if dataset_hash and dictionary.dataset_hash and dictionary.dataset_hash != dataset_hash:
        # 文件换了（hash 变），旧字典不能串到新数据上。
        return None
    return dictionary


def write_variable_dictionary(dictionary: VariableDictionary) -> VariableDictionary:
    _atomic_write_json(dictionary_path(dictionary.dataset_id), dictionary.model_dump(mode="json"))
    return dictionary


# ---------------------------------------------------------------------------
# 模型运行版本
# ---------------------------------------------------------------------------


def _read_index_raw(dataset_id: str) -> list[dict]:
    raw = _read_json(index_path(dataset_id))
    if isinstance(raw, dict) and isinstance(raw.get("runs"), list):
        return [item for item in raw["runs"] if isinstance(item, dict)]
    return []


def _index_entry(record: ModelRunRecord) -> dict:
    results = record.result.results
    return {
        "version_id": record.version_id,
        "parent_id": record.parent_id,
        "created_at": record.created_at,
        "model": record.model,
        "dependent_variable": record.config.dependent_variable,
        "independent_variables": record.config.independent_variables,
        "sample_size": results.sample_size if results else None,
        "r_squared": results.r_squared if results else None,
        "has_explanation": record.ai_explanation is not None,
        "dataset_hash": record.dataset_hash,
    }


def read_run_index(dataset_id: str) -> list[dict]:
    entries = _read_index_raw(dataset_id)
    if entries:
        return sorted(entries, key=lambda item: _version_number(str(item.get("version_id", ""))))
    # 索引丢了但版本文件还在：按文件重建，避免历史数据「消失」。
    rebuilt = [_index_entry(record) for record in _scan_runs(dataset_id)]
    if rebuilt:
        _write_index(dataset_id, rebuilt)
    return rebuilt


def _write_index(dataset_id: str, entries: list[dict]) -> None:
    ordered = sorted(entries, key=lambda item: _version_number(str(item.get("version_id", ""))))
    _atomic_write_json(index_path(dataset_id), {"runs": ordered})


def _version_number(version_id: str) -> int:
    match = _VERSION_ID.match(version_id)
    return int(match.group(1)) if match else 0


def next_version_id(dataset_id: str) -> str:
    entries = read_run_index(dataset_id)
    last = max((_version_number(str(item.get("version_id", ""))) for item in entries), default=0)
    return f"v{last + 1:03d}"


def _scan_runs(dataset_id: str) -> list[ModelRunRecord]:
    folder = runs_dir(dataset_id)
    if not folder.exists():
        return []
    records: list[ModelRunRecord] = []
    for path in folder.glob("v*.json"):
        if not _VERSION_ID.match(path.stem):
            continue
        raw = _read_json(path)
        if not isinstance(raw, dict):
            continue
        try:
            records.append(ModelRunRecord.model_validate(raw))
        except Exception:
            continue
    return sorted(records, key=lambda record: _version_number(record.version_id))


def save_model_run(record: ModelRunRecord) -> ModelRunRecord:
    path = run_path(record.dataset_id, record.version_id)
    _atomic_write_json(path, record.model_dump(mode="json"))

    entries = [item for item in _read_index_raw(record.dataset_id) if item.get("version_id") != record.version_id]
    entries.append(_index_entry(record))
    _write_index(record.dataset_id, entries)
    return record


def create_model_run(record: ModelRunRecord) -> ModelRunRecord:
    """分配下一个版本号后落盘；调用方传入的 version_id 会被覆盖。"""
    record = record.model_copy(update={"version_id": next_version_id(record.dataset_id)})
    return save_model_run(record)


def read_model_run(dataset_id: str, version_id: str) -> ModelRunRecord | None:
    raw = _read_json(run_path(dataset_id, version_id))
    if not isinstance(raw, dict):
        return None
    try:
        return ModelRunRecord.model_validate(raw)
    except Exception:
        return None


def list_model_runs(dataset_id: str) -> list[ModelRunRecord]:
    records: list[ModelRunRecord] = []
    for entry in read_run_index(dataset_id):
        version_id = str(entry.get("version_id", ""))
        record = read_model_run(dataset_id, version_id) if version_id else None
        if record is not None:
            records.append(record)
    return records


def update_model_explanation(dataset_id: str, version_id: str, explanation: ModelExplanation) -> ModelRunRecord | None:
    record = read_model_run(dataset_id, version_id)
    if record is None:
        return None
    updated = record.model_copy(update={"ai_explanation": explanation})
    return save_model_run(updated)


def delete_dataset(dataset_id: str) -> None:
    """仅测试与显式清理使用：删除整个数据集目录。"""
    import shutil

    folder = project_dir(dataset_id)
    if folder.exists():
        shutil.rmtree(folder, ignore_errors=True)
