import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import type { ModelRunRecord, VariableDictionary } from "../types";
import { displayName } from "../variableDictionary";
import { VersionTree } from "./VersionTree";

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
  compact?: boolean;
}

const DOT_TONES = ["tone-sage", "tone-tea", "tone-mist", "tone-clay", "tone-lilac"] as const;

export function ModelRunHistory({
  runs,
  activeVersionId,
  viewingVersionId,
  dictionary,
  busy,
  notice,
  onOpen,
  onContinue,
  onCompare,
  compact = false
}: Props) {
  const [selected, setSelected] = useState<string[]>([]);
  const [treeOpen, setTreeOpen] = useState(false);
  const [focusedId, setFocusedId] = useState<string | null>(null);

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

  const ordered = [...runs].sort((left, right) => right.created_at.localeCompare(left.created_at));

  return (
    <div className={`run-history ${compact ? "run-history-compact" : ""}`}>
      <div className="run-history-head">
        <span className="note">
          每次运行记下当时选的变量；想接着换变量，点「接着探究」。
          {activeVersionId ? ` HEAD → ${activeVersionId}` : ""}
        </span>
        <div className="run-history-tools">
          <button type="button" className="secondary" disabled={runs.length === 0} onClick={() => setTreeOpen(true)}>
            打开树形图
          </button>
          {!compact ? (
            <button
              type="button"
              className="secondary"
              disabled={selected.length !== 2 || busy}
              onClick={() => onCompare(selected[0], selected[1])}
            >
              {busy ? "对比中…" : "对比两版"}
            </button>
          ) : null}
        </div>
      </div>

      {notice ? <p className="note">{notice}</p> : null}

      {runs.length === 0 ? (
        <div className="empty compact-empty">还没有运行版本。跑通一次模型后，这里会记下你选过的变量组合。</div>
      ) : (
        <div className="run-timeline" role="list">
          {ordered.map((run, index) => {
            const isHead = run.version_id === activeVersionId;
            const isViewing = run.version_id === viewingVersionId;
            const isFocused = focusedId === run.version_id;
            const tone = DOT_TONES[index % DOT_TONES.length];
            const vars = formatVars(run, dictionary);
            const summary = run.research_question?.trim() || vars;
            return (
              <article
                key={run.version_id}
                className={[
                  "run-beat",
                  isViewing ? "is-viewing" : "",
                  isHead ? "is-head" : "",
                  isFocused ? "is-focused" : ""
                ]
                  .filter(Boolean)
                  .join(" ")}
                role="listitem"
                onMouseEnter={() => setFocusedId(run.version_id)}
                onMouseLeave={() => setFocusedId((current) => (current === run.version_id ? null : current))}
                onFocus={() => setFocusedId(run.version_id)}
                onBlur={() => setFocusedId((current) => (current === run.version_id ? null : current))}
              >
                <div className="run-beat-rail" aria-hidden="true">
                  <span className={`run-beat-dot ${tone} ${isHead ? "is-head" : ""}`} />
                </div>
                <div className="run-beat-main">
                  <div className="run-beat-line">
                    <label className="run-beat-check">
                      <input
                        type="checkbox"
                        checked={selected.includes(run.version_id)}
                        onChange={() => toggle(run.version_id)}
                        aria-label={`选择 ${run.version_id} 用于对比`}
                      />
                    </label>
                    <button type="button" className="run-beat-id" onClick={() => onOpen(run)}>
                      {run.version_id}
                    </button>
                    {isHead ? <span className="run-chip soft">HEAD</span> : null}
                    <span className="run-beat-summary" title={summary}>
                      {vars}
                    </span>
                    <span className="run-beat-meta">{run.parent_id ? `← ${run.parent_id}` : "起点"}</span>
                  </div>
                  {isFocused || isViewing ? (
                    <div className="run-beat-pop">
                      <p>{summary}</p>
                      <div className="run-beat-actions">
                        <button type="button" className="secondary" onClick={() => onOpen(run)}>
                          查看结果
                        </button>
                        <button type="button" className="secondary" onClick={() => onContinue(run)}>
                          接着探究
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {compact && selected.length === 2 ? (
        <button
          type="button"
          className="secondary wide"
          disabled={busy}
          onClick={() => onCompare(selected[0], selected[1])}
        >
          对比选中两版
        </button>
      ) : null}

      {treeOpen ? (
        <FloatingTreeDialog
          onClose={() => setTreeOpen(false)}
          runs={runs}
          activeVersionId={activeVersionId}
          viewingVersionId={viewingVersionId}
          dictionary={dictionary}
          onOpen={(record) => {
            onOpen(record);
            setTreeOpen(false);
          }}
          onContinue={(record) => {
            onContinue(record);
            setTreeOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

function FloatingTreeDialog({
  onClose,
  runs,
  activeVersionId,
  viewingVersionId,
  dictionary,
  onOpen,
  onContinue
}: {
  onClose: () => void;
  runs: ModelRunRecord[];
  activeVersionId: string | null;
  viewingVersionId: string | null;
  dictionary: VariableDictionary | null;
  onOpen: (record: ModelRunRecord) => void;
  onContinue: (record: ModelRunRecord) => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    mode: "move" | "resize";
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    originW: number;
    originH: number;
  } | null>(null);

  const [frame, setFrame] = useState(() => {
    const width = Math.min(860, Math.max(520, window.innerWidth - 120));
    const height = Math.min(620, Math.max(380, window.innerHeight - 120));
    return {
      x: Math.max(24, Math.round((window.innerWidth - width) / 2)),
      y: Math.max(24, Math.round((window.innerHeight - height) / 2)),
      w: width,
      h: height
    };
  });

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    function onPointerMove(event: PointerEvent) {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (drag.mode === "move") {
        setFrame((current) => ({
          ...current,
          x: clamp(drag.originX + dx, 8, window.innerWidth - 120),
          y: clamp(drag.originY + dy, 8, window.innerHeight - 80)
        }));
        return;
      }
      setFrame((current) => ({
        ...current,
        w: clamp(drag.originW + dx, 420, window.innerWidth - current.x - 8),
        h: clamp(drag.originH + dy, 300, window.innerHeight - current.y - 8)
      }));
    }

    function endDrag() {
      dragRef.current = null;
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
    };
  }, []);

  function beginMove(event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    dragRef.current = {
      mode: "move",
      startX: event.clientX,
      startY: event.clientY,
      originX: frame.x,
      originY: frame.y,
      originW: frame.w,
      originH: frame.h
    };
  }

  function beginResize(event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = {
      mode: "resize",
      startX: event.clientX,
      startY: event.clientY,
      originX: frame.x,
      originY: frame.y,
      originW: frame.w,
      originH: frame.h
    };
  }

  return (
    <div className="version-tree-layer">
      <div className="version-tree-scrim" onMouseDown={onClose} />
      <div
        ref={dialogRef}
        className="version-tree-dialog is-floating"
        role="dialog"
        aria-modal="true"
        aria-label="版本树形图"
        style={{ left: frame.x, top: frame.y, width: frame.w, height: frame.h }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="version-tree-dialog-head is-draggable" onPointerDown={beginMove}>
          <div>
            <strong>探究路径</strong>
            <p className="note">四层展开，父节点在自己的分支正中。悬停圆点看当时的 Y/X。</p>
          </div>
          <button type="button" className="secondary" onClick={onClose} onPointerDown={(event) => event.stopPropagation()}>
            关闭
          </button>
        </div>
        <div className="version-tree-dialog-body">
          <VersionTree
            runs={runs}
            activeVersionId={activeVersionId}
            viewingVersionId={viewingVersionId}
            dictionary={dictionary}
            onOpen={onOpen}
            onContinue={onContinue}
          />
        </div>
        <div className="version-tree-resize" onPointerDown={beginResize} aria-label="拖动缩放窗口" />
      </div>
    </div>
  );
}

function formatVars(run: ModelRunRecord, dictionary: VariableDictionary | null) {
  const y = displayName(run.config.dependent_variable, dictionary);
  const xs = run.config.independent_variables.map((item) => displayName(item, dictionary));
  if (!y && !xs.length) return run.model;
  const xText = xs.length ? xs.slice(0, 3).join("、") + (xs.length > 3 ? "…" : "") : "—";
  return `Y=${y || "—"} · X=${xText}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
