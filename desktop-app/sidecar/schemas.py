from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


def _now_iso() -> str:
    """带本地时区偏移的 ISO-8601 时间串，便于前端直接展示。"""
    return datetime.now().astimezone().isoformat(timespec="seconds")


class LLMConfig(BaseModel):
    enabled: bool | None = Field(None, description="Whether model calls are enabled for this request.")
    api_key: str | None = Field(None, description="Temporary API key for this request.")
    base_url: str | None = Field(None, description="OpenAI-compatible API base URL.")
    model: str | None = Field(None, description="Model name.")
    timeout: float | None = Field(None, description="Request timeout in seconds.")


class ModelRequest(BaseModel):
    research_question: str
    columns: list[str]
    dependent_variable: str | None = None
    independent_variables: list[str] = Field(default_factory=list)
    entity_column: str | None = None
    time_column: str | None = None
    treatment_column: str | None = None
    running_variable: str | None = None
    instrument_variable: str | None = None
    policy_period: float | None = Field(None, description="DID 政策实施年份；为空时模板保留 TODO 占位。")
    cutoff: float | None = Field(None, description="RDD 断点；为空时按 0 处理。")
    bandwidth: float | None = Field(None, description="RDD 带宽；为空时退化为 running 变量标准差。")
    llm_config: LLMConfig | None = None


class ModelRecommendation(BaseModel):
    model: str
    reason: str
    required_checks: list[str]
    generated_code: str
    provider: str = "rules"
    maas_used: bool = False
    maas_error: str | None = None
    maas_note: str | None = None


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatContext(BaseModel):
    data_columns: list[str] = Field(default_factory=list)
    data_summary: str | None = None
    variable_settings: dict | None = None
    relationship_hints: list[dict] = Field(default_factory=list)
    research_path: dict | None = None
    recommended_model: str | None = None
    generated_code: str | None = None
    model_results: dict | None = None


class ChatRequest(BaseModel):
    message: str
    history: list[ChatMessage] = Field(default_factory=list)
    context: ChatContext | None = None
    llm_config: LLMConfig | None = None


class ChatResponse(BaseModel):
    reply: str
    provider: str = "rules"
    maas_error: str | None = None


class ColumnInfo(BaseModel):
    name: str
    dtype: str | None = None
    sample_values: list[str] = Field(default_factory=list)


class InferVariablesRequest(BaseModel):
    research_question: str
    columns: list[ColumnInfo]
    llm_config: LLMConfig | None = None


class InferVariablesResponse(BaseModel):
    dependent_variable: str | None = None
    independent_variables: list[str] = Field(default_factory=list)
    entity_column: str | None = None
    time_column: str | None = None
    treatment_column: str | None = None
    running_variable: str | None = None
    instrument_variable: str | None = None
    reasoning: str
    provider: str = "rules"
    maas_error: str | None = None


class CoefficientResult(BaseModel):
    variable: str
    coefficient: float | None = None
    std_error: float | None = None
    t_statistic: float | None = None
    p_value: float | None = None
    ci_lower: float | None = None
    ci_upper: float | None = None


class ModelRunResults(BaseModel):
    sample_size: int
    r_squared: float | None = None
    r_squared_adjusted: float | None = None
    f_statistic: float | None = None
    f_pvalue: float | None = None
    log_likelihood: float | None = None
    coefficients: list[CoefficientResult]


class RunModelResponse(BaseModel):
    model_type: str
    success: bool
    results: ModelRunResults | None = None
    warnings: list[str] = Field(default_factory=list)
    error: str | None = None
    execution_status: str = Field("executed", description="executed=已真实估计；planned=仅提供代码方案")
    code_template: str | None = Field(None, description="未能真实运行时给出的可运行代码模板")


class ReportRequest(BaseModel):
    research_question: str
    model_type: str
    model_results: dict | None = None
    inference_notes: str | None = None
    llm_config: LLMConfig | None = None


class ReportResponse(BaseModel):
    markdown: str


# ---------------------------------------------------------------------------
# 变量字典：与「建模角色推断」(/infer-variables) 并存，只描述列的语义元数据。
# 字段名冻结，后续阶段只增不改名。
# ---------------------------------------------------------------------------


class VariableDictEntry(BaseModel):
    column: str
    label: str | None = None
    description: str | None = None
    type: str = Field("unknown", description="numeric/category/binary/datetime/text/unknown")
    unit: str | None = None
    value_labels: dict[str, str] = Field(default_factory=dict)
    confidence: float | None = None
    confirmed: bool = False
    source: str = Field("ai", description="ai/user/mixed")
    updated_at: str = Field(default_factory=lambda: _now_iso())


class VariableDictionary(BaseModel):
    dataset_id: str
    dataset_hash: str = ""
    entries: dict[str, VariableDictEntry] = Field(default_factory=dict)
    version: int = 1


class VariableDictInferRequest(BaseModel):
    research_question: str = ""
    dataset_id: str
    dataset_hash: str = ""
    columns: list[dict] = Field(default_factory=list)
    existing: VariableDictionary | None = None
    llm_config: LLMConfig | None = None


