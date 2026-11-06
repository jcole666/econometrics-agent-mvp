import { useEffect, useState } from "react";

import type { ModelRunRecord, VariableDictionary } from "../types";
import { displayName } from "../variableDictionary";

interface Props {
  runs: ModelRunRecord[];
  activeVersionId: string | null;
  viewingVersionId: string | null;
  dictionary: VariableDictionary | null;
  busy?: boolean;
  notice: string | null;
  onOpen: (record: ModelRunRecord) => void;
  onContinue: (record: ModelRunRecord) => void;
  onCompare: (leftId: string, rightId: string) => void;
}

export function ModelRunHistory({
  runs,
  activeVersionId,
  viewingVersionId,
  dictionary,
  busy,
  notice,
  onOpen,
  onContinue,
  onCompare
}: Props) {
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    setSelected((current) => current.filter((id) => runs.some((run) => run.version_id === id)));
  }, [runs.length]);

  function toggle(id: string) {
    setSelected((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      if (current.length >= 2) return [current[1], id];
      return [...current, id];
    });
  }

  return (
    <div className="run-history">
      <div className="run-history-head">
        <span className="note">
          每次成功运行都会新存一个版本，旧版本不会被覆盖；选中两个可以并排对比。
          {activeVersionId ? ` 下一次运行会以 ${activeVersionId} 为父版本。` : ""}
        </span>
        <button
          type="button"
          className="secondary"
          disabled={selected.length !== 2 || busy}
          onClick={() => onCompare(selected[0], selected[1])}
        >
          {busy ? "对比中…" : "对比选中版本"}
        </button>
      </div>

      {notice ? <p className="note">{notice}</p> : null}

      {runs.length === 0 ? (
        <div className="empty compact-empty">还没有运行版本。成功运行一次模型就会自动保存为 V1。</div>
      ) : (
        <div className="table-wrap">
          <table className="run-table">
            <thead>
              <tr>
                <th>对比</th>
                <th>版本</th>
                <th>时间</th>
                <th>模型</th>
                <th>Y</th>
                <th>核心 X</th>
                <th>R²</th>
                <th>n</th>
                <th>解读</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const results = run.result.results;
                const className = [
                  "run-row",
                  run.version_id === viewingVersionId ? "run-row-viewing" : "",
                  run.version_id === activeVersionId ? "run-row-active" : ""
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <tr key={run.version_id} className={className}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.includes(run.version_id)}
                        onChange={() => toggle(run.version_id)}
                        aria-label={`选择 ${run.version_id} 用于对比`}
                      />
                    </td>
                    <td>
                      <button type="button" className="run-link" onClick={() => onOpen(run)} title="查看该版本">
                        {run.version_id}
                      </button>
                    </td>
                    <td>{formatTime(run.created_at)}</td>
                    <td title={run.model}>{run.model}</td>
                    <td>{displayName(run.config.dependent_variable, dictionary)}</td>
                    <td title={run.config.independent_variables.join(", ")}>
                      {run.config.independent_variables.map((item) => displayName(item, dictionary)).join("、") || "—"}
                    </td>
                    <td>{results?.r_squared != null ? results.r_squared.toFixed(3) : "—"}</td>
                    <td>{results?.sample_size ?? "—"}</td>
                    <td>{run.ai_explanation ? run.ai_explanation.status === "completed" ? "AI" : "本地" : "—"}</td>
                    <td>
                      <button type="button" className="secondary" onClick={() => onContinue(run)} title="以该版本为父版本继续">
                        继续
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (input: number) => String(input).padStart(2, "0");
  return `${date.getMonth() + 1}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
