from __future__ import annotations

from fastapi.testclient import TestClient

from sidecar.api import app


client = TestClient(app)

PREFLIGHT_HEADERS = {
    "Access-Control-Request-Method": "POST",
    "Access-Control-Request-Headers": "content-type",
}


def test_packaged_origin_preflight_is_allowed() -> None:
    """打包版从 file:// 加载，Origin 为字符串 null，预检必须放行。"""

    response = client.options("/chat", headers={"Origin": "null", **PREFLIGHT_HEADERS})

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "null"


def test_packaged_origin_simple_request_is_allowed() -> None:
    response = client.get("/health", headers={"Origin": "null"})

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "null"


def test_dev_origin_still_allowed() -> None:
    for origin in ("http://127.0.0.1:5173", "http://localhost:5173"):
        response = client.get("/health", headers={"Origin": origin})

        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == origin


def test_unknown_origin_is_not_granted() -> None:
    response = client.get("/health", headers={"Origin": "https://evil.example.com"})

    assert "access-control-allow-origin" not in response.headers
