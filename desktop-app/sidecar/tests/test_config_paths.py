from __future__ import annotations

from pathlib import Path

import pytest

from sidecar.services import config_paths, maas_client


def test_repo_root_env_is_found_in_dev() -> None:
    root = config_paths.repo_root()

    if root is None or not (root / ".env").exists():
        pytest.skip("开发环境没有仓库根 .env，跳过")

    assert config_paths.resolve_env_file() == root / ".env"


def test_config_dir_override_takes_priority(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text("MAAS_API_KEY=from-override\n", encoding="utf-8")
    monkeypatch.setenv(config_paths.CONFIG_DIR_ENV_VAR, str(tmp_path))

    assert config_paths.env_file_candidates()[0] == env_file
    assert config_paths.resolve_env_file() == env_file


def test_app_data_dir_follows_appdata(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("APPDATA", str(tmp_path))

    assert config_paths.app_data_dir() == tmp_path / config_paths.APP_DIR_NAME


def test_read_env_file_ignores_comments_and_quotes(tmp_path: Path) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text(
        "\n".join(
            [
                "# 注释行",
                "",
                "MAAS_API_KEY=\"quoted-value\"",
                "MAAS_MODEL = spaced-model ",
                "NO_EQUALS_LINE",
                "=empty-key",
            ]
        ),
        encoding="utf-8",
    )

    values = config_paths.read_env_file(env_file)

    assert values == {"MAAS_API_KEY": "quoted-value", "MAAS_MODEL": "spaced-model"}


def test_read_env_file_missing_returns_empty(tmp_path: Path) -> None:
    assert config_paths.read_env_file(tmp_path / "not-exists.env") == {}


def test_api_key_loaded_from_configured_dir(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text("MAAS_API_KEY=from-configured-dir\nMAAS_ENABLED=auto\n", encoding="utf-8")
    monkeypatch.setenv(config_paths.CONFIG_DIR_ENV_VAR, str(tmp_path))
    monkeypatch.delenv("MAAS_API_KEY", raising=False)
    monkeypatch.delenv("HUAWEI_MAAS_API_KEY", raising=False)
    monkeypatch.setattr(maas_client._load_local_env, "_done", False, raising=False)

    status = maas_client.get_maas_status()

    assert status["api_key_present"] is True
    assert status["configured"] is True
    assert status["config_file"] == str(env_file)
