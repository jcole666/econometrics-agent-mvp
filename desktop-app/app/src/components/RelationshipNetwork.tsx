import type { RelationshipHint, VariableDictionary } from "../types";
import { displayName } from "../variableDictionary";

const SLOTS = [
  { x: 130, y: 78, labelY: 103 },
  { x: 62, y: 35, labelY: 18 },
  { x: 198, y: 35, labelY: 18 },
  { x: 62, y: 122, labelY: 147 },
  { x: 198, y: 122, labelY: 147 },
  { x: 130, y: 132, labelY: 154 }
];

export function RelationshipNetwork({
  hints,
  dictionary
}: {
  hints: RelationshipHint[];
  dictionary?: VariableDictionary | null;
}) {
  const names = Array.from(new Set(hints.flatMap((item) => [item.left, item.right]))).slice(0, 6);
  if (names.length < 2) return null;

  const positions = new Map(names.map((name, index) => [name, SLOTS[index]]));
  const edges = hints.filter((item) => positions.has(item.left) && positions.has(item.right));

  return (
    <div className="relationship-map" aria-label="变量关系地图">
      <svg viewBox="0 0 260 165" role="img">
        <title>变量关系地图</title>
        {edges.map((item) => {
          const left = positions.get(item.left)!;
          const right = positions.get(item.right)!;
          return (
            <line
              key={`${item.left}-${item.right}`}
              x1={left.x}
              y1={left.y}
              x2={right.x}
              y2={right.y}
              className={item.score >= 0 ? "relationship-edge-positive" : "relationship-edge-negative"}
              strokeWidth={Math.max(0.5, Math.min(2.8, Math.abs(item.score) * 2.4))}
            />
          );
        })}
        {names.map((name, index) => {
          const point = positions.get(name)!;
          const label = variableLabelParts(displayName(name, dictionary));
          return (
            <g className={index === 0 ? "relationship-node relationship-node-main" : "relationship-node"} key={name}>
              <title>{name}</title>
              <circle cx={point.x} cy={point.y} r={index === 0 ? 14 : 12} />
              <text x={point.x} y={point.labelY} textAnchor="middle">
                {label.map((part, lineIndex) => (
                  <tspan x={point.x} dy={lineIndex === 0 ? 0 : 9} key={`${name}-${lineIndex}`}>
                    {part}
                  </tspan>
                ))}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="relationship-map-note">
        <strong>{displayName(names[0], dictionary)}</strong>
        <span>与 {names.length - 1} 个变量形成明显连接</span>
      </div>
    </div>
  );
}

function variableLabelParts(name: string): string[] {
  const clean = name.replace(/\s+/g, "_");
  if (clean.length <= 16) return [clean];

  const parts = clean.split("_").filter(Boolean);
  if (parts.length <= 1) return [shortVariableName(clean, 18)];

  const lines: string[] = [];
  parts.forEach((part) => {
    const last = lines[lines.length - 1];
    if (!last || `${last}_${part}`.length > 16) {
      lines.push(part);
    } else {
      lines[lines.length - 1] = `${last}_${part}`;
    }
  });

  return lines.slice(0, 2).map((line, index) => (
    index === 1 && lines.length > 2 ? shortVariableName(line, 14) : shortVariableName(line, 16)
  ));
}

function shortVariableName(name: string, maxLength = 18): string {
  return name.length > maxLength ? `${name.slice(0, Math.max(1, maxLength - 3))}...` : name;
}
