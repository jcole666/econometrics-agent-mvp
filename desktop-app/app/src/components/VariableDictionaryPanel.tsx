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

  const stats = useMemo(() => dictionaryStats(dictionary), [dictionary]);
  const version = dictionary?.version ?? 0;

  useEffect(() => {
    const next: Record<string, DraftRow> = {};
    for (const column of columns) {
      const entry = dictionary?.entries?.[column.name];
      next[column.name] = {
        label: entry?.label ?? "",
        description: entry?.description ?? "",
        type: entry?.type ?? "unknown",
        unit: entry?.unit ?? ""
      };
    }
    setDraft(next);
    setPreview(null);
    setChecked({});
    setLocalNotice(null);
  }, [columns, version]);

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
      if (Object.keys(after).length === 0) continue;
      const clean = Object.fromEntries(Object.entries(after).filter(([, value]) => value !== ""));
      if (Object.keys(clean).length === 0) continue;
      patches.push({
        column: column.name,
        before: {
          label: entry?.label ?? null,
          description: entry?.description ?? null,
          type: entry?.type ?? "unknown",
          unit: entry?.unit ?? null
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
          变量字典描述「每一列是什么意思」，和上面的 Y / X 角色识别是两件事。
          {dictionary ? ` 已确认 ${stats.confirmed}/${stats.total} 列，第 ${version} 版。` : " 尚未生成。"}
        </span>
        <div className="vdict-actions">
          <button type="button" onClick={onInfer} disabled={busy || columns.length === 0}>
            {dictionary ? "重新推断" : "生成变量字典"}
          </button>
          <button type="button" className="secondary" onClick={saveEdits} disabled={busy || !dictionary}>
            保存并确认
          </button>
        </div>
      </div>

      {notice ? <p className="note">{notice}</p> : null}
      {localNotice ? <p className="note">{localNotice}</p> : null}

      {dictionary ? (
        <div className="table-wrap">
          <table className="vdict-table">
            <thead>
              <tr>
                <th>原始列名</th>
                <th>中文名称</th>
                <th>含义</th>
                <th>类型</th>
                <th>单位</th>
                <th>可信度</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {columns.map((column) => {
                const entry = dictionary.entries?.[column.name];
                const row = draft[column.name] ?? emptyRow();
                return (
                  <tr key={column.name}>
                    <td title={column.name}>{column.name}</td>
                    <td>
                      <input
                        className="vdict-input"
                        value={row.label}
                        placeholder="待确认"
                        onChange={(event) => updateRow(column.name, { label: event.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className="vdict-input"
                        value={row.description}
                        placeholder="这列代表什么"
                        onChange={(event) => updateRow(column.name, { description: event.target.value })}
                      />
                    </td>
                    <td>
                      <select
                        className="vdict-input"
                        value={row.type}
                        onChange={(event) => updateRow(column.name, { type: event.target.value as VariableSemanticType })}
                      >
                        {TYPE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        className="vdict-input"
                        value={row.unit}
                        placeholder="无"
                        onChange={(event) => updateRow(column.name, { unit: event.target.value })}
                      />
                    </td>
                    <td>{entry?.confidence != null ? `${Math.round(entry.confidence * 100)}%` : "—"}</td>
                    <td>
                      <span className={entry?.confirmed ? "vdict-badge vdict-badge-ok" : "vdict-badge"}>
                        {entry?.confirmed ? "已确认" : "待确认"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty compact-empty">
          还没有变量字典。点「生成变量字典」，小计会按列名与样例值给出中文名称、类型和单位，再由你确认。
        </div>
      )}

      {dictionary ? (
        <div className="vdict-chat">
          <label>对话修正</label>
          <div className="vdict-chat-row">
            <input
              className="vdict-input"
              value={message}
              placeholder="例如：「创新指数」是城市创新水平，越高越好"
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && runPreview()}
            />
            <button type="button" className="secondary" onClick={runPreview} disabled={busy || previewBusy}>
              {previewBusy ? "解析中" : "预览修改"}
            </button>
          </div>

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
                                  .map(([key, value]) => `${fieldLabel(key)} → ${String(value)}`)
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
      ) : null}
    </div>
  );
}

function emptyRow(): DraftRow {
  return { label: "", description: "", type: "unknown", unit: "" };
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
