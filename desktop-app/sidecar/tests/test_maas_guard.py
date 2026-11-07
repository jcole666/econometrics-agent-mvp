from __future__ import annotations

import pytest

from sidecar.schemas import LLMConfig
from sidecar.services import maas_client


def test_default_base_url_is_allowed() -> None:
    assert maas_client._validate_base_url(maas_client.DEFAULT_BASE_URL) == maas_client.DEFAULT_BASE_URL


def test_loopback_http_is_allowed() -> None:
    assert maas_client._validate_base_url("http://127.0.0.1:11434/v1") == "http://127.0.0.1:11434/v1"
    assert maas_client._validate_base_url("http://localhost:8000/v1/") == "http://localhost:8000/v1"


@pytest.mark.parametrize(
    "base_url",
    [
        "http://api.modelarts-maas.com/openai/v1",
        "https://192.168.1.10/v1",
        "https://evil.example.com/v1",
        "https://api.modelarts-maas.com.evil.example.com/v1",
        "ftp://api.modelarts-maas.com/v1",
        "https://user:pass@api.openai.com/v1",
        "",
        "   ",
    ],
)
def test_disallowed_base_url_is_rejected(base_url: str) -> None:
    with pytest.raises(maas_client.MaasUnavailable):
        maas_client._validate_base_url(base_url)


def test_custom_host_can_be_whitelisted_via_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MAAS_ALLOWED_HOSTS", "llm.school.edu.cn, another.example.com")

    assert maas_client._validate_base_url("https://llm.school.edu.cn/v1") == "https://llm.school.edu.cn/v1"
    with pytest.raises(maas_client.MaasUnavailable):
        maas_client._validate_base_url("https://not-listed.school.edu.cn/v1")


def test_custom_config_rejects_internal_host() -> None:
    config = LLMConfig(api_key="test-key", base_url="http://10.0.0.8:8080/v1", model="demo")

    with pytest.raises(maas_client.MaasUnavailable):
        maas_client._get_custom_config(config)


def test_custom_config_accepts_whitelisted_host() -> None:
    config = LLMConfig(api_key="test-key", base_url="https://api.deepseek.com/v1/", model="deepseek-chat")

    resolved = maas_client._get_custom_config(config)

    assert resolved.base_url == "https://api.deepseek.com/v1"
    assert resolved.api_key == "test-key"


def test_status_flags_disallowed_base_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MAAS_BASE_URL", "https://collector.example.com/v1")

    status = maas_client.get_maas_status()

    assert status["base_url"] == "https://collector.example.com/v1"
    assert status["base_url_allowed"] is False
