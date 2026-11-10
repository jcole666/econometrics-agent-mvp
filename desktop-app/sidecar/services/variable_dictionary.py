"""变量字典：语义推断、对话式补丁预览、确认落库。

与 ``variable_inferrer.py`` 的分工：
- ``variable_inferrer`` 判断「哪一列是 Y / X / 个体 / 时间」，是建模角色；
- 本模块描述「这一列是什么意思」，是语义元数据（label/unit/编码/可信度）。
两者并存，互不改写。
"""

from __future__ import annotations

import json
import re
from typing import Any

from sidecar.schemas import (
    VariableDictEntry,
    VariableDictInferRequest,
    VariableDictInferResponse,
    VariableDictPatchItem,
    VariableDictPatchPreviewRequest,
    VariableDictPatchPreviewResponse,
    VariableDictionary,
)
from sidecar.services import project_store
from sidecar.services.maas_client import MaasUnavailable, llm_provider_name, maas_chat, parse_json_content

SEMANTIC_TYPES = {"numeric", "category", "binary", "datetime", "text", "unknown"}
MERGEABLE_FIELDS = {"label", "description", "type", "unit", "value_labels", "confidence"}

_CJK = re.compile(r"[\u4e00-\u9fff]")
_CODE_NAME = re.compile(r"^(?:[A-Za-z]{1,4}\d{1,4}|(?:var|v|x|y|q|col|field|item)[_\-]?\d{1,4})$", re.IGNORECASE)
_UNIT_MARKERS: tuple[tuple[str, str], ...] = (
    ("万元", "万元"),
    ("万人", "万人"),
    ("元", "元"),
    ("人", "人"),
    ("率", "%"),
    ("%", "%"),
    ("年份", "年"),
)

_KIND_TO_TYPE = {
    "数值": "numeric",
    "二元/布尔": "binary",
    "时间": "datetime",
    "分类/文本": "category",
}


def _now_iso() -> str:
    from datetime import datetime

    return datetime.now().astimezone().isoformat(timespec="seconds")


def _semantic_type(column: dict) -> str:
    kind = str(column.get("kind") or "")
    if kind in _KIND_TO_TYPE:
        return _KIND_TO_TYPE[kind]
    dtype = str(column.get("dtype") or "").lower()
    if "datetime" in dtype or "date" in dtype:
        return "datetime"
    if any(token in dtype for token in ("int", "float", "double", "decimal")):
        return "numeric"
    if dtype in {"bool", "boolean"}:
        return "binary"
    if dtype in {"object", "string", "category"}:
        return "category"
    return "unknown"


def _guess_unit(name: str) -> str | None:
    for marker, unit in _UNIT_MARKERS:
        if marker in name:
            return unit
    return None


_DESCRIPTION_HINTS: tuple[tuple[str, str], ...] = (
    ("创新指数", "衡量城市或地区创新水平的综合指标，数值越高通常表示创新活动越活跃。"),
    ("数字经济发展指数", "衡量数字经济发展水平的综合指数。"),
    ("宽带接入率", "宽带接入覆盖或普及程度，通常以百分比表示。"),
    ("财政科技支出", "政府财政中用于科技活动的支出规模。"),
    ("人力资本", "反映劳动力受教育程度或技能水平的代理变量。"),
    ("产业结构升级", "反映产业结构高级化或升级程度的指标。"),
    ("人口密度", "单位面积上的人口数量。"),
    ("智慧城市试点", "是否入选智慧城市试点的政策处理变量，常见为 0/1。"),
    ("绿色专利占比", "绿色相关专利在全部专利中的比重。"),
    ("城市", "观测单位所属城市名称。"),
    ("省份", "观测单位所属省份。"),
    ("区域", "地理或行政区域划分。"),
    ("年份", "观测所属年份，常作为时间维度。"),
)


