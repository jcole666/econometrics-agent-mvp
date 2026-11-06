"""配置与数据目录的定位规则。

这里只负责「文件在哪里」，不负责解析业务配置。开发版与打包版的目录语义不同，
集中在一处，避免各处用 parents[N] 猜路径（历史上就因此读错过 .env 位置）。

解析顺序（第一个存在的胜出）：
1. 环境变量 ``XIAOJI_CONFIG_DIR`` 指定的目录（便于测试与运维覆盖）
2. ``%APPDATA%/EconometricsAgent/``（打包版的用户可写目录）
3. 仓库根目录（仅开发版；打包版不存在这个位置，也不会去 _MEIPASS 里找）

注意：``.env`` 里保存 API Key，**不能打包进 exe**；打包版只读用户目录。
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

APP_DIR_NAME = "EconometricsAgent"
ENV_FILE_NAME = ".env"
CONFIG_DIR_ENV_VAR = "XIAOJI_CONFIG_DIR"


def is_frozen() -> bool:
    return bool(getattr(sys, "frozen", False))


def app_data_dir() -> Path:
    """用户可写的应用数据目录：``%APPDATA%/EconometricsAgent``（非 Windows 退化为家目录）。"""

    base = os.getenv("APPDATA")
    if base:
        return Path(base) / APP_DIR_NAME
    return Path.home() / f".{APP_DIR_NAME.lower()}"


def repo_root() -> Path | None:
    """开发版的仓库根目录；打包版返回 None。"""

    if is_frozen():
        return None
    # 本文件位于 <repo>/desktop-app/sidecar/services/config_paths.py
    candidate = Path(__file__).resolve().parents[3]
    if (candidate / "desktop-app").is_dir():
        return candidate
    return None


def env_file_candidates() -> list[Path]:
    candidates: list[Path] = []

    override = os.getenv(CONFIG_DIR_ENV_VAR, "").strip()
    if override:
        candidates.append(Path(override).expanduser() / ENV_FILE_NAME)

    candidates.append(app_data_dir() / ENV_FILE_NAME)

    root = repo_root()
    if root is not None:
        candidates.append(root / ENV_FILE_NAME)

    return candidates


def resolve_env_file() -> Path | None:
    """返回实际会被读取的 .env 路径；都不存在时返回 None。"""

    for path in env_file_candidates():
        try:
            if path.is_file():
                return path
        except OSError:  # 权限异常或路径非法时继续尝试下一个
            continue
    return None


def read_env_file(path: Path) -> dict[str, str]:
    """解析 .env：忽略空行与 # 注释，去掉包裹的引号，不展开变量。"""

    values: dict[str, str] = {}
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return values

    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        key = key.strip()
        if not key:
            continue
        values[key] = value.strip().strip('"').strip("'")
    return values
