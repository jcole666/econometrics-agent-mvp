from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from sidecar.api import app


client = TestClient(app)

TOKEN = "test-local-token"
TOKEN_HEADER = {"X-Xiaoji-Token": TOKEN}


@pytest.fixture
def token_env(monkeypatch: pytest.MonkeyPatch) -> str:
    monkeypatch.setenv("XIAOJI_LOCAL_TOKEN", TOKEN)
    return TOKEN


def test_without_env_variable_check_is_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("XIAOJI_LOCAL_TOKEN", raising=False)

    assert client.get("/sample-profile").status_code == 200


def test_health_stays_public(token_env: str) -> None:
    assert client.get("/health").status_code == 200


def test_request_without_token_is_rejected(token_env: str) -> None:
    response = client.get("/sample-profile")

    assert response.status_code == 401
    assert "令牌" in response.json()["detail"]


def test_wrong_token_is_rejected(token_env: str) -> None:
    response = client.get("/sample-profile", headers={"X-Xiaoji-Token": "another-token"})

    assert response.status_code == 401


def test_request_with_token_passes(token_env: str) -> None:
    response = client.get("/sample-profile", headers=TOKEN_HEADER)

    assert response.status_code == 200
    assert response.json()["rows"] == 126


def test_preflight_not_blocked_by_token(token_env: str) -> None:
    """浏览器预检不带自定义头，必须放行，否则打包版链路会被 401 打断。"""

    response = client.options(
        "/sample-profile",
        headers={
            "Origin": "null",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "x-xiaoji-token",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "null"


def test_401_keeps_cors_headers(token_env: str) -> None:
    """401 也要带 CORS 头，否则前端只能看到跨域错误，看不到真实原因。"""

    response = client.get("/sample-profile", headers={"Origin": "null"})

    assert response.status_code == 401
    assert response.headers["access-control-allow-origin"] == "null"
