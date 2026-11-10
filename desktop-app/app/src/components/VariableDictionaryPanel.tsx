import { useEffect, useMemo, useState } from "react";

import type {
  ProfileColumn,
  VariableDictPatchItem,
  VariableDictPatchPreviewResponse,
  VariableDictionary,
  VariableSemanticType
} from "../types";
import { dictionaryStats } from "../variableDictionary";

const TYPE_OPTIONS: { value: VariableSemanticType; label: string }[] = [
  { value: "numeric", label: "数值" },
  { value: "category", label: "分类" },
  { value: "binary", label: "二元" },
  { value: "datetime", label: "时间" },
  { value: "text", label: "文本" },
  { value: "unknown", label: "未知" }
];

interface DraftRow {
  label: string;
  description: string;
  type: VariableSemanticType;
  unit: string;
  valueLabels: string;
}

interface Props {
  columns: ProfileColumn[];
  dictionary: VariableDictionary | null;
  busy: boolean;
  notice: string | null;
  onInfer: () => void;
  onPreview: (message: string) => Promise<VariableDictPatchPreviewResponse | null>;
  onConfirm: (patches: VariableDictPatchItem[]) => Promise<boolean>;
}

export function VariableDictionaryPanel({ columns, dictionary, busy, notice, onInfer, onPreview, onConfirm }: Props) {
  const [draft, setDraft] = useState<Record<string, DraftRow>>({});
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<VariableDictPatchPreviewResponse | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [localNotice, setLocalNotice] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const stats = useMemo(() => dictionaryStats(dictionary), [dictionary]);
  const version = dictionary?.version ?? 0;
  const pendingCount = Math.max(0, stats.total - stats.confirmed);
  // 仅依赖 version 不够：同版本号下含义被填上时草稿不会刷新，输入框一直显示占位符
  const contentStamp = useMemo(() => {
    if (!dictionary) return "empty";
    return Object.entries(dictionary.entries)
      .map(([name, entry]) => `${name}|${entry.description ?? ""}|${entry.label ?? ""}|${entry.type}|${entry.confirmed}`)
      .join(";");
  }, [dictionary]);

  useEffect(() => {
    const next: Record<string, DraftRow> = {};
    for (const column of columns) {
      const entry = dictionary?.entries?.[column.name];
      next[column.name] = {
        label: entry?.label ?? "",
        description: entry?.description ?? "",
        type: entry?.type ?? "unknown",
        unit: entry?.unit ?? "",
        valueLabels: labelsToText(entry?.value_labels)
      };
    }
    setDraft(next);
    setPreview(null);
    setChecked({});
    setLocalNotice(null);
  }, [columns, version, contentStamp, dictionary]);

  function updateRow(column: string, patch: Partial<DraftRow>) {
    setDraft((current) => ({ ...current, [column]: { ...(current[column] ?? emptyRow()), ...patch } }));
  }

  function collectEdits(): VariableDictPatchItem[] {
    if (!dictionary) return [];
    const patches: VariableDictPatchItem[] = [];
    for (const column of columns) {
      const entry = dictionary.entries?.[column.name];
      const row = draft[column.name];
      if (!row) continue;
      const after: Record<string, unknown> = {};
      if (row.label.trim() !== (entry?.label ?? "")) after.label = row.label.trim();
      if (row.description.trim() !== (entry?.description ?? "")) after.description = row.description.trim();
      if (row.type !== (entry?.type ?? "unknown")) after.type = row.type;
      if (row.unit.trim() !== (entry?.unit ?? "")) after.unit = row.unit.trim();
      if (row.valueLabels.trim() !== labelsToText(entry?.value_labels).trim()) {
        after.value_labels = textToLabels(row.valueLabels);
      }
      if (Object.keys(after).length === 0) continue;
      const clean = Object.fromEntries(
        Object.entries(after).filter(([, value]) => value !== "" || typeof value === "object")
      );
      if (Object.keys(clean).length === 0) continue;
      patches.push({
        column: column.name,
        before: {
          label: entry?.label ?? null,
          description: entry?.description ?? null,
          type: entry?.type ?? "unknown",
          unit: entry?.unit ?? null,
          value_labels: entry?.value_labels ?? {}
        },
        after: clean,
        op: "update"
      });
    }
    return patches;
  }

  async function saveEdits() {
    const patches = collectEdits();
    if (patches.length === 0) {
      setLocalNotice("没有需要保存的修改。");
      return;
    }
    const ok = await onConfirm(patches);
    setLocalNotice(ok ? `已保存并确认 ${patches.length} 列。` : "保存失败，请查看顶部状态提示。");
  }

  async function confirmAllCurrent() {
    if (!dictionary) return;
    const edits = collectEdits();
    const editMap = new Map(edits.map((item) => [item.column, item]));
    const patches: VariableDictPatchItem[] = columns.map((column) => {
      const existing = editMap.get(column.name);
      if (existing) return existing;
      const entry = dictionary.entries?.[column.name];
      return {
        column: column.name,
        before: {
          label: entry?.label ?? null,
          description: entry?.description ?? null,
          type: entry?.type ?? "unknown",
          unit: entry?.unit ?? null,
          value_labels: entry?.value_labels ?? {}
        },
        after: {},
        op: "confirm"
      };
    });
    const ok = await onConfirm(patches);
    setLocalNotice(ok ? `已确认全部 ${patches.length} 列释义。` : "确认失败，请查看顶部状态提示。");
  }

  async function runPreview() {
    const text = message.trim();
    if (!text) {
      setLocalNotice("先写下要改的内容，例如：「Q1 是年级」。");
      return;
    }
    setPreviewBusy(true);
    setLocalNotice(null);
    try {
      const result = await onPreview(text);
      setPreview(result);
      const nextChecked: Record<string, boolean> = {};
      for (const item of result?.preview ?? []) nextChecked[item.column] = true;
      setChecked(nextChecked);
      if (result && result.preview.length === 0) {
        setLocalNotice(result.assistant_summary || "没有找到可修改的列。");
      }
    } finally {
      setPreviewBusy(false);
    }
  }

  async function applyPreview() {
    const items = (preview?.preview ?? []).filter((item) => checked[item.column]);
    if (items.length === 0) {
      setLocalNotice("没有勾选任何一项。");
      return;
    }
    const ok = await onConfirm(items);
    setLocalNotice(ok ? `已写入 ${items.length} 列修改。` : "写入失败，请查看顶部状态提示。");
    if (ok) {
      setPreview(null);
      setMessage("");
      setChecked({});
    }
  }

  return (
    <div className="vdict">
      <div className="vdict-head">
        <span className="note">
          {busy
            ? "小计正在理解每列含义…"
            : dictionary
              ? pendingCount > 0
                ? `AI 已先填好释义，还有 ${pendingCount} 列待你确认。`
                : `全部 ${stats.total} 列已确认（第 ${version} 版）。`
              : "生成画像后会自动填充释义。"}
        </span>
        <div className="vdict-actions">
          <button type="button" onClick={onInfer} disabled={busy || columns.length === 0}>
            {busy ? "推断中…" : dictionary ? "重新推断" : "AI 填充"}
          </button>
          <button type="button" className="secondary" onClick={saveEdits} disabled={busy || !dictionary}>
            保存修改
          </button>
          <button type="button" onClick={confirmAllCurrent} disabled={busy || !dictionary || pendingCount === 0}>
            确认无误
          </button>
        </div>
      </div>

      {notice ? <p className="note">{notice}</p> : null}
      {localNotice ? <p className="note">{localNotice}</p> : null}

      {dictionary ? (
        <div className="vdict-cards">
          {columns.map((column) => {
            const entry = dictionary.entries?.[column.name];
            const row = draft[column.name] ?? emptyRow();
            const labelSameAsName = row.label.trim() === column.name;
            return (
              <div className={`vdict-card ${entry?.confirmed ? "vdict-card-ok" : ""}`} key={column.name}>
                <div className="vdict-card-top">
                  <strong title={column.name}>{column.name}</strong>
                  <select
                    className="vdict-input vdict-type"
                    value={row.type}
                    onChange={(event) => updateRow(column.name, { type: event.target.value as VariableSemanticType })}
                  >
                    {TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <span className={entry?.confirmed ? "vdict-badge vdict-badge-ok" : "vdict-badge"}>
                    {entry?.confirmed ? "已确认" : "待确认"}
                  </span>
                </div>
                <label className="vdict-field">
                  <span>含义</span>
                  <input
                    className="vdict-input"
                    value={row.description}
                    placeholder={busy ? "正在由 AI 填写…" : "这列代表什么"}
                    onChange={(event) => updateRow(column.name, { description: event.target.value })}
                  />
                </label>
                {!labelSameAsName || showAdvanced ? (
                  <label className="vdict-field">
                    <span>显示名</span>
                    <input
                      className="vdict-input"
                      value={row.label}
                      placeholder={column.name}
                      onChange={(event) => updateRow(column.name, { label: event.target.value })}
                    />
                  </label>
                ) : null}
                {showAdvanced ? (
                  <div className="vdict-card-extra">
                    <label className="vdict-field">
                      <span>单位</span>
                      <input
                        className="vdict-input"
                        value={row.unit}
                        placeholder="无"
                        onChange={(event) => updateRow(column.name, { unit: event.target.value })}
                      />
                    </label>
                    <label className="vdict-field">
                      <span>编码</span>
                      <input
                        className="vdict-input"
                        value={row.valueLabels}
                        placeholder="如 1=是;0=否"
                        onChange={(event) => updateRow(column.name, { valueLabels: event.target.value })}
                      />
                    </label>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="empty compact-empty">
          {busy ? "正在根据列名与样例值自动填写含义…" : "还没有字段释义。生成字段画像后会自动填充。"}
        </div>
      )}

      {dictionary ? (
        <div className="vdict-footer">
          <button type="button" className="secondary" onClick={() => setShowAdvanced((value) => !value)}>
            {showAdvanced ? "收起单位/编码" : "展开单位/编码"}
          </button>
          <div className="vdict-chat-row">
            <input
              className="vdict-input"
              value={message}
              placeholder="一句话修正，例如：智慧城市试点 1=试点市"
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && runPreview()}
            />
            <button type="button" className="secondary" onClick={runPreview} disabled={busy || previewBusy}>
              {previewBusy ? "解析中" : "改这一处"}
            </button>
          </div>
        </div>
      ) : null}

      {preview ? (
        <div className="vdict-preview">
          <p className="note">{preview.assistant_summary}</p>
          {preview.preview.length ? (
            <>
              <ul className="vdict-preview-list">
                {preview.preview.map((item) => (
                  <li key={item.column}>
                    <label>
                      <input
                        type="checkbox"
                        checked={Boolean(checked[item.column])}
                        onChange={(event) =>
                          setChecked((current) => ({ ...current, [item.column]: event.target.checked }))
                        }
                      />
                      <strong>{item.column}</strong>
                      <span>
                        {item.op === "confirm"
                          ? "标记为已确认"
                          : Object.entries(item.after)
                              .map(([key, value]) => `${fieldLabel(key)} → ${formatPatchValue(key, value)}`)
                              .join("；")}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <button type="button" onClick={applyPreview} disabled={busy}>
                应用勾选项
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function emptyRow(): DraftRow {
  return { label: "", description: "", type: "unknown", unit: "", valueLabels: "" };
}

function labelsToText(labels: Record<string, string> | null | undefined): string {
  if (!labels) return "";
  return Object.entries(labels)
    .sort(([left], [right]) => left.localeCompare(right, "zh-CN", { numeric: true }))
    .map(([code, meaning]) => `${code}=${meaning}`)
    .join(";");
}

function textToLabels(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  const parts = text.split(/[;；,，\n\r]+/);
  for (const part of parts) {
    const item = part.trim();
    if (!item) continue;
    const match = item.match(/^(.+?)\s*[=＝:：]\s*(.+)$/);
    if (!match) continue;
    const code = match[1].trim();
    const meaning = match[2].trim();
    if (!code || !meaning) continue;
    result[code] = meaning.slice(0, 40);
    if (Object.keys(result).length >= 20) break;
  }
  return result;
}

function formatPatchValue(key: string, value: unknown): string {
  if (key === "value_labels" && value && typeof value === "object") {
    const text = labelsToText(value as Record<string, string>);
    return text || "（清空）";
  }
  return String(value);
}

function fieldLabel(key: string): string {
  const labels: Record<string, string> = {
    label: "名称",
    description: "说明",
    type: "类型",
    unit: "单位",
    value_labels: "编码",
    confidence: "可信度",
    confirmed: "确认"
  };
  return labels[key] ?? key;
}
