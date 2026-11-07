import type { ModelExplanation } from "../types";

const SECTIONS: { key: keyof NonNullable<ModelExplanation["sections"]>; index: string; title: string }[] = [
  { key: "model_and_question", index: "①", title: "模型与研究问题" },
  { key: "key_findings", index: "②", title: "核心发现" },
  { key: "stats_explained", index: "③", title: "统计量解释" },
  { key: "reliability_limits", index: "④", title: "可靠性与边界" },
  { key: "next_steps", index: "⑤", title: "下一步建议" }
];

interface Props {
  explanation: ModelExplanation | null;
  loading: boolean;
  onRegenerate: () => void;
}

export function ExplanationCard({ explanation, loading, onRegenerate }: Props) {
  const isFallback = explanation?.status === "fallback" || explanation?.status === "failed";
  const sections = explanation?.sections;

  return (
    <div className="explain-card">
      <div className="explain-head">
        <div>
          <strong>结构化解读</strong>
          {explanation ? (
            <span className={isFallback ? "explain-badge explain-badge-fallback" : "explain-badge"}>
              {explanation.status === "completed" ? `AI 解读 · ${providerText(explanation.provider)}` : "本地基础解释"}
            </span>
          ) : null}
        </div>
        <button type="button" className="secondary" onClick={onRegenerate} disabled={loading}>
          {loading ? "生成中…" : explanation ? "重新生成" : "生成解读"}
        </button>
      </div>

      {!explanation && !loading ? (
        <p className="note">
          用研究问题 + 变量字典 + 本次回归结果生成五段解读。数字全部来自左侧结果表，模型写错会被校验拦下。
        </p>
      ) : null}

      {loading && !explanation ? <p className="note">正在组织解读…</p> : null}

      {isFallback && explanation?.error ? (
        <p className="explain-error">当前为本地基础解释：{explanation.error}</p>
      ) : null}

      {sections ? (
        <div className="explain-sections">
          {SECTIONS.map((section) => (
            <section key={section.key}>
              <span>
                {section.index} {section.title}
              </span>
              <p>{sections[section.key]}</p>
            </section>
          ))}
        </div>
      ) : null}

      {explanation?.cited_values?.length ? (
        <p className="note">
          已核对 {explanation.cited_values.length} 处数字与结果表一致
          {isFallback ? "（本次为模板生成）" : ""}。
        </p>
      ) : null}
    </div>
  );
}

function providerText(provider: string): string {
  if (provider === "custom_model") return "自定义模型";
  if (provider === "huawei_maas") return "华为云 MaaS";
  if (provider === "rules") return "本地规则";
  return provider;
}
