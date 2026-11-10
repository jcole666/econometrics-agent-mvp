from __future__ import annotations

import pytest

from sidecar.schemas import LLMConfig
from sidecar.services import maas_client


def test_default_base_url_is_allowed() -> None:
    assert maas_client._validate_base_url(maas_client.DEFAULT_BASE_URL) == maas_client.DEFAULT_BASE_URL


def test_loopback_http_is_allowed() -> None:
    assert maas_client._validate_base_url("http://127.0.0.1:11434/v1") == "http://127.0.0.1:11434/v1"
    assert maas_client._validate_base_url("http://localhost:8000/v1/") == "http://localhost:8000/v1"


def test_any_https_openai_compatible_host_is_allowed() -> None:
    assert maas_client._validate_base_url("https://llm.school.edu.cn/v1") == "https://llm.school.edu.cn/v1"
    assert maas_client._validate_base_url("https://openrouter.ai/api/v1") == "https://openrouter.ai/api/v1"
    assert maas_client._validate_base_url("https://api.siliconflow.cn/v1/") == "https://api.siliconflow.cn/v1"


@pytest.mark.parametrize(
    "base_url",
    [
        "http://api.modelarts-maas.com/openai/v1",
        "ftp://api.modelarts-maas.com/v1",
        "https://user:pass@api.openai.com/v1",
        "https://169.254.169.254/latest/meta-data",
        "https://metadata.google.internal/computeMetadata/v1",
        "",
        "   ",
    ],
)
def test_disallowed_base_url_is_rejected(base_url: str) -> None:
    with pytest.raises(maas_client.MaasUnavailable):
        maas_client._validate_base_url(base_url)


def test_custom_config_rejects_plain_http_lan() -> None:
    config = LLMConfig(api_key="test-key", base_url="http://10.0.0.8:8080/v1", model="demo")

    with pytest.raises(maas_client.MaasUnavailable):
        maas_client._get_custom_config(config)


def test_custom_config_accepts_https_lan_gateway() -> None:
    config = LLMConfig(api_key="test-key", base_url="https://10.0.0.8:8443/v1/", model="campus-llm")

    resolved = maas_client._get_custom_config(config)

    assert resolved.base_url == "https://10.0.0.8:8443/v1"
    assert resolved.model == "campus-llm"


def test_custom_config_keeps_third_party_model_name() -> None:
    config = LLMConfig(
        api_key="test-key",
        base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
        model="qwen-plus",
    )

    resolved = maas_client._get_custom_config(config)

    assert resolved.model == "qwen-plus"


def test_deepseek_root_url_gets_v1_suffix() -> None:
    assert maas_client._validate_base_url("https://api.deepseek.com") == "https://api.deepseek.com/v1"
    assert maas_client._validate_base_url("https://api.deepseek.com/") == "https://api.deepseek.com/v1"


def test_modelarts_normalizes_only_bad_aliases() -> None:
    assert (
        maas_client._normalize_model_name("deepseek", "https://api.modelarts-maas.com/openai/v1")
        == "deepseek-v4-pro"
    )
    assert (
        maas_client._normalize_model_name("deepseek-chat", "https://api.modelarts-maas.com/openai/v1")
        == "deepseek-v4-pro"
    )
    assert (
        maas_client._normalize_model_name("my-custom-deploy", "https://api.modelarts-maas.com/openai/v1")
        == "my-custom-deploy"
    )


def test_status_allows_unknown_https_host(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MAAS_BASE_URL", "https://collector.example.com/v1")

    status = maas_client.get_maas_status()

    assert status["base_url"] == "https://collector.example.com/v1"
    assert status["base_url_allowed"] is True