def _guess_description(name: str, kind: str) -> str | None:
    for key, text in _DESCRIPTION_HINTS:
        if key in name:
            return text
    if "指数" in name:
        return f"「{name}」是综合指数类指标，数值高低反映相对水平。"
    if "率" in name or "%" in name or "占比" in name:
        return f"「{name}」通常表示比例或比率，解读时注意量纲。"
    if "试点" in name or "是否" in name or kind == "二元/布尔":
        return f"「{name}」多为分类或处理变量，常用于识别政策冲击。"
    if "年份" in name or "年度" in name or kind == "时间":
        return f"「{name}」标识时间维度，面板分析中常用作时间列。"
    if kind == "数值":
        return f"「{name}」为数值型变量，建模前需确认缺失与异常值。"
    if kind.startswith("分类"):
        return f"「{name}」为分类变量，回归中常需编码或作为固定效应。"
    if _CJK.search(name):
        return f"「{name}」字段，请核对其在研究问题中的具体含义。"
    return f"列「{name}」的含义待核对；可结合样例值与研究问题补充说明。"


def _rule_entry(column: dict) -> VariableDictEntry:
    name = str(column["name"])
    kind = str(column.get("kind") or "")
    if _CJK.search(name):
        label: str | None = name
        confidence = 0.72
    elif _CODE_NAME.match(name):
        label = None
        confidence = 0.2
    else:
        label = name
        confidence = 0.45

    description = _guess_description(name, kind)

    return VariableDictEntry(
        column=name,
        label=label,
        description=description,
        type=_semantic_type(column),
        unit=_guess_unit(name),
        value_labels={},
        confidence=confidence,
        confirmed=False,
        source="ai",
        updated_at=_now_iso(),
    )


def _has_description(entry: VariableDictEntry | None) -> bool:
    return bool(entry and (entry.description or "").strip())


def _is_locked(entry: VariableDictEntry | None) -> bool:
    """只有「已确认且已有含义」才锁定，避免空确认永久挡住自动填充。"""
    return bool(entry and entry.confirmed and _has_description(entry))


def infer_dictionary(request: VariableDictInferRequest) -> VariableDictInferResponse:
    columns = [item for item in request.columns if isinstance(item, dict) and item.get("name")]
    existing = request.existing
    if existing is None and request.reuse_stored and request.dataset_id:
        existing = project_store.read_variable_dictionary(request.dataset_id, request.dataset_hash or None)

    entries: dict[str, VariableDictEntry] = {}
    for column in columns:
        name = str(column["name"])
        prior = (existing.entries.get(name) if existing else None)
        if _is_locked(prior):
            entries[name] = prior  # type: ignore[assignment]
            continue
        rule = _rule_entry(column)
        if prior is not None:
            rule = rule.model_copy(
                update={
                    "label": prior.label or rule.label,
                    "description": prior.description or rule.description,
                    "unit": prior.unit or rule.unit,
                    "value_labels": prior.value_labels or rule.value_labels,
                    "confirmed": False if not _has_description(prior) else prior.confirmed,
                    "source": "ai",
                }
            )
        entries[name] = rule

    provider = "rules"
    maas_error: str | None = None
    if columns:
        try:
            llm_entries = _llm_entries(request, columns)
            entries = _merge_llm_entries(entries, llm_entries)
            provider = llm_provider_name(request.llm_config)
        except MaasUnavailable as exc:
            maas_error = str(exc)

    # 内容变了就抬版本号，前端草稿才能跟着刷新（不能只靠 version 不变时的旧 draft）
    base_version = existing.version if existing else 0
    dictionary = VariableDictionary(
        dataset_id=request.dataset_id,
        dataset_hash=request.dataset_hash,
        entries=entries,
        version=max(1, base_version + 1),
    )
    return VariableDictInferResponse(dictionary=dictionary, provider=provider, maas_error=maas_error)


