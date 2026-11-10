import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { fetchBoxplot, fetchCategoryBar, fetchCorrHeatmap, fetchHistogram, fetchScatter } from "../api";
import { saveChartImage } from "../reportExport";
import type {
  BoxplotResponse,
  CategoryBarResponse,
  CorrHeatmapResponse,
  DataProfile,
  HistogramResponse,
  ScatterResponse,
  VariableDictionary
} from "../types";
import { displayName } from "../variableDictionary";
import { RelationshipNetwork } from "./RelationshipNetwork";

type ChartView = "network" | "scatter" | "heatmap" | "histogram" | "boxplot" | "category";

const VIEWS: { value: ChartView; label: string }[] = [
  { value: "network", label: "关系网络" },
  { value: "scatter", label: "散点拟合" },
  { value: "heatmap", label: "相关热力" },
  { value: "histogram", label: "分布直方" },
  { value: "boxplot", label: "箱线对比" },
  { value: "category", label: "分类柱状" }
];

const PALETTE = ["#1f6f5b", "#b45309", "#1d4f91", "#9f1239", "#0f766e", "#7c3aed"];

interface Props {
  file: File | null;
  profile: DataProfile;
  dictionary: VariableDictionary | null;
  /** 当前被解释变量：散点默认把它放在纵轴，横轴取与它最相关的那一列。 */
  outcome?: string;
}

