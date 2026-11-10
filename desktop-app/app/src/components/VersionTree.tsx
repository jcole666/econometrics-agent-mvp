import { useEffect, useMemo, useRef, useState } from "react";

import type { ModelRunRecord, VariableDictionary } from "../types";
import { displayName } from "../variableDictionary";

interface Props {
  runs: ModelRunRecord[];
  activeVersionId: string | null;
  viewingVersionId: string | null;
  dictionary: VariableDictionary | null;
  onOpen: (record: ModelRunRecord) => void;
  onContinue: (record: ModelRunRecord) => void;
}

interface TreeNode {
  run: ModelRunRecord;
  children: TreeNode[];
  depth: number;
  lane: number;
}

interface LaidOutNode {
  run: ModelRunRecord;
  depth: number;
  lane: number;
  cx: number;
  cy: number;
}

/** 展示用四层树：根在上，叶子在下，层与层之间留白 */
const LEVELS = 4;
const ROW_GAP = 96;
const LANE_GAP = 84;
const PAD_X = 52;
const PAD_Y = 42;
const R = 16;
const DEPTH_FILL = ["#d5e6dc", "#c5d5cb", "#ddd4c6", "#d3ced8"] as const;

export function VersionTree({
  runs,
  activeVersionId,
  viewingVersionId,
  dictionary,
  onOpen,
  onContinue
}: Props) {
  const layout = useMemo(() => layoutTree(runs), [runs]);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const hideTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
  }, []);

  function showHover(id: string) {
    if (hideTimer.current) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    setHoverId(id);
  }

  function scheduleHide(id: string) {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      setHoverId((current) => (current === id ? null : current));
      hideTimer.current = null;
    }, 220);
  }

  if (!runs.length) {
    return <div className="empty compact-empty">还没有版本树。跑一次模型后会出现根节点。</div>;
  }

  const width = Math.max(360, PAD_X * 2 + layout.maxLane * LANE_GAP);
  const height = Math.max(220, PAD_Y * 2 + layout.maxDepth * ROW_GAP);
  const hoverNode = layout.nodes.find((node) => node.run.version_id === hoverId) ?? null;

  return (
    <div className="version-tree version-tree-dots">
      <div className="version-tree-scroll">
        <div className="version-tree-canvas" style={{ width, height }}>
          <svg
            className="version-tree-wires"
            viewBox={`0 0 ${width} ${height}`}
            width={width}
            height={height}
            role="img"
            aria-label="研究版本树"
          >
            {layout.edges.map((edge) => (
              <path key={`${edge.from}-${edge.to}`} d={edge.path} className="version-tree-edge" fill="none" />
            ))}
            {layout.nodes.map((node) => {
              const isHead = node.run.version_id === activeVersionId;
              const isViewing = node.run.version_id === viewingVersionId;
              const isHover = node.run.version_id === hoverId;
              const fill = DEPTH_FILL[Math.min(node.depth, DEPTH_FILL.length - 1)];
              return (
                <g
                  key={node.run.version_id}
                  transform={`translate(${node.cx}, ${node.cy})`}
                  className={[
                    "version-dot",
                    isHead ? "is-head" : "",
                    isViewing ? "is-viewing" : "",
                    isHover ? "is-hover" : ""
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onMouseEnter={() => showHover(node.run.version_id)}
                  onMouseLeave={() => scheduleHide(node.run.version_id)}
                  onFocus={() => showHover(node.run.version_id)}
                  onBlur={() => scheduleHide(node.run.version_id)}
                  onClick={() => onOpen(node.run)}
                  tabIndex={0}
                  role="button"
                  aria-label={`${node.run.version_id} ${shortQuestion(node.run, 40)}`}
                >
                  <circle r={R + 10} className="version-dot-halo" />
                  <circle r={R} fill={isHead ? "#d9e8df" : fill} className="version-dot-core" />
                  <text y={4} textAnchor="middle" className="version-dot-mark">
                    {shortId(node.run.version_id)}
                  </text>
                </g>
              );
            })}
          </svg>

          {hoverNode ? (
            <aside
              className={`version-hover-card ${hoverCardSide(hoverNode, width)}`}
              style={hoverCardStyle(hoverNode, width, height)}
              onMouseEnter={() => showHover(hoverNode.run.version_id)}
              onMouseLeave={() => scheduleHide(hoverNode.run.version_id)}
            >
              <span className="version-hover-bridge" aria-hidden="true" />
              <header>
                <strong>{hoverNode.run.version_id}</strong>
                {hoverNode.run.version_id === activeVersionId ? <span className="run-chip soft">HEAD</span> : null}
                <span>{hoverNode.run.model}</span>
              </header>
              <p className="version-hover-vars">
                Y={displayName(hoverNode.run.config.dependent_variable, dictionary) || "—"}
              </p>
              <p className="version-hover-vars">
                X=
                {hoverNode.run.config.independent_variables.length
                  ? hoverNode.run.config.independent_variables
                      .map((item) => displayName(item, dictionary))
                      .join("、")
                  : "—"}
              </p>
              <p className="version-hover-parent">
                {hoverNode.run.parent_id ? `记录上的父版本 ${hoverNode.run.parent_id}` : "独立保存的一次运行"}
              </p>
              <div className="version-hover-actions">
                <button type="button" className="secondary" onClick={() => onOpen(hoverNode.run)}>
                  查看结果
                </button>
                <button type="button" className="secondary" onClick={() => onContinue(hoverNode.run)}>
                  接着探究
                </button>
              </div>
            </aside>
          ) : (
            <p className="version-tree-hint">四层展开，悬停圆点查看这次选的变量</p>
          )}
        </div>
      </div>
    </div>
  );
}

function hoverCardSide(node: LaidOutNode, width: number) {
  return node.cx + 28 + 236 < width - 8 ? "is-right" : "is-left";
}

function hoverCardStyle(node: LaidOutNode, width: number, height: number) {
  const cardW = 236;
  const cardH = 168;
  const preferRight = hoverCardSide(node, width) === "is-right";
  const left = preferRight ? node.cx + 26 : Math.max(8, node.cx - cardW - 26);
  const top = clamp(node.cy - 24, 8, Math.max(8, height - cardH - 8));
  return { left, top, width: cardW };
}

function layoutTree(runs: ModelRunRecord[]) {
  const shaped = shapeTree(runs);
  const byId = new Map(shaped.nodes.map((item) => [item.run.version_id, item]));
  const children = new Map<string, ModelRunRecord[]>();
  const roots: ModelRunRecord[] = [];

  for (const item of shaped.nodes) {
    const parent = item.layoutParent && byId.has(item.layoutParent) ? item.layoutParent : null;
    if (!parent) {
      roots.push(item.run);
      continue;
    }
    const list = children.get(parent) ?? [];
    list.push(item.run);
    children.set(parent, list);
  }

  roots.sort(byTimeAsc);
  for (const list of children.values()) list.sort(byTimeAsc);

  const forest: TreeNode[] = roots.map((run) => buildNode(run, children, 0));
  assignLanes(forest);

  const laid: LaidOutNode[] = [];
  walk(forest, (node) => {
    laid.push({
      run: node.run,
      depth: node.depth,
      lane: node.lane,
      cx: PAD_X + node.lane * LANE_GAP,
      cy: PAD_Y + node.depth * ROW_GAP
    });
  });

  const layoutParent = new Map(shaped.nodes.map((item) => [item.run.version_id, item.layoutParent]));
  const pos = new Map(laid.map((node) => [node.run.version_id, node]));
  const edges = laid
    .filter((node) => {
      const parent = layoutParent.get(node.run.version_id);
      return Boolean(parent && pos.has(parent));
    })
    .map((node) => {
      const parentId = layoutParent.get(node.run.version_id)!;
      const parent = pos.get(parentId)!;
      const child = pos.get(node.run.version_id)!;
      const y1 = parent.cy + R + 2;
      const y2 = child.cy - R - 2;
      const midY = y1 + (y2 - y1) * 0.46;
      const path =
        Math.abs(parent.cx - child.cx) < 1
          ? `M ${parent.cx} ${y1} L ${child.cx} ${y2}`
          : `M ${parent.cx} ${y1} L ${parent.cx} ${midY} L ${child.cx} ${midY} L ${child.cx} ${y2}`;
      return {
        from: parent.run.version_id,
        to: child.run.version_id,
        path
      };
    });

  const maxLane = laid.reduce((max, node) => Math.max(max, node.lane), 0);
  const maxDepth = laid.reduce((max, node) => Math.max(max, node.depth), 0);
  return { nodes: laid, edges, maxLane, maxDepth };
}

interface ShapedNode {
  run: ModelRunRecord;
  layoutParent: string | null;
}

/** 按时间排成四层，上层少、下层多，父节点居中盖住自己的孩子。 */
function shapeTree(runs: ModelRunRecord[]): { nodes: ShapedNode[] } {
  const sorted = [...runs].sort(byTimeAsc);
  if (!sorted.length) return { nodes: [] };
  const depth = Math.min(LEVELS, sorted.length);
  const counts = spreadCounts(sorted.length, depth);
  const levels: ModelRunRecord[][] = [];
  let cursor = 0;
  for (const count of counts) {
    levels.push(sorted.slice(cursor, cursor + count));
    cursor += count;
  }
  const parentOf = new Map<string, string | null>();
  for (const run of levels[0] ?? []) parentOf.set(run.version_id, null);
  for (let level = 1; level < levels.length; level += 1) {
    const parents = levels[level - 1];
    const kids = levels[level];
    if (!parents.length) continue;
    const base = Math.floor(kids.length / parents.length);
    let extra = kids.length % parents.length;
    let index = 0;
    for (const parent of parents) {
      const take = base + (extra > 0 ? 1 : 0);
      if (extra > 0) extra -= 1;
      for (let i = 0; i < take && index < kids.length; i += 1) {
        parentOf.set(kids[index].version_id, parent.version_id);
        index += 1;
      }
    }
  }
  return {
    nodes: sorted.map((run) => ({
      run,
      layoutParent: parentOf.get(run.version_id) ?? null
    }))
  };
}

function spreadCounts(total: number, depth: number): number[] {
  if (depth <= 1) return [total];
  const counts = new Array(depth).fill(1);
  let left = total - depth;
  while (left > 0) {
    let placed = false;
    for (let level = depth - 1; level >= 1 && left > 0; level -= 1) {
      const cap = Math.max(counts[level - 1] * 2, counts[level - 1] + 1);
      if (counts[level] >= cap) continue;
      counts[level] += 1;
      left -= 1;
      placed = true;
    }
    if (!placed) {
      counts[depth - 1] += left;
      break;
    }
  }
  return counts;
}

function buildNode(
  run: ModelRunRecord,
  children: Map<string, ModelRunRecord[]>,
  depth: number
): TreeNode {
  return {
    run,
    depth,
    lane: 0,
    children: (children.get(run.version_id) ?? []).map((child) => buildNode(child, children, depth + 1))
  };
}

function assignLanes(forest: TreeNode[]) {
  let nextLane = 0;
  const visit = (node: TreeNode) => {
    if (!node.children.length) {
      node.lane = nextLane;
      nextLane += 1;
      return node.lane;
    }
    const childLanes = node.children.map(visit);
    node.lane = (Math.min(...childLanes) + Math.max(...childLanes)) / 2;
    return node.lane;
  };
  forest.forEach(visit);
}

function walk(nodes: TreeNode[], visit: (node: TreeNode) => void) {
  for (const node of nodes) {
    visit(node);
    walk(node.children, visit);
  }
}

function byTimeAsc(left: ModelRunRecord, right: ModelRunRecord) {
  return left.created_at.localeCompare(right.created_at);
}

function shortQuestion(run: ModelRunRecord, max = 28) {
  const text = (run.research_question || run.model).trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function shortId(id: string) {
  const match = id.match(/(\d+)$/);
  return match ? match[1] : id.slice(-3);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
