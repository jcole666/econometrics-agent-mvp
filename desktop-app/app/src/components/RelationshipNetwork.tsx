import type { RelationshipHint, VariableDictionary } from "../types";
import { displayName } from "../variableDictionary";

const SLOTS = [
  { x: 180, y: 118, labelY: 148 },
  { x: 78, y: 52, labelY: 30 },
  { x: 282, y: 52, labelY: 30 },
  { x: 58, y: 168, labelY: 196 },
  { x: 302, y: 168, labelY: 196 },
  { x: 180, y: 198, labelY: 226 }
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
      <svg viewBox="0 0 360 250" role="img">
        <title>变量关系地图</title>
        <defs>
          <radialGradient id="network-bg" cx="50%" cy="45%" r="65%">
            <stop offset="0%" stopColor="#e8f5ef" />
            <stop offset="100%" stopColor="#f7f7f5" />
          </radialGradient>
          <filter id="node-shadow" x="-40%" y="-40%" width="180%" height="180%">
            <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="#1f6f5b" floodOpacity="0.18" />
          </filter>
        </defs>
        <rect x="0" y="0" width="360" height="250" fill="url(#network-bg)" rx="12" />
        {edges.map((item) => {
          const left = positions.get(item.left)!;
          const right = positions.get(item.right)!;
          const positive = item.score >= 0;
          return (
            <line
              key={`${item.left}-${item.right}`}
              x1={left.x}
              y1={left.y}
              x2={right.x}
              y2={right.y}
              stroke={positive ? "#1f6f5b" : "#9f1239"}
              strokeOpacity={0.35 + Math.min(0.5, Math.abs(item.score))}
              strokeWidth={Math.max(1.2, Math.min(4.2, Math.abs(item.score) * 3.2))}
              strokeLinecap="round"
            />
          );
        })}
        {names.map((name, index) => {
          const point = positions.get(name)!;
          const label = variableLabelParts(displayName(name, dictionary));
          const main = index === 0;
          return (
            <g key={name} filter="url(#node-shadow)">
              <title>{name}</title>
              <circle
                cx={point.x}
                cy={point.y}
                r={main ? 18 : 14}
                fill={main ? "#1f6f5b" : "#ffffff"}
                stroke={main ? "#0f513f" : "#1f6f5b"}
                strokeWidth={main ? 0 : 1.8}
              />
              <text
                x={point.x}
                y={point.labelY}
                textAnchor="middle"
                fontSize={11}
                fill="#1d2a25"
                fontWeight={700}
              >
                {label.map((part, lineIndex) => (
                  <tspan x={point.x} dy={lineIndex === 0 ? 0 : 11} key={`${name}-${lineIndex}`}>
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
