import type { ModelRunCompareResponse, ModelRunRecord, VariableDictionary } from "../types";
import { displayName } from "../variableDictionary";

interface CoefficientDiff {
  variable: string;
  left_coefficient: number | null;
  right_coefficient: number | null;
  delta: number | null;
  left_p_value: number | null;
  right_p_value: number | null;
}

interface MetricPair {
  left: number | null;
  right: number | null;
  delta?: number | null;
}

interface MetricsDiff {
  sample_size?: MetricPair;
  r_squared?: MetricPair;
  r_squared_adjusted?: MetricPair;
  coefficients?: CoefficientDiff[];
}

interface Props {
  comparison: ModelRunCompareResponse;
  left: ModelRunRecord | null;
  right: ModelRunRecord | null;
  dictionary: VariableDictionary | null;
}

const FIELD_LABELS: Record<string, string> = {
  dependent_variable: "被解释变量",
  entity_column: "个体列",
  time_column: "时间列",
  treatment_column: "处理列",
  running_variable: "断点变量",
  instrument_variable: "工具变量",
  added_independent_variables: "新增解释变量",
  removed_independent_variables: "移除解释变量"
};

export function ModelRunCompare({ comparison, left, right, dictionary }: Props) {
  const metrics = (comparison.metrics_diff ?? {}) as MetricsDiff;
  const configEntries = Object.entries(comparison.config_diff ?? {});

  return (
    <div className="run-compare">
      <div className="run-compare-head">
        <strong>
          {left?.version_id ?? "左"} ↔ {right?.version_id ?? "右"}
        </strong>
        <span className={comparison.comparable ? "vdict-badge vdict-badge-ok" : "vdict-badge"}>
          {comparison.comparable ? "可比：同模型同数据" : "不可比"}
        </span>
      </div>

      {!comparison.comparable ? (
        <p className="explain-error">
          {comparison.incomparable_reason ?? "两个版本不可比"}。下面只列配置差异，不计算变化幅度。
        </p>
      ) : null}

      <div className="run-compare-block">
        <span className="run-compare-title">配置差异</span>
        {configEntries.length === 0 ? (
          <p className="note">两次运行的模型设定完全相同，差异只来自数据或结果本身。</p>
        ) : (
          <ul className="run-compare-list">
            {configEntries.map(([key, value]) => (
              <li key={key}>
                <strong>{FIELD_LABELS[key] ?? key}</strong>
                <span>{describeValue(value, dictionary)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {comparison.comparable ? (
        <>
          <div className="run-compare-block">
            <span className="run-compare-title">拟合指标</span>
            <table className="run-compare-table">
              <thead>
                <tr>
                  <th>指标</th>
                  <th>{left?.version_id ?? "左"}</th>
                  <th>{right?.version_id ?? "右"}</th>
                  <th>差值</th>
                </tr>
              </thead>
              <tbody>
                <MetricRow label="样本量" pair={metrics.sample_size} digits={0} />
                <MetricRow label="R²" pair={metrics.r_squared} digits={4} />
                <MetricRow label="调整后 R²" pair={metrics.r_squared_adjusted} digits={4} />
              </tbody>
            </table>
          </div>

          {metrics.coefficients?.length ? (
            <div className="run-compare-block">
              <span className="run-compare-title">系数变化</span>
              <table className="run-compare-table">
                <thead>
                  <tr>
                    <th>变量</th>
                    <th>{left?.version_id ?? "左"}</th>
                    <th>{right?.version_id ?? "右"}</th>
                    <th>差值</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.coefficients.map((item) => (
                    <tr key={item.variable}>
                      <td title={item.variable}>{displayName(item.variable, dictionary)}</td>
                      <td>{formatNumber(item.left_coefficient, 4)}</td>
                      <td>{formatNumber(item.right_coefficient, 4)}</td>
                      <td>{formatDelta(item.delta)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      ) : null}

      <div className="run-compare-block">
        <span className="run-compare-title">解读对照</span>
        <div className="run-compare-explain">
          <ExplainSummary title={left?.version_id ?? "左"} explanation={comparison.explanations?.left ?? null} />
          <ExplainSummary title={right?.version_id ?? "右"} explanation={comparison.explanations?.right ?? null} />
        </div>
      </div>
    </div>
  );
}

function MetricRow({ label, pair, digits }: { label: string; pair?: MetricPair; digits: number }) {
  if (!pair) return null;
  return (
    <tr>
      <td>{label}</td>
      <td>{formatNumber(pair.left, digits)}</td>
      <td>{formatNumber(pair.right, digits)}</td>
      <td>{formatDelta(pair.delta, digits)}</td>
    </tr>
  );
}

function ExplainSummary({
  title,
  explanation
}: {
  title: string;
  explanation: { status: string; sections: { key_findings: string } | null } | null;
}) {
  if (!explanation?.sections) {
    return (
      <div className="run-compare-explain-card">
        <strong>{title}</strong>
        <p className="note">该版本没有解读。</p>
      </div>
    );
  }
  return (
    <div className="run-compare-explain-card">
      <strong>{title}</strong>
      <p>{explanation.sections.key_findings}</p>
    </div>
  );
}

function describeValue(value: unknown, dictionary: VariableDictionary | null): string {
  if (Array.isArray(value)) {
    return value.map((item) => displayName(String(item), dictionary)).join("、") || "—";
  }
  if (value && typeof value === "object" && "left" in value && "right" in value) {
    const pair = value as { left: unknown; right: unknown };
    return `${formatScalar(pair.left, dictionary)} → ${formatScalar(pair.right, dictionary)}`;
  }
  return formatScalar(value, dictionary);
}

function formatScalar(value: unknown, dictionary: VariableDictionary | null): string {
  if (value === null || value === undefined || value === "") return "空";
  return displayName(String(value), dictionary);
}

function formatNumber(value: number | null | undefined, digits: number): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toFixed(digits);
}

function formatDelta(value: number | null | undefined, digits = 4): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const rounded = Math.abs(value) < 1e-12 ? 0 : value;
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded.toFixed(digits)}`;
}
