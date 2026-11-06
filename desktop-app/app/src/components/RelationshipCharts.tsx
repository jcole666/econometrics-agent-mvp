import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { fetchCorrHeatmap, fetchScatter } from "../api";
import { saveChartImage } from "../reportExport";
import type { CorrHeatmapResponse, DataProfile, ScatterResponse, VariableDictionary } from "../types";
import { displayName } from "../variableDictionary";
import { RelationshipNetwork } from "./RelationshipNetwork";

type ChartView = "network" | "scatter" | "heatmap";

const VIEWS: { value: ChartView; label: string }[] = [
  { value: "network", label: "关系网络" },
  { value: "scatter", label: "散点 + 拟合" },
  { value: "heatmap", label: "相关热力图" }
];

interface Props {
  file: File | null;
  profile: DataProfile;
  dictionary: VariableDictionary | null;
}

export function RelationshipCharts({ file, profile, dictionary }: Props) {
  const numericColumns = useMemo(
    () => profile.columns.filter((column) => column.kind === "数值").map((column) => column.name),
    [profile]
  );
  const hints = profile.diagnostics?.relationship_hints ?? [];

  const [view, setView] = useState<ChartView>("network");
  const [xColumn, setXColumn] = useState(numericColumns[0] ?? "");
  const [yColumn, setYColumn] = useState(numericColumns[1] ?? numericColumns[0] ?? "");
  const [heatColumns, setHeatColumns] = useState<string[]>(numericColumns.slice(0, 4));
  const [scatter, setScatter] = useState<ScatterResponse | null>(null);
  const [heatmap, setHeatmap] = useState<CorrHeatmapResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const chartRef = useRef<SVGSVGElement | null>(null);
  const setChartRef = useCallback((node: SVGSVGElement | null) => {
    chartRef.current = node;
  }, []);

  useEffect(() => {
    setXColumn((current) => (numericColumns.includes(current) ? current : numericColumns[0] ?? ""));
    setYColumn((current) =>
      numericColumns.includes(current) ? current : numericColumns[1] ?? numericColumns[0] ?? ""
    );
    setHeatColumns((current) => {
      const kept = current.filter((column) => numericColumns.includes(column));
      return kept.length >= 2 ? kept : numericColumns.slice(0, 4);
    });
  }, [numericColumns.join("|")]);

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

  function toggleHeatColumn(column: string) {
    setHeatColumns((current) => {
      if (current.includes(column)) return current.filter((item) => item !== column);
      if (current.length >= 8) return current;
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
      const base = view === "scatter" ? `${xColumn}_${yColumn}` : "相关系数热力图";
      setNotice(await saveChartImage(`${base}.png`, dataUrl));
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "图片导出失败。");
    }
  }

  if (numericColumns.length === 0) {
    return <div className="empty compact-empty">这份数据没有数值列，无法画散点或热力图。</div>;
  }

  return (
    <div className="rel-charts">
      <div className="rel-tabs" role="tablist">
        {VIEWS.map((item) => (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={view === item.value}
            className={view === item.value ? "rel-tab rel-tab-active" : "rel-tab"}
            onClick={() => {
              setView(item.value);
              setNotice(null);
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
              <div className="rel-canvas">
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
              <div className="rel-canvas">
                <HeatmapChart data={heatmap} labelOf={(column) => displayName(column, dictionary)} svgRef={setChartRef} />
              </div>
              <CaptionBlock caption={heatmap.caption} />
              <WarningList warnings={heatmap.warnings} />
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

const SCATTER_WIDTH = 660;
const SCATTER_HEIGHT = 380;
const SCATTER_PAD = { left: 62, right: 20, top: 20, bottom: 52 };

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
      <rect x={0} y={0} width={SCATTER_WIDTH} height={SCATTER_HEIGHT} fill="#ffffff" />

      {yTicks.map((tick) => (
        <g key={`y-${tick}`}>
          <line
            x1={SCATTER_PAD.left}
            y1={scaleY(tick)}
            x2={SCATTER_PAD.left + innerWidth}
            y2={scaleY(tick)}
            stroke="#ececea"
            strokeWidth={1}
          />
          <text x={SCATTER_PAD.left - 8} y={scaleY(tick) + 4} textAnchor="end" fontSize={11} fill="#6b6b66">
            {formatTick(tick)}
          </text>
        </g>
      ))}
      {xTicks.map((tick) => (
        <g key={`x-${tick}`}>
          <line
            x1={scaleX(tick)}
            y1={SCATTER_PAD.top}
            x2={scaleX(tick)}
            y2={SCATTER_PAD.top + innerHeight}
            stroke="#ececea"
            strokeWidth={1}
          />
          <text x={scaleX(tick)} y={SCATTER_PAD.top + innerHeight + 18} textAnchor="middle" fontSize={11} fill="#6b6b66">
            {formatTick(tick)}
          </text>
        </g>
      ))}

      <line
        x1={SCATTER_PAD.left}
        y1={SCATTER_PAD.top + innerHeight}
        x2={SCATTER_PAD.left + innerWidth}
        y2={SCATTER_PAD.top + innerHeight}
        stroke="#c8c8c3"
        strokeWidth={1}
      />
      <line
        x1={SCATTER_PAD.left}
        y1={SCATTER_PAD.top}
        x2={SCATTER_PAD.left}
        y2={SCATTER_PAD.top + innerHeight}
        stroke="#c8c8c3"
        strokeWidth={1}
      />

      <defs>
        <clipPath id="scatter-plot-area">
          <rect
            x={SCATTER_PAD.left}
            y={SCATTER_PAD.top}
            width={innerWidth}
            height={innerHeight}
          />
        </clipPath>
      </defs>

      <g clipPath="url(#scatter-plot-area)">
        {data.points.map((point, index) => (
          <circle
            key={index}
            cx={scaleX(point.x)}
            cy={scaleY(point.y)}
            r={2.4}
            fill="#3d3d3a"
            fillOpacity={0.5}
          />
        ))}
        {data.fit ? (
          <line
            x1={scaleX(xMin)}
            y1={scaleY(data.fit.slope * xMin + data.fit.intercept)}
            x2={scaleX(xMax)}
            y2={scaleY(data.fit.slope * xMax + data.fit.intercept)}
            stroke="#b42318"
            strokeWidth={1.8}
          />
        ) : null}
      </g>

      <text x={SCATTER_PAD.left + innerWidth / 2} y={SCATTER_HEIGHT - 10} textAnchor="middle" fontSize={12} fill="#202123">
        {xLabel}
      </text>
      <text
        transform={`translate(16 ${SCATTER_PAD.top + innerHeight / 2}) rotate(-90)`}
        textAnchor="middle"
        fontSize={12}
        fill="#202123"
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
  const cell = 58;
  const left = 148;
  const top = 64;
  const size = data.columns.length;
  const width = left + cell * size + 16;
  const height = top + cell * size + 14;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="相关系数热力图"
      className="rel-svg"
    >
      <title>相关系数热力图</title>
      <rect x={0} y={0} width={width} height={height} fill="#ffffff" />

      {data.columns.map((column, index) => (
        <text
          key={`col-${column}`}
          x={left + index * cell + cell / 2}
          y={top - 8}
          textAnchor="start"
          fontSize={11}
          fill="#202123"
          transform={`rotate(-32 ${left + index * cell + cell / 2} ${top - 8})`}
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
          fill="#202123"
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
                width={cell - 2}
                height={cell - 2}
                fill={correlationColor(value)}
                stroke="#ffffff"
                strokeWidth={1}
              >
                <title>{`${labelOf(data.columns[rowIndex])} × ${labelOf(data.columns[columnIndex])}：${
                  value === null ? "无法计算" : value.toFixed(3)
                }（n=${n}）`}</title>
              </rect>
              <text
                x={x + (cell - 2) / 2}
                y={y + (cell - 2) / 2 + 4}
                textAnchor="middle"
                fontSize={11}
                fill={value !== null && Math.abs(value) > 0.55 ? "#ffffff" : "#202123"}
              >
                {value === null ? "—" : value.toFixed(2)}
              </text>
            </g>
          );
        })
      )}
    </svg>
  );
}

function correlationColor(value: number | null): string {
  if (value === null) return "#f4f4f2";
  const alpha = 0.08 + 0.62 * Math.min(1, Math.abs(value));
  return value >= 0 ? `rgba(180, 35, 24, ${alpha.toFixed(3)})` : `rgba(45, 90, 140, ${alpha.toFixed(3)})`;
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
