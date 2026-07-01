from __future__ import annotations

from pydantic import BaseModel, Field


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


class ReportRequest(BaseModel):
    research_question: str
    model_type: str
    model_results: dict | None = None
    inference_notes: str | None = None
    llm_config: LLMConfig | None = None


class ReportResponse(BaseModel):
    markdown: str