def _llm_entries(request: VariableDictInferRequest, columns: list[dict]) -> list[dict]:
    payload = {
        "research_question": request.research_question,
        "columns": [
            {
                "name": column.get("name"),
                "dtype": column.get("dtype"),
                "kind": column.get("kind"),
                "sample_values": column.get("sample_values"),
                "min": column.get("min"),
                "max": column.get("max"),
                "unique": column.get("unique"),
            }
            for column in columns
        ],
    }
    messages = [
        {
            "role": "system",
            "content": (
                "你是计量经济学助教。必须为每一列写出可直接给用户核对的中文释义，只返回 JSON："
                '{"entries":[{"column":"原始列名","label":"中文名称","description":"一句话含义","type":"numeric|category|binary|datetime|text|unknown",'
                '"unit":"单位或null","value_labels":{"1":"含义"},"confidence":0到1}]}。'
                "硬性要求：每个给定 column 都必须出现；description 不能为空，写清楚这列在研究里代表什么；"
                "若列名已是中文，label 可与列名相同，但仍要写 description；二元变量尽量补 value_labels；"
                "不要编造单位；不要改动任何数值。"
            ),
        },
        {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
    ]
    raw = parse_json_content(maas_chat(messages, request.llm_config))
    entries = raw.get("entries")
    return [item for item in entries if isinstance(item, dict)] if isinstance(entries, list) else []


def _merge_llm_entries(entries: dict[str, VariableDictEntry], llm_entries: list[dict]) -> dict[str, VariableDictEntry]:
    merged = dict(entries)
    for item in llm_entries:
        name = str(item.get("column") or "").strip()
        entry = merged.get(name)
        if entry is None or _is_locked(entry):
            continue

        update: dict[str, Any] = {}
        label = item.get("label")
        if isinstance(label, str) and label.strip() and not (entry.label or "").strip():
            update["label"] = label.strip()[:60]
        elif isinstance(label, str) and label.strip() and not entry.confirmed:
            update["label"] = label.strip()[:60]
        description = item.get("description")
        if isinstance(description, str) and description.strip():
            if not _has_description(entry) or not entry.confirmed:
                update["description"] = description.strip()[:200]
        semantic_type = str(item.get("type") or "")
        if semantic_type in SEMANTIC_TYPES and (not entry.confirmed or entry.type == "unknown"):
            update["type"] = semantic_type
        unit = item.get("unit")
        if isinstance(unit, str) and unit.strip() and (not entry.unit or not entry.confirmed):
            update["unit"] = unit.strip()[:20]
        value_labels = item.get("value_labels")
        if isinstance(value_labels, dict) and value_labels and (not entry.value_labels or not entry.confirmed):
            update["value_labels"] = {str(key): str(value)[:40] for key, value in list(value_labels.items())[:20]}
        confidence = item.get("confidence")
        if isinstance(confidence, (int, float)) and 0 <= float(confidence) <= 1:
            update["confidence"] = round(float(confidence), 3)

        if update:
            # 补全空含义后需用户再确认
            if entry.confirmed and "description" in update:
                update["confirmed"] = False
            update["updated_at"] = _now_iso()
            merged[name] = entry.model_copy(update=update)
    return merged


# ---------------------------------------------------------------------------
# 对话式补丁：先预览，再确认
# ---------------------------------------------------------------------------

_SEPARATORS = ("是", "表示", "代表", "指", "叫作", "叫做", "意思是", "：", ":", "为", "改成", "改为", "=", "＝")
_STOP_CHARS = "。；;\n，,！!？?"
_CLAUSE_STRIP = " \t【】[]（）()「」“”\"'、-_"


def preview_patch(request: VariableDictPatchPreviewRequest) -> VariableDictPatchPreviewResponse:
    dictionary = request.dictionary
    rules = _rule_preview(request.message, dictionary)

    provider = "rules"
    maas_error: str | None = None
    if rules:
        # 规则已经能定位到具体列时，不再多花一次模型调用；只有规则无收获才让 LLM 兜底。
        return VariableDictPatchPreviewResponse(preview=rules, assistant_summary=_summary(rules), provider=provider)

    try:
        llm_preview, summary = _llm_preview(request)
        if llm_preview:
            provider = llm_provider_name(request.llm_config)
            return VariableDictPatchPreviewResponse(
                preview=llm_preview,
                assistant_summary=summary or _summary(llm_preview),
                provider=provider,
            )
    except MaasUnavailable as exc:
        maas_error = str(exc)

    return VariableDictPatchPreviewResponse(
        preview=[],
        assistant_summary="没有从这句话里找到可以修改的列。可以这样说：「Q1 是年级，取值 1=高一」或者「把数字经济发展指数改成都市数字经济指数」。",
        provider="rules",
        maas_error=maas_error,
    )


def _rule_preview(message: str, dictionary: VariableDictionary) -> list[VariableDictPatchItem]:
    preview: list[VariableDictPatchItem] = []
    seen: set[str] = set()

    for clause in _split_clauses(message):
        matched = _match_column(clause, dictionary)
        if matched is None:
            continue
        column, index = matched
        if column in seen:
            continue
        seen.add(column)
        entry = dictionary.entries[column]

        tail = clause[index + len(column) :][:80]
        tail = _strip_separators(tail)
        should_confirm = "确认" in message or "没问题" in message
        description = _first_clause(tail)

        if description:
            after: dict[str, Any] = {"description": description}
            # 「Q1 是年级」这类短句同时作为中文名称；已有正式名称时只更新说明。
            if len(description) <= 12 and (not entry.label or _CODE_NAME.match(entry.label or "")):
                after["label"] = description
            preview.append(
                VariableDictPatchItem(
                    column=column,
                    before=_entry_snapshot(entry),
                    after=after,
                    op="update",
                )
            )
        elif should_confirm:
            preview.append(
                VariableDictPatchItem(
                    column=column,
                    before=_entry_snapshot(entry),
                    after={"confirmed": True},
                    op="confirm",
                )
            )
    return preview


def _split_clauses(message: str) -> list[str]:
    """一句话里可能定义多个变量，先按标点切成小句，避免把说明里的词当成待改列名。"""
    clauses: list[str] = []
    current: list[str] = []
    for char in message:
        if char in _STOP_CHARS:
            text = "".join(current).strip()
            if text:
                clauses.append(text)
            current = []
            continue
        current.append(char)
    tail = "".join(current).strip()
    if tail:
        clauses.append(tail)
    return clauses


def _match_column(clause: str, dictionary: VariableDictionary) -> tuple[str, int] | None:
    """在一小句里选「出现最早、名字最长」的列名，减少短名误命中。"""
    best: tuple[int, int, str] | None = None
    for column in dictionary.entries:
        index = clause.find(column)
        if index < 0:
            continue
        key = (index, -len(column), column)
        if best is None or key < best:
            best = key
    if best is None:
        return None
    return best[2], best[0]


def _strip_separators(text: str) -> str:
    candidate = text.lstrip(_CLAUSE_STRIP)
    for separator in _SEPARATORS:
        if candidate.startswith(separator):
            candidate = candidate[len(separator) :]
            candidate = candidate.lstrip(_CLAUSE_STRIP)
            break
    return candidate


def _first_clause(text: str) -> str | None:
    for index, char in enumerate(text):
        if char in _STOP_CHARS:
            text = text[:index]
            break
    cleaned = text.strip(_CLAUSE_STRIP)
    return cleaned[:80] or None


def _entry_snapshot(entry: VariableDictEntry) -> dict[str, Any]:
    return {
        "label": entry.label,
        "description": entry.description,
        "type": entry.type,
        "unit": entry.unit,
        "value_labels": entry.value_labels,
        "confidence": entry.confidence,
        "confirmed": entry.confirmed,
    }


def _llm_preview(request: VariableDictPatchPreviewRequest) -> tuple[list[VariableDictPatchItem], str]:
    dictionary = request.dictionary
    payload = {
        "message": request.message,
        "entries": [
            {
                "column": column,
                "label": entry.label,
                "description": entry.description,
                "type": entry.type,
                "unit": entry.unit,
                "value_labels": entry.value_labels,
            }
            for column, entry in dictionary.entries.items()
        ],
    }
    messages = [
        {
            "role": "system",
            "content": (
                "用户在用自然语言修正变量字典。只返回 JSON："
                '{"preview":[{"column":"原始列名","after":{"label":"可选","description":"可选","unit":"可选","type":"可选",'
                '"value_labels":{"键":"含义"},"confirmed":true},"op":"update"}],"assistant_summary":"一句话说明准备改什么"}。'
                "column 必须来自给定条目；改不动的字段不要出现在 after 里；不要编造数值。"
            ),
        },
        {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
    ]
    raw = parse_json_content(maas_chat(messages, request.llm_config))
    items = raw.get("preview")
    summary = raw.get("assistant_summary")
    preview: list[VariableDictPatchItem] = []
    if isinstance(items, list):
        for item in items:
            if not isinstance(item, dict):
                continue
            column = str(item.get("column") or "").strip()
            entry = dictionary.entries.get(column)
            after = item.get("after")
            if entry is None or not isinstance(after, dict):
                continue
            clean = {key: value for key, value in after.items() if key in MERGEABLE_FIELDS or key == "confirmed"}
            if not clean:
                continue
            preview.append(
                VariableDictPatchItem(
                    column=column,
                    before=_entry_snapshot(entry),
                    after=clean,
                    op="update",
                )
            )
    return preview, str(summary or "").strip()


def _summary(preview: list[VariableDictPatchItem]) -> str:
    if not preview:
        return "没有需要修改的条目。"
    names = "、".join(f"{item.column}" for item in preview[:5])
    return f"准备修改 {len(preview)} 列：{names}。确认后才会写入，可逐条取消。"


# ---------------------------------------------------------------------------
# 确认写入
# ---------------------------------------------------------------------------


def confirm_patches(dataset_id: str, dataset_hash: str, patches: list[VariableDictPatchItem], dictionary: VariableDictionary) -> VariableDictionary:
    if dictionary.dataset_id and dictionary.dataset_id != dataset_id:
        raise ValueError("字典与数据集不匹配，请重新推断后再确认。")

    entries = dict(dictionary.entries)
    for patch in patches:
        column = patch.column
        if not column:
            continue
        entry = entries.get(column) or VariableDictEntry(column=column, source="user", updated_at=_now_iso())
        update: dict[str, Any] = {}
        for key, value in patch.after.items():
            if key not in MERGEABLE_FIELDS:
                continue
            if key == "type":
                if isinstance(value, str) and value in SEMANTIC_TYPES:
                    update["type"] = value
                continue
            if key == "value_labels":
                if isinstance(value, dict):
                    update["value_labels"] = {str(k): str(v)[:40] for k, v in list(value.items())[:20]}
                continue
            if key == "confidence":
                if isinstance(value, (int, float)) and 0 <= float(value) <= 1:
                    update["confidence"] = round(float(value), 3)
                continue
            if isinstance(value, str):
                update[key] = value.strip()[:200]

        # 用户经手的一律标记为用户来源并置为已确认。
        update["confirmed"] = True
        update["source"] = "user" if entry.source in {"user", "mixed"} else "mixed"
        update["updated_at"] = _now_iso()
        entries[column] = entry.model_copy(update=update)

    confirmed_dictionary = dictionary.model_copy(
        update={
            "dataset_id": dataset_id,
            "dataset_hash": dataset_hash or dictionary.dataset_hash,
            "entries": entries,
            "version": dictionary.version + 1,
        }
    )
    return project_store.write_variable_dictionary(confirmed_dictionary)


def get_dictionary(dataset_id: str, dataset_hash: str | None = None) -> VariableDictionary | None:
    return project_store.read_variable_dictionary(dataset_id, dataset_hash or None)
