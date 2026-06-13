from pydantic import BaseModel, Field


class ModelRequest(BaseModel):
    research_question: str = Field(
        ...,
        description="用户输入的自然语言研究问题",
        examples=["教育水平和工作经验是否影响收入"],
    )
    columns: list[str] = Field(
        ...,
        description="数据表中的字段名列表",
        examples=[["income", "education", "experience", "gender"]],
    )
    dependent_variable: str | None = Field(
        None,
        description="被解释变量 Y",
        examples=["income"],
    )
    independent_variables: list[str] = Field(
        default_factory=list,
        description="解释变量 X 列表",
        examples=[["education", "experience", "gender"]],
    )
    entity_column: str | None = Field(None, description="面板数据中的个体 ID 列")
    time_column: str | None = Field(None, description="时间列或政策后变量列")
    treatment_column: str | None = Field(None, description="处理组变量或内生解释变量")
    running_variable: str | None = Field(None, description="RDD 中的断点运行变量")
    instrument_variable: str | None = Field(None, description="IV-2SLS 中的工具变量")


class ModelRecommendation(BaseModel):
    model: str = Field(..., description="系统推荐的计量模型")
    reason: str = Field(..., description="推荐该模型的理由")
    required_checks: list[str] = Field(..., description="建模前需要检查的事项")
    generated_code: str = Field(..., description="Python 代码模板")
    provider: str = Field("rules", description="推荐来源：rules 或 huawei_maas")
    maas_used: bool = Field(False, description="本次推荐是否成功调用华为云 MaaS")
    maas_error: str | None = Field(None, description="MaaS 未启用或调用失败时的提示")
    maas_note: str | None = Field(None, description="MaaS 返回的补充说明")


class ChatMessage(BaseModel):
    role: str = Field(..., description="消息角色：user 或 assistant")
    content: str = Field(..., description="消息内容")


class ChatContext(BaseModel):
    data_columns: list[str] = Field(default_factory=list, description="当前数据字段")
    recommended_model: str | None = Field(None, description="当前推荐模型")
    generated_code: str | None = Field(None, description="当前生成代码")
    model_results: dict | None = Field(None, description="当前模型运行结果")


class ChatRequest(BaseModel):
    message: str = Field(..., description="用户本轮提问")
    history: list[ChatMessage] = Field(default_factory=list, description="历史对话")
    context: ChatContext | None = Field(None, description="当前分析上下文")


class ChatResponse(BaseModel):
    reply: str = Field(..., description="助手回复")
    provider: str = Field("rules", description="回复来源：rules 或 huawei_maas")
    maas_error: str | None = Field(None, description="MaaS 未启用或调用失败时的提示")


class ColumnInfo(BaseModel):
    name: str = Field(..., description="字段名")
    dtype: str | None = Field(None, description="字段类型")
    sample_values: list[str] = Field(default_factory=list, description="样例值")


class InferVariablesRequest(BaseModel):
    research_question: str = Field(..., description="用户输入的研究问题")
    columns: list[ColumnInfo] = Field(..., description="字段画像列表")


class InferVariablesResponse(BaseModel):
    dependent_variable: str | None = Field(None, description="被解释变量 Y")
    independent_variables: list[str] = Field(default_factory=list, description="解释变量 X")
    entity_column: str | None = Field(None, description="面板个体 ID 列")
    time_column: str | None = Field(None, description="时间列")
    treatment_column: str | None = Field(None, description="处理组或处理变量")
    running_variable: str | None = Field(None, description="RDD 断点运行变量")
    instrument_variable: str | None = Field(None, description="IV 工具变量")
    reasoning: str = Field(..., description="变量识别理由")
    provider: str = Field("rules", description="识别来源：rules 或 huawei_maas")
    maas_error: str | None = Field(None, description="MaaS 未启用或调用失败时的提示")


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


class ReportResponse(BaseModel):
    markdown: str