export function RelationshipCharts({ file, profile, dictionary, outcome }: Props) {
  const numericColumns = useMemo(
    () => profile.columns.filter((column) => column.kind === "数值").map((column) => column.name),
    [profile]
  );
  const categoryColumns = useMemo(
    () =>
      profile.columns
        .filter((column) => column.kind === "分类/文本" || column.kind === "二元/布尔")
        .map((column) => column.name),
    [profile]
  );
  const hints = profile.diagnostics?.relationship_hints ?? [];

  const defaultPair = useMemo(() => {
    const candidates = hints.filter(
      (item) => numericColumns.includes(item.left) && numericColumns.includes(item.right)
    );
    const hint = candidates[0];
    if (!hint) {
      return { x: numericColumns[0] ?? "", y: numericColumns[1] ?? numericColumns[0] ?? "" };
    }
    if (outcome && hint.left === outcome) return { x: hint.right, y: hint.left };
    if (outcome && hint.right === outcome) return { x: hint.left, y: hint.right };
    return { x: hint.left, y: hint.right };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hints, outcome, numericColumns.join("|")]);

  const defaultHeatColumns = useMemo(() => {
    const ordered: string[] = [];
    const push = (name: string) => {
      if (numericColumns.includes(name) && !ordered.includes(name)) ordered.push(name);
    };
    push(defaultPair.x);
    push(defaultPair.y);
    for (const item of hints) {
      push(item.left);
      push(item.right);
    }
    for (const name of numericColumns) push(name);
    return ordered.slice(0, 4);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultPair.x, defaultPair.y, hints, numericColumns.join("|")]);

  const [view, setView] = useState<ChartView>("network");
  const [xColumn, setXColumn] = useState("");
  const [yColumn, setYColumn] = useState("");
  const [heatColumns, setHeatColumns] = useState<string[]>([]);
  const [histColumn, setHistColumn] = useState("");
  const [boxColumns, setBoxColumns] = useState<string[]>([]);
  const [categoryColumn, setCategoryColumn] = useState("");
  const [scatter, setScatter] = useState<ScatterResponse | null>(null);
  const [heatmap, setHeatmap] = useState<CorrHeatmapResponse | null>(null);
  const [histogram, setHistogram] = useState<HistogramResponse | null>(null);
  const [boxplot, setBoxplot] = useState<BoxplotResponse | null>(null);
  const [categoryBar, setCategoryBar] = useState<CategoryBarResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const chartRef = useRef<SVGSVGElement | null>(null);
  const setChartRef = useCallback((node: SVGSVGElement | null) => {
    chartRef.current = node;
  }, []);

  useEffect(() => {
    setXColumn((current) => (numericColumns.includes(current) ? current : defaultPair.x));
    setYColumn((current) => (numericColumns.includes(current) ? current : defaultPair.y));
    setHeatColumns((current) => {
      const kept = current.filter((column) => numericColumns.includes(column));
      return kept.length >= 2 ? kept : defaultHeatColumns;
    });
    setHistColumn((current) => (numericColumns.includes(current) ? current : defaultPair.y || numericColumns[0] || ""));
    setBoxColumns((current) => {
      const kept = current.filter((column) => numericColumns.includes(column));
      return kept.length >= 1 ? kept : defaultHeatColumns.slice(0, 3);
    });
    setCategoryColumn((current) =>
      categoryColumns.includes(current) ? current : categoryColumns[0] ?? ""
    );
  }, [numericColumns.join("|"), categoryColumns.join("|"), defaultPair.x, defaultPair.y, defaultHeatColumns.join(",")]);

  useEffect(() => {
    if (view !== "scatter" || !file || !xColumn || !yColumn || xColumn === yColumn) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchScatter(file, xColumn, yColumn)
      .then((result) => {
        if (!cancelled) setScatter(result);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "散点统计失败。");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [view, file, xColumn, yColumn]);

  useEffect(() => {
    if (view !== "heatmap" || !file || heatColumns.length < 2) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchCorrHeatmap(file, heatColumns)
      .then((result) => {
        if (!cancelled) setHeatmap(result);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "相关系数计算失败。");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [view, file, heatColumns.join(",")]);

  useEffect(() => {
    if (view !== "histogram" || !file || !histColumn) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchHistogram(file, histColumn)
      .then((result) => {
        if (!cancelled) setHistogram(result);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "直方图统计失败。");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [view, file, histColumn]);

  useEffect(() => {
    if (view !== "boxplot" || !file || boxColumns.length < 1) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchBoxplot(file, boxColumns)
      .then((result) => {
        if (!cancelled) setBoxplot(result);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "箱线图统计失败。");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [view, file, boxColumns.join(",")]);

  useEffect(() => {
    if (view !== "category" || !file || !categoryColumn) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchCategoryBar(file, categoryColumn)
      .then((result) => {
        if (!cancelled) setCategoryBar(result);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "分类统计失败。");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [view, file, categoryColumn]);

  function toggleHeatColumn(column: string) {
    setHeatColumns((current) => {
      if (current.includes(column)) return current.filter((item) => item !== column);
      if (current.length >= 8) return current;
      return [...current, column];
    });
  }

  function toggleBoxColumn(column: string) {
    setBoxColumns((current) => {
      if (current.includes(column)) return current.filter((item) => item !== column);
      if (current.length >= 6) return current;
      return [...current, column];
    });
  }

  async function exportPng() {
    const node = chartRef.current;
    if (!node) {
      setNotice("当前没有可导出的图。");
      return;
    }
    setNotice("正在导出图片…");
    try {
      const dataUrl = await svgToPng(node);
      const base =
        view === "scatter"
          ? `${xColumn}_${yColumn}`
          : view === "histogram"
            ? `${histColumn}_直方图`
            : view === "boxplot"
              ? "箱线图"
              : view === "category"
                ? `${categoryColumn}_分类`
                : "相关系数热力图";
      setNotice(await saveChartImage(`${base}.png`, dataUrl));
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "图片导出失败。");
    }
  }

  const availableViews = VIEWS.filter((item) => {
    if (item.value === "category") return categoryColumns.length > 0;
    if (item.value === "network") return true;
    return numericColumns.length > 0;
  });

  if (numericColumns.length === 0 && categoryColumns.length === 0) {
    return <div className="empty compact-empty">这份数据没有可画图的数值或分类列。</div>;
  }

  return (
    <div className="rel-charts">
      <div className="rel-tabs" role="tablist">
        {availableViews.map((item) => (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={view === item.value}
            className={view === item.value ? "rel-tab rel-tab-active" : "rel-tab"}
            onClick={() => {
              setView(item.value);
              setNotice(null);
              setError(null);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      {view === "network" ? (
        hints.length ? (
          <RelationshipNetwork hints={hints.slice(0, 8)} dictionary={dictionary} />
        ) : (
          <div className="empty compact-empty">暂未发现明显线性关系。</div>
        )
      ) : null}

      {view === "scatter" ? (
        <>
          <div className="rel-controls">
            <label>
              横轴
              <select value={xColumn} onChange={(event) => setXColumn(event.target.value)}>
                {numericColumns.map((column) => (
                  <option key={column} value={column}>{displayName(column, dictionary)}</option>
                ))}
              </select>
            </label>
            <label>
              纵轴
              <select value={yColumn} onChange={(event) => setYColumn(event.target.value)}>
                {numericColumns.map((column) => (
                  <option key={column} value={column}>{displayName(column, dictionary)}</option>
                ))}
              </select>
            </label>
            <button type="button" className="secondary" onClick={exportPng} disabled={!scatter || loading}>
              导出 PNG
            </button>
          </div>

          {xColumn === yColumn ? <div className="empty compact-empty">横轴与纵轴需要选择不同的列。</div> : null}
          {loading ? <div className="empty compact-empty">正在计算…</div> : null}
          {error ? <div className="empty compact-empty">{error}</div> : null}

          {scatter && xColumn !== yColumn ? (
            <>
              <div className="rel-metrics">
                <span>n = {scatter.n}</span>
                <span>r = {scatter.r === null ? "—" : scatter.r.toFixed(3)}</span>
                <span>p = {scatter.p_value === null ? "—" : formatP(scatter.p_value)}</span>
              </div>
              <div className="rel-canvas rel-canvas-rich">
                <ScatterChart
                  data={scatter}
                  xLabel={displayName(scatter.x, dictionary)}
                  yLabel={displayName(scatter.y, dictionary)}
                  svgRef={setChartRef}
                />
              </div>
              <CaptionBlock caption={scatter.caption} />
              <WarningList warnings={scatter.warnings} />
            </>
          ) : null}
        </>
      ) : null}

      {view === "heatmap" ? (
        <>
          <div className="rel-controls rel-controls-wrap">
            {numericColumns.map((column) => (
              <label key={column} className="rel-check">
                <input
                  type="checkbox"
                  checked={heatColumns.includes(column)}
                  onChange={() => toggleHeatColumn(column)}
                />
                {displayName(column, dictionary)}
              </label>
            ))}
            <button type="button" className="secondary" onClick={exportPng} disabled={!heatmap || loading}>
              导出 PNG
            </button>
          </div>

          {heatColumns.length < 2 ? (
            <div className="empty compact-empty">至少勾选两个数值列。</div>
          ) : loading ? (
            <div className="empty compact-empty">正在计算…</div>
          ) : error ? (
            <div className="empty compact-empty">{error}</div>
          ) : heatmap ? (
            <>
              <div className="rel-canvas rel-canvas-rich">
                <HeatmapChart data={heatmap} labelOf={(column) => displayName(column, dictionary)} svgRef={setChartRef} />
              </div>
              <CaptionBlock caption={heatmap.caption} />
              <WarningList warnings={heatmap.warnings} />
            </>
          ) : null}
        </>
      ) : null}

      {view === "histogram" ? (
        <>
          <div className="rel-controls">
            <label>
              变量
              <select value={histColumn} onChange={(event) => setHistColumn(event.target.value)}>
                {numericColumns.map((column) => (
                  <option key={column} value={column}>{displayName(column, dictionary)}</option>
                ))}
              </select>
            </label>
            <button type="button" className="secondary" onClick={exportPng} disabled={!histogram || loading}>
              导出 PNG
            </button>
          </div>
          {loading ? <div className="empty compact-empty">正在计算…</div> : null}
          {error ? <div className="empty compact-empty">{error}</div> : null}
          {histogram ? (
            <>
              <div className="rel-metrics">
                <span>n = {histogram.n}</span>
                <span>均值 = {histogram.mean == null ? "—" : histogram.mean.toFixed(3)}</span>
                <span>标准差 = {histogram.std == null ? "—" : histogram.std.toFixed(3)}</span>
              </div>
              <div className="rel-canvas rel-canvas-rich">
                <HistogramChart
                  data={histogram}
                  label={displayName(histogram.column, dictionary)}
                  svgRef={setChartRef}
                />
              </div>
              <CaptionBlock caption={histogram.caption} />
              <WarningList warnings={histogram.warnings} />
            </>
          ) : null}
        </>
      ) : null}

      {view === "boxplot" ? (
        <>
          <div className="rel-controls rel-controls-wrap">
            {numericColumns.map((column) => (
              <label key={column} className="rel-check">
                <input
                  type="checkbox"
                  checked={boxColumns.includes(column)}
                  onChange={() => toggleBoxColumn(column)}
                />
                {displayName(column, dictionary)}
              </label>
            ))}
            <button type="button" className="secondary" onClick={exportPng} disabled={!boxplot || loading}>
              导出 PNG
            </button>
          </div>
          {boxColumns.length < 1 ? (
            <div className="empty compact-empty">至少勾选一个数值列。</div>
          ) : loading ? (
            <div className="empty compact-empty">正在计算…</div>
          ) : error ? (
            <div className="empty compact-empty">{error}</div>
          ) : boxplot ? (
            <>
              <div className="rel-canvas rel-canvas-rich">
                <BoxplotChart data={boxplot} labelOf={(column) => displayName(column, dictionary)} svgRef={setChartRef} />
              </div>
              <CaptionBlock caption={boxplot.caption} />
              <WarningList warnings={boxplot.warnings} />
            </>
          ) : null}
        </>
      ) : null}

      {view === "category" ? (
        <>
          <div className="rel-controls">
            <label>
              分类变量
              <select value={categoryColumn} onChange={(event) => setCategoryColumn(event.target.value)}>
                {categoryColumns.map((column) => (
                  <option key={column} value={column}>{displayName(column, dictionary)}</option>
                ))}
              </select>
            </label>
            <button type="button" className="secondary" onClick={exportPng} disabled={!categoryBar || loading}>
              导出 PNG
            </button>
          </div>
          {loading ? <div className="empty compact-empty">正在计算…</div> : null}
          {error ? <div className="empty compact-empty">{error}</div> : null}
          {categoryBar ? (
            <>
              <div className="rel-metrics">
                <span>n = {categoryBar.n}</span>
                <span>类别数 = {categoryBar.unique}</span>
              </div>
              <div className="rel-canvas rel-canvas-rich">
                <CategoryBarChart
                  data={categoryBar}
                  label={displayName(categoryBar.column, dictionary)}
                  svgRef={setChartRef}
                />
              </div>
              <CaptionBlock caption={categoryBar.caption} />
              <WarningList warnings={categoryBar.warnings} />
            </>
          ) : null}
        </>
      ) : null}

      {notice ? <p className="note">{notice}</p> : null}
    </div>
  );
}

function formatP(value: number): string {
  if (value < 0.001) return "<0.001";
  return value.toFixed(3);
}

function WarningList({ warnings }: { warnings: string[] }) {
  if (!warnings.length) return null;
  return (
    <ul className="rel-warnings">
      {warnings.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function CaptionBlock({ caption }: { caption: { how_to_read: string; finding: string; caveat: string } }) {
  return (
    <div className="rel-caption">
      <div>
        <span>怎么读</span>
        <p>{caption.how_to_read}</p>
      </div>
      <div>
        <span>看到什么</span>
        <p>{caption.finding}</p>
      </div>
      <div>
        <span>注意什么</span>
        <p>{caption.caveat}</p>
      </div>
    </div>
  );
}

const SCATTER_WIDTH = 680;
const SCATTER_HEIGHT = 400;
const SCATTER_PAD = { left: 58, right: 24, top: 28, bottom: 56 };

function ScatterChart({
  data,
  xLabel,
  yLabel,
  svgRef
}: {
  data: ScatterResponse;
  xLabel: string;
  yLabel: string;
  svgRef: (node: SVGSVGElement | null) => void;
}) {
  const innerWidth = SCATTER_WIDTH - SCATTER_PAD.left - SCATTER_PAD.right;
  const innerHeight = SCATTER_HEIGHT - SCATTER_PAD.top - SCATTER_PAD.bottom;
  const [xMin, xMax] = extent(data.points.map((point) => point.x));
  const [yMin, yMax] = extent(data.points.map((point) => point.y));

  const scaleX = (value: number) => SCATTER_PAD.left + ((value - xMin) / (xMax - xMin)) * innerWidth;
  const scaleY = (value: number) => SCATTER_PAD.top + innerHeight - ((value - yMin) / (yMax - yMin)) * innerHeight;

  const xTicks = ticks(xMin, xMax, 5);
  const yTicks = ticks(yMin, yMax, 5);

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${SCATTER_WIDTH} ${SCATTER_HEIGHT}`}
      role="img"
      aria-label={`${xLabel} 与 ${yLabel} 的散点图`}
      className="rel-svg"
    >
      <title>{`${xLabel} 与 ${yLabel} 的散点图`}</title>
      <defs>
        <linearGradient id="scatter-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f4faf7" />
          <stop offset="100%" stopColor="#ffffff" />
        </linearGradient>
        <linearGradient id="scatter-fit" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#b45309" />
          <stop offset="100%" stopColor="#9f1239" />
        </linearGradient>
        <clipPath id="scatter-plot-area">
          <rect x={SCATTER_PAD.left} y={SCATTER_PAD.top} width={innerWidth} height={innerHeight} rx={8} />
        </clipPath>
      </defs>
      <rect x={0} y={0} width={SCATTER_WIDTH} height={SCATTER_HEIGHT} fill="url(#scatter-bg)" rx={10} />

      {yTicks.map((tick) => (
        <g key={`y-${tick}`}>
          <line
            x1={SCATTER_PAD.left}
            y1={scaleY(tick)}
            x2={SCATTER_PAD.left + innerWidth}
            y2={scaleY(tick)}
            stroke="#d7e5df"
            strokeWidth={1}
            strokeDasharray="3 4"
          />
          <text x={SCATTER_PAD.left - 8} y={scaleY(tick) + 4} textAnchor="end" fontSize={11} fill="#5f6b66">
            {formatTick(tick)}
          </text>
        </g>
      ))}
      {xTicks.map((tick) => (
        <g key={`x-${tick}`}>
          <text x={scaleX(tick)} y={SCATTER_PAD.top + innerHeight + 20} textAnchor="middle" fontSize={11} fill="#5f6b66">
            {formatTick(tick)}
          </text>
        </g>
      ))}

      <rect
        x={SCATTER_PAD.left}
        y={SCATTER_PAD.top}
        width={innerWidth}
        height={innerHeight}
        fill="none"
        stroke="#c5d8cf"
        strokeWidth={1.2}
        rx={8}
      />

      <g clipPath="url(#scatter-plot-area)">
        {data.points.map((point, index) => (
          <circle
            key={index}
            cx={scaleX(point.x)}
            cy={scaleY(point.y)}
            r={3.1}
            fill="#1f6f5b"
            fillOpacity={0.42}
            stroke="#0f513f"
            strokeOpacity={0.18}
            strokeWidth={0.8}
          />
        ))}
        {data.fit ? (
          <line
            x1={scaleX(xMin)}
            y1={scaleY(data.fit.slope * xMin + data.fit.intercept)}
            x2={scaleX(xMax)}
            y2={scaleY(data.fit.slope * xMax + data.fit.intercept)}
            stroke="url(#scatter-fit)"
            strokeWidth={2.4}
            strokeLinecap="round"
          />
        ) : null}
      </g>

      <text x={SCATTER_PAD.left + innerWidth / 2} y={SCATTER_HEIGHT - 12} textAnchor="middle" fontSize={12} fill="#1d2a25" fontWeight={700}>
        {xLabel}
      </text>
      <text
        transform={`translate(16 ${SCATTER_PAD.top + innerHeight / 2}) rotate(-90)`}
        textAnchor="middle"
        fontSize={12}
        fill="#1d2a25"
        fontWeight={700}
      >
        {yLabel}
      </text>
    </svg>
  );
}

function HeatmapChart({
  data,
  labelOf,
  svgRef
}: {
  data: CorrHeatmapResponse;
  labelOf: (column: string) => string;
  svgRef: (node: SVGSVGElement | null) => void;
}) {
  const cell = 62;
  const left = 150;
  const top = 72;
  const size = data.columns.length;
  const width = left + cell * size + 86;
  const height = top + cell * size + 18;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="相关系数热力图"
      className="rel-svg"
      style={{ maxWidth: `${width}px` }}
    >
      <title>相关系数热力图</title>
      <defs>
        <linearGradient id="heat-legend" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1d4f91" />
          <stop offset="50%" stopColor="#f4f4f2" />
          <stop offset="100%" stopColor="#9f1239" />
        </linearGradient>
      </defs>
      <rect x={0} y={0} width={width} height={height} fill="#fbfcfb" rx={10} />

      {data.columns.map((column, index) => (
        <text
          key={`col-${column}`}
          x={left + index * cell + cell / 2}
          y={top - 10}
          textAnchor="start"
          fontSize={11}
          fill="#1d2a25"
          fontWeight={600}
          transform={`rotate(-28 ${left + index * cell + cell / 2} ${top - 10})`}
        >
          {truncate(labelOf(column), 8)}
        </text>
      ))}

      {data.columns.map((rowColumn, row) => (
        <text
          key={`row-${rowColumn}`}
          x={left - 10}
          y={top + row * cell + cell / 2 + 4}
          textAnchor="end"
          fontSize={11}
          fill="#1d2a25"
          fontWeight={600}
        >
          {truncate(labelOf(rowColumn), 10)}
        </text>
      ))}

      {data.matrix.map((row, rowIndex) =>
        row.map((value, columnIndex) => {
          const x = left + columnIndex * cell;
          const y = top + rowIndex * cell;
          const n = data.n_matrix[rowIndex]?.[columnIndex] ?? 0;
          return (
            <g key={`cell-${rowIndex}-${columnIndex}`}>
              <rect
                x={x}
                y={y}
                width={cell - 4}
                height={cell - 4}
                rx={8}
                fill={correlationColor(value)}
                stroke="#ffffff"
                strokeWidth={1.5}
              >
                <title>{`${labelOf(data.columns[rowIndex])} × ${labelOf(data.columns[columnIndex])}：${
                  value === null ? "无法计算" : value.toFixed(3)
                }（n=${n}）`}</title>
              </rect>
              <text
                x={x + (cell - 4) / 2}
                y={y + (cell - 4) / 2 + 4}
                textAnchor="middle"
                fontSize={11}
                fontWeight={700}
                fill={value !== null && Math.abs(value) > 0.5 ? "#ffffff" : "#1d2a25"}
              >
                {value === null ? "—" : value.toFixed(2)}
              </text>
            </g>
          );
        })
      )}

      <rect x={width - 42} y={top} width={12} height={cell * size - 4} fill="url(#heat-legend)" rx={4} />
      <text x={width - 26} y={top + 8} fontSize={10} fill="#5f6b66">+1</text>
      <text x={width - 26} y={top + (cell * size) / 2} fontSize={10} fill="#5f6b66">0</text>
      <text x={width - 26} y={top + cell * size - 8} fontSize={10} fill="#5f6b66">-1</text>
    </svg>
  );
}

function HistogramChart({
  data,
  label,
  svgRef
}: {
  data: HistogramResponse;
  label: string;
  svgRef: (node: SVGSVGElement | null) => void;
}) {
  const width = 680;
  const height = 360;
  const pad = { left: 52, right: 20, top: 24, bottom: 52 };
  const innerWidth = width - pad.left - pad.right;
  const innerHeight = height - pad.top - pad.bottom;
  const maxCount = Math.max(1, ...data.bins.map((bin) => bin.count));
  const barWidth = innerWidth / Math.max(1, data.bins.length);

  return (
    <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label} 直方图`} className="rel-svg">
      <title>{`${label} 直方图`}</title>
      <defs>
        <linearGradient id="hist-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2f9e7d" />
          <stop offset="100%" stopColor="#1f6f5b" />
        </linearGradient>
      </defs>
      <rect x={0} y={0} width={width} height={height} fill="#f7fbf9" rx={10} />
      {ticks(0, maxCount, 4).map((tick) => (
        <g key={`h-${tick}`}>
          <line
            x1={pad.left}
            y1={pad.top + innerHeight - (tick / maxCount) * innerHeight}
            x2={pad.left + innerWidth}
            y2={pad.top + innerHeight - (tick / maxCount) * innerHeight}
            stroke="#d7e5df"
            strokeDasharray="3 4"
          />
          <text
            x={pad.left - 8}
            y={pad.top + innerHeight - (tick / maxCount) * innerHeight + 4}
            textAnchor="end"
            fontSize={11}
            fill="#5f6b66"
          >
            {Math.round(tick)}
          </text>
        </g>
      ))}
      {data.bins.map((bin, index) => {
        const barHeight = (bin.count / maxCount) * innerHeight;
        const x = pad.left + index * barWidth + 3;
        const y = pad.top + innerHeight - barHeight;
        return (
          <g key={`${bin.left}-${bin.right}`}>
            <rect x={x} y={y} width={Math.max(4, barWidth - 6)} height={barHeight} rx={5} fill="url(#hist-fill)">
              <title>{`[${bin.left}, ${bin.right}]：${bin.count}`}</title>
            </rect>
            {index % Math.ceil(data.bins.length / 6) === 0 ? (
              <text x={x + (barWidth - 6) / 2} y={height - 18} textAnchor="middle" fontSize={10} fill="#5f6b66">
                {formatTick(bin.left)}
              </text>
            ) : null}
          </g>
        );
      })}
      <text x={width / 2} y={height - 4} textAnchor="middle" fontSize={12} fill="#1d2a25" fontWeight={700}>
        {label}
      </text>
    </svg>
  );
}

function BoxplotChart({
  data,
  labelOf,
  svgRef
}: {
  data: BoxplotResponse;
  labelOf: (column: string) => string;
  svgRef: (node: SVGSVGElement | null) => void;
}) {
  const width = 680;
  const height = 360;
  const pad = { left: 48, right: 20, top: 28, bottom: 58 };
  const innerWidth = width - pad.left - pad.right;
  const innerHeight = height - pad.top - pad.bottom;
  const values = data.series.flatMap((item) =>
    [item.min, item.q1, item.median, item.q3, item.max, ...item.outliers].filter((value): value is number => value != null)
  );
  const [yMin, yMax] = extent(values.length ? values : [0, 1]);
  const scaleY = (value: number) => pad.top + innerHeight - ((value - yMin) / (yMax - yMin)) * innerHeight;
  const slot = innerWidth / Math.max(1, data.series.length);

  return (
    <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="箱线图" className="rel-svg">
      <title>箱线图</title>
      <rect x={0} y={0} width={width} height={height} fill="#fbfaf7" rx={10} />
      {ticks(yMin, yMax, 5).map((tick) => (
        <g key={`b-${tick}`}>
          <line
            x1={pad.left}
            y1={scaleY(tick)}
            x2={pad.left + innerWidth}
            y2={scaleY(tick)}
            stroke="#ebe4d6"
            strokeDasharray="3 4"
          />
          <text x={pad.left - 8} y={scaleY(tick) + 4} textAnchor="end" fontSize={11} fill="#5f6b66">
            {formatTick(tick)}
          </text>
        </g>
      ))}
      {data.series.map((item, index) => {
        if (item.median == null || item.q1 == null || item.q3 == null || item.min == null || item.max == null) {
          return null;
        }
        const cx = pad.left + slot * index + slot / 2;
        const boxWidth = Math.min(48, slot * 0.45);
        const color = PALETTE[index % PALETTE.length];
        return (
          <g key={item.column}>
            <line x1={cx} y1={scaleY(item.min)} x2={cx} y2={scaleY(item.max)} stroke={color} strokeWidth={1.6} />
            <line x1={cx - 10} y1={scaleY(item.min)} x2={cx + 10} y2={scaleY(item.min)} stroke={color} strokeWidth={1.6} />
            <line x1={cx - 10} y1={scaleY(item.max)} x2={cx + 10} y2={scaleY(item.max)} stroke={color} strokeWidth={1.6} />
            <rect
              x={cx - boxWidth / 2}
              y={scaleY(item.q3)}
              width={boxWidth}
              height={Math.max(2, scaleY(item.q1) - scaleY(item.q3))}
              fill={`${color}22`}
              stroke={color}
              strokeWidth={1.8}
              rx={4}
            />
            <line
              x1={cx - boxWidth / 2}
              y1={scaleY(item.median)}
              x2={cx + boxWidth / 2}
              y2={scaleY(item.median)}
              stroke={color}
              strokeWidth={2.2}
            />
            {item.outliers.slice(0, 20).map((value, outlierIndex) => (
              <circle key={`${item.column}-${outlierIndex}`} cx={cx} cy={scaleY(value)} r={2.6} fill={color} fillOpacity={0.55} />
            ))}
            <text x={cx} y={height - 18} textAnchor="middle" fontSize={11} fill="#1d2a25" fontWeight={700}>
              {truncate(labelOf(item.column), 8)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function CategoryBarChart({
  data,
  label,
  svgRef
}: {
  data: CategoryBarResponse;
  label: string;
  svgRef: (node: SVGSVGElement | null) => void;
}) {
  const width = 680;
  const height = Math.max(280, 70 + data.items.length * 34);
  const pad = { left: 120, right: 56, top: 20, bottom: 24 };
  const innerWidth = width - pad.left - pad.right;
  const maxCount = Math.max(1, ...data.items.map((item) => item.count));

  return (
    <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label} 分类柱状图`} className="rel-svg">
      <title>{`${label} 分类柱状图`}</title>
      <rect x={0} y={0} width={width} height={height} fill="#f8fafc" rx={10} />
      {data.items.map((item, index) => {
        const y = pad.top + index * 34;
        const barWidth = (item.count / maxCount) * innerWidth;
        const color = PALETTE[index % PALETTE.length];
        return (
          <g key={`${item.label}-${index}`}>
            <text x={pad.left - 10} y={y + 16} textAnchor="end" fontSize={11} fill="#1d2a25" fontWeight={600}>
              {truncate(item.label, 10)}
            </text>
            <rect x={pad.left} y={y + 4} width={Math.max(4, barWidth)} height={20} rx={6} fill={color} fillOpacity={0.85}>
              <title>{`${item.label}: ${item.count} (${(item.share * 100).toFixed(1)}%)`}</title>
            </rect>
            <text x={pad.left + barWidth + 8} y={y + 18} fontSize={11} fill="#5f6b66">
              {item.count}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function correlationColor(value: number | null): string {
  if (value === null) return "#eef1ef";
  const t = Math.min(1, Math.abs(value));
  if (value >= 0) {
    return `rgba(159, 18, 57, ${(0.12 + 0.72 * t).toFixed(3)})`;
  }
  return `rgba(29, 79, 145, ${(0.12 + 0.72 * t).toFixed(3)})`;
}

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function extent(values: number[]): [number, number] {
  if (!values.length) return [0, 1];
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    const delta = Math.abs(min) || 1;
    min -= delta;
    max += delta;
  }
  const padding = (max - min) * 0.05;
  return [min - padding, max + padding];
}

function ticks(min: number, max: number, count: number): number[] {
  if (count < 2) return [min];
  const step = (max - min) / (count - 1);
  return Array.from({ length: count }, (_, index) => min + step * index);
}

function formatTick(value: number): string {
  if (Math.abs(value) >= 1000) return value.toFixed(0);
  if (Math.abs(value) >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

/** 把 SVG 转成 PNG：先序列化，再用 canvas 放大 2 倍，保证导出清晰。 */
async function svgToPng(svg: SVGSVGElement, scale = 2): Promise<string> {
  const box = svg.viewBox.baseVal;
  const width = box.width || svg.clientWidth || 720;
  const height = box.height || svg.clientHeight || 380;

  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));

  const serialized = new XMLSerializer().serializeToString(clone);
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`;

  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("图表渲染失败，无法导出。"));
    image.src = url;
  });

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前环境不支持画布导出。");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}
