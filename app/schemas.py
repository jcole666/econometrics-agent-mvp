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
    generated_code: str = Field(..., description="自动生成的 Python 代码模板")
