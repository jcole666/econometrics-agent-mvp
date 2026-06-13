from __future__ import annotations

from app.schemas import LLMConfig


def has_custom_model_config(config: LLMConfig | None) -> bool:
    if config is None:
        return False
    return any([config.api_key, config.base_url, config.model])


def llm_provider_name(config: LLMConfig | None) -> str:
    return "custom_model" if has_custom_model_config(config) else "huawei_maas"