class VariableDictInferResponse(BaseModel):
    dictionary: VariableDictionary
    provider: str = "rules"
    maas_error: str | None = None


class VariableDictPatchItem(BaseModel):
    column: str
    before: dict = Field(default_factory=dict)
    after: dict = Field(default_factory=dict)
    op: str = Field("update", description="update/confirm")


class VariableDictPatchPreviewRequest(BaseModel):
    message: str
    dictionary: VariableDictionary
    llm_config: LLMConfig | None = None


class VariableDictPatchPreviewResponse(BaseModel):
    preview: list[VariableDictPatchItem] = Field(default_factory=list)
    assistant_summary: str = ""
    provider: str = "rules"
    maas_error: str | None = None


class VariableDictConfirmRequest(BaseModel):
    dataset_id: str
    dataset_hash: str = ""
    patches: list[VariableDictPatchItem] = Field(default_factory=list)
    dictionary: VariableDictionary


class VariableDictConfirmResponse(BaseModel):
    dictionary: VariableDictionary


# ---------------------------------------------------------------------------
# 结构化模型解读
# ---------------------------------------------------------------------------


class ExplanationSections(BaseModel):
    model_and_question: str = ""
    key_findings: str = ""
    stats_explained: str = ""
    reliability_limits: str = ""
    next_steps: str = ""


class CitedValue(BaseModel):
    path: str
    value: float | str


class ModelExplanation(BaseModel):
    status: str = Field("pending", description="pending/completed/failed/fallback")
    revision: int = 1
    research_question: str = ""
    sections: ExplanationSections | None = None
    cited_values: list[CitedValue] = Field(default_factory=list)
    provider: str = "rules"
    error: str | None = None
    created_at: str = Field(default_factory=lambda: _now_iso())


class ExplainVariable(BaseModel):
    column: str
    label: str | None = None
    unit: str | None = None


class ExplainVariables(BaseModel):
    dependent: ExplainVariable | None = None
    independent: list[ExplainVariable] = Field(default_factory=list)
    controls: list[str] = Field(default_factory=list)


class ExplainModelRequest(BaseModel):
    research_question: str
    model: str
    variables: ExplainVariables = Field(default_factory=ExplainVariables)
    model_results: ModelRunResults
    diagnostics: dict | None = None
    llm_config: LLMConfig | None = None


# ---------------------------------------------------------------------------
# 模型运行版本
# ---------------------------------------------------------------------------


class ModelRunConfig(BaseModel):
    dependent_variable: str
    independent_variables: list[str] = Field(default_factory=list)
    entity_column: str | None = None
    time_column: str | None = None
    treatment_column: str | None = None
    running_variable: str | None = None
    instrument_variable: str | None = None


class ModelRunRecord(BaseModel):
    version_id: str
    parent_id: str | None = None
    created_at: str = Field(default_factory=lambda: _now_iso())
    research_question: str = ""
    dataset_id: str
    dataset_hash: str = ""
    variable_dictionary_snapshot: VariableDictionary | None = None
    model: str = "OLS"
    config: ModelRunConfig
    result: RunModelResponse
    diagnostics: dict = Field(default_factory=dict)
    ai_explanation: ModelExplanation | None = None


class ModelRunCreateRequest(BaseModel):
    parent_id: str | None = None
    research_question: str = ""
    dataset_id: str
    dataset_hash: str = ""
    variable_dictionary_snapshot: VariableDictionary | None = None
    model: str = "OLS"
    config: ModelRunConfig
    result: RunModelResponse
    diagnostics: dict | None = None
    ai_explanation: ModelExplanation | None = None


class ModelRunListResponse(BaseModel):
    runs: list[ModelRunRecord] = Field(default_factory=list)


class ModelRunCompareRequest(BaseModel):
    left_id: str
    right_id: str
    dataset_id: str


class ModelRunCompareResponse(BaseModel):
    comparable: bool
    incomparable_reason: str | None = None
    config_diff: dict = Field(default_factory=dict)
    metrics_diff: dict = Field(default_factory=dict)
    explanations: dict = Field(default_factory=dict)
    ai_diff_summary: str | None = None


# ---------------------------------------------------------------------------
# 关系图数据（数字只能来自 Python）
# ---------------------------------------------------------------------------


class ChartCaption(BaseModel):
    how_to_read: str = ""
    finding: str = ""
    caveat: str = ""


class ScatterPoint(BaseModel):
    x: float
    y: float


class ScatterFit(BaseModel):
    slope: float
    intercept: float


class ScatterResponse(BaseModel):
    x: str
    y: str
    points: list[ScatterPoint] = Field(default_factory=list)
    fit: ScatterFit | None = None
    r: float | None = None
    p_value: float | None = None
    n: int = 0
    warnings: list[str] = Field(default_factory=list)
    caption: ChartCaption = Field(default_factory=ChartCaption)


class CorrHeatmapResponse(BaseModel):
    columns: list[str] = Field(default_factory=list)
    matrix: list[list[float | None]] = Field(default_factory=list)
    n_matrix: list[list[int]] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    caption: ChartCaption = Field(default_factory=ChartCaption)
