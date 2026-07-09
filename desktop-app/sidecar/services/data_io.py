from __future__ import annotations

import io

import pandas as pd
from fastapi import UploadFile

MAX_UPLOAD_BYTES = 50 * 1024 * 1024


async def read_upload_dataframe(file: UploadFile) -> pd.DataFrame:
    content = await file.read()
    return read_dataframe_bytes(content, file.filename or "")


def read_dataframe_bytes(content: bytes, filename: str) -> pd.DataFrame:
    if not content:
        raise ValueError("上传文件为空。")
    if len(content) > MAX_UPLOAD_BYTES:
        raise ValueError("上传文件超过 50MB 限制。")

    suffix = filename.lower()
    try:
        if suffix.endswith((".xlsx", ".xls")):
            return pd.read_excel(io.BytesIO(content))
        if suffix.endswith(".csv") or not suffix:
            try:
                return pd.read_csv(io.BytesIO(content), encoding="utf-8-sig")
            except UnicodeDecodeError:
                return pd.read_csv(io.BytesIO(content))
    except Exception as exc:
        raise ValueError("无法读取数据文件，请上传有效的 CSV 或 Excel 文件。") from exc

    raise ValueError("仅支持 CSV、XLSX 和 XLS 数据文件。")
